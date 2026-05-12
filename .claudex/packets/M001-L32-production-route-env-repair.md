# M001-L32 - Production Route And Env Repair

**Status:** Ready
**Sprint:** M001 - Brandcode MCP Stabilization And Pre-Release Hardening
**Repo:** `/Users/jasonlankow/Desktop/brandsystem-mcp`
**Lane type:** Hosted production infrastructure repair / non-release proof prep
**Recommended commit:** `Repair Brandcode MCP production route env readiness`
**Prompt:** `.claudex/prompts/M001-L32-production-route-env-repair.md`

## Why

Jason authorized production proof/live-key testing for the `brandcode` slug,
but M001-L31 preflight found production proof blocked:

- `mcp.brandcode.studio` does not resolve.
- No production MCP alias is visible for `mcp.brandcode.studio`.
- Vercel Production env lists only `MCP_LOG_LEVEL`, `NODE_ENV`, and
  `UCS_API_BASE_URL`.
- Production does not currently list `BRANDCODE_MCP_ENV=production`.
- Production does not currently list `BRANDCODE_MCP_TEST_KEYS` or equivalent
  live-key seed env.
- Production does not currently list `BRANDCODE_MCP_SERVICE_TOKEN`.
- Production does not currently list durable shared rate-limit env.

This lane repairs production route/env readiness so the next lane can generate
live keys and run production smoke without creating sensitive credentials into
a broken proof path.

## Scope

Inspect first:

- `specs/brandcode-mcp-production-proof-preflight.md`
- `specs/brandcode-mcp-operational-roadmap-m001-m003.md`
- `specs/brandcode-mcp-limited-client-handoff-packet.md`
- `specs/brandcode-mcp-limited-client-key-ops-runbook.md`
- `.claudex/sprints/current.md`
- `HANDOFF.md`

Implement narrowly:

- Configure or verify `mcp.brandcode.studio` as the Production MCP route for
  the `brandsystem-mcp` Vercel project.
- Repair DNS/alias/certificate posture until the host resolves, or record the
  exact external blocker.
- Configure Production env baseline:
  - `BRANDCODE_MCP_ENV=production`
  - `BRANDCODE_MCP_SERVICE_TOKEN`
  - durable shared rate-limit env using accepted Redis REST names
  - production key-store variable name/path, without adding raw keys yet
- Deploy or inspect Production only as needed to prove the route/env baseline.
- Prove unauthenticated `https://mcp.brandcode.studio/brandcode` reaches the
  app-level bearer gate, ideally `401 missing_bearer`.
- Update the production preflight, sprint current, M001 messages, and HANDOFF.

## Out Of Scope

- No `bck_live_` key generation.
- No production smoke.
- No production client handoff.
- No public release.
- No npm publish.
- No MCP directory submission.
- No public listing metadata changes.
- No package/source posture changes.
- No hosted tool additions.
- No selected-kit default behavior.
- No custody relaxation.
- No public deletion/export SLA, legal terms, or self-serve deletion/export.
- No secret values in docs, commits, logs, or examples.

## Acceptance

- `mcp.brandcode.studio` resolves and reaches the hosted MCP app-level bearer
  gate for `/brandcode`, or a precise external blocker is recorded.
- Production env baseline is present or an exact provisioning blocker is
  recorded.
- No live keys are generated.
- No production smoke is run.
- `git diff --check` passes.
- Run focused verification only for touched code; docs/env-only changes may
  skip lint/build/tests with a clear note.
- Exactly one next Ready lane remains, unless a named external blocker
  prevents continuing.
