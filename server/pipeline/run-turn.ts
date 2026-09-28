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
import { getAgent, getModel, type Effort } from "../../src/lib/catalog";
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
import { provisionTables } from "./data-space";

export type TurnResult =
  | { status: "ok"; traceId: string; changes: FileWrite[]; summary: string; content: string }
  | { status: "blocked"; guardrail: string; reason: string; direction: "input" | "output" }
  | { status: "error"; reason: string };

/** What the caller can observe while the turn is still running. */
export type TurnEvent =
  | { type: "step"; step: TraceStep }
  | { type: "delta"; text: string }
  | { type: "file"; path: string; op: "created" | "modified" }
  | { type: "table"; name: string; rows: number }
  | { type: "done"; result: TurnResult };

export type Emit = (event: TurnEvent) => void;

const noop: Emit = () => {};

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
      const { writes, prose } = parseFileWrites(result.content);
      const applied = await applyWrites(args.projectId, writes);
      for (const w of applied) emit({ type: "file", path: w.path, op: "created" });
      push(
        "write",
        applied.length ? `${applied.length} file(s)` : "no file writes",
        Date.now() - tWrite,
      );

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
        summary: applied.length
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
