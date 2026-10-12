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

The module registry, individual routes, source links, UI and safety notes are present. The modules are **not yet runtime-integrated**. Do not display a module as connected until its adapter passes a health check and authentication is configured.

## Integration boundaries

- Keep one Lolo identity and PostgreSQL instance for host-level users, module metadata, task records, and audit events.
- Keep service-owned data where it belongs: Rocket.Chat messages in Rocket.Chat; cloud files in their provider; security artifacts and browser sessions in isolated workers/storage.
- Never put provider tokens in frontend code, localStorage, repository files, or ordinary module metadata. Use server-side secret storage and expose only connection status to the browser.
- Run browser automation, security testing, and reverse engineering in separate workers/containers with least privilege, resource limits, restricted network access, and explicit authorization.
- Require a confirmation for side effects such as deployment, rollback, destructive cloud operations, or active security scans.
- Add a backend adapter only after reviewing each upstream project's license, runtime requirements, environment variables, and security model. Prefer a separately deployed service behind an authenticated internal API over a monolithic source-code merge.

## Suggested delivery order

1. Add a `module_connections` registry in PostgreSQL for module id, owner, status, health-check timestamp, non-secret configuration, and audit metadata. Store secret references only, never secret values.
2. Implement authenticated server-side adapter interfaces and a health endpoint for each module.
3. Bring up one upstream service at a time in a separate container, with explicit ports, resource limits, and persistent volumes where needed.
4. Add connection setup, health status, and job history to the module's dedicated page.
5. Add integration tests, permission checks, backup/restore coverage, and deployment smoke tests before marking the module connected.

## Design rules

- Keep the module directory quiet: one clear title, one primary action, status, and only the controls relevant to that tool.
- Use the existing theme tokens and glass surfaces; avoid stacking blur layers or decorative cards.
- Keep motion short and subtle, respect reduced-motion preferences, and preserve keyboard focus and contrast.
- Keep mobile navigation reachable without horizontal page overflow. Use responsive grids instead of compressing all tools into one dense panel.
