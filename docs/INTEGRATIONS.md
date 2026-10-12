# LoloDomain modular integrations

This repository is the host workspace. Integrations are intentionally separate modules, not copied source trees embedded in the frontend.

## Route map

| Route | Upstream | Responsibility |
| --- | --- | --- |
| `/integrations` | Module registry | Entry point and discovery |
| `/messages` | [Rocket.Chat](https://github.com/RocketChat/Rocket.Chat) | Team messaging |
| `/browser` | [OpenBrowser AI](https://github.com/billy-enrizky/openbrowser-ai) | Browser automation |
| `/security` | [Strix](https://github.com/usestrix/strix) | Authorized application security testing |
| `/cloud` | [OmniCloud](https://github.com/dimartarmizi/OmniCloud) | Cloud storage aggregation |
| `/reverse-engineering` | [REA](https://github.com/morluto/rea) | Reverse engineering and analysis |
| `/deploy` | [Railway](https://github.com/railwayapp) | Deployment platform workflows |
| `/design` | [anti-slop](https://github.com/miqdadbadjuber/anti-slop) | UI quality rules and review checklist |

## Current implementation status

The module registry, individual routes, source links, UI and safety notes are present. Per-user module metadata is persisted in PostgreSQL through the authenticated `/api/modules` API and the `module_connections` table. Module pages can save a non-secret HTTPS endpoint and an enabled preference. This is configuration only: modules are **not yet runtime-integrated**, no upstream health checks run, and `healthy` must never be inferred from a saved endpoint.

## Integration boundaries

- Keep one Lolo identity and PostgreSQL instance for host-level users, module metadata, task records, and audit events.
- Keep service-owned data where it belongs: Rocket.Chat messages in Rocket.Chat; cloud files in their provider; security artifacts and browser sessions in isolated workers/storage.
- Never put provider tokens in frontend code, localStorage, repository files, or ordinary module metadata. Use server-side secret storage and expose only connection status to the browser.
- Run browser automation, security testing, and reverse engineering in separate workers/containers with least privilege, resource limits, restricted network access, and explicit authorization.
- Require a confirmation for side effects such as deployment, rollback, destructive cloud operations, or active security scans.
- Add a backend adapter only after reviewing each upstream project's license, runtime requirements, environment variables, and security model. Prefer a separately deployed service behind an authenticated internal API over a monolithic source-code merge.

## Suggested delivery order

1. Implement authenticated server-side adapter interfaces and real health checks for each module; validate destinations with SSRF-safe rules before making outbound requests.
2. Bring up one upstream service at a time in a separate container, with explicit ports, resource limits, and persistent volumes where needed.
3. Add server-side secret storage and provider-specific authentication without exposing credentials to the browser.
4. Add job history and audit records to the relevant module pages.
5. Add integration tests, permission checks, backup/restore coverage, and deployment smoke tests before marking a module connected.

## Design rules

- Keep the module directory quiet: one clear title, one primary action, status, and only the controls relevant to that tool.
- Use the existing theme tokens and glass surfaces; avoid stacking blur layers or decorative cards.
- Keep motion short and subtle, respect reduced-motion preferences, and preserve keyboard focus and contrast.
- Keep mobile navigation reachable without horizontal page overflow. Use responsive grids instead of compressing all tools into one dense panel.

## Access-control and execution boundaries

- /api/modules requires a valid user session and returns only that user's saved metadata.
- /llm/v1/* requires a valid session because it uses server-owned provider configuration and quota.
- /v1/* is the external SDK surface and requires a valid Lolo API key.
- Infrastructure controls and the server operations panel are admin-only. Production admin accounts must be listed in ADMIN_EMAILS; production signup never grants admin to the first visitor.
- Production builds and live dev servers are deliberately blocked until an isolated build worker is configured. The current runner can execute project-controlled lifecycle scripts and is not a security sandbox.
- CI validates code only; it does not publish the site or deploy production.
