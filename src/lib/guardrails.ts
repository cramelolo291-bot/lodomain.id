// Deterministic guardrail screening, in the spirit of DeepTeam's vulnerability
// classes. Zero LLM calls: these rules run on every turn, inline, for free.
//
// They are a first filter, not a proof. Anything they miss is caught by the
// Red Team agent in the conversation itself.

import { GUARDRAILS, type Guardrail } from "../convex/schema";

export type Severity = "low" | "medium" | "high" | "critical";

export type Screening = {
  blocked: boolean;
  category: Guardrail;
  severity: Severity;
  reason: string;
};

export type Rule = {
  category: Guardrail;
  severity: Severity;
  reason: string;
  pattern: RegExp;
};

const RULES: Rule[] = [
  {
    category: GUARDRAILS.SYSTEM_PROMPT_LEAK,
    severity: "high",
    reason: "Attempts to extract the system prompt or hidden instructions.",
    pattern:
      /\b(reveal|show|print|repeat|output|dump|leak)\b[^.\n]{0,40}\b(your\s+)?(system\s+prompt|initial\s+instructions|hidden\s+instructions|the\s+prompt\s+above)\b/i,
  },
  {
    category: GUARDRAILS.PROMPT_INJECTION,
    severity: "high",
    reason: "Tries to override the operator's instructions mid-conversation.",
    pattern:
      /(ignore|disregard|forget|override|bypass)\b[^.\n]{0,30}\b(all\s+)?(previous|prior|above|earlier|your)\b[^.\n]{0,30}\b(instruction|instructions|prompt|prompts|rule|rules|guideline|guidelines)\b/i,
  },
  {
    category: GUARDRAILS.PROMPT_INJECTION,
    severity: "medium",
    reason: "Injects a new system-level turn from untrusted content.",
    pattern:
      /(\[|<|```)?\s*(system|assistant|developer)\s*(\]|:|>)\s*(you\s+are|now\s+you|new\s+instructions|from\s+now\s+on)/i,
  },
  {
    category: GUARDRAILS.JAILBREAK,
    severity: "medium",
    reason: "Roleplay framing used to shed the model's restrictions.",
    pattern:
      /\b(pretend|act as|roleplay|role-play|you\s+are\s+now)\b[^.\n]{0,40}\b(unrestricted|unfiltered|uncensored|no\s+rules|dan\s+mode|jailbroken|evil\s+ai)\b/i,
  },
  {
    category: GUARDRAILS.JAILBREAK,
    severity: "low",
    reason: "Known jailbreak payload markers.",
    pattern: /\b(do\s+anything\s+now|\bDAN\s+mode|developer\s+mode\s+enabled|sudo\s+mode)\b/i,
  },
  {
    category: GUARDRAILS.EXCESSIVE_AGENCY,
    severity: "high",
    reason: "Asks the agent to act beyond the authority the user actually holds.",
    pattern:
      /\b(delete|destroy|wipe|drop)\b[^.\n]{0,30}\b(all\s+)?(database|tables?|bucket|everything|production)\b|\b(transfer|wire|send)\b[^.\n]{0,20}\b(funds?|money|balance)\b/i,
  },
  {
    category: GUARDRAILS.CREDENTIAL_ACCESS,
    severity: "critical",
    reason: "Asks for secrets, tokens or private keys.",
    pattern:
      /\b(give|show|print|send|leak|dump|what\s+is|reveal)\b[^.\n]{0,30}\b(api\s*keys?|secret\s*keys?|private\s*keys?|access\s*tokens?|bearer\s+tokens?|passwords?|credentials?|env\s*vars?)\b/i,
  },
  {
    category: GUARDRAILS.CREDENTIAL_ACCESS,
    severity: "high",
    reason: "Bulk-harvest syntax for secrets, e.g. piping env or shadow files.",
    pattern:
      /(cat|printenv|env|echo|base64)\b[^|\n]{0,40}\||(cat|less|more)\b[^.\n]{0,20}\/etc\/(shadow|passwd)|\.aws\/credentials|\.env\b/i,
  },
  {
    category: GUARDRAILS.SHELL_INJECTION,
    severity: "critical",
    reason: "Shell command chaining that would execute on the host.",
    pattern:
      /[;&|]{1,2}\s*(curl|wget|bash|sh|nc|rm\s+-rf|chmod\s+777|python\s+-c|node\s+-e)\b|\$\([^)]+\)|`[^`]+`\s*\|/i,
  },
  {
    category: GUARDRAILS.PII_LEAKAGE,
    severity: "high",
    reason: "Message carries personal data that should not be stored or echoed.",
    pattern:
      /\b\d{3}-\d{2}-\d{4}\b|\b[\w.+-]+@[\w-]+\.[\w.]{2,}\b|\b(?:\d[ -]*?){13,16}\b|\b\+?\d{1,3}[\s-]?\(?\d{2,4}\)?[\s-]?\d{3,4}[\s-]?\d{3,4}\b/,
  },
];

export type Direction = "input" | "output";

/** Rules that make sense on an inbound prompt vs. a model answer. */
function rulesFor(direction: Direction): Rule[] {
  if (direction === "input") return RULES;
  // A model reply that trips a jailbreak marker is a real leak; PII matching on
  // output is noisy, so it stays inbound-only.
  return RULES.filter((r) => r.category !== GUARDRAILS.PII_LEAKAGE);
}

export function screen(
  text: string,
  direction: Direction = "input",
): Screening | null {
  if (!text || text.length < 8) return null;

  for (const rule of rulesFor(direction)) {
    if (rule.pattern.test(text)) {
      return {
        blocked: true,
        category: rule.category,
        severity: rule.severity,
        reason: rule.reason,
      };
    }
  }
  return null;
}

export const GUARDRAIL_LABELS: Record<Guardrail, string> = {
  prompt_injection: "Prompt injection",
  jailbreak: "Jailbreak",
  pii_leakage: "PII leakage",
  system_prompt_leak: "System prompt leak",
  excessive_agency: "Excessive agency",
  shell_injection: "Shell injection",
  credential_access: "Credential access",
};

export const SEVERITY_ORDER: Record<Severity, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};
