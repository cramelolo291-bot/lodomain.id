// The turn: one request in, one persisted answer out.
//
// Order is the whole design:
//   1. screen the prompt — a blocked request never touches the pool
//   2. claim a slot on the healthiest account (conditional UPDATE, no race)
//   3. call Ollama; on a retryable failure, cool that account and try the next
//   4. apply any file writes, store the message, write the trace, log usage
//
// Every stage is timed. Those timings are the `steps` array in the trace, which
// is what makes "why did it answer that" answerable.

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
import { env } from "../env";
import { chat, OllamaError, type ChatMessage } from "../ollama/client";
import { claim as poolClaim, classify, okOutcome, recordUsage, settle } from "../ollama/pool";
import { parseFileWrites, type FileWrite } from "./file-blocks";
import { systemPrompt } from "./prompts";

export type TurnResult =
  | { status: "ok"; traceId: string; changes: FileWrite[]; summary: string }
  | { status: "blocked"; guardrail: string; reason: string }
  | { status: "error"; reason: string };

const HISTORY_LIMIT = 40;

async function recentTurns(
  conversationId: string,
): Promise<ChatMessage[]> {
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
    .limit(HISTORY_LIMIT);

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

    await db
      .insert(projectFiles)
      .values({ projectId, path: write.path, content: write.content })
      .onConflictDoUpdate({
        target: [projectFiles.projectId, projectFiles.path],
        set: { content: write.content, updatedAt: new Date() },
      });

    applied.push(write);
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
  /** Overrides the model with the caller's local Ollama tag. */
  localModel?: string;
};

export async function runTurn(args: TurnArgs): Promise<TurnResult> {
  const started = Date.now();
  const steps: TraceStep[] = [];
  const push = (stage: string, detail: string, ms: number, status: TraceStep["status"] = "ok") =>
    steps.push({ stage, detail, ms, status });

  // 1 — guardrail
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
    return {
      status: "blocked",
      guardrail: finding.category,
      reason: finding.reason,
    };
  }
  push("guardrail", "clean", Date.now() - t0);

  await db.insert(messages).values({
    conversationId: args.conversationId,
    userId: args.userId,
    role: "user",
    content: args.prompt,
  });

  // 2 — pool. Try each account in turn; a 401/429 moves on to the next.
  const history = await recentTurns(args.conversationId);
  const agent = getAgent(args.agent);
  const modelDef = getModel(args.model);
  const localModel = args.localModel ?? modelDef.id;

  const system = systemPrompt(agent, modelDef, args.effort);
  const wire: ChatMessage[] = [
    { role: "system", content: system },
    ...history,
    { role: "user", content: args.prompt },
  ];

  let lastError = "No account in the pool had a free slot.";
  const claimedAt = Date.now();

  for (let attempt = 0; attempt < env.MAX_ATTEMPTS; attempt += 1) {
    const account = await poolClaim(db, localModel);
    if (!account) break;

    const claimMs = Date.now() - claimedAt;
    push("pool", `claimed ${account.label}`, claimMs);

    const t1 = Date.now();
    try {
      const result = await chat(localModel, wire, {
        temperature: 0.7,
        // A local model cannot hold a million tokens. Cap at what actually fits
        // in memory rather than sending the catalogue's headline number.
        numCtx: Math.min(modelDef.contextK * 1024, 32_768),
      });

      // 4 — apply, persist, measure
      const { writes, prose } = parseFileWrites(result.content);
      const applied = await applyWrites(args.projectId, writes);
      push("write", applied.length ? `${applied.length} file(s)` : "no file writes", Date.now() - t1);

      const body = prose || result.content || "(empty response)";
      const genMs = Date.now() - t1;
      push("upstream", `${result.tokensIn} in · ${result.tokensOut} out`, genMs);

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

      const [message] = await db
        .insert(messages)
        .values({
          conversationId: args.conversationId,
          userId: args.userId,
          role: "assistant",
          content: body,
          agent: args.agent,
          model: localModel,
          latencyMs: result.latencyMs,
          tokensIn: result.tokensIn,
          tokensOut: result.tokensOut,
        })
        .returning({ id: messages.id });

      const [trace] = await db
        .insert(traces)
        .values({
          conversationId: args.conversationId,
          userId: args.userId,
          prompt: args.prompt,
          agent: args.agent,
          model: localModel,
          account: account.label,
          ok: true,
          totalMs: Date.now() - started,
          tokensIn: result.tokensIn,
          tokensOut: result.tokensOut,
          steps,
        })
        .returning({ id: traces.id });

      return {
        status: "ok",
        traceId: trace!.id,
        changes: applied,
        summary: applied.length
          ? `Wrote ${applied.length} file${applied.length === 1 ? "" : "s"}`
          : "Answered without file changes",
      };
    } catch (e) {
      const status = e instanceof OllamaError ? e.status : 500;
      const outcome = classify(status);
      lastError = e instanceof Error ? e.message : String(e);

      push("upstream", `failed · ${status}`, Date.now() - t1, "error");
      await settle(db, account.id, outcome);
      await recordUsage(db, {
        userId: args.userId,
        accountId: account.id,
        model: localModel,
        agent: args.agent,
        effort: args.effort ?? null,
        tokensIn: 0,
        tokensOut: 0,
        latencyMs: Date.now() - t1,
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

  await db.insert(traces).values({
    conversationId: args.conversationId,
    userId: args.userId,
    prompt: args.prompt,
    agent: args.agent,
    model: localModel,
    ok: false,
    totalMs: Date.now() - started,
    steps,
  });

  return { status: "error", reason: lastError };
}

export type { Db };
