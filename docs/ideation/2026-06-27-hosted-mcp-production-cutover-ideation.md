---
date: 2026-06-27
topic: hosted-mcp-production-cutover
focus: highest-leverage next step + smallest first cut to make the wired-but-undeployed hosted MCP a live, observable production surface
mode: repo-grounded
---

# Ideation: Hosted Brandcode MCP — from wired to live

## Grounding Context (Codebase)

Per-brand key auth is wired end-to-end across both repos: UCS has a Blob-backed key registry + `POST /api/brandcode-mcp/keys/validate` (committed UCS main, 5/5 tests); the MCP's `src/hosted/auth.ts` `buildUcsValidator` calls it (committed brandsystem-mcp `68fb4c1`, 553 tests green). All hosted tools (`brand_runtime`, `brand_search`, `brand_check`, `brand_status`, `list/get_brand_asset`, `brand_feedback`, `capture_taste`, `brand_history`) are implemented and read live governance from the UCS pull package.

Deploy scaffold exists but has never run in production:
- `api/[slug].ts` — Vercel Fluid Compute fetch handler; reads `BRANDCODE_MCP_SERVICE_TOKEN`, `UCS_API_BASE_URL`, `BRANDCODE_MCP_ENV`; 500s if the service token is unset.
- `vercel.json` — rewrites `/:slug` → `/api/:slug`, `no-store` on `/api/*`.
- `bin/brandcode-mcp.mjs` — local dev entry (`dist/index-http.js`).
- `src/hosted/router.ts` — rate limiting **is** wired (`checkHostedRateLimit`, 429 + `Retry-After`, store-unavailable handling); in-process default, durable store optional.
- `src/hosted/telemetry.ts` — `emitAgentRunRecord` is a **no-op** (`deferred_until_ucs_history_entry_contract`); the UCS sink (`POST /api/brand/hosted/{slug}/agent/history`) already exists and is exercised by `brand_feedback`.

Charter (`UCS/brand-os/s009-brandcode-mcp-discovery-charter-v0.1.md`) Milestone B: deploy staging (`mcp.staging.brandcode.studio`) → prod (`mcp.brandcode.studio`); per-key rate limits 60/min; **§456 specifies argon2id key hashing — UCS shipped SHA-256** (divergence).

## Topic Axes
- A1 — Deploy & environment (Vercel project, domains, env vars, staging→prod)
- A2 — Key lifecycle (issuance, rotation, revocation, audit)
- A3 — Observability (AgentRun telemetry, health/readiness, logs)
- A4 — Hardening (hash-algorithm parity, rate-limit durability, secrets, abuse)
- A5 — Proof & onboarding (end-to-end smoke, connect UX, docs)

## Ranked Ideas

### 1. Ship a thin vertical slice to staging + an automated end-to-end smoke
**Description:** Deploy the hosted surface to `mcp.staging.brandcode.studio`, issue one real `bck_test_` key for an existing compiled brand (e.g. `c5` or `brandcode`), and write one automated smoke that runs the whole chain against the deployed URL: issue key → MCP `initialize` + `tools/list` → an authed `brand_runtime`/`brand_status` call → assert live governance comes back → 401 on a bad key → 403 on a wrong slug. This is the literal "smallest first cut that proves the whole path."
**Axis:** A5 (also A1)
**Basis:** `direct:` the scaffold is complete and unrun — `api/[slug].ts`, `vercel.json`, `bin/brandcode-mcp.mjs` all exist; charter Milestone B line 368 names the staging deploy as the gate; auth/tools/rate-limit are all already green in unit tests but never exercised over HTTP.
**Rationale:** Everything else (observe, harden, promote, onboard) is unprovable until one real authed call traverses the deployed transport. It collapses the "repos ahead of reality" gap in a single move and converts a pile of untested integration points into one green signal.
**Downsides:** Touches infra (Vercel project, DNS, env vars) that may need account access; the smoke needs a stable test brand + key kept out of git.
**Confidence:** 90%
**Complexity:** Medium
**Status:** Unexplored

### 2. Wire `emitAgentRunRecord` to the existing UCS agent/history sink
**Description:** Replace the telemetry no-op with a real `POST /api/brand/hosted/{slug}/agent/history` for every hosted tool dispatch — outcome (ok/auth_error/upstream_error/tool_error), latency, tool, `surface: "mcp-hosted"`, requestId. The sink and contract already exist (the MCP's `brand_feedback` already writes there).
**Axis:** A3
**Basis:** `direct:` `src/hosted/telemetry.ts` is a no-op marked `deferred_until_ucs_history_entry_contract`, but that contract is no longer missing — `feedback-fetcher.ts` already posts `AgentRunHistoryEntry` to the same route, so the blocker is stale.
**Rationale:** Without it, a deployed MCP is a black box — no way to see call volume, error rates, or which brands/keys are active. It compounds: every call feeds the AgentRun history + brand-health UCS already renders.
**Downsides:** Per-call POST adds latency unless fire-and-forget; must never block or fail the tool response; needs the same fail-open discipline as feedback.
**Confidence:** 85%
**Complexity:** Medium
**Status:** Unexplored

### 3. Pre-production hardening parity pass (hash algorithm + rate-limit posture)
**Description:** Resolve two latent gaps before any `bck_live_` key exists: (a) the charter specifies **argon2id** hashing but UCS shipped **SHA-256** — decide and document (SHA-256 of a 32-byte random secret is defensible; argon2id is for low-entropy secrets — write the rationale or switch); (b) confirm the in-process rate limiter's launch posture and the explicit trigger to add a durable (Upstash) store.
**Axis:** A4
**Basis:** `direct:` charter line 456 ("argon2id hashing") vs UCS `brandcode-mcp-key-registry.ts` `createHash("sha256")`; `direct:` charter line 203 (60/min/key) + `router.ts` in-process default with `rate_limit_store_unavailable` branch.
**Rationale:** Cheapest to settle now (a decision + maybe a one-line swap) and expensive to change after keys are minted in the wild. Closes the only spec-vs-impl divergence the alignment review found.
**Downsides:** If the decision is "switch to argon2id," it's a UCS-side change + re-issue; mostly a decision, low code.
**Confidence:** 80%
**Complexity:** Low
**Status:** Unexplored

### 4. Key lifecycle runbook: issue / rotate / revoke via the existing CLI
**Description:** A short operator runbook (and any missing CLI verbs) for minting a `bck_live_` key, rotating it, and revoking it (`revokedAt`), plus where the raw key is stored (secret manager) and a per-key audit trail. The issuance CLI (`tools/brandcode-mcp-key.mjs`, `npm run brandcode-mcp:key`) already exists on the UCS side.
**Axis:** A2
**Basis:** `direct:` UCS shipped the issuance helper + `npm run brandcode-mcp:key`; the registry record already has `revokedAt` and validate rejects revoked keys — but there is no documented rotate/revoke motion or audit.
**Rationale:** A production auth system without a written rotate/revoke path is an incident waiting to happen; charter §456 lists rotation UX + per-key audit log as the key-leakage mitigation.
**Downsides:** Partly UCS-side; "audit log" may be net-new if not already emitted.
**Confidence:** 70%
**Complexity:** Low
**Status:** Unexplored

### 5. Hosted deploy health / readiness probe
**Description:** A lightweight readiness signal for a deployed instance — UCS reachability, `BRANDCODE_MCP_SERVICE_TOKEN` presence, environment, and runtime freshness — exposed either as an unauthenticated `GET /{slug}` health shape or folded into `brand_status`. Lets you tell "deployed and wired" from "deployed but misconfigured" in one call.
**Axis:** A3
**Basis:** `direct:` `api/[slug].ts` already 500s on a missing service token — that's the seed of a readiness check; `reasoned:` fresh serverless deploys fail silently on env/DNS misconfig, and a probe is the standard first diagnostic.
**Rationale:** Turns "is staging actually up and talking to UCS?" from guesswork into a single curl; becomes the smoke's first assertion and a future uptime monitor's target.
**Downsides:** Must not leak config; an unauthenticated health route needs care about what it exposes.
**Confidence:** 65%
**Complexity:** Low
**Status:** Unexplored

### 6. Staging-first promotion (canary), not a prod "cutover"
**Description:** Reframe Milestone B's prod step as a *promotion* gated on staging smoke green, not a separate build: same artifact, `BRANDCODE_MCP_ENV=production` + `bck_live_` keys + `mcp.brandcode.studio` DNS, promoted only after the staging smoke passes. Wire the smoke (idea #1) as the gate.
**Axis:** A1
**Basis:** `reasoned:` the charter treats staging and prod as two deploys; since it's one artifact differing only by env vars/DNS, promotion-after-green is strictly safer and removes the "big cutover" risk framing.
**Rationale:** De-risks production by making it the boring last step; compounds with the smoke harness as a permanent gate for every future hosted change.
**Downsides:** Needs the smoke (idea #1) to exist first; minimal value on its own.
**Confidence:** 70%
**Complexity:** Low
**Status:** Unexplored

## Rejection Summary

| # | Idea | Reason Rejected |
|---|------|-----------------|
| 1 | Build a Brand Console key-management UI | Already explicitly out-of-scope for v1 in the UCS spec; runbook (survivor #4) covers the need |
| 2 | "First authed tool call" Stripe-style quickstart doc | Premature — no external users yet; better as a follow-on to the smoke once the path is proven; folds into #1 |
| 3 | Add durable Upstash rate-limit store now | Too expensive relative to launch volume; in-process suffices — captured as the "trigger to upgrade" note inside #3 |
| 4 | Multi-region / scale-out hosting | Not grounded — no traffic; constraint-flip (1M brands) is a future concern, not a next step |
| 5 | Self-serve key issuance from Brand Console | Subject/scope overrun for v1; one operator-issued key is the proven path; defer |
| 6 | Per-tool richer `brand_runtime` visual slice | Real but unrelated to the cutover; belongs in a separate governance-mapping ideation |
| 7 | Rebuild rate limiting | Not needed — `router.ts` already wires it; only durability is deferred (folded into #3) |

**Axis coverage:** A1 (#1, #6), A2 (#4), A3 (#2, #5), A4 (#3), A5 (#1). All five axes covered.

## Recommended next step

**Idea #1 — thin vertical slice to staging + automated end-to-end smoke** — with **#2 (telemetry)** and **#3 (hashing parity decision)** folded in as the "definition of done for a *trustworthy* staging surface." #1 is the user's own "smallest first cut that proves the whole path," and it unblocks every other axis. Proceed to `ce-plan` on this fused scope.
