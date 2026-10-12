# Verification and security boundaries

## Automated checks

The `verify` GitHub Actions workflow runs on pushes to `main`, pull requests,
and manual dispatch. It installs dependencies, runs ESLint, runs TypeScript
type-checking, creates the production frontend build, and runs the sequential
test suite. The suite includes database-backed API tests through PGlite, module
configuration ownership tests, input/path hardening checks, schema checks, and
production static-serving checks.

A configured workflow is not evidence that a run passed. Use the run's actual
status and logs as the source of truth; do not mark a check green when it has
not run.

## Explicit limits

- Module settings store endpoint metadata only. Saving an endpoint does not
  contact it, authenticate to it, launch it, or prove it is healthy.
- The module API requires a valid session and scopes records by the current
  user's ID. Provider credentials are not accepted or stored by these routes.
- The shared browser LLM route requires a session. The OpenAI-compatible
  `/v1` API requires a hashed API key.
- Production build/dev execution is refused until a separately isolated worker
  is configured. A development-mode child process is not a security sandbox.
- Tests that require a real Ollama model, live provider credentials, external
  network access, or a production deployment cannot be inferred from the
  database-backed suite. They must be run against those real dependencies
  before claiming end-to-end success.

## Deployment gate

Do not deploy based only on a successful frontend build. Require a green
verification run, successful database migration/schema verification, a
production health check, and a rollback path. Keep provider secrets in the
deployment's secret manager; never put them in endpoint URLs, source control,
or client-side variables.
