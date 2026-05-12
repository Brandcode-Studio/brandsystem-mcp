# Current Sprint

**Active sprint:** M001 - Brandcode MCP stabilization and pre-release hardening
**Status:** Active
**Started:** 2026-05-08
**Repo:** `/Users/jasonlankow/Desktop/brandsystem-mcp`

## Sprint Objective

Turn the implemented Brandcode hosted MCP surface into an A-grade pre-release candidate with truthful CI posture, repeatable hosted proof, explicit UCS portable-runtime alignment, license clarity, security hardening, directory-score readiness, and battle-tested functionality.

## Current Truth

- `origin/main` includes M001 coordination/proof docs through pushed tip
  `d0e06b3`; local `main` now includes the next-1.5-sprints operational
  roadmap and M001-L32 lane prep.
- Latest GitHub CI baseline before M001-L01 was `61218ac`, and that CI is green.
- The seven hosted implementation commits from `9cd1c77` through `40e94a0` landed as one push batch; only the tip got CI.
- The `40e94a0` CI failure was `npm audit`; build, lint, and tests passed at the cumulative hosted MCP state.
- The audit issue was repaired by `61218ac`.
- Hosted code now reports all 8 locked Use MCP tools as real.
- Staging route proof now passes at `https://mcp.staging.brandcode.studio/brandcode`.
- Vercel Authentication is off for the hosted MCP route; app-level bearer auth remains enforced.
- `brand_feedback` append proof now passes with `append_status: recorded`.
- Hosted MCP service-token config now uses `BRANDCODE_MCP_SERVICE_TOKEN`, matching the UCS env var name.
- Untracked local files `.claude/` and `prompt` are not sprint artifacts and should remain untouched unless Jason explicitly asks.
- M001-L01 added repo-native hosted proof via `npm run smoke:hosted-mcp`.
- The smoke harness help and env-missing paths run locally without secrets; live hosted proof still requires `BRANDCODE_MCP_SMOKE_URL`, `BRANDCODE_MCP_SMOKE_FULL_KEY`, and optional read/asset/feedback inputs.
- M001-L02 refreshed the Use MCP roadmap/product spine so it no longer describes implemented hosted tools as stubs.
- The roadmap now frames Full Brand Runtime as the default hosted object, keeps selected/campaign kits out of v0.1 default, and treats `brand_feedback` as append-only review input.
- M001-L06 completed the license/package/directory/security trust audit and found the release blocker is hosted-service terms plus hosted security/privacy/rate-limit posture, not the MIT license for Build package code.
- M001-L07 expanded local hosted auth/security coverage for malformed bearer headers, wrong-environment key prefixes, all 8 tool scope requirements, and the canonical service-token env name; `SECURITY.md` now documents hosted auth, scopes, service-token, custody/privacy, and rate-limit posture.
- M001-L08 deployed the local custody hardening to staging and proved `get_brand_asset` against `https://mcp.staging.brandcode.studio/brandcode` with `brandcode:logo:c5-logomark-red.svg`.
- L08 proof result: the current Brandcode hosted package has no package-safe asset delivery refs; all six listed staging assets report `blocked_private_provider_url`.
- The hosted smoke harness now treats that posture as `blocked`, not `fail`, when the MCP returns the asset metadata, marks it unsafe for MCP delivery, and exposes no raw private/provider URLs.
- M001-L09 traced the package-safe asset fixture upstream to UCS, not the MCP: hosted `get_brand_asset` reads `GET /api/brand/hosted/{slug}/pull`, which uses the UCS compiled Brandcode payload from `app/tools/lib/brand-adapter-runtime.ts`, `app/tools/lib/compiled-brand-runtime.ts`, and `app/tools/lib/compiled-brand-asset-manifests.ts`.
- The current Brandcode compiled asset `brandcode:logo:c5-logomark-red.svg` has `refs.publicUrl` and root-relative runtime URLs, but no package materialization field accepted by the MCP custody contract: no `deliveryRef.packagePath`, no `packagePath`, no `package_url`, and no equivalent package-safe delivery ref.
- M001-L10 repaired the upstream UCS compiled package data locally without relaxing MCP custody: `brandcode:logo:c5-logomark-red.svg` now carries `deliveryRef: { posture: "package_safe", packagePath: "brandcode-brand-runtime/visual/assets/logo/c5-logomark-red.svg" }`, `inRuntimePackage: true`, and `lifecycle: "production-approved"` through the UCS compiled Brandcode payload.
- M001-L10 local proof passed against the UCS compiled adapter payload, but hosted smoke was blocked because the current shell has no `BRANDCODE_MCP_SMOKE_URL` or `BRANDCODE_MCP_SMOKE_FULL_KEY`, and the UCS change has not been pushed/deployed because Jason did not authorize push in the prompt.
- M001-L11 verified UCS `origin/main` contains `37585f98 Add Brandcode package asset delivery ref`, and hosted smoke passed against `https://mcp.staging.brandcode.studio/brandcode` with `BRANDCODE_MCP_SMOKE_ASSET_ID=brandcode:logo:c5-logomark-red.svg`.
- L11 hosted proof result: `get_brand_asset` returned `custody.safe_for_mcp: true`, `custody.blocked_private_provider_url: false`, `delivery_posture: "package_safe"`, `delivery_ref_kind: "package_path"`, and no raw private/provider URL exposure.
- M001-L12 first exposed a proof-infra gap: Vercel CLI non-interactive `env add/update` could not replace the empty sensitive Preview test-key value, and `vercel env pull --environment=preview --yes` redacts sensitive values locally.
- M001-L12 then resolved the proof-input blocker through the interactive Vercel env flow: `BRANDCODE_MCP_TEST_KEYS` is populated for Preview/all branches, staging was redeployed, and `mcp.staging.brandcode.studio` now aliases `https://brandsystem-eipxqt3go-column-five.vercel.app`.
- M001-L12 hosted smoke passed with full/read key postures and package-safe asset id `brandcode:logo:c5-logomark-red.svg`.
- M001-L12 MCP Inspector proof passed: `tools/list` returned the locked 8-tool order, `get_brand_asset` returned package-safe delivery without raw private/provider URLs, and read-only `brand_check` returned structured `insufficient_scope`.
- M001-L12 Claude Code proof passed through a temporary HTTP MCP config: Claude called `brand_status` and `get_brand_asset`, reported 8 implemented tools, package-safe asset posture, and no raw private/provider URL exposure.
- M001-L13 completed the release-candidate trust review and did not release, publish, submit to directories, alter package/listing metadata, add tools, relax custody, or introduce selected Brand Kit default behavior.
- L13 decision: do not claim release-candidate readiness yet; the next release gate is hosted-service terms plus rate-limit/abuse posture.
- M001-L14 completed the hosted terms and rate-limit gate without release, publish, directory submission, package/listing metadata changes, hosted tool additions, selected Brand Kit default behavior, or custody relaxation.
- The L14 durable gate is `specs/brandcode-mcp-hosted-terms-rate-limit-gate.md`.
- After L19, `brand_status.rate_limits` reports
  `status: "active_pre_release_in_process"` on the hosted HTTP route and still
  reports `release_gate: "blocked"` with blocker owner
  `Jason Lankow / Brandcode Studio Ops <jlankow@columnfive.com>`.
- The hosted terms/rate-limit gate was still not release-satisfied after L15.
  At that point, final public retention/deletion/export language,
  abuse/rate-limit operations, public "free in v1" copy, and
  `@brandcode/mcp` package/source posture remained launch blockers. Later M001
  lanes resolved abuse-owner, durable rate-limit proof, and v0.1
  package/source posture, while release approval and deletion/export launch
  language remain blocked.
- M001-L15 captured Jason approval for the recommended hosted-service posture in `specs/brandcode-mcp-hosted-service-terms-decision-brief.md`.
- L15 approval settles the pre-release service-terms direction, but does not authorize release, npm publish, directory submission, public listing changes, or release-candidate readiness claims.
- M001-L16 repaired the invalid MCP image content returned by visual extraction tools by normalizing Puppeteer screenshot bytes through valid base64 encoding before emitting image content.
- L16 restored local full-suite proof: `npm test -- --run test/tools/smoke.test.ts`, `npm run lint`, `npm run build`, and full `npm test` all passed. Full `npm test` passed 39 files and 526 tests.
- M001-L17 pushed `main` from `61218ac` to `2cf291c` after Jason authorized
  push.
- GitHub CI run `25641439073` passed on pushed tip `2cf291c` across Node 20
  and Node 22 matrix jobs. Both jobs passed `npm ci`, `npm run build`,
  `npm run lint`, `npm test`, and `npm audit --audit-level=high`.
- The CI run emitted a Node.js 20 Actions deprecation annotation for
  `actions/checkout@v4` and `actions/setup-node@v4`; this is the next release
  trust hygiene lane.
- M001-L18 updated CI to test Node 20, 22, and 24; updated first-party actions
  to `actions/checkout@v6` and `actions/setup-node@v6`; and pushed commit
  `60aa66f`.
- GitHub CI run `25678340682` passed on pushed tip `60aa66f` across Node 20,
  Node 22, and Node 24. All three jobs passed `npm ci`, `npm run build`,
  `npm run lint`, `npm test`, and `npm audit --audit-level=high`.
- The prior Node.js 20 Actions deprecation annotation did not recur in the
  watched L18 run output or `gh run view` job summary.
- M001-L19 added hosted in-process fixed-window rate limiting keyed by
  environment, brand slug, and API key id. The hosted route now returns
  `x-ratelimit-*` headers, emits structured `429 rate_limited` responses, and
  reports `brand_status.rate_limits.status` as
  `active_pre_release_in_process` when called through the hosted HTTP router.
- L19 did not satisfy the public release gate: the limiter is process-local
  pre-release enforcement, not durable shared production enforcement.
- M001-L19 was pushed after Jason authorized push. GitHub CI run `25684546273`
  passed on pushed tip `74d72f5` across Node 20, Node 22, and Node 24. All
  three jobs passed `npm ci`, `npm run build`, `npm run lint`, `npm test`, and
  `npm audit --audit-level=high`.
- Jason named the pre-release abuse response owner as Jason Lankow /
  Brandcode Studio Ops `<jlankow@columnfive.com>`, with authority to revoke,
  rotate, suspend, or throttle hosted Brandcode MCP API keys for abuse, leaked
  keys, excessive traffic, security risk, or service-stability risk.
- Jason chose durable shared hosted rate limiting as the next lane before broad
  public release.
- M001-L20 added optional durable shared Redis REST fixed-window rate limiting
  using `@upstash/redis`. Hosted env may use
  `BRANDCODE_MCP_RATE_LIMIT_REDIS_REST_URL` /
  `BRANDCODE_MCP_RATE_LIMIT_REDIS_REST_TOKEN`, or standard
  `UPSTASH_REDIS_REST_*` / `KV_REST_API_*` names.
- `brand_status.rate_limits.status` now distinguishes
  `active_durable_shared` from the `active_pre_release_in_process` local/test
  fallback, and the router fails closed with `503 rate_limit_unavailable` if a
  configured durable shared store is unavailable.
- M001-L20 hosted durable-store proof passed after Jason provisioned
  Vercel/Upstash KV/Redis Preview env. Staging now aliases
  `https://brandsystem-kqrdhx4pe-column-five.vercel.app`, and `brand_status`
  through the MCP Streamable HTTP client reports
  `rate_limits.status: "active_durable_shared"` with
  `enforcement: "durable_shared_redis_fixed_window"`.
- M001-L20 hosted smoke also passed against
  `https://mcp.staging.brandcode.studio/brandcode` with full/read key postures
  and package-safe asset id `brandcode:logo:c5-logomark-red.svg`: `fail: 0`,
  `blocked: 0`, `skipped: 0`.
- During proof, generated Preview test keys were accidentally echoed by an
  unsafe pseudo-terminal attempt; they were treated as burned, rotated, and
  replaced through the Vercel API for all Preview branches before proof.
- Public release remains blocked until Jason explicitly approves release.
- M001-L20 verification passed for `git diff --check`, focused hosted
  router/status tests, lint, build, and full `npm test` (39 files, 530 tests).
- M001-L20 was pushed after Jason authorized push. GitHub CI run `25687209671`
  passed on pushed tip `cc94bee` across Node 20, Node 22, and Node 24. All
  three jobs passed `npm ci`, `npm run build`, `npm run lint`, `npm test`, and
  `npm audit --audit-level=high`.
- M001-L21 added `specs/brandcode-mcp-hosted-data-policy.md` and aligned
  SECURITY, README, llms, and hosted terms docs around the same data-policy
  truth: authorized bearer-key pre-release access, client-owned or
  client-controlled brand data, append-only feedback, scoped/redacted history,
  package-safe custody, and Jason/legal/ops deletion/export blockers.
- M001-L22 added
  `specs/brandcode-mcp-package-source-posture-decision-brief.md` and framed the
  unresolved `@brandcode/mcp` package/source posture as a named Jason decision
  blocker before npm, package metadata, directory submission, public listing, or
  release work.
- Jason chose Option 4 for v0.1 limited-client posture: defer public
  `@brandcode/mcp` package/source distribution, keep Brandcode MCP as an
  approved-brand hosted pre-release service, and do not publish npm or submit
  directory metadata for v0.1 limited-client work.
- Option 3 remains the likely future public direction: a narrow public
  connector/client artifact plus service-controlled hosted implementation and
  bearer-key-gated brand data access. That future posture still needs separate
  approval and hardening.
- M001-L21 was docs-only. It did not change hosted tools, custody code,
  package/listing metadata, release/publish posture, or
  `brand_status.rate_limits.release_gate`.
- M001-L22 was docs-only. It did not change code, hosted tools, custody,
  package/listing metadata, release/publish posture, directory submission, or
  public source/license posture.
- M001-L23 added
  `specs/brandcode-mcp-limited-client-readiness-plan.md` and turned Option 4
  into approved-client rollout guardrails: client/brand eligibility, staging vs
  production endpoint posture, key issuance/rotation/revocation/leak response,
  per-client smoke proof, support/abuse/deletion/export/incident intake,
  package-safe custody, rate-limit/service-token checks, no-public-package
  guardrails, and future Option 3 signals.
- M001-L23 was docs-only. It did not change code, hosted tools, custody,
  package/listing metadata, release/publish posture, directory submission,
  public source/license posture, or production client keys.
- M001-L24 added
  `specs/brandcode-mcp-limited-client-onboarding-template.md` and a concrete
  internal staging proof at
  `specs/brandcode-mcp-column-five-brandcode-staging-onboarding-proof.md`.
- M001-L24 tested the template against the Column Five Brandcode `brandcode`
  staging instance at `https://mcp.staging.brandcode.studio/brandcode`.
  Hosted smoke passed with `ok: true`, `status: "pass"`, `fail: 0`,
  `blocked: 0`, and `skipped: 0`; package-safe asset proof passed for
  `brandcode:logo:c5-logomark-red.svg`.
- M001-L24 was docs/proof-only. It did not change code, hosted tools, custody,
  package/listing metadata, release/publish posture, directory submission,
  public source/license posture, production client keys, or production endpoint
  access.
- M001-L25 completed the Column Five Brandcode client-config dry run through
  Jason-approved staging-only generate-and-run keys.
- L25 generated fresh staging-only `bck_test_` full/read keys, installed them in
  Vercel Preview `BRANDCODE_MCP_TEST_KEYS` for all Preview branches, deployed
  fresh Preview `dpl_E45BFFLXS2H2BJWz9TvBuZv8Cgtb`, and re-aliased
  `https://mcp.staging.brandcode.studio` to
  `https://brandsystem-umyitawby-column-five.vercel.app`.
- L25 hosted smoke passed against
  `https://mcp.staging.brandcode.studio/brandcode` with
  `brandcode:logo:c5-logomark-red.svg`: `ok: true`, `status: "pass"`,
  `fail: 0`, `blocked: 0`, `skipped: 0`.
- L25 Claude Code proof passed through a temporary HTTP MCP config: Claude
  called `brand_status` and `get_brand_asset`, reported 8 implemented tools,
  `rate_limit_status: "active_durable_shared"`, package-safe asset delivery,
  `safe_for_mcp: true`, and no raw private/provider URL exposure.
- M001-L25 did not print, commit, or write bearer-key values to docs. It did
  not change code, hosted tools, custody, package/listing metadata,
  release/publish posture, directory submission, public source/license posture,
  production client keys, or production endpoint access.
- M001-L26 added
  `specs/brandcode-mcp-limited-client-key-ops-runbook.md`, documenting
  limited-client staging key generation, Preview env installation posture,
  deploy/alias proof, production-key approval gating, smoke proof, real-client
  config proof, key ownership, rotation, revocation, suspected leak response,
  and redacted evidence capture.
- M001-L26 was docs-only. It did not change code, hosted tools, custody,
  package/listing metadata, release/publish posture, directory submission,
  public source/license posture, production client keys, or production endpoint
  access.
- M001-L27 added
  `specs/brandcode-mcp-limited-client-support-intake-ledger.md`, documenting
  limited-client support intake for access setup, auth/scope, custody,
  quality, feedback/history, deletion/export, abuse/security, incidents, and
  offboarding.
- M001-L27 was docs-only. It preserved manual pre-release deletion/export ops
  review and did not add public SLA language, self-serve operations, hosted
  tools, custody changes, production keys, release/publish posture, package
  metadata, directory submission, or public source posture.
- M001-L28 added
  `specs/brandcode-mcp-deletion-export-launch-decision-brief.md`, framing the
  remaining public deletion/export launch language as Jason/legal/ops
  decisions for requester authorization, verification method, systems and
  exclusions, export package format, response windows, escalation path, and
  required legal/subprocessor language.
- M001-L28 was docs-only. It preserved manual pre-release deletion/export
  review through Brandcode Studio Ops and did not add self-serve
  deletion/export tools, public SLA language, legal terms, hosted tools,
  custody changes, production keys, release/publish posture, package metadata,
  directory submission, or public source posture.
- Jason then approved the L28 pre-release deletion/export operating posture:
  authorized requesters are brand owners/admins for the brand instance or Jason
  as Brandcode Studio Ops; authority proof is brand instance admin status or,
  for the internal Column Five Brandcode instance, verified
  `columnfivemedia.com` / `columnfive.com` email.
- Jason accepted the L28 public-operating recommendations: external authority
  proof requires brand admin role, approved client contact, or written
  admin/contract-owner approval; scope stays hosted MCP service data only;
  exports are curated support packets; security/abuse/audit/legal/backups and
  out-of-custody provider data are excluded; no public SLA or self-serve
  deletion/export is approved; draft legal/subprocessor language is useful
  review input but not final public terms.
- M001-L23 through M001-L28 were pushed to `origin/main` at tip `9619b37`.
- GitHub CI run `25701556152` passed on pushed tip `9619b37` across Node 20,
  Node 22, and Node 24. All three jobs passed `npm ci`, `npm run build`,
  `npm run lint`, `npm test`, and `npm audit --audit-level=high`.
- M001-L28 decision updates and L29 prep were pushed to `origin/main` at tip
  `201ee36`.
- GitHub CI run `25705113500` passed on pushed tip `201ee36` across Node 20,
  Node 22, and Node 24. All three jobs passed `npm ci`, `npm run build`,
  `npm run lint`, `npm test`, and `npm audit --audit-level=high`.
- M001-L29 added
  `specs/brandcode-mcp-limited-client-go-no-go-checklist.md`, a per-client
  operator checklist that separates staging readiness, production proof
  readiness, and public release readiness.
- M001-L29 keeps public release blocked: final legal/subprocessor launch
  language, future public package/source approval, directory metadata, and
  explicit Jason release approval are still required.
- M001-L30 applied the go/no-go checklist to the current Column Five Brandcode
  staging route. After Jason asked to generate the needed keys, fresh
  staging-only `bck_test_` full/read keys were generated, installed as
  sensitive Vercel Preview env, deployed behind staging, used for proof, and
  removed locally.
- M001-L30 hosted smoke passed against
  `https://mcp.staging.brandcode.studio/brandcode` at
  `2026-05-12T02:25:44.680Z` on Ready Preview deployment
  `dpl_4aQ9vVdsXC6SD5u7TMqXZKs4eCQC` /
  `https://brandsystem-pwnz9m3oy-column-five.vercel.app`: `ok: true`,
  `status: "pass"`, `fail: 0`, `blocked: 0`, `skipped: 0`, locked 8-tool
  order, `brand_status.rate_limits.status: "active_durable_shared"`,
  package-safe asset custody, `brand_feedback` append recorded, and read-only
  `insufficient_scope` for `brand_check` and `brand_feedback`.
- M001-L30 was pushed to `origin/main` at tip `3961be4`.
- GitHub CI run `25710999132` passed on pushed tip `3961be4` across Node 20,
  Node 22, and Node 24. All three jobs passed `npm ci`, `npm run build`,
  `npm run lint`, `npm test`, and `npm audit --audit-level=high`.
- Jason authorized production proof and live-key testing for the `brandcode`
  slug on 2026-05-12.
- Production proof is authorized but blocked on infrastructure: `mcp.brandcode.studio`
  does not currently resolve, `vercel alias ls` shows only
  `mcp.staging.brandcode.studio`, and `vercel env ls production` lists only
  `MCP_LOG_LEVEL`, `NODE_ENV`, and `UCS_API_BASE_URL`.
- Production `BRANDCODE_MCP_ENV=production`, `BRANDCODE_MCP_TEST_KEYS` or
  equivalent live-key seed env, `BRANDCODE_MCP_SERVICE_TOKEN`, and durable
  shared rate-limit env are not listed in Production. No `bck_live_` keys were
  generated.
- M001-L31 added
  `specs/brandcode-mcp-limited-client-handoff-packet.md`, a reusable
  approved-client staging handoff packet with setup shape, approved claims,
  non-claims, key/scope posture, custody expectations, smoke/proof
  expectations, support/intake, rotation/offboarding, a redacted Column Five
  Brandcode internal example, and the current production-proof blocker.
- M001-L31 was docs-only. It did not change code, hosted tools, custody,
  package/listing metadata, release/publish posture, directory submission,
  public source/license posture, production keys, production endpoint access,
  public deletion/export SLA, or self-serve deletion/export operations.
- M001-L31 was pushed to `origin/main` at tip `d0e06b3`.
- GitHub CI run `25746822612` passed on pushed tip `d0e06b3` across Node 20,
  Node 22, and Node 24. All three jobs passed `npm ci`, `npm run build`,
  `npm run lint`, `npm test`, and `npm audit --audit-level=high`.
- The operational roadmap for the remainder of M001, M002, and the first half
  of M003 is recorded in
  `specs/brandcode-mcp-operational-roadmap-m001-m003.md`.
- The roadmap sequence is production route/env repair, production smoke proof,
  M001 closeout/open M002, limited-client pilot rehearsal, support-ledger
  dogfood, key rotation/revocation/offboarding drill, non-Brandcode brand
  proof, one evidence-led quality repair, then M003 production trust
  foundations.

## Lanes

| Lane | Status | Packet | Goal |
| --- | --- | --- | --- |
| M001-L01 | Done | `.claudex/packets/M001-L01-hosted-proof-harness.md` | Add a repeatable hosted MCP smoke harness and refresh docs so the next hosted proof cannot drift into chat-only claims. |
| M001-L02 | Done | `.claudex/packets/M001-L02-roadmap-alignment-delta.md` | Refresh `specs/brandcode-mcp-use-roadmap-alignment.md` against the now-real 8-tool implementation and latest UCS portable runtime semantics. |
| M001-L03 | Done | Manual proof captured in `.claudex/messages/M001-messages.md` | Resolve staging-domain/deployment-protection proof once DNS or Vercel access is available. |
| M001-L04 | Done | Manual proof captured in `.claudex/messages/M001-messages.md` | Prove `brand_feedback` append against UCS history once a real service token exists. |
| M001-L05 | Done | `.claudex/packets/M001-L05-pre-release-hardening-map.md` | Map license, security, tests, directory scoring, and battle-test work before any release. |
| M001-L06 | Done | `.claudex/packets/M001-L06-license-directory-trust-audit.md` | Audit license/package/directory/security trust posture and produce a pre-release gap list. |
| M001-L07 | Done | `.claudex/packets/M001-L07-security-matrix-rate-limit-posture.md` | Expand hosted auth/scope/security verification and document or implement rate-limit posture. |
| M001-L08 | Done | `.claudex/packets/M001-L08-asset-fetch-custody-proof.md` | Prove `get_brand_asset` with a stable staging asset id and harden custody proof. |
| M001-L09 | Done - upstreamed | `.claudex/packets/M001-L09-package-safe-asset-fixture.md` | Coordinate a stable package-safe Brandcode asset fixture so hosted `get_brand_asset` can pass package delivery proof before battle testing. |
| M001-L10 | Done | `.claudex/packets/M001-L10-ucs-package-asset-delivery-ref.md` | Repair the upstream UCS Brandcode compiled/runtime package data so one stable asset has a real package-safe delivery ref, then rerun hosted smoke. |
| M001-L11 | Done | `.claudex/packets/M001-L11-hosted-package-asset-smoke-proof.md` | Confirm UCS staging freshness for the local package-safe asset repair and rerun hosted smoke with the package-safe asset id. |
| M001-L12 | Done | `.claudex/packets/M001-L12-multi-client-battle-test.md` | Battle test the locked hosted 8-tool surface across real MCP clients before any release candidate review. |
| M001-L13 | Done | `.claudex/packets/M001-L13-release-candidate-trust-review.md` | Review the pre-release trust posture and decide the next repair lane before any release candidate claim. |
| M001-L14 | Done | `.claudex/packets/M001-L14-hosted-terms-rate-limit-gate.md` | Turn hosted-service terms, privacy/retention, custody, abuse handling, and rate-limit posture into an explicit release gate. |
| M001-L15 | Done | `.claudex/packets/M001-L15-hosted-service-terms-decision-brief.md` | Prepare the compact Jason decision brief for hosted-service terms, retention, rate-limit/abuse ownership, pricing copy, and package/source posture. |
| M001-L16 | Done | `.claudex/packets/M001-L16-full-suite-visual-extraction-smoke-repair.md` | Repair the two failing visual extraction smoke tests so full local suite proof can precede push/CI or any release-candidate claim. |
| M001-L17 | Done | `.claudex/packets/M001-L17-push-ci-proof-authorization.md` | Resolve the push/CI proof gap after full-suite green, without pushing unless Jason explicitly authorizes it. |
| M001-L18 | Done | `.claudex/packets/M001-L18-github-actions-node24-compatibility.md` | Repair or explicitly harden the GitHub Actions Node runtime posture surfaced by the passing M001-L17 CI run. |
| M001-L19 | Done | `.claudex/packets/M001-L19-hosted-rate-limit-abuse-posture.md` | Add active pre-release hosted rate-limit enforcement and preserve the durable production release blocker truthfully. |
| M001-L20 | Done | `.claudex/packets/M001-L20-durable-shared-rate-limit-enforcement.md` | Add durable shared Redis REST enforcement and prove hosted durable rate-limit posture. |
| M001-L21 | Done | `.claudex/packets/M001-L21-hosted-retention-export-deletion-policy.md` | Clarify hosted Brandcode MCP retention, deletion, export, feedback/history, custody, and service/package posture before any release claim. |
| M001-L22 | Done | `.claudex/packets/M001-L22-package-source-posture-decision-brief.md` | Prepare the Jason decision brief for `@brandcode/mcp` package/source posture before npm, directory, listing, or release work. |
| M001-L23 | Done | `.claudex/packets/M001-L23-limited-client-readiness-plan.md` | Turn the approved Option 4 posture into a limited-client readiness plan and guardrails without publishing or listing Brandcode MCP. |
| M001-L24 | Done | `.claudex/packets/M001-L24-limited-client-onboarding-template.md` | Turn the limited-client readiness plan into a reusable per-client onboarding template/checklist and test it against the internal Brandcode staging instance. |
| M001-L25 | Done | `.claudex/packets/M001-L25-column-five-brandcode-client-config-dry-run.md` | Prove the Column Five Brandcode staging endpoint through a real MCP client config without exposing keys. |
| M001-L26 | Done | `.claudex/packets/M001-L26-limited-client-key-ops-runbook.md` | Document limited-client key operations for staging, production gating, rotation, revocation, leak response, and redacted proof capture. |
| M001-L27 | Done | `.claudex/packets/M001-L27-limited-client-support-intake-ledger.md` | Document limited-client support, incident, deletion/export, and offboarding intake without promising public SLA or self-serve operations. |
| M001-L28 | Done | `.claudex/packets/M001-L28-deletion-export-launch-decision-brief.md` | Prepare the Jason/legal/ops deletion/export launch decision brief without implying public approval or self-serve operations. |
| M001-L29 | Done | `.claudex/packets/M001-L29-limited-client-go-no-go-checklist.md` | Consolidate limited-client evidence into a staging/production/public go/no-go checklist without making release claims. |
| M001-L30 | Done | `.claudex/packets/M001-L30-limited-client-staging-freshness-proof.md` | Applied the go/no-go checklist to the current Column Five Brandcode staging instance and refreshed redacted hosted proof. |
| M001-L31 | Done | `.claudex/packets/M001-L31-limited-client-handoff-packet.md` | Drafted the approved limited-client handoff packet with setup, claims, support, custody, key posture, and current production-proof blocker. |
| M001-L32 | Blocked - external DNS/secret env | `.claudex/packets/M001-L32-production-route-env-repair.md` | Added the production alias and `BRANDCODE_MCP_ENV=production`; blocked on external DNS plus Production service-token and durable rate-limit secret env before live-key proof. |

## Blockers And Decisions

- Jason decision: no publish, public release, or MCP directory submission until hardening is much stronger and Jason explicitly authorizes release.
- Jason approved the recommended hosted-service posture for pre-release authorized access, client-owned data, feedback/history posture, custody, launch-copy restraint, and source/service separation.
- L11 resolved the hosted package asset proof blocker for `brandcode:logo:c5-logomark-red.svg`.
- L12 resolved the hosted client credential blocker for Preview through Vercel env provisioning and did not commit secrets to the repo.
- Rate-limit/abuse posture now has command-backed hosted durable shared Redis
  REST proof on the staging MCP route. `release_gate` remains `blocked`
  because Jason has not approved release.
- Pre-release abuse response owner is Jason Lankow / Brandcode Studio Ops
  `<jlankow@columnfive.com>`, with key revoke/rotate/suspend/throttle
  authority for abuse, leaked keys, excessive traffic, security risk, or
  service-stability risk.
- Push/CI proof for the M001 stack is complete: GitHub CI run `25641439073`
  passed on pushed tip `2cf291c`.
- Push/CI proof for L19 is complete: GitHub CI run `25684546273` passed on
  pushed tip `74d72f5`.
- Push/CI proof for L20 is complete: GitHub CI run `25687209671` passed on
  pushed tip `cc94bee`.
- Push/CI proof for the M001-L23 through M001-L28 stack is complete: GitHub CI
  run `25701556152` passed on pushed tip `9619b37`.
- Push/CI proof for the pushed L28 decision updates and L29 prep is complete:
  GitHub CI run `25705113500` passed on pushed tip `201ee36`.
- Push/CI proof for M001-L30 is complete: GitHub CI run `25710999132`
  passed on pushed tip `3961be4`.
- Push/CI proof for M001-L31 is complete: GitHub CI run `25746822612`
  passed on pushed tip `d0e06b3`.
- L13 converted directory metadata and production-key/non-Brandcode proof into product-spine deferrals until hosted terms/rate-limit posture is settled.
- L14 converted hosted-service terms, retention/privacy, custody, abuse handling, rate-limit posture, pricing copy, and package/source posture into a blocked release gate.
- Full-suite local test deferral is resolved by M001-L16.
- CI hardening deferral is resolved by M001-L18.
- Hosted rate-limit/abuse posture is no longer vague: command-backed hosted
  proof shows `brand_status.rate_limits.status: "active_durable_shared"`.
  M001-L21 drafted hosted data-policy language. M001-L22 framed package/source
  posture options, and Jason chose Option 4 for v0.1 limited-client work.
  M001-L23 added the limited-client readiness plan. Release remains blocked by
  final deletion/export launch approval, future public package/source approval,
  directory metadata, and Jason explicit release approval.
- M001-L24 proved the limited-client onboarding template against the internal
  `brandcode` staging instance.
- M001-L25 proved the same endpoint through a real Claude Code MCP client
  configuration after Jason authorized a staging-only generate-and-run key flow.
- M001-L26 turned the key-generation, handoff, rotation, revocation,
  leak-response, and redacted proof process into a limited-client key
  operations runbook.
- M001-L27 turned support, incident, deletion/export, and offboarding intake
  into a redacted limited-client ledger without promising public SLA or
  self-serve operations.
- M001-L28 turned the remaining deletion/export launch language risk into a
  compact Jason/legal/ops decision brief. The pre-release operating posture is
  now recorded; the remaining blocker is final legal/subprocessor launch
  language, not missing repo preparation.
- M001-L29 consolidated limited-client evidence into a go/no-go checklist that
  separates staging, production proof, and public release readiness while
  keeping deletion/export launch language blocked until final
  legal/subprocessor launch language is approved.
- M001-L30 recorded the current Column Five Brandcode staging read without
  making a release claim. Staging readiness is go for internal Column Five
  Brandcode rehearsal only; production proof, production key issuance, public
  package/source posture, directory metadata, final legal/subprocessor launch
  language, and release remain Jason/legal/ops blockers.
- Jason has now authorized production proof/live-key testing for `brandcode`,
  but production proof is blocked on route/env provisioning. The durable
  preflight is `specs/brandcode-mcp-production-proof-preflight.md`.
- M001-L31 drafted the limited-client handoff packet that an approved staging
  client could receive, while keeping the production proof blocker and
  public-release blockers explicit.
- The next 1.5 sprint roadmap is operationalized in
  `specs/brandcode-mcp-operational-roadmap-m001-m003.md`. It keeps M001 and
  M002 focused on production proof and limited-client use before any public
  package/directory work.
- M001-L32 partially repaired production route/env readiness by adding the
  `mcp.brandcode.studio` Vercel alias and Production
  `BRANDCODE_MCP_ENV=production`. The next proof step is blocked until
  external DNS sets `A mcp.brandcode.studio 76.76.21.21` or moves nameservers
  to Vercel, and Production receives `BRANDCODE_MCP_SERVICE_TOKEN` plus
  durable shared rate-limit env.

## Ready Lane Rule

No lane is Ready for automation because the next useful lane,
M001-L33 Production Live-Key Smoke Proof, is blocked on external DNS and
Production secret env provisioning.

The deletion/export pre-release operating posture is recorded, but public
deletion/export launch language is still blocked on final legal/subprocessor
review. No public SLA, self-serve deletion/export, or release claim is allowed.

Do not publish, release, submit to directories, add tools, alter public listing
metadata, issue production client handoff keys, name a real client without
approval, or relax private custody. Production proof/live-key testing for
`brandcode` is authorized, but the production route/env blockers must be
resolved first. Jason approval remains a hard blocker for any release or
publish action.

Do not generate `bck_live_` keys or run production smoke until
`mcp.brandcode.studio` resolves, Production service-token env exists, durable
shared rate-limit env exists, and a fresh Production deployment can reach the
hosted app-level bearer gate.
