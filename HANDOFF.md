# HANDOFF

## Current State

Active sprint: M001 - Brandcode MCP stabilization and pre-release hardening.

The hosted Brandcode Use MCP implementation has all 8 locked v0.1 tools wired in code. M001-L01 added a repeatable smoke harness at `npm run smoke:hosted-mcp`; M001-L02 refreshed the Use MCP roadmap so it no longer describes implemented tools as stubs. M001-L03/L04 staging route and feedback append proof now pass. M001-L06 completed the license/package/directory/security trust audit. M001-L07 expanded hosted auth/scope/security proof and documented rate-limit posture. M001-L08 proved hosted asset custody blocking and surfaced the package-safe asset fixture blocker. M001-L09 traced that blocker upstream to UCS/Brandcode Studio package data. M001-L10 repaired the UCS package delivery ref, M001-L11 proved the package-safe asset through hosted MCP smoke, M001-L12 completed multi-client proof with MCP Inspector and Claude Code, M001-L13 completed release-candidate trust review, M001-L14 completed the hosted terms/rate-limit gate, M001-L15 captured Jason's approval of the recommended hosted-service posture, M001-L16 restored full local test-suite proof, M001-L17 pushed the M001 stack with green GitHub CI, M001-L18 restored GitHub Actions Node runtime trust, M001-L19 added active hosted in-process pre-release rate limiting, M001-L20 added and proved durable shared Redis REST rate limiting on staging, M001-L21 drafted hosted data-policy truth, M001-L22 prepared the package/source posture decision brief, M001-L23 added the limited-client readiness plan, M001-L24 added the onboarding template plus a real Column Five Brandcode staging proof, M001-L25 proved the Column Five client-config dry run through Claude Code using a Jason-approved staging-only generate-and-run key flow, M001-L26 added the limited-client key operations runbook, M001-L27 added the limited-client support intake ledger, M001-L28 prepared the deletion/export launch decision brief, M001-L29 added the limited-client go/no-go checklist, M001-L30 applied that checklist to the current Column Five Brandcode staging route, M001-L31 drafted the reusable limited-client handoff packet, and M001-L32 partially repaired production route/env readiness. M001-L31 is pushed and CI-green at `d0e06b3`. The next 1.5 sprint operational roadmap is now `specs/brandcode-mcp-operational-roadmap-m001-m003.md`. After Jason asked to generate the needed keys, M001-L30 generated fresh staging-only full/read keys, installed them as sensitive Vercel Preview env, deployed Ready Preview `dpl_4aQ9vVdsXC6SD5u7TMqXZKs4eCQC`, re-aliased staging to `https://brandsystem-pwnz9m3oy-column-five.vercel.app`, and proved hosted smoke green. Jason then authorized production proof/live-key testing for the `brandcode` slug. M001-L32 added the `mcp.brandcode.studio` production alias and Production `BRANDCODE_MCP_ENV=production`, but production proof remains blocked because external DNS still does not resolve and Production secret env still lacks `BRANDCODE_MCP_SERVICE_TOKEN`, durable shared rate-limit env, and the intentionally deferred live-key store. Jason approved the L28 pre-release deletion/export operating posture, while final public legal/subprocessor launch language remains blocked. Jason chose Option 4 for v0.1 limited-client posture: defer public `@brandcode/mcp` package/source distribution while improving the hosted Brandcode product for approved clients. Option 3 remains the likely future public direction. Jason does not want to release yet; release remains blocked on explicit approval and final launch-language review.

## Latest Build Work

M001-L32 production route/env repair partially completed and blocked:

- Added `mcp.brandcode.studio` to the linked `brandsystem-mcp` Vercel project.
- `vercel alias ls` now shows
  `brandsystem-az14haxle-column-five.vercel.app -> mcp.brandcode.studio`.
- Added Production `BRANDCODE_MCP_ENV=production`.
- `mcp.brandcode.studio` still does not resolve. Vercel reports external DNS
  must set `A mcp.brandcode.studio 76.76.21.21`, or the domain nameservers
  must move to Vercel.
- Production still lacks `BRANDCODE_MCP_SERVICE_TOKEN` and durable shared
  rate-limit env (`BRANDCODE_MCP_RATE_LIMIT_REDIS_REST_*`,
  `UPSTASH_REDIS_REST_*`, or `KV_REST_API_*`).
- Production `BRANDCODE_MCP_TEST_KEYS` remains intentionally unset until L33
  generates scoped `bck_live_` keys.
- Direct production deployment URL reaches the hosted app but returns a
  misconfigured service-token response, not the app-level bearer gate.
- No `bck_live_` keys were generated. No production smoke was run.
- No next Ready lane remains because M001-L33 is blocked on external DNS and
  Production secret env provisioning.

Operational roadmap shaped:

- Added `specs/brandcode-mcp-operational-roadmap-m001-m003.md`.
- The roadmap keeps the next work operational: finish M001 with production
  route/env repair, production smoke proof, and M001 closeout; spend M002 on
  limited-client pilot rehearsal, support-ledger dogfood, key rotation/
  revocation/offboarding drill, non-Brandcode proof, and one evidence-led
  quality repair; start M003 with production observability, incident/key
  drills, backup owner posture, and legal/subprocessor review readiness.
- Added the next Ready lane:
  `.claudex/packets/M001-L32-production-route-env-repair.md`.
- Added the convenience prompt:
  `.claudex/prompts/M001-L32-production-route-env-repair.md`.
- M001-L32 repairs production route/env readiness only. It must not generate
  `bck_live_` keys or run production smoke until `mcp.brandcode.studio`
  resolves and Production env baseline is complete.

M001-L31 push/CI proof completed:

- Pushed `main` to `d0e06b3`.
- GitHub CI run `25746822612` passed:
  `https://github.com/Brandcode-Studio/brandsystem-mcp/actions/runs/25746822612`.
- Node 20, Node 22, and Node 24 jobs passed `npm ci`, `npm run build`,
  `npm run lint`, `npm test`, and `npm audit --audit-level=high`.

M001-L31 completed the limited-client handoff packet:

- Added:
  `specs/brandcode-mcp-limited-client-handoff-packet.md`.
- The packet gives an approved limited-client staging handoff shape: endpoint
  setup, generic HTTP MCP client config, approved claims, explicit non-claims,
  key/scope posture, tool expectations, custody expectations, smoke/proof bar,
  support/intake, rotation/offboarding, and a redacted Column Five Brandcode
  internal staging example.
- The packet preserved the production proof truth at the time: Jason
  authorized production proof/live-key testing for the `brandcode` slug, but
  production proof was blocked on `mcp.brandcode.studio` DNS/alias and missing
  Production env for hosted MCP mode, live-key seed, service token, and durable
  shared rate limits. M001-L32 later added the production alias and
  `BRANDCODE_MCP_ENV=production`; DNS and secret env remain blocked.
- No code changed. Verification was docs-only with `git diff --check`.
- No release, npm publish, public MCP directory submission, public listing
  metadata change, hosted tool addition, selected-kit default behavior, custody
  relaxation, production client handoff, production key generation, production
  endpoint proof, self-serve deletion/export operation, public SLA, or legal
  terms happened.

M001-L30 push/CI proof and production preflight completed:

- Pushed `main` from `201ee36` to `3961be4`.
- GitHub CI run `25710999132` passed:
  `https://github.com/Brandcode-Studio/brandsystem-mcp/actions/runs/25710999132`.
- Node 20, Node 22, and Node 24 jobs passed `npm ci`, `npm run build`,
  `npm run lint`, `npm test`, and `npm audit --audit-level=high`.
- Jason authorized production proof/live-key testing for the `brandcode` slug.
- Durable production preflight:
  `specs/brandcode-mcp-production-proof-preflight.md`.
- Production proof is authorized but blocked: `mcp.brandcode.studio` does not
  resolve, `vercel alias ls` shows only `mcp.staging.brandcode.studio`, and
  `vercel env ls production` lists only `MCP_LOG_LEVEL`, `NODE_ENV`, and
  `UCS_API_BASE_URL`.
- Production is missing `BRANDCODE_MCP_ENV=production`,
  `BRANDCODE_MCP_TEST_KEYS` or equivalent live-key seed env,
  `BRANDCODE_MCP_SERVICE_TOKEN`, and durable shared rate-limit env.
- No `bck_live_` keys were generated because the production endpoint/env
  baseline is not ready for proof.
- No release, npm publish, public MCP directory submission, public listing
  metadata change, hosted tool addition, selected-kit default behavior, custody
  relaxation, production client handoff, self-serve deletion/export operation,
  public SLA, legal terms, or public release proof happened.

M001-L30 applied the limited-client go/no-go checklist to the Column Five
Brandcode staging route and refreshed staging proof:

- Updated redacted evidence in:
  `specs/brandcode-mcp-column-five-brandcode-staging-onboarding-proof.md`
  and `specs/brandcode-mcp-limited-client-go-no-go-checklist.md`.
- Route reachability passed:
  `https://mcp.staging.brandcode.studio/brandcode` returned
  `401 missing_bearer` for unauthenticated access with slug `brandcode`.
- Jason asked to generate the needed keys, so fresh staging-only `bck_test_`
  full/read keys were generated into `0600` temp files, installed as sensitive
  all-Preview `BRANDCODE_MCP_TEST_KEYS` through the Vercel API, deployed, used
  for proof, and removed locally.
- Vercel inspect found Ready Preview deployment
  `dpl_4aQ9vVdsXC6SD5u7TMqXZKs4eCQC` at
  `https://brandsystem-pwnz9m3oy-column-five.vercel.app`.
- Latest pushed CI remains green: GitHub Actions run `25705113500` passed on
  `201ee36d8c140e811950eb4e7d9d69a64a5a08db`.
- Hosted smoke passed at `2026-05-12T02:25:44.680Z` with `ok: true`,
  `status: "pass"`, `fail: 0`, `blocked: 0`, and `skipped: 0`.
- Locked tool order passed for the 8-tool surface.
- `brand_status.rate_limits.status` returned `active_durable_shared` with
  `durable_shared_redis_fixed_window` enforcement.
- `get_brand_asset` passed for `brandcode:logo:c5-logomark-red.svg` with
  package-safe custody, `safe_for_mcp: true`, and no raw private/provider URL
  exposure.
- `brand_feedback` append returned `append_status: "recorded"`.
- Read-only scope proof returned structured `insufficient_scope` payloads with
  status `403` for `brand_check` and `brand_feedback`.
- No code changed. Verification was docs/proof-only with `git diff --check`.

The prior production proof/live-key decision blocker is superseded: Jason
authorized production proof for the `brandcode` slug after this proof. The
proof is now blocked on production route/env provisioning. M001-L31 then
completed the limited-client staging handoff packet without generating live
keys or claiming production readiness.

No release, npm publish, public MCP directory submission, public listing
metadata change, hosted tool addition, selected-kit default behavior, custody
relaxation, production client key generation, self-serve deletion/export
operation, public SLA, legal terms, or production endpoint proof happened.

M001-L29 completed the limited-client go/no-go checklist:

- Durable checklist:
  `specs/brandcode-mcp-limited-client-go-no-go-checklist.md`
- The checklist separates staging readiness, production proof readiness, and
  public release readiness.
- It gives operators a per-client evidence table for approval, endpoint, key
  posture, service-token env, durable rate limits, smoke proof, locked 8-tool
  order, scope behavior, package-safe custody, feedback posture, client config
  proof, support intake, deletion/export posture, and CI freshness.
- It makes production proof dependent on explicit Jason approval.
- It keeps public release blocked until final legal/subprocessor launch
  language, future public package/source approval, directory metadata, and
  explicit Jason release approval exist.
- It records fail-closed criteria for missing approval, missing or unsafe
  keys, missing hosted proof, private/provider URL exposure, insufficient
  asset custody, absent support ownership, failing CI, and release-shaped
  actions without Jason approval.
- No code changed. Verification was docs-only with `git diff --check` and
  `git diff --cached --check`.

M001-L28 decision updates and L29 prep push/CI proof completed:

- Pushed `main` from `9619b37` to `201ee36`.
- GitHub CI run `25705113500` passed:
  `https://github.com/Brandcode-Studio/brandsystem-mcp/actions/runs/25705113500`.
- Node 20, Node 22, and Node 24 jobs passed `npm ci`, `npm run build`,
  `npm run lint`, `npm test`, and `npm audit --audit-level=high`.
- No release, npm publish, public MCP directory submission, public listing
  metadata change, hosted tool addition, selected-kit default behavior, custody
  relaxation, production client key generation, or production endpoint proof
  happened.

M001-L28 completed the deletion/export launch decision brief:

- Durable brief:
  `specs/brandcode-mcp-deletion-export-launch-decision-brief.md`
- The brief separates current manual pre-release deletion/export review from
  any future public launch promise.
- It frames the required Jason/legal/ops decisions for requester
  authorization, authorization verification, deletion/export scope, excluded
  systems, export package format, response windows, escalation path, and
  legal/subprocessor language.
- It preserves Option 4 package/source posture and hosted-service access
  boundaries.
- It does not approve public release, npm publish, MCP directory submission,
  public listing metadata, production client keys, self-serve deletion/export
  tooling, public SLA, legal terms, custody relaxation, or selected-kit default
  behavior.
- Jason then approved the pre-release deletion/export operating posture and
  accepted the public-operating recommendations: brand owner/admin, recorded
  legal/contract contact, or Jason as authorized requester; brand admin role,
  approved contact, or written admin/contract-owner approval as external proof;
  hosted MCP service data as scope; curated support-packet export; security,
  abuse, audit, legal, backup, and out-of-custody exclusions; no public SLA;
  and Jason Lankow as escalation owner.
- Draft legal/subprocessor language exists in the brief as useful review input,
  but it is not approved public launch copy.
- No code changed. Verification was docs-only with `git diff --check` and
  `git diff --cached --check`.

M001-L23 through M001-L28 push/CI proof completed:

- Pushed `main` from `48f6fec` to `9619b37`.
- GitHub CI run `25701556152` passed:
  `https://github.com/Brandcode-Studio/brandsystem-mcp/actions/runs/25701556152`.
- Node 20, Node 22, and Node 24 jobs passed `npm ci`, `npm run build`,
  `npm run lint`, `npm test`, and `npm audit --audit-level=high`.
- No release, npm publish, public MCP directory submission, public listing
  metadata change, hosted tool addition, selected-kit default behavior, custody
  relaxation, production client key generation, or production endpoint proof
  happened.

M001-L11 completed hosted package asset proof for the UCS package-data fixture:

- The repaired UCS asset is still `brandcode:logo:c5-logomark-red.svg`, with governed package-safe `deliveryRef.packagePath: "brandcode-brand-runtime/visual/assets/logo/c5-logomark-red.svg"`, `inRuntimePackage: true`, and `lifecycle: "production-approved"`.
- UCS `origin/main` contains `37585f98 Add Brandcode package asset delivery ref`.
- No MCP custody code changed and no private/provider URLs were made public.
- Hosted smoke from this repo passed against `https://mcp.staging.brandcode.studio/brandcode` with `BRANDCODE_MCP_SMOKE_ASSET_ID=brandcode:logo:c5-logomark-red.svg`.
- `get_brand_asset` returned `custody_safe: true`, `safe_for_mcp: true`, `blocked_private_provider_url: false`, `delivery_posture: "package_safe"`, `delivery_ref_kind: "package_path"`, and `raw_private_provider_url_exposed: false`.
- The full smoke also passed locked tool order, package-safe catalog shape, feedback append, and read-only insufficient-scope checks for `brand_check` and `brand_feedback`.

M001-L12 completed multi-client battle testing:

- The empty Preview `BRANDCODE_MCP_TEST_KEYS` value was removed and replaced with fresh staging-only full/read entries for the `brandcode` slug through Vercel's interactive env flow.
- Staging was redeployed and aliased to `https://mcp.staging.brandcode.studio`; latest deployment is `https://brandsystem-eipxqt3go-column-five.vercel.app`.
- Hosted smoke passed with full/read key postures and package-safe asset id `brandcode:logo:c5-logomark-red.svg`.
- MCP Inspector `tools/list` returned the locked 8-tool Phase 0 order.
- MCP Inspector `get_brand_asset` returned package-safe custody, package-path delivery, and no raw private/provider URL.
- MCP Inspector read-only `brand_check` returned structured `insufficient_scope` with `status: 403`.
- Claude Code used a temporary HTTP MCP config, called `brand_status` and `get_brand_asset`, and reported 8 implemented tools, package-safe asset posture, package-path delivery, and no raw private/provider URL exposure.
- Codex CLI remains available but was not used after MCP Inspector and Claude Code satisfied the two-client acceptance bar.

M001-L13 completed release-candidate trust review:

- Durable review: `specs/brandcode-mcp-release-candidate-trust-review.md`.
- At L13 closeout time, local `main` was 20 commits ahead of `origin/main`.
  That push/CI gap was later resolved by M001-L17.
- The pre-M001 remote `main` CI green baseline was `61218ac`; GitHub Actions
  run `25571869563` passed on 2026-05-08.
- The hosted surface is strong on staging smoke, package-safe Brandcode asset
  proof, and two-client proof, but it is not release-candidate ready.
- Release remains blocked by rate-limit/abuse posture, unresolved
  `@brandcode/mcp` package/source posture, final public retention/export
  language, and no separate Brandcode Use directory metadata.
- Release/publish remains blocked on Jason approval.

M001-L14 completed the hosted terms and rate-limit gate:

- Durable gate: `specs/brandcode-mcp-hosted-terms-rate-limit-gate.md`.
- The gate is blocked, not satisfied.
- At L14 time, `brand_status.rate_limits` preserved
  `status: "not_reported_by_staging"` and reported `release_gate: "blocked"`.
  After L19 and the named-owner decision, hosted-route status reports
  `active_pre_release_in_process` with blocker owner
  `Jason Lankow / Brandcode Studio Ops <jlankow@columnfive.com>`.
- `SECURITY.md` now names the hosted-service release gate, feedback/history
  retention gap, custody limits, and rate-limit/abuse owner requirement.
- README and `llms.txt` now qualify hosted Use MCP access as authorized and
  pre-release-gated.
- `specs/brandcode-mcp-phase-0-lock.md` keeps "free in v1" as product intent,
  not approved public pricing copy.
- Verification passed for `git diff --check`, hosted tool tests, lint, and
  build. Full `npm test` exposed two unrelated visual extraction smoke cases
  that were repaired in M001-L16.
M001-L15 completed the hosted service terms decision brief:

- Durable decision brief:
  `specs/brandcode-mcp-hosted-service-terms-decision-brief.md`.
- Jason approved the recommended hosted-service posture for approved-brand,
  bearer-key-only, pre-release access; client-owned or client-controlled data;
  runtime use limited to MCP/governance workflows; append-only feedback; scoped
  redacted history; package-safe asset delivery; no raw private/provider URLs;
  no public "free in v1" copy until pricing/limits are settled; and separate
  hosted-service access posture from source/package license posture.
- This approval does not authorize release, npm publish, directory submission,
  public listing changes, or release-candidate claims.
- Remaining release blockers are no GitHub CI on the M001 stack, no active
  rate-limit enforcement or named abuse runbook, no final public
  retention/deletion/export language, final package/source posture for
  `@brandcode/mcp`, deferred directory metadata, and explicit Jason release
  approval.

M001-L16 completed the full suite visual extraction smoke repair:

- Added shared screenshot base64 normalization in `src/lib/visual-extractor.ts`.
- Updated `brand_extract_visual`, `brand_extract_site`, and `brand_start` to
  return valid MCP image content when screenshots are Uint8Array-backed.
- `npm test -- --run test/tools/smoke.test.ts` passed: 50 tests.
- `npm run lint` passed.
- `npm run build` passed.
- Full `npm test` passed: 39 files, 526 tests.

M001-L17 completed push/CI proof:

- Jason explicitly authorized push in-thread.
- Pushed `main` from `61218ac` to `2cf291c`.
- GitHub CI run `25641439073` passed:
  `https://github.com/Brandcode-Studio/brandsystem-mcp/actions/runs/25641439073`.
- Node 20 and Node 22 matrix jobs both passed `npm ci`, `npm run build`,
  `npm run lint`, `npm test`, and `npm audit --audit-level=high`.
- CI emitted a Node.js 20 Actions deprecation annotation for
  `actions/checkout@v4` and `actions/setup-node@v4`.
- M001-L18 is the next Ready lane to repair or explicitly harden the GitHub
  Actions Node runtime posture.

M001-L18 completed GitHub Actions Node 24 compatibility:

- Pushed commit `60aa66f Add Node 24 GitHub Actions compatibility`.
- GitHub CI run `25678340682` passed:
  `https://github.com/Brandcode-Studio/brandsystem-mcp/actions/runs/25678340682`.
- Node 20, Node 22, and Node 24 matrix jobs all passed `npm ci`,
  `npm run build`, `npm run lint`, `npm test`, and
  `npm audit --audit-level=high`.
- CI used `actions/checkout@v6` and `actions/setup-node@v6`.
- The prior Node.js 20 Actions deprecation annotation did not recur in the
  watched run output or `gh run view` job summary.
- M001-L19 became the next lane and is now closed.

M001-L19 completed hosted rate-limit and abuse posture hardening:

- Added `src/hosted/rate-limit.ts`, an in-process fixed-window limiter keyed by
  environment, brand slug, and API key id.
- Wired the hosted HTTP router to enforce the limiter after bearer auth and
  before MCP transport dispatch.
- Default policy is 60 authenticated requests per 60 seconds.
- Config knobs are `BRANDCODE_MCP_RATE_LIMIT_REQUESTS_PER_WINDOW`,
  `BRANDCODE_MCP_RATE_LIMIT_WINDOW_SECONDS`, and emergency disable
  `BRANDCODE_MCP_RATE_LIMIT_DISABLED=1`.
- Over-limit requests return JSON `429 rate_limited` with structured
  `rate_limits`, `retry-after`, and `x-ratelimit-*` headers.
- Successful hosted responses include `x-ratelimit-limit`,
  `x-ratelimit-remaining`, and `x-ratelimit-reset`.
- `brand_status.rate_limits.status` now reports
  `active_pre_release_in_process` when called through the hosted HTTP route.
- The release gate remains blocked because the limiter is process-local
  pre-release enforcement, not durable shared production enforcement.
- Verification passed for
  `npm test -- --run test/hosted/router.test.ts test/hosted/tools.test.ts`
  and `npm run lint`; `git diff --check`, `npm run build`, and full
  `npm test` also passed. Full `npm test` passed 39 files and 527 tests.
- Jason authorized push, and GitHub CI run `25684546273` passed on pushed tip
  `74d72f5`: `https://github.com/Brandcode-Studio/brandsystem-mcp/actions/runs/25684546273`.
- Node 20, Node 22, and Node 24 matrix jobs all passed `npm ci`,
  `npm run build`, `npm run lint`, `npm test`, and
  `npm audit --audit-level=high`.
- No release, npm publish, public MCP directory submission, public listing
  change, hosted tool addition, selected-kit default behavior, UCS change, or
  custody relaxation happened.
- Jason named the pre-release abuse response owner as Jason Lankow /
  Brandcode Studio Ops `<jlankow@columnfive.com>`, with authority to revoke,
  rotate, suspend, or throttle hosted Brandcode MCP API keys for abuse, leaked
  keys, excessive traffic, security risk, or service-stability risk.
- Jason chose durable shared hosted rate limiting as the next lane before broad
  public release.

M001-L20 completed durable shared rate-limit implementation locally:

- Added optional durable shared Redis REST fixed-window enforcement using
  `@upstash/redis`.
- Hosted env contract is `BRANDCODE_MCP_RATE_LIMIT_REDIS_REST_URL` /
  `BRANDCODE_MCP_RATE_LIMIT_REDIS_REST_TOKEN`, with standard
  `UPSTASH_REDIS_REST_*` and `KV_REST_API_*` env names also accepted.
- Preserved in-process memory enforcement as the local/test and pre-release
  fallback when no shared store env exists.
- `brand_status.rate_limits.status` now distinguishes
  `active_durable_shared`, `active_pre_release_in_process`, `unavailable`, and
  `disabled`.
- If a configured durable shared store is unavailable, hosted requests fail
  closed with `503 rate_limit_unavailable` before MCP tool dispatch.
- Over-limit behavior still returns structured `429 rate_limited`,
  `retry-after`, and `x-ratelimit-*` headers.
- Verification passed for `git diff --check`, focused hosted router/status
  tests, lint, build, and full `npm test` (39 files, 530 tests).
- Jason authorized push, and GitHub CI run `25687209671` passed on pushed tip
  `cc94bee`: `https://github.com/Brandcode-Studio/brandsystem-mcp/actions/runs/25687209671`.
- Node 20, Node 22, and Node 24 matrix jobs all passed `npm ci`,
  `npm run build`, `npm run lint`, `npm test`, and
  `npm audit --audit-level=high`.
- Hosted durable-store proof is now complete. Jason provisioned Vercel/Upstash
  KV/Redis Preview env, fresh Preview was deployed at
  `https://brandsystem-kqrdhx4pe-column-five.vercel.app`, and staging was
  re-aliased to `https://mcp.staging.brandcode.studio`.
- `brand_status` through the MCP Streamable HTTP client reported
  `rate_limits.status: "active_durable_shared"` with
  `enforcement: "durable_shared_redis_fixed_window"`, scoped
  `per_key_per_brand`, source `KV_REST_API_URL/KV_REST_API_TOKEN`, and default
  limit 60 requests per 60 seconds.
- Hosted smoke passed against
  `https://mcp.staging.brandcode.studio/brandcode` with full/read key postures
  and package-safe asset id `brandcode:logo:c5-logomark-red.svg`: `fail: 0`,
  `blocked: 0`, `skipped: 0`.
- During env repair, one unsafe pseudo-terminal attempt echoed generated test
  keys. Those values were treated as burned, rotated immediately, and replaced
  through the Vercel API for all Preview branches before proof.
- Release remains blocked until Jason explicitly approves release.

M001-L21 completed hosted retention/export/deletion policy hardening:

- Durable policy: `specs/brandcode-mcp-hosted-data-policy.md`.
- The hosted data-policy draft documents authorized pre-release bearer-key
  access, client-owned/client-controlled brand data, append-only
  `brand_feedback`, scoped/redacted `brand_history`, package-safe custody, and
  source/package separation from hosted service access.
- The policy states that hosted MCP does not expose public self-serve deletion
  or export tools for hosted feedback/history.
- During pre-release, deletion/export requests route to Jason Lankow /
  Brandcode Studio Ops for manual review through Brandcode/UCS operations.
- Public launch remains blocked until Jason/legal/ops approve deletion/export
  requester authorization, scope, export format, response windows, support
  escalation, and any required legal/subprocessor language.
- Updated `SECURITY.md`, `README.md`, `llms.txt`, the hosted terms gate, and
  the service-terms decision brief to point to the same truth.
- No code, hosted tool, custody, package/listing metadata, release, publish,
  directory submission, or `brand_status.rate_limits.release_gate` change
  happened.

M001-L22 completed package/source posture decision prep:

- Durable decision brief:
  `specs/brandcode-mcp-package-source-posture-decision-brief.md`.
- The brief separates the existing `@brandsystem/mcp` Build package MIT posture
  from hosted Brandcode MCP service access and any future `@brandcode/mcp`
  source/package distribution.
- It frames four Jason decision options: open MIT package/source with separate
  hosted service terms, proprietary/service-only, dual posture, or deferral/no
  public package-source distribution for v0.1.
- It preserves the boundary that source/package license does not grant hosted
  service access, bearer keys, hosted runtime data, feedback/history, or
  package-safe assets.
- No code, hosted tool, custody, package/listing metadata, release, publish,
  directory submission, or public source/license posture changed.

Jason then chose the v0.1 package/source posture:

- Approved posture: Option 4, defer public package/source distribution.
- v0.1 limited-client Brandcode MCP remains approved-brand hosted pre-release
  only.
- No `@brandcode/mcp` npm publish, public package/source claim, public listing,
  or MCP directory submission should happen for v0.1 limited-client work.
- Authorized clients use the hosted Streamable HTTP endpoint with brand-scoped
  bearer keys.
- Future direction: Option 3, a narrow public connector/client artifact plus
  service-controlled hosted implementation and bearer-key-gated brand data
  access, after separate approval and hardening.

M001-L23 completed the limited-client readiness plan:

- Durable plan:
  `specs/brandcode-mcp-limited-client-readiness-plan.md`.
- The plan covers approved client/brand eligibility, staging vs production
  endpoint posture, API key issuance/scope/rotation/revocation/leak response,
  per-client smoke proof, support/abuse/deletion/export/incident intake,
  package-safe custody expectations, rate-limit and service-token env checks,
  Option 4 no-public-package/no-directory/no-listing guardrails, and future
  Option 3 signals to capture.
- Limited-client handoff still requires client/brand approval and, for
  production access, explicit Jason approval plus fresh production smoke.
- No code, hosted tools, custody behavior, package metadata, public listing,
  directory submission, release, publish, public source posture, production
  client key generation, or real client naming changed.
- M001-L24 became the next lane for a reusable limited-client onboarding
  template/checklist.

M001-L24 completed the limited-client onboarding template and internal proof:

- Durable template:
  `specs/brandcode-mcp-limited-client-onboarding-template.md`.
- Internal proof:
  `specs/brandcode-mcp-column-five-brandcode-staging-onboarding-proof.md`.
- Tested real hosted instance: Column Five Brandcode internal `brandcode`
  staging endpoint at `https://mcp.staging.brandcode.studio/brandcode`.
- Hosted smoke passed with local redacted staging full/read keys and asset id
  `brandcode:logo:c5-logomark-red.svg`.
- Result: `ok: true`, `status: "pass"`, `fail: 0`, `blocked: 0`,
  `skipped: 0`.
- Locked 8-tool order, package-safe asset delivery, feedback append, history
  shape, runtime/search/check, and read-only insufficient-scope checks passed.
- No secrets were recorded. No production endpoint/key proof happened.

M001-L25 completed the client-configuration dry run:

- Durable proof record:
  `specs/brandcode-mcp-column-five-client-config-dry-run.md`.
- Jason chose option 2: staging-only generate-and-run keys for the internal
  `brandcode` staging proof.
- Fresh staging-only `bck_test_` full/read keys were generated and installed in
  Vercel Preview `BRANDCODE_MCP_TEST_KEYS` for all Preview branches without
  printing or committing key values.
- Fresh Preview deployment `dpl_E45BFFLXS2H2BJWz9TvBuZv8Cgtb` was created at
  `https://brandsystem-umyitawby-column-five.vercel.app`.
- `https://mcp.staging.brandcode.studio` was re-aliased to that deployment.
- Hosted smoke passed against
  `https://mcp.staging.brandcode.studio/brandcode` with asset id
  `brandcode:logo:c5-logomark-red.svg`: `ok: true`, `status: "pass"`,
  `fail: 0`, `blocked: 0`, `skipped: 0`.
- Claude Code used a temporary HTTP MCP config to call `brand_status` and
  `get_brand_asset`, reporting 8 implemented tools,
  `rate_limit_status: "active_durable_shared"`, package-safe asset delivery,
  `safe_for_mcp: true`, and no raw private/provider URL exposure.
- No release, npm publish, public MCP directory submission, public listing
  metadata change, hosted tool addition, selected-kit default behavior, custody
  relaxation, package/source posture change, production client key generation,
  or production endpoint proof happened.

M001-L26 completed the limited-client key operations runbook:

- Durable runbook:
  `specs/brandcode-mcp-limited-client-key-ops-runbook.md`
- The runbook covers staging-only `bck_test_` key generation, Vercel Preview
  env installation posture, deploy/alias proof, production `bck_live_` key
  approval gating, hosted smoke proof, real-client config proof, key owner,
  scopes, brand slug binding, rotation, revocation, suspected leak response,
  and redacted evidence capture.
- No production client keys were generated.
- No production endpoint proof, release, npm publish, public MCP directory
  submission, public listing metadata change, hosted tool addition,
  selected-kit default behavior, package/source posture change, or custody
  relaxation happened.

M001-L27 completed the limited-client support intake ledger:

- Durable ledger:
  `specs/brandcode-mcp-limited-client-support-intake-ledger.md`
- The ledger covers access setup, auth/scope, custody, quality,
  feedback/history, deletion/export, abuse/security, incident, and offboarding
  intake.
- Each request records endpoint, brand slug, key posture, non-secret key
  id/label, owner, escalation owner, status, evidence link, redaction check,
  next action, and resolution.
- The status vocabulary includes `blocked_decision`, `blocked_custody`, and
  `blocked_secret` so support can stop truthfully when a Jason/legal/ops
  decision, custody repair, or secret containment path is required.
- Deletion/export remains manual pre-release operations review through
  Brandcode Studio Ops. No self-serve deletion/export operation, public
  response window, public support SLA, legal term, or launch promise was added.
- No production endpoint proof, release, npm publish, public MCP directory
  submission, public listing metadata change, hosted tool addition,
  selected-kit default behavior, package/source posture change, custody
  relaxation, or production client key generation happened.

## Latest PO Work

Seeded repo-native sprint coordination and carried M001 through the M001-L27
limited-client support intake ledger closeout:

- `.claudex/sprints/current.md`
- `.claudex/sprints/m001-brandcode-mcp-stabilization.md`
- `.claudex/packets/M001-L01-hosted-proof-harness.md`
- `.claudex/prompts/M001-L01-hosted-proof-harness.md`
- `.claudex/packets/M001-L02-roadmap-alignment-delta.md`
- `.claudex/prompts/M001-L02-roadmap-alignment-delta.md`
- `.claudex/packets/M001-L05-pre-release-hardening-map.md`
- `.claudex/prompts/M001-L05-pre-release-hardening-map.md`
- `.claudex/packets/M001-L06-license-directory-trust-audit.md`
- `.claudex/prompts/M001-L06-license-directory-trust-audit.md`
- `.claudex/packets/M001-L07-security-matrix-rate-limit-posture.md`
- `.claudex/packets/M001-L08-asset-fetch-custody-proof.md`
- `.claudex/packets/M001-L09-package-safe-asset-fixture.md`
- `.claudex/packets/M001-L10-ucs-package-asset-delivery-ref.md`
- `.claudex/packets/M001-L11-hosted-package-asset-smoke-proof.md`
- `.claudex/packets/M001-L12-multi-client-battle-test.md`
- `.claudex/packets/M001-L13-release-candidate-trust-review.md`
- `.claudex/packets/M001-L14-hosted-terms-rate-limit-gate.md`
- `.claudex/packets/M001-L15-hosted-service-terms-decision-brief.md`
- `.claudex/packets/M001-L16-full-suite-visual-extraction-smoke-repair.md`
- `.claudex/packets/M001-L17-push-ci-proof-authorization.md`
- `.claudex/packets/M001-L18-github-actions-node24-compatibility.md`
- `.claudex/packets/M001-L19-hosted-rate-limit-abuse-posture.md`
- `.claudex/packets/M001-L20-durable-shared-rate-limit-enforcement.md`
- `.claudex/packets/M001-L21-hosted-retention-export-deletion-policy.md`
- `.claudex/packets/M001-L22-package-source-posture-decision-brief.md`
- `.claudex/packets/M001-L23-limited-client-readiness-plan.md`
- `.claudex/packets/M001-L24-limited-client-onboarding-template.md`
- `.claudex/packets/M001-L25-column-five-brandcode-client-config-dry-run.md`
- `.claudex/packets/M001-L26-limited-client-key-ops-runbook.md`
- `.claudex/packets/M001-L27-limited-client-support-intake-ledger.md`
- `.claudex/packets/M001-L28-deletion-export-launch-decision-brief.md`
- `.claudex/packets/M001-L29-limited-client-go-no-go-checklist.md`
- `.claudex/packets/M001-L30-limited-client-staging-freshness-proof.md`
- `.claudex/packets/M001-L31-limited-client-handoff-packet.md`
- `.claudex/packets/M001-L32-production-route-env-repair.md`
- `specs/brandcode-mcp-operational-roadmap-m001-m003.md`
- `specs/brandcode-mcp-deletion-export-launch-decision-brief.md`
- `specs/brandcode-mcp-column-five-client-config-dry-run.md`
- `specs/brandcode-mcp-limited-client-key-ops-runbook.md`
- `specs/brandcode-mcp-limited-client-support-intake-ledger.md`
- `specs/brandcode-mcp-limited-client-go-no-go-checklist.md`
- `specs/brandcode-mcp-production-proof-preflight.md`
- `.claudex/prompts/M001-L09-package-safe-asset-fixture.md`
- `.claudex/prompts/M001-L10-ucs-package-asset-delivery-ref.md`
- `.claudex/prompts/M001-L12-multi-client-battle-test.md`
- `.claudex/prompts/M001-L13-release-candidate-trust-review.md`
- `.claudex/prompts/M001-L15-hosted-service-terms-decision-brief.md`
- `.claudex/prompts/M001-L16-full-suite-visual-extraction-smoke-repair.md`
- `.claudex/prompts/M001-L17-push-ci-proof-authorization.md`
- `.claudex/prompts/M001-L18-github-actions-node24-compatibility.md`
- `.claudex/prompts/M001-L19-hosted-rate-limit-abuse-posture.md`
- `.claudex/prompts/M001-L20-durable-shared-rate-limit-enforcement.md`
- `.claudex/prompts/M001-L21-hosted-retention-export-deletion-policy.md`
- `.claudex/prompts/M001-L22-package-source-posture-decision-brief.md`
- `.claudex/prompts/M001-L23-limited-client-readiness-plan.md`
- `.claudex/prompts/M001-L24-limited-client-onboarding-template.md`
- `.claudex/prompts/M001-L25-column-five-brandcode-client-config-dry-run.md`
- `.claudex/prompts/M001-L26-limited-client-key-ops-runbook.md`
- `.claudex/prompts/M001-L27-limited-client-support-intake-ledger.md`
- `.claudex/prompts/M001-L28-deletion-export-launch-decision-brief.md`
- `.claudex/prompts/M001-L29-limited-client-go-no-go-checklist.md`
- `.claudex/prompts/M001-L30-limited-client-staging-freshness-proof.md`
- `.claudex/prompts/M001-L31-limited-client-handoff-packet.md`
- `.claudex/prompts/M001-L32-production-route-env-repair.md`
- `.claudex/messages/M001-messages.md`

## Previous Build Work

M001-L09 closed as blocked upstream with docs-only coordination:

- Hosted `get_brand_asset` reads UCS package data through `src/hosted/brand-fetcher.ts`, which calls `GET /api/brand/hosted/{slug}/pull`.
- The UCS route at `/Users/jasonlankow/Desktop/UCS/app/api/brand/hosted/[slug]/pull/route.ts` serves compiled Brandcode packages from `/Users/jasonlankow/Desktop/UCS/app/tools/lib/brand-adapter-runtime.ts`.
- The concrete generated sources are `/Users/jasonlankow/Desktop/UCS/app/tools/lib/compiled-brand-runtime.ts` and `/Users/jasonlankow/Desktop/UCS/app/tools/lib/compiled-brand-asset-manifests.ts`.
- `brandcode:logo:c5-logomark-red.svg` exists there with root-relative runtime URL and public URL refs, but no `deliveryRef.packagePath`, top-level `packagePath`, or package-safe `packageUrl`.
- The MCP correctly refuses to infer package custody from ordinary URL fields; no MCP code changed and no custody rule was relaxed.
- Hosted smoke with `BRANDCODE_MCP_SMOKE_ASSET_ID` was not rerun because no package-safe fixture exists and local smoke env keys are not present.
- M001-L10 became the repair lane for the upstream UCS/Studio package asset delivery ref.

M001-L08 closed with hosted custody proof and a package fixture blocker:

- `scripts/hosted-mcp-smoke.mjs` now requires `get_brand_asset` to return package-safe custody before passing.
- Private-provider-only asset responses are classified as `blocked` when the MCP truthfully marks the asset unsafe for MCP delivery and exposes no raw private/provider URL.
- `src/hosted/tools/assets.ts` now blocks private-looking `packageUrl` values instead of treating them as package-safe.
- `test/hosted/tools.test.ts` covers private-looking package URL custody.
- Hosted proof ran against `https://mcp.staging.brandcode.studio/brandcode` on deployment `https://brandsystem-qhfz5p7o6-column-five.vercel.app`.
- Selected asset id: `brandcode:logo:c5-logomark-red.svg`.
- `list_brand_assets` returned six assets and `custody_safe: true`.
- All six staging assets currently report `delivery_ref.posture: "blocked_private_provider_url"`.
- `get_brand_asset` returned the selected asset as blocked for private-provider-only delivery, exposed no raw private/provider URL, and the smoke harness reported that as `blocked`, not `fail`.
- No package-safe asset delivery ref exists in the current Brandcode staging package.

M001-L07 closed as a focused hosted security hardening lane:

- `test/hosted/auth.test.ts` covers malformed bearer parsing, wrong-environment key prefixes, and the full 8-tool scope matrix for read/check/feedback/full key postures.
- `test/hosted/router.test.ts` proves malformed Authorization headers are rejected at the hosted HTTP boundary.
- Existing env tests keep `BRANDCODE_MCP_SERVICE_TOKEN` as the only accepted service-token env name.
- Existing hosted asset, feedback, and history tests cover private provider URL redaction and compact history/receipt privacy.
- `SECURITY.md` now documents hosted bearer auth, scopes, service-token posture, custody/privacy, feedback/history posture, and rate limits as `not_reported_by_staging`.

M001-L06 closed as a docs-only license and directory trust audit:

- `specs/brandcode-mcp-license-directory-trust-audit.md` records the current release blockers.
- MIT remains clean for the existing `@brandsystem/mcp` Build package code, and `@brandcode/mcp` package/source can likely inherit MIT if Jason chooses that posture.
- Hosted Brandcode MCP still needs explicit service terms for bearer-key access, rate limits, feedback/history retention, private custody, client-owned brand data, and abuse handling.
- Existing listing metadata is Build-oriented and should remain Build-only until a separate Brandcode MCP Use listing is intentionally authored.
- `SECURITY.md` is too thin for hosted Use MCP review; it needs bearer auth, scopes, service-token posture, private custody, feedback/history privacy, and rate-limit/abuse language.

M001-L02 closed as a docs-only roadmap/product-spine update:

- `specs/brandcode-mcp-use-roadmap-alignment.md` now reflects the now-real 8-tool hosted implementation.
- Full Brand Runtime is framed as the default hosted Use MCP object.
- selected Brand Kits and campaign/exploratory kits remain outside default v0.1 until UCS has durable hosted selected-kit publish/share truth.
- `DESIGN.md` is framed as an adapter/readable brief, not runtime authority.
- `brand_feedback` is append-only review/hosted patch-request input, not canonical governance mutation.

M001-L01 closed with a repo-native hosted proof harness:

- `scripts/hosted-mcp-smoke.mjs`
- `npm run smoke:hosted-mcp`
- `test/scripts/hosted-mcp-smoke.test.ts`

The harness uses env-provided endpoint and bearer keys. It verifies MCP initialize/list/tools/core hosted calls and insufficient-scope behavior for `brand_check` and `brand_feedback`. It reports missing live dependencies as `blocked` or `skipped` instead of turning them into chat-only proof.

Latest hosted proof:

- Endpoint: `https://mcp.staging.brandcode.studio/brandcode`
- Package-safe asset id: `brandcode:logo:c5-logomark-red.svg`
- Latest client-config proof deployment:
  `https://brandsystem-umyitawby-column-five.vercel.app`
- Latest client-config proof:
  hosted smoke passed with `ok: true`, `status: "pass"`, `fail: 0`,
  `blocked: 0`, and `skipped: 0`; Claude Code called `brand_status` and
  `get_brand_asset` through a temporary HTTP MCP config and reported 8
  implemented tools, `rate_limit_status: "active_durable_shared"`,
  `asset_delivery_posture: "package_safe"`, `safe_for_mcp: true`, and no raw
  private/provider URL exposure.
- Latest durable rate-limit proof deployment:
  `https://brandsystem-kqrdhx4pe-column-five.vercel.app`
- Latest durable rate-limit proof:
  `brand_status.rate_limits.status: "active_durable_shared"` with
  `enforcement: "durable_shared_redis_fixed_window"`.
- Latest multi-client proof deployment: `https://brandsystem-eipxqt3go-column-five.vercel.app`
- Earlier asset-custody deployment: `https://brandsystem-qhfz5p7o6-column-five.vercel.app`
- Earlier feedback-proof deployment: `https://brandsystem-oj1iwfm13-column-five.vercel.app`
- Service-token env: `BRANDCODE_MCP_SERVICE_TOKEN`
- `brand_feedback` append proof: `append_status: recorded`
- `get_brand_asset` package delivery proof: passed with `delivery_ref_kind: "package_path"` and no raw private/provider URL exposure.

## Next Ready Lane

No lane is Ready. M001-L33 Production Live-Key Smoke Proof is blocked until
external DNS and Production secret env provisioning are complete.

M001-L32 added the production alias and Production MCP mode, but
`mcp.brandcode.studio` must resolve, Production env must include the hosted MCP
service token and durable shared rate-limit variables, and a fresh Production
deployment must reach the app-level bearer gate before any `bck_live_` key
generation or production smoke.

Public deletion/export launch language remains blocked until final
legal/subprocessor review. No public SLA, self-serve deletion/export, or
release claim is allowed.

Do not publish, release, submit to MCP directories, add tools, alter public
listing metadata, issue production client keys, name a real client without
approval, promise public deletion/export SLA, add self-serve deletion/export
operations, or relax custody.


## Known Blockers

- M001 push/CI proof is complete: `origin/main` includes pushed tip `2cf291c`
  and GitHub CI run `25641439073` passed.
- L19 push/CI proof is complete: `origin/main` includes pushed tip `74d72f5`
  and GitHub CI run `25684546273` passed.
- L20 push/CI proof is complete: `origin/main` includes pushed tip `cc94bee`
  and GitHub CI run `25687209671` passed.
- M001-L23 through M001-L28 push/CI proof is complete: `origin/main` includes
  pushed tip `9619b37` and GitHub CI run `25701556152` passed.
- L28 decision updates and L29 prep push/CI proof is complete: `origin/main`
  includes pushed tip `201ee36` and GitHub CI run `25705113500` passed.
- L30 push/CI proof is complete: `origin/main` includes pushed tip `3961be4`
  and GitHub CI run `25710999132` passed.
- L31 push/CI proof is complete: `origin/main` includes pushed tip `d0e06b3`
  and GitHub CI run `25746822612` passed.
- Jason approved the recommended hosted-service posture, M001-L21 drafted
  hosted data-policy language, and Jason chose Option 4 from M001-L22 for v0.1
  limited-client posture. M001-L23 added the limited-client readiness plan.
  Final legal/subprocessor launch language, future public package/source
  approval, and explicit release approval remain launch blockers.
- Rate limits have command-backed hosted durable shared Redis REST proof on the staging MCP route; local/test traffic can still use the in-process fallback when no shared store env exists.
- Pre-release abuse response owner is Jason Lankow / Brandcode Studio Ops `<jlankow@columnfive.com>`, with authority to revoke, rotate, suspend, or throttle hosted Brandcode MCP API keys for abuse, leaked keys, excessive traffic, security risk, or service-stability risk.
- Directory metadata for Brandcode Use is deferred until hosted terms/rate-limit posture is settled.
- CI hardening is resolved by M001-L18.
- Hosted rate-limit/abuse posture is no longer vague: `brand_status` reports
  `active_durable_shared` on the staging MCP route. Release remains blocked by
  final legal/subprocessor launch language, limited-client readiness, future
  public `@brandcode/mcp` package/source posture, deferred directory metadata,
  and Jason explicit release approval.
- Limited-client readiness now has a template, one real internal staging smoke
  proof, one real Claude Code client-config proof, a compact key operations
  runbook, and a support/intake ledger for setup, auth/scope, custody, quality,
  feedback/history, deletion/export, abuse/security, incident, and offboarding
  requests.
- The deletion/export pre-release operating posture is recorded in
  `specs/brandcode-mcp-deletion-export-launch-decision-brief.md`. Current
  deletion/export support remains manual pre-release ops review; no public
  response windows, self-serve operation, or support/legal launch language is
  approved yet.
- The limited-client go/no-go checklist is recorded in
  `specs/brandcode-mcp-limited-client-go-no-go-checklist.md`.
- The production proof preflight is recorded in
  `specs/brandcode-mcp-production-proof-preflight.md`; production proof is
  authorized but blocked on production domain/env provisioning.
- The limited-client handoff packet is recorded in
  `specs/brandcode-mcp-limited-client-handoff-packet.md`; it makes staging
  setup usable for an approved limited client without claiming production or
  public release readiness.
- The operational roadmap is recorded in
  `specs/brandcode-mcp-operational-roadmap-m001-m003.md`; it keeps M001/M002
  focused on production proof and limited-client use before any public
  package/directory work.
- Local proof-key note: Vercel Preview has a sensitive
  `BRANDCODE_MCP_TEST_KEYS` value, but `vercel env pull` redacts sensitive
  values locally. Future proof sessions need an intentional local secret
  handoff or a generate-and-run/API flow that avoids printing secrets.

## Local Hygiene

Untracked `.claude/` and `prompt` existed before M001 coordination work and should remain untouched unless Jason explicitly asks.
