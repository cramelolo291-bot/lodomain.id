# LOLO.AI Infrastructure Agent

The first Infrastructure Agent slice is deliberately **plan-only**. It is mounted in the existing application and does not replace the landing page, chat, workspace, or server console.

## UI

Open `/infrastructure` after signing in. The navigation entry uses the existing AppShell. The page can draft plans for:

- VPS/server review
- DNS and domain changes
- Application deployment
- HTTPS/TLS setup
- Infrastructure audit

## API

All routes require an authenticated **admin** session.

- `GET /api/infrastructure/catalog` — lists supported plan categories and reports `executionEnabled: false`.
- `POST /api/infrastructure/plan` — validates and returns a plan.

Example request:

```json
{
  "target": "https",
  "task": "Plan HTTPS setup for app.example.com behind the existing reverse proxy. Include checks and rollback."
}
```

`target` accepts `vps`, `dns`, `deploy`, `https`, or `audit`. `task` must contain 8–2000 characters. The response has `status: "planned"`, `executionEnabled: false`, ordered steps, and safety notes.

## Explicit non-goals of this slice

This implementation does not connect to VPS/cloud/DNS accounts, execute shell commands, edit DNS, issue certificates, restart services, deploy code, or persist plans. A displayed plan is not evidence that the target infrastructure was inspected. The next implementation phase should add provider adapters with narrowly scoped credentials, durable audit records, replay protection, explicit per-action approval, and integration tests before enabling any live mutation.
