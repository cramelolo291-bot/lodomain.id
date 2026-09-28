// The turn: one request in, one persisted answer out.
//
// Order is the whole design:
//   1. screen the prompt — a blocked request never touches the pool
//   2. provision any data-space tables the request implies
//   3. claim a slot on the healthiest account (conditional UPDATE, no race)
//   4. stream from Ollama; on a retryable failure, cool that account and try the
//      next one
//   5. screen the answer, apply file writes, store, trace, log usage
//
// Every stage emits an event and is timed. Those timings are the `steps` array
// in the trace, which is what makes "why did it answer that" answerable.
//
// `runTurn` is `streamTurn` with a listener that discards events, so the
// non-streaming and streaming paths can never drift apart.

import { and, asc, eq } from "drizzle-orm";
import { db, type Db } from "../db/client";
import {
  guardrailHits,
  messages,
  projectFiles,
  traces,
  type TraceStep,
} from "../db/schema";
import { screen } from "../../src/lib/guardrails";
import { getAgent, getModel, type Effort, type ModelDef } from "../../src/lib/catalog";
import { mergeTables, tablesForPrompt } from "../../src/lib/data";
import { env } from "../env";
import {
  chat,
  chatStream,
  OllamaError,
  type ChatMessage,
} from "../ollama/client";
import {
  claim as poolClaim,
  classify,
  okOutcome,
  recordUsage,
  settle,
} from "../ollama/pool";
import { budgetHistory, systemPrompt } from "./prompts";
import { parseFileWrites, type FileWrite } from "./file-blocks";
import { runBuild } from "../build/runner";
import { devServer, syncDev } from "../build/dev";
import { provisionTables } from "./data-space";

export type TurnResult =
  | {
      status: "ok";
      traceId: string;
      changes: FileWrite[];
      summary: string;
      content: string;
      /** Present when the agent asked for a build. */
      build?: {
        ok: boolean;
        code: number | null;
        ms: number;
        output: string;
        skipped?: string;
      };
    }
  | { status: "blocked"; guardrail: string; reason: string; direction: "input" | "output" }
  | { status: "error"; reason: string };

/** What the caller can observe while the turn is still running. */
export type TurnEvent =
  | { type: "step"; step: TraceStep }
  | { type: "delta"; text: string }
  | { type: "file"; path: string; op: "created" | "modified" }
  | { type: "table"; name: string; rows: number }
  /** A line of build output, as it arrives. */
  | { type: "build"; line: string }
  /** The build finished, whatever the outcome. */
  | { type: "buildDone"; ok: boolean; code: number | null; ms: number; skipped?: string }
  | { type: "done"; result: TurnResult };

export type Emit = (event: TurnEvent) => void;

const noop: Emit = () => {};

/**
 * How many times the agent may look at its own build output and try again
 * inside one turn.
 *
 * Two is a deliberate ceiling. Each cycle is a full model call plus an install
 * plus a build, so a turn could go from two seconds to five minutes. And a
 * model that cannot fix it in two goes is not going to fix it in twenty — it is
 * going to loop. The user always gets an answer; it just may be "here is what
 * the build says, and here is what I tried".
 */
const MAX_REPAIRS = 2;

/** How much of a build log is worth putting back in front of the model. */
const MAX_REPAIR_OUTPUT = 4_000;

/** Tells the model what happened and what to do about it. */
function repairPrompt(output: string, cycle: number, max: number): string {
  const tail = output.slice(-MAX_REPAIR_OUTPUT);
  return `The build failed. Here is its output:

\`\`\`
${tail}
\`\`\`

Fix it. Rewrite only the files that need changing with \`lolo:write\`, and add a
\`lolo:build\` block so it is checked again. This is attempt ${cycle} of ${max} —
if you cannot fix it, say what is wrong instead of trying a blind edit.`;
}

/** Everything the repair loop needs, so its signature stays readable. */
type RepairContext = {
  projectId: string;
  userId: string;
  localModel: string;
  modelDef: ModelDef;
  wire: ChatMessage[];
  emit: Emit;
  push: (
    stage: string,
    detail: string,
    ms: number,
    status?: "ok" | "warn" | "error",
  ) => void;
  stream: boolean;
};

/**
 * Hands the model its own build output and lets it try again.
 *
 * This is what turns "writes files" into "does the work": a build that fails is
 * not a failure of the turn, it is the next thing the agent has to look at. The
 * loop stops as soon as a build passes, the model declines to change anything,
 * or the budget runs out.
 *
 * The output guardrail runs here too. Repair text is model output like any
 * other, and skipping it would be a hole exactly where an attacker would look.
 */
async function repairAfterFailedBuild(
  ctx: RepairContext,
  lastContent: string,
  buildOutput: string,
): Promise<void> {
  const conversation: ChatMessage[] = [
    ...ctx.wire,
    { role: "assistant", content: lastContent },
    { role: "user", content: repairPrompt(buildOutput, 1, MAX_REPAIRS) },
  ];

  for (let cycle = 1; cycle <= MAX_REPAIRS; cycle += 1) {
    const account = await poolClaim(db, ctx.localModel);
    if (!account) {
      ctx.push("repair", "no account free for a repair", 0, "warn");
      return;
    }

    const started = Date.now();
    ctx.push("repair", `attempt ${cycle}/${MAX_REPAIRS}`, started, "warn");

    let content: string;
    let tokensIn: number;
    let tokensOut: number;
    try {
      const options = {
        temperature: 0.4, // Lower than a first answer: this is a correction.
        numCtx: Math.min(ctx.modelDef.contextK * 1024, 32_768),
      };

      if (ctx.stream) {
        const chunks: string[] = [];
        await collect(
          chatStream(ctx.localModel, conversation, options),
          (e) => {
            if (e.type === "delta") chunks.push(e.text);
          },
        );
        content = chunks.join("");
        tokensIn = 0;
        tokensOut = 0;
      } else {
        const result = await chat(ctx.localModel, conversation, options);
        content = result.content;
        tokensIn = result.tokensIn;
        tokensOut = result.tokensOut;
      }
    } catch (e) {
      ctx.push(
        "repair",
        `upstream failed: ${e instanceof Error ? e.message : String(e)}`,
        Date.now() - started,
        "error",
      );
      return;
    }

    const leak = screen(content, "output");
    if (leak) {
      ctx.push("repair", `blocked · ${leak.category}`, Date.now() - started, "error");
      return;
    }

    if (tokensIn || tokensOut) {
      await recordUsage(db, {
        userId: ctx.userId,
        accountId: account.id,
        model: ctx.localModel,
        agent: "lolo",
        effort: null,
        tokensIn,
        tokensOut,
        latencyMs: Date.now() - started,
        ok: true,
      });
    }

    const { writes } = parseFileWrites(content);
    if (writes.length === 0) {
      // It declined to change anything. That is a legitimate ending — a model
      // explaining why it cannot fix something beats a model thrashing.
      ctx.push("repair", "no further changes proposed", Date.now() - started, "warn");
      return;
    }

    const applied = await applyWrites(ctx.projectId, writes);
    for (const w of applied) ctx.emit({ type: "file", path: w.path, op: "modified" });

    const files = await db
      .select({ path: projectFiles.path, content: projectFiles.content })
      .from(projectFiles)
      .where(eq(projectFiles.projectId, ctx.projectId));

    const build = await runBuild(
      ctx.projectId,
      Object.fromEntries(files.map((f) => [f.path, f.content])),
      "build",
      { onOutput: (line) => ctx.emit({ type: "build", line }) },
    );

    ctx.emit({
      type: "buildDone",
      ok: build.ok,
      code: build.code,
      ms: build.ms,
      ...(build.skipped ? { skipped: build.skipped } : {}),
    });

    if (build.ok) {
      ctx.push("repair", `build passed after ${cycle} attempt(s)`, Date.now() - started);
      return;
    }
    if (build.skipped) {
      ctx.push("repair", build.skipped, Date.now() - started, "warn");
      return;
    }

    conversation.push(
      { role: "assistant", content },
      { role: "user", content: repairPrompt(build.output, cycle + 1, MAX_REPAIRS) },
    );
    ctx.push(
      "repair",
      `still failing (${build.code ?? "timeout"})`,
      Date.now() - started,
      "error",
    );
  }

  ctx.push("repair", `gave up after ${MAX_REPAIRS} attempts`, 0, "warn");
}

async function recentTurns(conversationId: string): Promise<ChatMessage[]> {
  const rows = await db
    .select({ role: messages.role, content: messages.content })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversationId),
        eq(messages.blocked, false),
      ),
    )
    .orderBy(asc(messages.createdAt))
    // Read a generous window, then let compaction decide what actually fits.
    .limit(200);

  return rows
    .map((r) => ({ role: r.role as ChatMessage["role"], content: r.content }))
    .filter((m) => m.content.length > 0);
}

async function applyWrites(projectId: string, writes: FileWrite[]): Promise<FileWrite[]> {
  const applied: FileWrite[] = [];

  for (const write of writes) {
    const existing = await db
      .select({ content: projectFiles.content })
      .from(projectFiles)
      .where(
        and(eq(projectFiles.projectId, projectId), eq(projectFiles.path, write.path)),
      )
      .limit(1);

    const before = existing[0]?.content ?? null;
    if (before === write.content) continue;

    const [row] = await db
      .insert(projectFiles)
      .values({ projectId, path: write.path, content: write.content })
      .onConflictDoUpdate({
        target: [projectFiles.projectId, projectFiles.path],
        set: { content: write.content, updatedAt: new Date() },
      })
      .returning({ createdAt: projectFiles.createdAt });

    applied.push(write);
    void row;
  }

  return applied;
}

export type TurnArgs = {
  conversationId: string;
  projectId: string;
  userId: string;
  prompt: string;
  agent: string;
  model: string;
  effort?: Effort;
  /** Overrides the catalogue model with the caller's local Ollama tag. */
  localModel?: string;
  /** Stream tokens instead of waiting for the whole answer. */
  stream?: boolean;
};

export async function streamTurn(args: TurnArgs, emit: Emit = noop): Promise<TurnResult> {
  const started = Date.now();
  const steps: TraceStep[] = [];

  const push = (
    stage: string,
    detail: string,
    ms: number,
    status: TraceStep["status"] = "ok",
  ) => {
    const step: TraceStep = { stage, detail, ms, status };
    steps.push(step);
    emit({ type: "step", step });
  };

  const finish = async (result: TurnResult): Promise<TurnResult> => {
    emit({ type: "done", result });
    return result;
  };

  /**
   * Filled in by the build stage and attached to the result. A `let` rather
   * than a return value because the build sits between writing files and
   * persisting the turn, and the result is assembled at the end.
   */
  let buildSummary:
    | { ok: boolean; code: number | null; ms: number; output: string; skipped?: string }
    | undefined;

  // ── 1. Input guardrail ───────────────────────────────────────────────────
  const t0 = Date.now();
  const finding = screen(args.prompt);
  if (finding) {
    push("guardrail", `blocked · ${finding.category}`, Date.now() - t0, "error");
    await db.insert(messages).values({
      conversationId: args.conversationId,
      userId: args.userId,
      role: "user",
      content: args.prompt,
      blocked: true,
      guardrail: finding.category,
      guardrailReason: finding.reason,
    });
    await db.insert(guardrailHits).values({
      userId: args.userId,
      category: finding.category,
      severity: finding.severity,
      direction: "input",
      match: finding.reason,
      excerpt: args.prompt.slice(0, 280),
    });
    return finish({
      status: "blocked",
      guardrail: finding.category,
      reason: finding.reason,
      direction: "input",
    });
  }
  push("guardrail", "clean", Date.now() - t0);

  await db.insert(messages).values({
    conversationId: args.conversationId,
    userId: args.userId,
    role: "user",
    content: args.prompt,
  });

  // ── 2. Data space ────────────────────────────────────────────────────────
  const tData = Date.now();
  const wanted = tablesForPrompt(args.prompt);
  if (wanted.length) {
    const provisioned = await provisionTables(db, args.projectId, wanted);
    for (const p of provisioned) {
      emit({ type: "table", name: p.name, rows: p.rows });
    }
    push(
      "data",
      provisioned.length
        ? `provisioned ${provisioned.length} ${provisioned.length === 1 ? "table" : "tables"}`
        : "schema already present",
      Date.now() - tData,
    );
  }

  // ── 3. Context ───────────────────────────────────────────────────────────
  const tCtx = Date.now();
  const history = await recentTurns(args.conversationId);
  const agent = getAgent(args.agent);
  const modelDef = getModel(args.model);
  const localModel = args.localModel ?? modelDef.id;

  const system = systemPrompt(agent, modelDef, args.effort);
  // A local model cannot hold a million tokens. Compaction drops the middle of
  // the conversation and keeps the opening and the most recent turns.
  const compacted = budgetHistory(
    [...history, { role: "user" as const, content: args.prompt }],
    Math.min(modelDef.contextK * 1024, 32_768) / 2,
  );

  const wire: ChatMessage[] = [{ role: "system", content: system }, ...compacted];
  const dropped = history.length + 1 - compacted.length;
  push(
    "context",
    dropped > 0
      ? `${compacted.length} turns kept · ${dropped} compacted away`
      : `${compacted.length} turns`,
    Date.now() - tCtx,
  );

  // ── 4. Pool ──────────────────────────────────────────────────────────────
  let lastError = "No account in the pool had a free slot.";

  for (let attempt = 0; attempt < env.MAX_ATTEMPTS; attempt += 1) {
    const account = await poolClaim(db, localModel);
    if (!account) break;

    const tClaim = Date.now();
    push("pool", `claimed ${account.label}`, tClaim);

    const tGen = Date.now();
    try {
      const options = {
        temperature: 0.7,
        numCtx: Math.min(modelDef.contextK * 1024, 32_768),
      };

      const result = args.stream
        ? await collect(chatStream(localModel, wire, options), emit)
        : await chat(localModel, wire, options);

      // ── 5. Output guardrail ──────────────────────────────────────────────
      const tOut = Date.now();
      const leak = screen(result.content, "output");
      if (leak) {
        push("output", `blocked · ${leak.category}`, Date.now() - tOut, "error");
        await settle(db, account.id, okOutcome);
        await recordUsage(db, {
          userId: args.userId,
          accountId: account.id,
          model: localModel,
          agent: args.agent,
          effort: args.effort ?? null,
          tokensIn: result.tokensIn,
          tokensOut: result.tokensOut,
          latencyMs: result.latencyMs,
          ok: true,
        });
        await db.insert(guardrailHits).values({
          userId: args.userId,
          category: leak.category,
          severity: leak.severity,
          direction: "output",
          match: leak.reason,
          excerpt: result.content.slice(0, 280),
        });
        await db.insert(messages).values({
          conversationId: args.conversationId,
          userId: args.userId,
          role: "assistant",
          content:
            "The answer was withheld: it tripped an output rule " +
            `(${leak.category}). Nothing was written to the project.`,
          agent: args.agent,
          model: localModel,
          blocked: true,
          guardrail: leak.category,
          guardrailReason: leak.reason,
        });
        await writeTrace(args, {
          steps,
          started,
          ok: false,
          model: localModel,
          account: account.label,
          tokensIn: result.tokensIn,
          tokensOut: result.tokensOut,
        });
        return finish({
          status: "blocked",
          guardrail: leak.category,
          reason: leak.reason,
          direction: "output",
        });
      }
      push("output", "clean", Date.now() - tOut);

      // ── 6. Apply ────────────────────────────────────────────────────────
      const tWrite = Date.now();
      const { writes, prose, builds } = parseFileWrites(result.content);
      const applied = await applyWrites(args.projectId, writes);
      for (const w of applied) emit({ type: "file", path: w.path, op: "created" });
      push(
        "write",
        applied.length ? `${applied.length} file(s)` : "no file writes",
        Date.now() - tWrite,
      );

      // The agent asked to check its own work. One build per turn, ever: a
      // small model will emit the directive repeatedly, and each run installs
      // dependencies. The cap is here rather than in the model prompt because a
      // prompt is advice and this is a rule.
      //
      // The project files are read once and used for both the live sync and the
      // build — two queries of the same rows in one turn is the kind of thing
      // that quietly disagrees with itself later.
      const files = await db
        .select({ path: projectFiles.path, content: projectFiles.content })
        .from(projectFiles)
        .where(eq(projectFiles.projectId, args.projectId));
      const fileMap = Object.fromEntries(files.map((f) => [f.path, f.content]));

      // A running dev server keeps its own copy on disk. Push the writes into
      // it so the watcher fires and the preview updates as the agent works,
      // without restarting the process and losing its state.
      if (applied.length > 0 && devServer(args.projectId)) {
        const tSync = Date.now();
        const synced = await syncDev(args.projectId, fileMap);
        push(
          "live",
          synced.changed ? `synced ${synced.changed} file(s)` : "already in sync",
          Date.now() - tSync,
        );
      }

      if (builds.length > 0) {
        const tBuild = Date.now();
        const target = builds[0]!;

        const build = await runBuild(
          args.projectId,
          fileMap,
          target,
          { onOutput: (line) => emit({ type: "build", line }) },
        );

        buildSummary = {
          ok: build.ok,
          code: build.code,
          ms: build.ms,
          output: build.output,
          ...(build.skipped ? { skipped: build.skipped } : {}),
        };

        emit({
          type: "buildDone",
          ok: build.ok,
          code: build.code,
          ms: build.ms,
          ...(build.skipped ? { skipped: build.skipped } : {}),
        });
        push(
          "build",
          build.skipped
            ? build.skipped
            : build.ok
              ? `${target} ok in ${(build.ms / 1000).toFixed(1)}s`
              : `${target} failed (${build.code ?? "timeout"})`,
          Date.now() - tBuild,
        );

        // A failed build is not the end of the turn — it is the next thing the
        // agent has to look at. Hand it the output and let it try to fix it.
        if (!build.ok && !build.skipped) {
          await repairAfterFailedBuild(
            {
              projectId: args.projectId,
              userId: args.userId,
              localModel,
              modelDef,
              wire,
              emit,
              push,
              stream: Boolean(args.stream),
            },
            result.content,
            build.output,
          );
        }
      }

      const body = prose || result.content || "(empty response)";
      push(
        "upstream",
        `${result.tokensIn} in · ${result.tokensOut} out`,
        Date.now() - tGen,
      );

      // ── 7. Persist ──────────────────────────────────────────────────────
      await settle(db, account.id, okOutcome);
      await recordUsage(db, {
        userId: args.userId,
        accountId: account.id,
        model: localModel,
        agent: args.agent,
        effort: args.effort ?? null,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        latencyMs: result.latencyMs,
        ok: true,
      });

      await db.insert(messages).values({
        conversationId: args.conversationId,
        userId: args.userId,
        role: "assistant",
        content: body,
        agent: args.agent,
        model: localModel,
        latencyMs: result.latencyMs,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
      });

      const traceId = await writeTrace(args, {
        steps,
        started,
        ok: true,
        model: localModel,
        account: account.label,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
      });

      return finish({
        status: "ok",
        traceId,
        changes: applied,
        content: body,
        ...(buildSummary ? { build: buildSummary } : {}),
        summary: buildSummary
          ? `${buildSummary.ok ? "Build passed" : "Build failed"} · ${applied.length} file${applied.length === 1 ? "" : "s"}`
          : applied.length
            ? `Wrote ${applied.length} file${applied.length === 1 ? "" : "s"}`
            : "Answered without file changes",
      });
    } catch (e) {
      const status = e instanceof OllamaError ? e.status : 500;
      const outcome = classify(status);
      lastError = e instanceof Error ? e.message : String(e);

      push("upstream", `failed · ${status}`, Date.now() - tGen, "error");
      await settle(db, account.id, outcome);
      await recordUsage(db, {
        userId: args.userId,
        accountId: account.id,
        model: localModel,
        agent: args.agent,
        effort: args.effort ?? null,
        tokensIn: 0,
        tokensOut: 0,
        latencyMs: Date.now() - tGen,
        ok: false,
      });

      if (!outcome.retryable) break;
    }
  }

  await db.insert(messages).values({
    conversationId: args.conversationId,
    userId: args.userId,
    role: "assistant",
    content: lastError,
    agent: args.agent,
    model: localModel,
  });

  await writeTrace(args, {
    steps,
    started,
    ok: false,
    model: localModel,
    account: null,
    tokensIn: 0,
    tokensOut: 0,
  });

  return finish({ status: "error", reason: lastError });
}

async function writeTrace(
  args: TurnArgs,
  meta: {
    steps: TraceStep[];
    started: number;
    ok: boolean;
    model: string;
    account: string | null;
    tokensIn: number;
    tokensOut: number;
  },
): Promise<string> {
  const [row] = await db
    .insert(traces)
    .values({
      conversationId: args.conversationId,
      userId: args.userId,
      prompt: args.prompt,
      agent: args.agent,
      model: meta.model,
      account: meta.account,
      ok: meta.ok,
      totalMs: Date.now() - meta.started,
      tokensIn: meta.tokensIn,
      tokensOut: meta.tokensOut,
      steps: meta.steps,
    })
    .returning({ id: traces.id });
  return row!.id;
}

/** Drains a stream, forwarding deltas, and returns the assembled result. */
async function collect(
  stream: AsyncGenerator<{ delta: string; done: boolean; result?: Awaited<ReturnType<typeof chat>> }>,
  emit: Emit,
): Promise<{ content: string; tokensIn: number; tokensOut: number; latencyMs: number; model: string }> {
  let content = "";
  let last: Awaited<ReturnType<typeof chat>> | undefined;

  for await (const event of stream) {
    if (event.delta) {
      content += event.delta;
      emit({ type: "delta", text: event.delta });
    }
    if (event.result) last = event.result;
  }

  return (
    last ?? { content, tokensIn: 0, tokensOut: 0, latencyMs: 0, model: "unknown" }
  );
}

/** Non-streaming convenience wrapper. Identical behaviour, no events. */
export function runTurn(args: TurnArgs): Promise<TurnResult> {
  return streamTurn({ ...args, stream: false }, noop);
}

export { mergeTables };
export type { Db };
