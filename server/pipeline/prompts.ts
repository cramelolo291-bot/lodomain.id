// System prompts.
//
// The four agents from the freebuff roster, written for a small local model:
// short, concrete, one job. Long prompts make a 7B model wander, so each one
// states the deliverable and the file protocol and stops.

import type { AgentDef, Effort, ModelDef } from "../../src/lib/catalog";

const FILE_PROTOCOL = `When you need to change the project, write files with this exact format:

\`\`\`lolo:write path/to/file.ext
...file contents...
\`\`\`

Rules:
- one file per block
- paths are relative, no leading slash, no ".."
- no explanation inside the block
- prose before or after the blocks is shown to the user as your answer`;

const BUILD_PROTOCOL = `To check your work, ask for a real build with:

\`\`\`lolo:build
\`\`\`

The target is optional: \`\`\`lolo:build typecheck\`\`\` or \`\`\`lolo:build test\`\`\`.
Valid targets are build, typecheck, test, install. Anything else is ignored.

Rules:
- at most one per answer, and only the first is run
- only after you have written the files, never before
- the output is streamed to the user; read it and fix what it reports
- the project needs a package.json with a matching script, or the build is skipped`;

function effortNote(effort: Effort | undefined): string {
  if (!effort) return "";
  switch (effort) {
    case "minimal":
    case "low":
      return "\nBe brief. Ship the smallest correct change, no preamble.";
    case "medium":
      return "\nExplain the approach in two or three sentences before the code.";
    case "high":
    case "xhigh":
      return "\nThink through the tradeoffs and state them before writing. Cover the failure cases.";
    case "max":
      return "\nBe thorough. Cover edge cases, error paths, and what you would do next.";
  }
}

export function systemPrompt(
  agent: AgentDef,
  model: ModelDef,
  effort?: Effort,
): string {
  const base = `You are ${agent.name} (${agent.tagline}), part of Lolo AI — a self-hosted agent server running on the operator's own machine.

${agent.description}

Context you can rely on:
- The model serving you is ${model.label} by ${model.vendor}, running locally via Ollama.
- Best suited to: ${model.bestFor}.
- The user is the operator and their friends. They are technical.
- You have no internet access. Do not claim to have fetched anything.

${FILE_PROTOCOL}

${BUILD_PROTOCOL}${effortNote(effort)}`;

  return base.trim();
}

/** Keeps the conversation inside a window the local model can actually hold. */
export function budgetHistory(
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  maxChars: number,
): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  if (messages.length === 0) return messages;

  const system = messages[0]?.role === "system" ? [messages[0]!] : [];
  const rest = messages.slice(system.length);

  // Drop from the middle, never the first or last. The opening request carries
  // the intent; the last turn carries the question.
  const kept: typeof rest = [];
  let total = system.reduce((n, m) => n + m.content.length, 0);

  for (const m of rest) {
    if (total + m.content.length > maxChars) continue;
    kept.push(m);
    total += m.content.length;
  }

  if (kept.length >= 2) return [...system, ...kept];
  return [...system, ...rest.slice(-2)];
}
