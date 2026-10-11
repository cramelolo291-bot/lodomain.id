import { Hono } from "hono";
import { z } from "zod";
import { requireAdmin } from "../auth/session";
import { body } from "../http/validate";

export const infrastructure = new Hono();
infrastructure.use("*", requireAdmin);

const requestBody = z.object({
  task: z.string().trim().min(8).max(2000),
  target: z.enum(["vps", "dns", "deploy", "https", "audit"]).default("audit"),
});

const CATALOG = [
  { id: "vps", label: "VPS / server", mode: "plan-only", requiresApproval: true },
  { id: "dns", label: "DNS", mode: "plan-only", requiresApproval: true },
  { id: "deploy", label: "Deployment", mode: "plan-only", requiresApproval: true },
  { id: "https", label: "HTTPS / TLS", mode: "plan-only", requiresApproval: true },
  { id: "audit", label: "Infrastructure audit", mode: "read-only-plan", requiresApproval: false },
] as const;

function makePlan(task: string, target: (typeof CATALOG)[number]["id"]) {
  const steps: string[] = {
    vps: [
      "Collect the provider, server identifier, OS, region, and access method.",
      "Inspect current service health, disk, memory, firewall, and listening ports.",
      "Draft the smallest required configuration change and a rollback command.",
      "Request explicit operator approval before any write, restart, firewall, or package action.",
    ],
    dns: [
      "Identify the DNS provider, zone, exact hostname, and intended record.",
      "Read current records and capture the current value and TTL.",
      "Preview the proposed record diff and check for conflicting records.",
      "Require explicit approval before changing or deleting any DNS record.",
    ],
    deploy: [
      "Identify the repository, branch/commit, build command, and target environment.",
      "Check environment-variable names without exposing secret values.",
      "Prepare a build, health-check, and rollback plan.",
      "Require explicit approval before publishing artifacts or switching production traffic.",
    ],
    https: [
      "Identify the hostname, reverse proxy, DNS status, and certificate method.",
      "Check port 80/443 reachability and existing certificate expiry.",
      "Draft certificate issuance, renewal, and redirect configuration.",
      "Require explicit approval before changing proxy configuration or reloading services.",
    ],
    audit: [
      "Inventory declared services, exposed ports, TLS status, and deployment configuration.",
      "Separate confirmed observations from unknowns; do not infer access or provider state.",
      "Prioritize findings by severity and include remediation plus rollback notes.",
    ],
  }[target];

  return {
    id: crypto.randomUUID(),
    target,
    task,
    status: "planned" as const,
    executionEnabled: false,
    approvalRequired: target !== "audit",
    createdAt: new Date().toISOString(),
    steps,
    safety: [
      "This endpoint creates a plan only; it does not connect to a VPS or DNS provider.",
      "No shell command, deployment, DNS update, certificate issuance, or service restart is executed.",
      "Live execution must be implemented with scoped provider credentials, an audit log, and a separate approval check.",
    ],
  };
}

infrastructure.get("/infrastructure/catalog", (c) =>
  c.json({ items: CATALOG, executionEnabled: false }),
);

infrastructure.post("/infrastructure/plan", async (c) => {
  const input = await body(c, requestBody);
  return c.json(makePlan(input.task, input.target), 201);
});
