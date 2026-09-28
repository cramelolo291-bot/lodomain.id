// Deterministic guardrail screening, in the spirit of DeepTeam's vulnerability
// classes. Zero LLM calls: these rules run on every turn, inline, for free.
//
// They are a first filter, not a proof. Anything they miss is caught by the
// Red Team agent inside the conversation itself.
//
// No imports, so the browser and the Hono server can both run the exact same
// rules against the exact same text.

export type GuardrailCategory =
  | "prompt_injection"
  | "jailbreak"
  | "pii_leakage"
  | "system_prompt_leak"
  | "excessive_agency"
  | "shell_injection"
  | "credential_access";

export type Severity = "low" | "medium" | "high" | "critical";

export type Screening = {
  blocked: boolean;
  category: GuardrailCategory;
  severity: Severity;
  reason: string;
};

type Rule = {
  category: GuardrailCategory;
  severity: Severity;
  reason: string;
  pattern: RegExp;
};

const RULES: Rule[] = [
  {
    category: "system_prompt_leak",
    severity: "high",
    reason: "Attempts to extract the system prompt or hidden instructions.",
    pattern:
      /\b(reveal|show|print|repeat|output|dump|leak)\b[^.\n]{0,40}\b(your\s+)?(system\s+prompt|initial\s+instructions|hidden\s+instructions|the\s+prompt\s+above)\b/i,
  },
  {
    category: "prompt_injection",
    severity: "high",
    reason: "Tries to override the operator's instructions mid-conversation.",
    pattern:
      /(ignore|disregard|forget|override|bypass)\b[^.\n]{0,30}\b(all\s+)?(previous|prior|above|earlier|your)\b[^.\n]{0,30}\b(instruction|instructions|prompt|prompts|rule|rules|guideline|guidelines)\b/i,
  },
  {
    category: "prompt_injection",
    severity: "medium",
    reason: "Injects a new system-level turn from untrusted content.",
    pattern:
      /(\[|<|```)?\s*(system|assistant|developer)\s*(\]|:|>)\s*(you\s+are|now\s+you|new\s+instructions|from\s+now\s+on)/i,
  },
  {
    category: "jailbreak",
    severity: "medium",
    reason: "Roleplay framing used to shed the model's restrictions.",
    pattern:
      /\b(pretend|act as|roleplay|role-play|you\s+are\s+now)\b[^.\n]{0,40}\b(unrestricted|unfiltered|uncensored|no\s+rules|dan\s+mode|jailbroken|evil\s+ai)\b/i,
  },
  {
    category: "jailbreak",
    severity: "low",
    reason: "Known jailbreak payload markers.",
    pattern:
      /\b(do\s+anything\s+now|\bDAN\s+mode|developer\s+mode\s+enabled|sudo\s+mode)\b/i,
  },
  {
    category: "excessive_agency",
    severity: "high",
    reason: "Asks the agent to act beyond the authority the user actually holds.",
    pattern:
      /\b(delete|destroy|wipe|drop)\b[^.\n]{0,30}\b(all\s+)?(database|tables?|bucket|everything|production)\b|\b(transfer|wire|send)\b[^.\n]{0,20}\b(funds?|money|balance)\b/i,
  },
  {
    category: "credential_access",
    severity: "critical",
    reason: "Asks for secrets, tokens or private keys.",
    pattern:
      /\b(give|show|print|send|leak|dump|what\s+is|reveal)\b[^.\n]{0,30}\b(api\s*keys?|secret\s*keys?|private\s*keys?|access\s*tokens?|bearer\s*tokens?|passwords?|credentials?|env\s*vars?)\b/i,
  },
  {
    category: "credential_access",
    severity: "high",
    reason: "Bulk-harvest syntax for secrets, e.g. piping env or shadow files.",
    pattern:
      /(cat|printenv|env|echo|base64)\b[^|\n]{0,40}\||(cat|less|more)\b[^.\n]{0,20}\/etc\/(shadow|passwd)|\.aws\/credentials|\.env\b/i,
  },
  {
    category: "shell_injection",
    severity: "critical",
    reason: "Shell command chaining that would execute on the host.",
    pattern:
      /[;&|]{1,2}\s*(curl|wget|bash|sh|nc|rm\s+-rf|chmod\s+777|python\s+-c|node\s+-e)\b|\$\([^)]+\)|`[^`]+`\s*\|/i,
  },
  {
    category: "pii_leakage",
    severity: "high",
    reason: "Message carries personal data that should not be stored or echoed.",
    pattern:
      /\b\d{3}-\d{2}-\d{4}\b|\b[\w.+-]+@[\w-]+\.[\w.]{2,}\b|\b(?:\d[ -]*?){13,16}\b|\b\+?\d{1,3}[\s-]?\(?\d{2,4}\)?[\s-]?\d{3,4}[\s-]?\d{3,4}\b/,
  },
];

/**
 * Rules for what the *model says*, which is a different question from what the
 * user asks.
 *
 * The input rules are phrased as requests ("give me your api key"), so they
 * never match a reply that actually contains a secret. These match the material
 * itself. They are deliberately high-signal: a secret value in a recognisable
 * format, not a keyword. Code the agent writes — `process.env.RESEND_API_KEY`,
 * a `.env.example` — has no value and must not trip anything here.
 */
const OUTPUT_RULES: Rule[] = [
  {
    category: "credential_access",
    severity: "critical",
    reason: "The answer contains live credential material.",
    pattern:
      /-----BEGIN [A-Z ]*PRIVATE KEY-----|sk-lolo-[A-Za-z0-9_-]{16,}|sk-[A-Za-z0-9]{32,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|xox[baprs]-[A-Za-z0-9-]{10,}/,
  },
  {
    category: "credential_access",
    severity: "critical",
    reason: "The answer contains a connection string with an inline password.",
    pattern:
      /\b(postgres|postgresql|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^\s:/@]+:[^\s@/]+@/i,
  },
  {
    category: "credential_access",
    severity: "high",
    reason: "The answer states the value of a secret rather than its name.",
    // The type name after a colon is not a value: `password: varchar(255)` and
    // `secret: required` are schema definitions, not leaks. Anything shorter
    // than six characters is a type name, a placeholder, or a variable.
    pattern:
      /\b(password|passwd|secret|api[\s_-]?key|access[\s_-]?token|auth[\s_-]?token)\b\s*(is|are|=|:)\s*["'`]?(?!(?:varchar|text|string|boolean|bool|integer|number|required|optional|not\s+null|null)\b)[A-Za-z0-9_\-+/=.]{6,}/i,
  },
  {
    category: "credential_access",
    severity: "high",
    reason: "The answer contains a signed token.",
    pattern: /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/,
  },
  {
    category: "system_prompt_leak",
    severity: "high",
    reason: "The answer reproduces the system prompt or the agent's instructions.",
    pattern:
      /you\s+are\s+\w+[^\n]{0,40}part\s+of\s+lolo\s+ai|(here\s+(are|is)\s+my\s+(system\s+)?(prompt|instructions))|(my\s+(system\s+)?instructions\s+(are|were)\s*:)/i,
  },
  {
    category: "prompt_injection",
    severity: "high",
    reason: "The answer tries to issue instructions to a later turn.",
    pattern:
      /(ignore|disregard|forget)\b[^.\n]{0,30}\b(previous|prior|above|earlier)\b[^.\n]{0,30}\b(instruction|instructions|prompt|prompts|rule|rules)\b/i,
  },
];

export type Direction = "input" | "output";

function rulesFor(direction: Direction): Rule[] {
  // PII matching is noisy on a reply — an email address in a code sample is
  // not a leak — so it stays inbound only.
  if (direction === "input") return RULES;
  return OUTPUT_RULES;
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

export const GUARDRAIL_LABELS: Record<GuardrailCategory, string> = {
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

/**
 * The attack techniques the Red Team agent knows to try, shown in the server
 * panel so the coverage is legible rather than a black box.
 */
export const ATTACK_TECHNIQUES: Array<{
  name: string;
  targets: GuardrailCategory[];
}> = [
  { name: "Prompt injection", targets: ["prompt_injection"] },
  { name: "System override", targets: ["prompt_injection", "system_prompt_leak"] },
  { name: "Context poisoning", targets: ["prompt_injection"] },
  { name: "Roleplay / DAN", targets: ["jailbreak"] },
  { name: "Base64 & leetspeak", targets: ["jailbreak"] },
  { name: "Crescendo (multi-turn)", targets: ["jailbreak"] },
  { name: "Goal redirection", targets: ["excessive_agency"] },
  { name: "System reconnaissance", targets: ["system_prompt_leak"] },
  { name: "Shell & SQL injection", targets: ["shell_injection"] },
  { name: "Credential harvesting", targets: ["credential_access"] },
  { name: "PII extraction", targets: ["pii_leakage"] },
  { name: "Agent identity spoofing", targets: ["prompt_injection"] },
];
