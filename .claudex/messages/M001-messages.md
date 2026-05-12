# M001 Messages

## 2026-05-08 - Sprint Opened

M001 opened to stabilize the Brandcode hosted Use MCP after the rapid 8-tool implementation run.

Current repo truth:

- `main` is green at `61218ac`.
- `40e94a0` carried the cumulative seven hosted implementation commits but failed CI on `npm audit`.
- `61218ac` fixed the audit failure.
- Intermediate hosted commits did not get isolated GitHub CI runs.
- The hosted code now reports all 8 locked tools as real.
- Hosted proof remains incomplete until staging DNS, deployment protection/client access, and UCS service-token feedback append are resolved.

Next Ready lane:

- M001-L01 - Hosted Proof Harness And Truth Spine.

## 2026-05-08 - M001-L01 Closed

M001-L01 added a repo-native hosted MCP smoke harness:

- Command: `npm run smoke:hosted-mcp`
- Script: `scripts/hosted-mcp-smoke.mjs`
- Local tests: `test/scripts/hosted-mcp-smoke.test.ts`

What it proves when endpoint and keys are provided:

- MCP `initialize`
- `tools/list`
- locked 8-tool order
- `brand_status`
- `brand_runtime`
- `brand_search`
- `list_brand_assets`
- optional `get_brand_asset`
- `brand_check`
- `brand_history`
- `brand_feedback`
- read-only insufficient-scope behavior for `brand_check` and `brand_feedback`

This lane proved the harness help/env-missing path locally without secrets. It did not claim staging-domain proof, Vercel route proof, external MCP client proof, or feedback append proof because live endpoint/key/service-token dependencies were not provided in the local run.

## 2026-05-08 - M001-L02 Shaped

M001-L02 is now the single Ready lane.

Purpose:

- Refresh the Brandcode Use MCP roadmap/product-spine docs after the hosted 8-tool implementation run and M001-L01 proof harness.
- Remove stale stub language from `specs/brandcode-mcp-use-roadmap-alignment.md`.
- Re-lock the product semantics around Full Brand Runtime, selected Brand Kits, campaign/exploratory kits, Production-Approved Assets, hosted review/patch input, and `DESIGN.md` non-authority.

Still blocked after L02:

- Exact staging-domain proof waits on DNS/alias/cert.
- Direct external MCP client proof waits on Vercel access/deployment-protection posture.
- `brand_feedback` append proof waits on a real UCS service token.

## 2026-05-08 - M001-L02 Closed

M001-L02 refreshed the Use MCP roadmap/product spine as a docs-only lane.

Updated docs:

- `specs/brandcode-mcp-use-roadmap-alignment.md`
- `specs/brandcode-mcp-phase-0-lock.md`
- `README.md`
- M001 sprint closeout docs

Current product truth:

- `@brandsystem/mcp` remains Build.
- `@brandcode/mcp` remains hosted Use.
- v0.1 remains locked at exactly 8 tools.
- The roadmap no longer calls implemented hosted tools `not_implemented_in_staging` stubs.
- Full Brand Runtime is the default hosted object.
- selected Brand Kits and campaign/exploratory kits stay out of default v0.1 until UCS has durable hosted selected-kit publish/share truth.
- `DESIGN.md` is an adapter/readable brief, not runtime authority.
- `brand_feedback` is append-only review/hosted patch-request input, not canonical mutation.

Next lane posture:

- No lane is Ready for automation.
- M001-L03 remains blocked by DNS/alias/cert and Vercel access/deployment-protection posture.
- M001-L04 remains blocked by real UCS service-token provisioning.

## 2026-05-08 - M001-L03/L04 Proof Completed

Jason configured DNS for `mcp.staging.brandcode.studio`, disabled Vercel Authentication for the hosted MCP route, and configured shared service-token posture.

The hosted MCP service-token env name was normalized to `BRANDCODE_MCP_SERVICE_TOKEN` so the hosted MCP and UCS use the same variable name. `UCS_SERVICE_TOKEN` is no longer accepted by repo code.

Staging proof:

- Alias: `https://mcp.staging.brandcode.studio/brandcode`
- Deployment: `https://brandsystem-oj1iwfm13-column-five.vercel.app`
- Command: `npm run smoke:hosted-mcp -- --json`

Passed:

- MCP `initialize`
- `tools/list` exact locked 8-tool order
- `brand_status`
- `brand_runtime`
- `brand_search`
- `list_brand_assets`
- `brand_check`
- `brand_history`
- `brand_feedback` with `append_status: recorded`
- read-only insufficient-scope behavior for `brand_check`
- read-only insufficient-scope behavior for `brand_feedback`

Skipped:

- `get_brand_asset`, because no `BRANDCODE_MCP_SMOKE_ASSET_ID` was provided.

## 2026-05-08 - Release Posture Reframed

Jason explicitly does not want to release yet.

Reason:

- MCP directories and review/scoring sites can ingest first releases quickly and then take weeks or months to update negative initial reviews.
- Brandcode MCP should reach a much stronger production-trust bar before publish: license clarity, security hardening, test depth, multi-client battle testing, and high-quality directory metadata.

M001-L05 was reframed from release readiness to pre-release hardening map.

Next Ready lane:

- M001-L05 - Pre-Release Hardening Map.

## 2026-05-08 - M001-L06 Shaped

M001-L05 is complete as a hardening map. M001-L06 is now the single Ready lane.

Purpose:

- Audit license, package, directory, and trust-facing docs before any public release.
- Identify license/hosted-service terms questions for Jason.
- Identify security/privacy and directory/scoring risks grounded in repo files.
- Produce a durable gap list and exactly one next Ready lane.

Still prohibited:

- No npm publish.
- No public MCP directory submission.
- No new tools.
- No hosted behavior changes unless a critical false claim can be fixed docs-only.

## 2026-05-08 - M001-L06 Closed

M001-L06 completed the license, package, directory, and trust audit as a docs-only lane.

Audit doc:

- `specs/brandcode-mcp-license-directory-trust-audit.md`

Core findings:

- `@brandcode/mcp` can likely inherit MIT for package/source-code distribution if the package ships from this repo or sibling code under the same copyright posture, but MIT does not cover hosted-service access.
- Hosted Brandcode MCP needs explicit service terms before public release for bearer-key access, rate limits, feedback/history retention, private asset custody, client-owned brand data, and abuse handling.
- Current `package.json`, `server.json`, `smithery.yaml`, `glama.json`, and `llms.txt` are mostly Build-oriented for `@brandsystem/mcp`; that is acceptable now, but Brandcode MCP needs separate Use listing metadata before any directory submission.
- `SECURITY.md` is not yet strong enough for hosted Use MCP review because it omits bearer auth, scopes, service-token posture, private custody, feedback/history privacy, and rate-limit/abuse posture.
- Public docs mostly preserve the locked 8-tool/read-append posture, no canonical mutation, no selected-kit default, and no unauthenticated public read; a few "any MCP client" / "agents anywhere" phrases need auth qualifiers before release copy is submitted.

Next Ready lane:

- M001-L07 - Security Matrix And Rate-Limit Posture.

Still prohibited:

- No npm publish.
- No public MCP directory submission.
- No new tools.
- No hosted behavior changes outside narrow security proof/documentation.

## 2026-05-08 - M001-L07 Closed

M001-L07 expanded hosted security proof and documentation without changing the
locked hosted tool surface.

Implementation and tests:

- `test/hosted/auth.test.ts` now covers malformed bearer headers, the full
  8-tool scope matrix for read/check/feedback/full key postures, and staging vs
  production key-prefix rejection/acceptance.
- `test/hosted/router.test.ts` now proves malformed Authorization headers are
  rejected at the hosted HTTP boundary.
- Existing `test/hosted/env.test.ts` continues to prove
  `BRANDCODE_MCP_SERVICE_TOKEN` is the only accepted hosted service-token env
  name and `UCS_SERVICE_TOKEN` is not accepted.
- Existing asset, feedback, and history tests already prove private provider URL
  redaction and compact history/receipt privacy for the relevant surfaces.

Docs:

- `SECURITY.md` now documents hosted bearer auth, slug-scoped keys, scopes,
  service-token posture, private custody, feedback/history privacy, and the
  current rate-limit posture.
- Rate limits remain documented as `not_reported_by_staging`, which is an
  explicit pre-release posture, not a production claim.

Next Ready lane:

- M001-L08 - Asset Fetch And Custody Proof.

Still prohibited:

- No npm publish.
- No public MCP directory submission.
- No new tools.
- No selected-kit hosted publish/share behavior.

## 2026-05-08 - M001-L08 Partial Custody Hardening

M001-L08 local hardening landed, but the required hosted asset proof is blocked
on unavailable staging smoke credentials.

Completed locally:

- `scripts/hosted-mcp-smoke.mjs` now treats `get_brand_asset` as pass only when
  the returned asset is package-safe, has `custody.safe_for_mcp: true`, has a
  package delivery ref, does not report `blocked_private_provider_url`, and does
  not expose raw private/provider URLs.
- `src/hosted/tools/assets.ts` now blocks private-looking `packageUrl` values
  rather than treating them as package-safe.
- `test/hosted/tools.test.ts` covers private-looking package URL custody.

Hosted proof attempted:

- Checked local shell env: the required `BRANDCODE_MCP_SMOKE_*` values are not
  set.
- Checked Vercel Preview env safely: it lists `BRANDCODE_MCP_TEST_KEYS`, but
  `vercel env pull --environment=preview --yes` and `vercel env run -e preview`
  expose empty sensitive values to the local process.
- Result: no staging bearer key was available locally, so
  `list_brand_assets` could not be run against
  `https://mcp.staging.brandcode.studio/brandcode`, no stable asset id could be
  selected, and hosted smoke with `BRANDCODE_MCP_SMOKE_ASSET_ID` could not be
  completed.

Lane posture:

- M001-L08 remains the single Ready lane.
- Exact blocker: Jason needs to provide/expose the hosted smoke URL, full key,
  read-only key, and either a stable asset id or enough credential access to
  list assets without exposing secrets in chat.

## 2026-05-08 - M001-L08 Closed With Package Fixture Blocker

M001-L08 deployed the custody hardening to staging and completed hosted asset
proof against a stable Brandcode asset id.

Proof target:

- Endpoint: `https://mcp.staging.brandcode.studio/brandcode`
- Deployment: `https://brandsystem-qhfz5p7o6-column-five.vercel.app`
- Asset id: `brandcode:logo:c5-logomark-red.svg`

Result:

- `list_brand_assets` returned six assets and `custody_safe: true`.
- All six currently available staging assets report
  `delivery_ref.posture: "blocked_private_provider_url"`.
- `get_brand_asset` correctly returned the selected asset as blocked for
  private-provider-only delivery, with `custody.safe_for_mcp: false`.
- No raw private/provider URL was exposed.
- The smoke harness now classifies this truthful custody block as `blocked`
  rather than `fail`, while package-safe assets must still satisfy the strict
  pass criteria.

New blocker:

- Brandcode staging needs at least one stable package-safe asset fixture before
  `get_brand_asset` can pass package delivery proof.

Next Ready lane:

- M001-L09 - Package-Safe Asset Fixture Coordination.

## 2026-05-09 - M001-L09 Blocked Upstream

M001-L09 traced the package-safe asset fixture gap to UCS/Brandcode Studio
package data, not to the MCP custody layer.

Upstream path:

- Hosted MCP fetcher: `src/hosted/brand-fetcher.ts`
- UCS pull route:
  `/Users/jasonlankow/Desktop/UCS/app/api/brand/hosted/[slug]/pull/route.ts`
- UCS compiled Brandcode payload source:
  `/Users/jasonlankow/Desktop/UCS/app/tools/lib/brand-adapter-runtime.ts`
- UCS generated data:
  `/Users/jasonlankow/Desktop/UCS/app/tools/lib/compiled-brand-runtime.ts`
  and
  `/Users/jasonlankow/Desktop/UCS/app/tools/lib/compiled-brand-asset-manifests.ts`

Current asset truth:

- `brandcode:logo:c5-logomark-red.svg` exists in the UCS compiled Brandcode
  payload.
- It has `/logo/c5-logomark-red.svg` plus public URL refs.
- It does not have `deliveryRef.packagePath`, top-level `packagePath`, or a
  package-safe `packageUrl`.
- Existing public URL refs are not package materialization proof by themselves.

Lane result:

- No MCP code changed.
- No custody rule was relaxed.
- Hosted smoke with `BRANDCODE_MCP_SMOKE_ASSET_ID` was not rerun because no
  package-safe fixture exists and local smoke env keys are not present.
- Required upstream data change: UCS/Brandcode Studio runtime packaging must
  materialize one stable Production-approved/runtime Brandcode asset into the
  runtime package and emit a package-safe delivery ref, preferably for
  `brandcode:logo:c5-logomark-red.svg`, such as `deliveryRef.packagePath` or an
  equivalent top-level `packagePath`.

Next Ready lane:

- M001-L10 - UCS Package Asset Delivery Ref Repair.

## 2026-05-09 - M001-L10 Local UCS Fixture Repaired

M001-L10 repaired the upstream UCS package-data fixture locally without changing
MCP custody rules.

UCS result:

- `brandcode:logo:c5-logomark-red.svg` now has `lifecycle:
  "production-approved"`, `inRuntimePackage: true`, and
  `deliveryRef.packagePath:
  "brandcode-brand-runtime/visual/assets/logo/c5-logomark-red.svg"`.
- `app/tools/lib/generate-compiled-brand-runtime.mjs` now preserves package
  delivery fields from manifest assets into the compiled payload.
- The regenerated UCS compiled outputs include the package-safe delivery ref in
  `compiled-brand-runtime.ts`, `compiled-brand-asset-manifests.ts`, and
  `clients/brandcode/.brand/compiled/asset-runtime.json`.
- No private/provider URLs were made public.

Verification:

- Local compiled adapter payload inspection confirmed the asset exposes the
  package-safe delivery ref and no private Blob/provider URL.
- Focused UCS tests passed for the package-safe logomark and adapter payload.
- UCS TypeScript passed.
- UCS `git diff --check` passed.
- Hosted smoke from this repo was attempted with
  `BRANDCODE_MCP_SMOKE_ASSET_ID=brandcode:logo:c5-logomark-red.svg`, but it
  remained blocked because `BRANDCODE_MCP_SMOKE_URL` and
  `BRANDCODE_MCP_SMOKE_FULL_KEY` are not present in the current shell.

Remaining blocker:

- The UCS repair has not been pushed/deployed because Jason's prompt explicitly
  said not to push unless asked. Staging freshness and hosted smoke still need
  to be proven before `get_brand_asset` can be called release-grade.

Next Ready lane:

- M001-L11 - Hosted Package Asset Smoke Proof.

## 2026-05-09 - M001-L11 Blocked On Hosted Inputs

M001-L11 attempted the hosted package asset proof for the already-repaired UCS
fixture without changing MCP custody behavior.

Freshness result:

- Required UCS delivery-ref commit: `37585f98 Add Brandcode package asset delivery ref`
- `/Users/jasonlankow/Desktop/UCS` is still ahead of `origin/main`.
- `37585f98` is not an ancestor of `origin/main`, and no remote branch contains
  it.
- Result: staging freshness cannot be confirmed for the UCS package-data change
  read by `https://mcp.staging.brandcode.studio/brandcode`.

Hosted smoke result:

- Command:
  `BRANDCODE_MCP_SMOKE_ASSET_ID=brandcode:logo:c5-logomark-red.svg npm run smoke:hosted-mcp -- --json`
- Status: `blocked`
- Missing required env:
  - `BRANDCODE_MCP_SMOKE_URL`
  - `BRANDCODE_MCP_SMOKE_FULL_KEY`
- `BRANDCODE_MCP_SMOKE_READ_KEY` is also needed for a fully unblocked
  insufficient-scope proof.

No hosted `get_brand_asset` package delivery claim was made. The missing input
is Jason authorization/push/deploy for UCS commit `37585f98` plus hosted smoke
credentials in the local shell.

Next Ready lane:

- M001-L11 remains the single Ready target until staging freshness and smoke
  credentials exist. Do not advance to battle testing, publish, submit to MCP
  directories, add tools, or relax custody.

## 2026-05-09 - M001-L11 Hosted Package Asset Proof Passed

M001-L11 completed the hosted package asset smoke proof.

Freshness:

- UCS `origin/main` contains `37585f98 Add Brandcode package asset delivery ref`.
- `git -C /Users/jasonlankow/Desktop/UCS merge-base --is-ancestor 37585f98 origin/main`
  exited `0`.
- `git -C /Users/jasonlankow/Desktop/UCS branch -r --contains 37585f98`
  returned `origin/main`.

Hosted smoke:

- Endpoint: `https://mcp.staging.brandcode.studio/brandcode`
- Asset id: `brandcode:logo:c5-logomark-red.svg`
- Overall status: `pass`
- `tools/list` returned the locked 8-tool Phase 0 order.
- `get_brand_asset` returned package-safe custody:
  - `custody_safe: true`
  - `safe_for_mcp: true`
  - `blocked_private_provider_url: false`
  - `delivery_posture: "package_safe"`
  - `delivery_ref_kind: "package_path"`
  - `raw_private_provider_url_exposed: false`
- `brand_feedback` append proof still returned `append_status: recorded`.
- Read-only insufficient-scope proof still passed for `brand_check` and
  `brand_feedback`.

Next Ready lane:

- M001-L12 - Multi-Client Battle Test.

## 2026-05-09 - M001-L12 Blocked On Hosted Client Credentials

M001-L12 attempted the multi-client battle-test lane, but could not complete
hosted smoke or real-client proof in the current environment.

Smoke result:

- Command: `npm run smoke:hosted-mcp -- --json`
- Status: `blocked`
- Missing required env:
  - `BRANDCODE_MCP_SMOKE_URL`
  - `BRANDCODE_MCP_SMOKE_FULL_KEY`

Preview env check:

- `vercel env pull --environment=preview --yes` succeeded into a temporary file.
- The pulled preview env lists `BRANDCODE_MCP_TEST_KEYS` and
  `BRANDCODE_MCP_SERVICE_TOKEN`.
- `BRANDCODE_MCP_TEST_KEYS` is an empty quoted value, so no `brandcode`
  full/read key entries can be derived for local proof.
- A second smoke attempt with endpoint
  `https://mcp.staging.brandcode.studio/brandcode` and asset id
  `brandcode:logo:c5-logomark-red.svg` stayed blocked because
  `BRANDCODE_MCP_SMOKE_FULL_KEY` was unavailable.

Client paths checked:

- Claude Code is installed and supports HTTP MCP servers with Authorization
  headers.
- Codex CLI is installed and supports Streamable HTTP MCP servers with a
  bearer-token env var.
- MCP Inspector is reachable through `npx -y @modelcontextprotocol/inspector`
  and supports CLI HTTP mode plus headers.

No client proof was claimed because none of those clients can truthfully
exercise the target endpoint without usable full/read bearer keys for the
`brandcode` slug. Treating unauthenticated rejection as multi-client proof would
be false.

Required next input:

- Expose `BRANDCODE_MCP_SMOKE_URL=https://mcp.staging.brandcode.studio/brandcode`.
- Expose `BRANDCODE_MCP_SMOKE_FULL_KEY` for `brandcode` with
  `read,check,feedback`.
- Expose `BRANDCODE_MCP_SMOKE_READ_KEY` for `brandcode` with `read` only.
- Expose `BRANDCODE_MCP_SMOKE_ASSET_ID=brandcode:logo:c5-logomark-red.svg`.
- Or populate non-empty `BRANDCODE_MCP_TEST_KEYS` preview entries for the
  `brandcode` slug so local proof can derive those keys.

No hosted code changed, no custody rule was relaxed, and no release, publish, or
directory action was taken.

Next lane posture:

- No lane is Ready while M001-L12 is blocked on hosted client credentials.
- Once the keys are available, M001-L12 should resume as the single Ready lane.

## 2026-05-09 - M001-L12 Multi-Client Battle Test Passed

M001-L12 completed hosted smoke and real-client proof without changing hosted
MCP code, adding tools, relaxing custody, publishing, or submitting to
directories.

Credential/proof-input repair:

- Removed the empty sensitive Preview `BRANDCODE_MCP_TEST_KEYS` value.
- Generated fresh staging-only full/read entries for the `brandcode` slug.
- Added the entries back to Vercel Preview for all Preview branches through the
  interactive Vercel env flow.
- `vercel env pull --environment=preview --yes` still redacts the sensitive
  value locally, so future proof sessions need either an intentional local
  secret handoff or the same generate-and-run shell posture.
- No bearer key was committed to the repo or recorded in docs.

Deployment/proof target:

- Latest staging deployment:
  `https://brandsystem-eipxqt3go-column-five.vercel.app`
- Alias: `https://mcp.staging.brandcode.studio`
- Endpoint: `https://mcp.staging.brandcode.studio/brandcode`
- Package-safe asset id: `brandcode:logo:c5-logomark-red.svg`

Hosted smoke:

- Overall status: `pass`
- `fail: 0`, `blocked: 0`, `skipped: 0`
- `get_brand_asset`: `pass`
- `safe_for_mcp: true`
- `delivery_ref_kind: "package_path"`
- `raw_private_provider_url_exposed: false`

MCP Inspector:

- `tools/list` returned the locked 8-tool Phase 0 order.
- `get_brand_asset` returned package-safe custody with
  `blocked_private_provider_url: false` and package-path delivery.
- Read-only `brand_check` returned structured `insufficient_scope` with
  `status: 403` and `required_scope: "check"`.

Claude Code:

- Used a temporary HTTP MCP config.
- Called `brand_status` and `get_brand_asset`.
- Reported 8 implemented tools, 0 stubs, package-safe asset posture,
  `blocked_private_provider_url: false`, package-path delivery, and no raw
  private/provider URL exposure.

Next Ready lane:

- M001-L13 - Release Candidate Trust Review.

## 2026-05-09 - M001-L13 Release Candidate Trust Review Closed

M001-L13 completed a docs-only release-candidate trust review without
publishing, releasing, submitting to MCP directories, changing public listings,
adding tools, relaxing custody, or introducing selected Brand Kit default
behavior.

Durable review:

- `specs/brandcode-mcp-release-candidate-trust-review.md`

Evidence checked:

- `git fetch origin` completed.
- Before the L13 closeout commit, local `main` was ahead of `origin/main` by 20
  commits.
- Latest remote `main` CI is GitHub Actions run `25571869563`, which passed on
  `61218ac Fix npm audit: basic-ftp DoS, fast-uri path traversal,
  hono/ip-address/postcss XSS`.
- No GitHub CI has run on the local M001 stack from `c4dc704` through the L13
  closeout commit.
- M001-L12 hosted smoke, MCP Inspector proof, and Claude Code proof remain the
  current hosted/client evidence.

Review decision:

- Do not claim release-candidate readiness yet.
- Release/publish remains blocked on Jason approval.
- Strong proof now exists for the locked 8-tool staging surface,
  package-safe Brandcode asset delivery, and two real clients.
- The release-candidate gate remains blocked by hosted-service terms,
  rate-limit/abuse posture reported as `not_reported_by_staging`, unresolved
  `@brandcode/mcp` package/source posture, no CI run on the local M001 stack,
  and no separate Brandcode Use directory metadata.

Blocker conversion:

- Repair packet: M001-L14 Hosted Terms And Rate-Limit Gate.
- Named Jason decision: `@brandcode/mcp` package/source posture.
- Named Jason decision: explicit approval before any release, publish,
  production release, directory submission, or public listing change.
- Product-spine deferral: Brandcode Use directory metadata after terms and
  rate-limit posture settle.
- Product-spine deferral: production-key, non-Brandcode brand, and post-push CI
  proof before any release-candidate claim.

Next Ready lane:

- M001-L14 - Hosted Terms And Rate-Limit Gate.

## 2026-05-09 - M001-L14 Hosted Terms And Rate-Limit Gate Closed

M001-L14 completed a narrowly scoped hosted trust gate without publishing,
releasing, submitting to directories, changing public listing metadata, adding
hosted tools, introducing selected Brand Kit default behavior, pushing, or
relaxing custody.

Durable gate:

- `specs/brandcode-mcp-hosted-terms-rate-limit-gate.md`

Code/docs updated:

- `src/hosted/tools/status.ts`
- `test/hosted/tools.test.ts`
- `SECURITY.md`
- `README.md`
- `llms.txt`
- `specs/brandcode-mcp-phase-0-lock.md`
- `specs/brandcode-mcp-pre-release-hardening.md`
- `specs/brandcode-mcp-license-directory-trust-audit.md`
- `specs/brandcode-mcp-release-candidate-trust-review.md`
- `.claudex/packets/M001-L14-hosted-terms-rate-limit-gate.md`
- `.claudex/packets/M001-L15-hosted-service-terms-decision-brief.md`
- `.claudex/prompts/M001-L15-hosted-service-terms-decision-brief.md`

Gate decision:

- The hosted terms/rate-limit gate is blocked, not satisfied.
- `brand_status.rate_limits.status` remains `not_reported_by_staging`.
- `brand_status.rate_limits.release_gate` is now `blocked`.
- At L14 time, the named blocker owner was still
  `Jason decision / Brandcode operations owner`.
- Public release requires command-backed rate-limit enforcement or a
  Jason-approved operations owner and abuse-handling policy.

Remaining Jason decisions:

- Hosted bearer-key access terms.
- Client-owned brand data, feedback, and history privacy/retention.
- Rate-limit/abuse operations owner and launch policy.
- Whether "free in v1 for active Brandcode Studio brands" is approved public
  copy.
- Whether `@brandcode/mcp` package/source posture is MIT, proprietary,
  dual-positioned, or service-only.
- Explicit approval before any release, publish, production release, directory
  submission, public listing change, or push for CI proof.

Verification:

- `git diff --check` passed.
- `npm test -- --run test/hosted/tools.test.ts` passed: 45 tests.
- `npm run lint` passed.
- `npm run build` passed.
- Full `npm test` ran 526 tests: 524 passed and 2 failed in
  `test/tools/smoke.test.ts`.
- Deterministic failing cases:
  - `brand_extract_visual returns gracefully without .brand/`
  - `brand_extract_site returns gracefully without .brand/ when merge is false`
- Failure shape: MCP SDK rejected an invalid tool result because the first
  content item had no valid text/image/audio/resource payload. This is outside
  the hosted terms/rate-limit gate and should become a separate smoke repair if
  Jason wants full-suite green before push.

Next Ready lane:

- M001-L15 - Hosted Service Terms Decision Brief.

## 2026-05-10 - M001-L15 Hosted Service Terms Posture Approved

Jason approved all recommended hosted-service posture items.

Durable decision brief:

- `specs/brandcode-mcp-hosted-service-terms-decision-brief.md`

Approved posture:

- hosted Use access is approved-brand, bearer-key-only, and pre-release;
- brand/runtime/content/assets remain client-owned or client-controlled;
- hosted runtime data is used only to serve MCP tools and governance workflows;
- no raw private/provider URLs, private blob URLs, service tokens, or raw
  custody paths are exposed through hosted MCP responses;
- `brand_feedback` is append-only review input, not canonical governance
  mutation;
- `brand_history` is scoped to brand/key posture and returns compact redacted
  summaries;
- feedback/history retention remains limited and review-oriented, with final
  deletion/export language still needed before public launch copy;
- active rate-limit enforcement is preferred, and any limited launch without
  command-backed enforcement requires a named Brandcode operations owner and
  abuse policy;
- public "free in v1" copy is not approved as launch copy yet;
- `@brandcode/mcp` package/source can likely inherit the repo MIT posture if
  Jason approves that package posture, but hosted service access remains
  separate from source/license access.

Release status:

- No release, npm publish, public listing, directory submission, production
  release, package posture change, or release-candidate claim is approved.
- Full-suite local tests still need repair before push/CI or any
  release-candidate claim.

Next Ready lane:

- M001-L16 - Full Suite Visual Extraction Smoke Repair.

## 2026-05-10 - M001-L16 Full Suite Visual Extraction Smoke Repair Closed

M001-L16 repaired the two deterministic full-suite smoke failures without
changing hosted Brandcode MCP behavior, publishing, releasing, pushing,
submitting to directories, changing listing metadata, adding hosted tools, or
relaxing custody.

Cause:

- Puppeteer screenshots can arrive as Uint8Array values in the current runtime.
- Calling `.toString("base64")` directly on those values produced
  comma-separated byte text rather than valid base64.
- The MCP SDK rejected the first image content block from `brand_extract_visual`
  and `brand_extract_site` as invalid.

Repair:

- Added shared `screenshotToBase64()` encoding in
  `src/lib/visual-extractor.ts`.
- Updated `brand_extract_visual`, `brand_extract_site`, and `brand_start` to
  use the shared encoder before returning screenshot image content.

Verification:

- `npm test -- --run test/tools/smoke.test.ts` passed: 50 tests.
- `npm run lint` passed.
- `npm run build` passed.
- Full `npm test` passed: 39 files, 526 tests.

Next Ready lane:

- M001-L17 - Push CI Proof Authorization.

Named decision:

- Do not push the local M001 stack or seek CI proof until Jason explicitly
  authorizes push or PR proof.

## 2026-05-10 - M001-L17 Push CI Proof Closed

Jason explicitly authorized push in-thread.

Push proof:

- Branch: `main`
- Pushed range: `61218ac..2cf291c`
- Pushed tip: `2cf291c Repair visual extraction smoke responses`

GitHub CI proof:

- Workflow: CI
- Run id: `25641439073`
- URL:
  `https://github.com/Brandcode-Studio/brandsystem-mcp/actions/runs/25641439073`
- Result: success
- Matrix jobs: Node 20 and Node 22 both passed.
- Steps passed in both jobs: `npm ci`, `npm run build`, `npm run lint`,
  `npm test`, and `npm audit --audit-level=high`.

CI annotation:

- GitHub reported Node.js 20 Actions deprecation for `actions/checkout@v4`
  and `actions/setup-node@v4`.
- This is not a current failure, but it should be repaired or explicitly
  hardened before release-candidate claims.

No release, npm publish, public MCP directory submission, public listing
change, hosted tool addition, selected-kit default behavior, or custody
relaxation happened.

Next Ready lane:

- M001-L18 - GitHub Actions Node 24 Compatibility.

## 2026-05-11 - M001-L18 GitHub Actions Node 24 Compatibility Closed

Jason explicitly authorized push.

Push proof:

- Pushed commit: `60aa66f Add Node 24 GitHub Actions compatibility`

GitHub CI proof:

- Workflow: CI
- Run id: `25678340682`
- URL:
  `https://github.com/Brandcode-Studio/brandsystem-mcp/actions/runs/25678340682`
- Result: success
- Matrix jobs: Node 20, Node 22, and Node 24 all passed.
- Steps passed in all three jobs: `npm ci`, `npm run build`, `npm run lint`,
  `npm test`, and `npm audit --audit-level=high`.
- First-party actions used in CI: `actions/checkout@v6` and
  `actions/setup-node@v6`.
- The prior Node.js 20 Actions deprecation annotation did not recur in the
  watched run output or `gh run view` job summary.

No release, npm publish, public MCP directory submission, public listing
change, hosted tool addition, selected-kit default behavior, or custody
relaxation happened.

Next Ready lane:

- M001-L19 - Hosted Rate Limit And Abuse Posture.

## 2026-05-11 - M001-L19 Hosted Rate Limit And Abuse Posture Closed

M001-L19 added active hosted pre-release rate-limit enforcement without making a
production durability claim.

Changed:

- Added `src/hosted/rate-limit.ts` with an in-process fixed-window limiter.
- Wired the hosted HTTP router to check the limiter after bearer auth and
  before MCP transport dispatch.
- Limiter key: environment + brand slug + API key id.
- Default policy: 60 authenticated requests per 60 seconds.
- Operator knobs:
  `BRANDCODE_MCP_RATE_LIMIT_REQUESTS_PER_WINDOW`,
  `BRANDCODE_MCP_RATE_LIMIT_WINDOW_SECONDS`, and emergency disable
  `BRANDCODE_MCP_RATE_LIMIT_DISABLED=1`.
- Over-limit requests return JSON `429 rate_limited` with structured
  `rate_limits`, `retry-after`, and `x-ratelimit-*` headers.
- Successful hosted responses include `x-ratelimit-limit`,
  `x-ratelimit-remaining`, and `x-ratelimit-reset`.
- `brand_status.rate_limits.status` now reports
  `active_pre_release_in_process` when called through the hosted HTTP route,
  including configured limit, remaining count, window/reset fields,
  enforcement type, source, and release-gate posture.

Truthful blocker:

- The limiter is process-local pre-release enforcement, not durable shared
  production enforcement.
- `brand_status.rate_limits.release_gate` remains `blocked`.
- Jason later named the pre-release operations owner and chose durable shared
  enforcement as the next lane before broad public release.

Verification:

- `git diff --check` passed.
- `npm test -- --run test/hosted/router.test.ts test/hosted/tools.test.ts`
  passed: 57 tests.
- `npm run lint` passed.
- `npm run build` passed.
- Full `npm test` passed: 39 files, 527 tests.

Remote CI proof:

- Jason authorized push.
- Pushed commit: `74d72f5 Harden hosted rate limit abuse posture`.
- GitHub CI run id: `25684546273`.
- URL:
  `https://github.com/Brandcode-Studio/brandsystem-mcp/actions/runs/25684546273`
- Result: success.
- Matrix jobs: Node 20, Node 22, and Node 24 all passed.
- Steps passed in all three jobs: `npm ci`, `npm run build`, `npm run lint`,
  `npm test`, and `npm audit --audit-level=high`.

No release, npm publish, public MCP directory submission, public listing
change, hosted tool addition, selected-kit default behavior, UCS change, or
custody relaxation happened.

Next state:

- Jason named the pre-release abuse response owner as Jason Lankow /
  Brandcode Studio Ops `<jlankow@columnfive.com>`.
- Owner authority covers revoking, rotating, suspending, or throttling hosted
  Brandcode MCP API keys for abuse, leaked keys, excessive traffic, security
  risk, or service-stability risk.
- Jason chose durable shared hosted rate limiting as the next lane before broad
  public release.

Next Ready lane:

- M001-L20 - Durable Shared Rate Limit Enforcement.

## 2026-05-11 - M001-L20 Durable Shared Rate Limit Enforcement Closed

M001-L20 added durable shared rate-limit implementation without making a hosted
proof or release claim.

Changed:

- Added optional durable shared Redis REST fixed-window enforcement using
  `@upstash/redis`.
- Hosted env contract:
  `BRANDCODE_MCP_RATE_LIMIT_REDIS_REST_URL` and
  `BRANDCODE_MCP_RATE_LIMIT_REDIS_REST_TOKEN`.
- Standard `UPSTASH_REDIS_REST_*` and `KV_REST_API_*` env names are accepted
  when a Vercel/Upstash store is attached.
- Preserved in-process memory enforcement as the local/test and pre-release
  fallback when no shared store env exists.
- Kept rate-limit keys scoped to environment, brand slug, and API key id.
- `brand_status.rate_limits.status` now distinguishes
  `active_durable_shared`, `active_pre_release_in_process`, `unavailable`, and
  `disabled`.
- Configured durable store outages fail closed as JSON
  `503 rate_limit_unavailable` before MCP dispatch.
- Existing over-limit behavior remains structured JSON `429 rate_limited` with
  `retry-after` and `x-ratelimit-*` headers.

Original closeout blocker:

- No hosted Redis/Upstash/KV store or sensitive hosted rate-limit env was
  available in this local session, so hosted durable proof was not completed.
- Public release remains blocked until Jason approves/provisions the hosted
  shared store env, hosted proof shows
  `brand_status.rate_limits.status: "active_durable_shared"`, and Jason
  explicitly approves release.

Verification:

- `git diff --check` passed.
- `npm test -- --run test/hosted/router.test.ts test/hosted/tools.test.ts`
  passed: 60 tests.
- `npm run lint` passed.
- `npm run build` passed.
- Full `npm test` passed: 39 files, 530 tests.

Remote CI proof:

- Jason authorized push.
- Pushed commit: `cc94bee Add durable hosted rate limit enforcement`.
- GitHub CI run id: `25687209671`.
- URL:
  `https://github.com/Brandcode-Studio/brandsystem-mcp/actions/runs/25687209671`
- Result: success.
- Matrix jobs: Node 20, Node 22, and Node 24 all passed.
- Steps passed in all three jobs: `npm ci`, `npm run build`, `npm run lint`,
  `npm test`, and `npm audit --audit-level=high`.

Next state:

- Superseded later the same day by hosted durable proof after Jason provisioned
  Vercel/Upstash KV/Redis Preview env.

## 2026-05-11 - M001-L20 Hosted Durable Rate-Limit Proof Completed

M001-L20 is now closed with hosted proof, not just implementation/CI proof.

Proof actions:

- Restored `BRANDCODE_MCP_TEST_KEYS` for Vercel Preview/all branches after
  rotating the generated test keys.
- Deployed fresh Preview:
  `https://brandsystem-kqrdhx4pe-column-five.vercel.app`.
- Re-aliased staging:
  `https://mcp.staging.brandcode.studio`.
- Called `brand_status` through the MCP Streamable HTTP client against
  `https://mcp.staging.brandcode.studio/brandcode`.

Proof result:

- `rate_limits.status: "active_durable_shared"`
- `rate_limits.enforced: true`
- `rate_limits.enforcement: "durable_shared_redis_fixed_window"`
- `rate_limits.scope: "per_key_per_brand"`
- `rate_limits.limit: 60`
- `rate_limits.source:
  "BRANDCODE_MCP_RATE_LIMIT_REQUESTS_PER_WINDOW/BRANDCODE_MCP_RATE_LIMIT_WINDOW_SECONDS; durable shared Redis REST (KV_REST_API_URL/KV_REST_API_TOKEN)"`

Hosted smoke:

- `npm run smoke:hosted-mcp -- --json` passed against
  `https://mcp.staging.brandcode.studio/brandcode`.
- Package-safe asset id:
  `brandcode:logo:c5-logomark-red.svg`.
- Result: `fail: 0`, `blocked: 0`, `skipped: 0`.

Security note:

- One unsafe pseudo-terminal attempt echoed generated test keys during the env
  repair. Those values were treated as burned, rotated immediately, and the
  rotated keys were installed through the Vercel API before hosted proof.

Remaining release blockers:

- Jason explicit release/publish approval.
- Final hosted retention/deletion/export policy language.
- Final `@brandcode/mcp` package/source posture.
- Brandcode Use directory metadata.

Next Ready lane:

- M001-L21 - Hosted Retention Export Deletion Policy.

## 2026-05-11 - M001-L21 Hosted Retention Export Deletion Policy Closed

M001-L21 closed as a docs-only hosted trust lane.

Changed:

- Added `specs/brandcode-mcp-hosted-data-policy.md`.
- Documented authorized pre-release bearer-key access, client-owned or
  client-controlled brand data, append-only `brand_feedback`, scoped/redacted
  `brand_history`, package-safe asset custody, and hosted service/package
  separation.
- Named the current deletion/export posture truthfully: hosted MCP has no
  public self-serve deletion or export tools for hosted feedback/history.
- During pre-release, deletion/export requests route to Jason Lankow /
  Brandcode Studio Ops for manual Brandcode/UCS operations review.
- Public launch remains blocked until Jason/legal/ops approve requester
  authorization, deletion/export scope, export package format, response
  windows, support escalation, and any required legal/subprocessor language.
- Updated `SECURITY.md`, `README.md`, `llms.txt`,
  `specs/brandcode-mcp-hosted-terms-rate-limit-gate.md`, and
  `specs/brandcode-mcp-hosted-service-terms-decision-brief.md`.
- Updated the L21 packet, sprint board, and `HANDOFF.md`.
- Added exactly one next Ready lane:
  `.claudex/packets/M001-L22-package-source-posture-decision-brief.md`.

Verification:

- `git diff --check` passed.
- No code or package metadata changed, so lint/build/tests were not required.

No release, npm publish, public MCP directory submission, public listing
metadata change, hosted tool addition, selected-kit default behavior, UCS
change, or custody relaxation happened. `brand_status.rate_limits.release_gate`
remains blocked.

Next Ready lane:

- M001-L22 - Package Source Posture Decision Brief.

## 2026-05-11 - M001-L22 Package Source Posture Decision Brief Closed

M001-L22 closed as a docs-only package/source posture decision lane.

Changed:

- Added
  `specs/brandcode-mcp-package-source-posture-decision-brief.md`.
- Separated the current `@brandsystem/mcp` Build package MIT posture from
  hosted Brandcode MCP service access and future `@brandcode/mcp`
  source/package distribution.
- Framed four Jason decision options for `@brandcode/mcp`: open MIT
  package/source with separate hosted service terms, proprietary/service-only,
  dual public connector plus service-controlled hosted implementation, or
  deferral/no public package-source distribution for v0.1.
- Preserved the non-negotiable boundary that installing source/package code
  must not grant access to `mcp.brandcode.studio`, bearer keys, hosted runtime
  data, feedback/history, or package-safe assets.
- Updated the L22 packet, sprint board, and `HANDOFF.md`.

Verification:

- `git diff --check` passed.
- No code or package metadata changed, so lint/build/tests were not required.

No release, npm publish, public MCP directory submission, public listing
metadata change, hosted tool addition, selected-kit default behavior, custody
relaxation, or package/source posture change happened.

Superseded Jason decision blocker:

- Choose the `@brandcode/mcp` package/source posture before any npm, package
  metadata, directory submission, public listing, public source/license posture
  change, or release-candidate claim. Jason later chose Option 4 for v0.1
  limited-client work.

## 2026-05-11 - M001 Package Source Posture Decision Recorded

Jason chose Option 4 for v0.1 limited-client work.

Decision:

- Brandcode MCP remains approved-brand hosted pre-release only for v0.1
  limited-client work.
- Public `@brandcode/mcp` package/source distribution is deferred.
- No npm publish, package metadata, public source/license posture change,
  public listing, or MCP directory submission should happen for v0.1
  limited-client work.
- Authorized clients use the hosted Streamable HTTP endpoint with brand-scoped
  bearer keys.
- Option 3 remains the likely future public direction: a narrow public
  connector/client artifact plus service-controlled hosted implementation and
  bearer-key-gated brand data access.

Updated:

- `specs/brandcode-mcp-package-source-posture-decision-brief.md`
- `specs/brandcode-mcp-hosted-service-terms-decision-brief.md`
- `SECURITY.md`
- `README.md`
- `llms.txt`
- `.claudex/sprints/current.md`
- `HANDOFF.md`

Next Ready lane:

- M001-L23 - Limited Client Readiness Plan.

## 2026-05-11 - M001-L23 Limited Client Readiness Plan Closed

M001-L23 closed as a docs-only limited-client readiness lane.

Changed:

- Added `specs/brandcode-mcp-limited-client-readiness-plan.md`.
- Recorded the approved Option 4 v0.1 posture as operational guardrails:
  public `@brandcode/mcp` package/source distribution remains deferred, while
  approved clients may use the hosted Brandcode MCP with brand-scoped bearer
  keys after approval and proof.
- Covered approved client/brand eligibility, staging vs production endpoint
  posture, API key issuance/scope/rotation/revocation/leak response,
  per-client smoke proof, support/abuse/deletion/export/incident intake,
  package-safe custody expectations, rate-limit and service-token env checks,
  no-public-package/no-directory/no-listing guardrails, and future Option 3
  signals to capture.
- Updated `SECURITY.md`, `README.md`, `llms.txt`, the L23 packet, sprint
  board, and `HANDOFF.md`.
- Added exactly one next Ready lane:
  `.claudex/packets/M001-L24-limited-client-onboarding-template.md`.

Verification:

- `git diff --check` passed.
- No code or package metadata changed, so lint/build/tests were not required.

No release, npm publish, public MCP directory submission, public listing
metadata change, hosted tool addition, selected-kit default behavior, custody
relaxation, production client key generation, or real client naming happened.

Next Ready lane:

- M001-L24 - Limited Client Onboarding Template.

## 2026-05-11 - M001-L24 Limited Client Onboarding Template Closed

M001-L24 closed as a docs/proof limited-client onboarding lane.

Changed:

- Added `specs/brandcode-mcp-limited-client-onboarding-template.md`.
- Added an internal, redacted staging proof:
  `specs/brandcode-mcp-column-five-brandcode-staging-onboarding-proof.md`.
- Updated the L24 packet, sprint board, `README.md`, `SECURITY.md`,
  `llms.txt`, and `HANDOFF.md`.

Real instance proof:

- Brand / slug: Column Five Brandcode internal instance, `brandcode`.
- Endpoint: `https://mcp.staging.brandcode.studio/brandcode`.
- Command: `npm run smoke:hosted-mcp -- --json` with local redacted staging
  full/read keys and asset id `brandcode:logo:c5-logomark-red.svg`.
- Result: `ok: true`, `status: "pass"`, `fail: 0`, `blocked: 0`,
  `skipped: 0`.
- Locked 8-tool order passed.
- `brand_runtime`, `brand_search`, `brand_check`, `brand_status`,
  `list_brand_assets`, `get_brand_asset`, `brand_feedback`, and
  `brand_history` were exercised by the smoke harness.
- Package-safe asset proof passed for
  `brandcode:logo:c5-logomark-red.svg`.
- Read-only insufficient-scope checks passed for `brand_check` and
  `brand_feedback`.

Verification:

- `git diff --check` passed.
- No code or package metadata changed, so lint/build/tests were not required.

No release, npm publish, public MCP directory submission, public listing
metadata change, hosted tool addition, selected-kit default behavior, custody
relaxation, production client key generation, or production endpoint proof
happened.

Next Ready lane:

- M001-L25 - Column Five Brandcode Client Config Dry Run.

## 2026-05-11 - M001-L25 Column Five Client Config Dry Run Blocked

M001-L25 closed as a docs-only blocked client-config dry run.

Recorded:

- Added `specs/brandcode-mcp-column-five-client-config-dry-run.md`.
- Updated the L25 packet, sprint board, and `HANDOFF.md`.

What was checked:

- Claude Code, Codex CLI, and `npx` are available local client paths.
- Target endpoint remains `https://mcp.staging.brandcode.studio/brandcode`.
- Local shell did not have `BRANDCODE_MCP_SMOKE_URL`,
  `BRANDCODE_MCP_SMOKE_FULL_KEY`, `BRANDCODE_MCP_SMOKE_READ_KEY`,
  `BRANDCODE_MCP_SMOKE_ASSET_ID`, or `BRANDCODE_MCP_BEARER_KEY`.
- `.env.local` contains only `VERCEL_OIDC_TOKEN`.
- Vercel Preview lists encrypted `BRANDCODE_MCP_TEST_KEYS`, but a safe
  temporary `vercel env pull --environment=preview --yes` check returned
  zero-length local values for encrypted sensitive variables.

Result:

- Useful hosted calls through a real MCP client were not run. Without a bearer
  key, Claude Code, Codex CLI, or MCP Inspector would only prove
  `missing_bearer` / `invalid_token`, not `brand_status` or
  `get_brand_asset`.
- No bearer keys were printed, committed, or written to docs.
- No hosted env, deployment, alias, code, package metadata, listing metadata,
  public release posture, custody behavior, production key, or production
  endpoint changed.

Option 3 signal:

- The generic client config shape is straightforward; repeatable secret
  handoff is the real friction. Encrypted Vercel Preview env is good custody,
  but it is not a reusable local proof input for later client dry runs.

Named Jason decision blocker:

- Provide a staging `bck_test_` bearer key through secure local secret handoff,
  or explicitly authorize a staging-only generate-and-run flow that creates or
  rotates a temporary Preview test key, deploys/aliases staging if needed, runs
  the client proof, and records only redacted results.

No next Ready lane is left because the next proof step is blocked on that
Jason decision.

## 2026-05-11 - M001-L25 Column Five Client Config Dry Run Completed

M001-L25 reopened after Jason chose option 2: staging-only generate-and-run
keys for the internal `brandcode` staging proof.

Executed:

- Generated fresh staging-only `bck_test_` full/read keys for slug
  `brandcode`.
- Installed the generated key bundle into Vercel Preview
  `BRANDCODE_MCP_TEST_KEYS` for all Preview branches without printing or
  committing key values.
- Deployed fresh Preview `dpl_E45BFFLXS2H2BJWz9TvBuZv8Cgtb` at
  `https://brandsystem-umyitawby-column-five.vercel.app`.
- Re-aliased `https://mcp.staging.brandcode.studio` to that deployment.

Proof:

- Hosted smoke passed against
  `https://mcp.staging.brandcode.studio/brandcode` with asset id
  `brandcode:logo:c5-logomark-red.svg`.
- Smoke result: `ok: true`, `status: "pass"`, `fail: 0`, `blocked: 0`,
  `skipped: 0`.
- Claude Code used a temporary HTTP MCP config and called `brand_status` and
  `get_brand_asset`.
- Claude Code reported 8 implemented tools,
  `rate_limit_status: "active_durable_shared"`,
  `asset_delivery_posture: "package_safe"`, `safe_for_mcp: true`, and
  `raw_private_provider_url_exposed: false`.

Durable proof:

- `specs/brandcode-mcp-column-five-client-config-dry-run.md`

No release, npm publish, public MCP directory submission, public listing
metadata change, hosted tool addition, selected-kit default behavior, custody
relaxation, package/source posture change, production client key generation, or
production endpoint proof happened.

Next Ready lane:

- M001-L26 - Limited Client Key Ops Runbook.

## 2026-05-11 - M001-L26 Limited Client Key Ops Runbook

M001-L26 closed as a docs-only limited-client operations hardening lane.

Added:

- `specs/brandcode-mcp-limited-client-key-ops-runbook.md`.

Updated:

- `SECURITY.md`
- `README.md`
- `llms.txt`
- `.claudex/sprints/current.md`
- `.claudex/packets/M001-L26-limited-client-key-ops-runbook.md`
- `HANDOFF.md`

Runbook coverage:

- staging-only `bck_test_` key generation;
- Vercel Preview env installation posture for `BRANDCODE_MCP_TEST_KEYS`;
- deploy/alias proof;
- production `bck_live_` key issuance as an explicit Jason-approved gate;
- `read`, `check`, and `feedback` scopes;
- brand slug binding, key owner, support intake, rotation, revocation, and
  suspected leak response;
- hosted smoke proof and real-client config proof;
- redacted evidence templates that avoid raw bearer keys, private/provider
  URLs, service tokens, and raw custody paths.

Verification:

- `git diff --check` passed.
- `git diff --cached --check` passed after staging.
- No code changes were made, so lint/build/tests were skipped as docs-only.

No production client keys were generated. No production endpoint proof,
release, npm publish, public MCP directory submission, public listing metadata
change, hosted tool addition, selected-kit default behavior, package/source
posture change, or custody relaxation happened.

Next Ready lane:

- M001-L27 - Limited Client Support Intake Ledger.

## 2026-05-11 - M001-L27 Prompt Prepared

Prepared the build-lane prompt for the current Ready lane:

- `.claudex/prompts/M001-L27-limited-client-support-intake-ledger.md`

Also linked the prompt from the L27 packet and `HANDOFF.md`.

No release, npm publish, public MCP directory submission, public listing
metadata change, hosted tool addition, selected-kit default behavior, custody
relaxation, package/source posture change, production client key generation, or
production endpoint proof happened.

Current Ready lane remains:

- M001-L27 - Limited Client Support Intake Ledger.

## 2026-05-11 - M001-L27 Completed

Closed M001-L27 as a docs-only limited-client support hardening lane.

Added:

- `specs/brandcode-mcp-limited-client-support-intake-ledger.md`

Updated pointers and coordination:

- `SECURITY.md`
- `README.md`
- `llms.txt`
- `.claudex/sprints/current.md`
- `.claudex/packets/M001-L27-limited-client-support-intake-ledger.md`
- `.claudex/packets/M001-L28-deletion-export-launch-decision-brief.md`
- `.claudex/prompts/M001-L28-deletion-export-launch-decision-brief.md`
- `HANDOFF.md`

Ledger coverage:

- access setup, auth/scope, custody, quality, feedback/history,
  deletion/export, abuse/security, incident, and offboarding intake;
- endpoint, brand slug, key posture, non-secret key id/label, owner, status,
  evidence, next action, and escalation owner fields;
- status vocabulary for `new`, `triaging`, `waiting_on_client`,
  `waiting_on_ops`, `blocked_decision`, `blocked_custody`, `blocked_secret`,
  `in_progress`, `resolved`, and `closed_no_action`;
- redaction rules for bearer keys, service tokens, private/provider URLs, raw
  custody paths, sensitive env values, key-bearing configs, screenshots/logs,
  and large support blobs;
- deletion/export intake as manual pre-release ops review through Brandcode
  Studio Ops.

Verification:

- `git diff --check` passed.
- `git diff --cached --check` passed after staging.
- No code changes were made, so lint/build/tests were skipped as docs-only.

No release, npm publish, public MCP directory submission, public listing
metadata change, hosted tool addition, selected-kit default behavior, custody
relaxation, package/source posture change, production client key generation,
self-serve deletion/export operation, public SLA, or production endpoint proof
happened.

Next Ready lane:

- M001-L28 - Deletion Export Launch Decision Brief.

## 2026-05-11 - M001-L28 Completed

Closed M001-L28 as a docs-only deletion/export launch decision-prep lane.

Added:

- `specs/brandcode-mcp-deletion-export-launch-decision-brief.md`

Updated pointers and coordination:

- `README.md`
- `SECURITY.md`
- `llms.txt`
- `.claudex/sprints/current.md`
- `.claudex/packets/M001-L28-deletion-export-launch-decision-brief.md`
- `HANDOFF.md`

Brief coverage:

- current pre-release deletion/export remains manual Brandcode Studio Ops
  review;
- requester authorization and verification options;
- deletion/export scope and excluded systems;
- export package format and delivery channel options;
- response window and escalation decisions;
- legal, privacy, DPA, and subprocessor language decision points;
- Option 4 package/source posture and hosted-service access boundaries.

Verification:

- `git diff --check` passed.
- `git diff --cached --check` passed after staging.
- No code changes were made, so lint/build/tests were skipped as docs-only.

No release, npm publish, public MCP directory submission, public listing
metadata change, hosted tool addition, selected-kit default behavior, custody
relaxation, package/source posture change, production client key generation,
self-serve deletion/export operation, public SLA, legal terms, or production
endpoint proof happened.

No next Ready lane is left because the next step is a named Jason/legal/ops
decision blocker: approve or revise requester authorization, verification
method, deletion/export scope, excluded systems, export format and delivery
channel, response windows, escalation owner, and required legal/subprocessor
language.

## 2026-05-11 - M001-L23 Through L28 Pushed And CI-Proven

Jason asked to move straight from the L28 decision needs into push/CI proof.

Pushed:

- `main` from `48f6fec` to `9619b37`.

GitHub CI:

- Run: `25701556152`
- URL:
  `https://github.com/Brandcode-Studio/brandsystem-mcp/actions/runs/25701556152`
- Result: success.
- Node 20, Node 22, and Node 24 jobs passed `npm ci`, `npm run build`,
  `npm run lint`, `npm test`, and `npm audit --audit-level=high`.

No release, npm publish, public MCP directory submission, public listing
metadata change, hosted tool addition, selected-kit default behavior, custody
relaxation, production client key generation, or production endpoint proof
happened.

## 2026-05-11 - M001-L29 Limited Client Go No-Go Checklist Prepared

Prepared the next non-release hardening lane:

- `.claudex/packets/M001-L29-limited-client-go-no-go-checklist.md`
- `.claudex/prompts/M001-L29-limited-client-go-no-go-checklist.md`

Purpose:

- consolidate limited-client evidence into one staging/production/public
  go/no-go checklist;
- keep public release and deletion/export launch language blocked until
  Jason/legal/ops decisions are recorded;
- preserve Option 4 posture and avoid npm, directory, public listing, or
  release claims.

Current Ready lane:

- M001-L29 - Limited Client Go No-Go Checklist.

## 2026-05-11 - L28 Deletion Export Decisions Recorded

Jason approved the pre-release deletion/export operating posture and then
accepted the remaining public-operating recommendations.

Recorded in:

- `specs/brandcode-mcp-deletion-export-launch-decision-brief.md`

Decision posture:

- Authorized requesters are brand owner/admin for the brand instance, or Jason
  Lankow as Brandcode Studio Ops. For public operation, a recorded
  legal/contract contact is also acceptable when recorded for that client.
- Authority proof is brand instance admin status or, for the internal Column
  Five Brandcode instance, verified `columnfivemedia.com` /
  `columnfive.com` email. For external clients, authority proof requires brand
  admin role, approved client contact, or written admin/contract-owner approval;
  domain match alone is not sufficient.
- Recommended scope is hosted MCP service data: `brand_feedback`, scoped
  `brand_history` summaries/receipts, support/intake records, non-secret key
  metadata, and MCP-visible package/runtime references.
- Recommended exclusions are security/abuse logs, rate-limit counters, audit
  receipts/tombstones, billing/legal records, legal holds, backups until normal
  expiry, secrets, raw private/provider URLs, private custody paths, and
  third-party/provider data outside Brandcode custody.
- Recommended export format is a curated support packet: Markdown index, JSON
  summaries/receipts, support/intake records, non-secret key metadata, and
  package-safe refs.
- Response posture remains manual pre-release review with no public SLA or
  customer-facing timeline.
- Escalation owner is Jason Lankow / Brandcode Studio Ops.
- Draft legal/subprocessor language is accepted as useful review input, but
  public launch copy is not approved.

No release, npm publish, public MCP directory submission, public listing
metadata change, hosted tool addition, selected-kit default behavior, custody
relaxation, production client key generation, self-serve deletion/export
operation, public SLA, legal terms, or production endpoint proof happened.

Current Ready lane remains:

- M001-L29 - Limited Client Go No-Go Checklist.

## 2026-05-12 - L28 Decision Updates And L29 Prep Pushed

Pushed the current coordination stack before continuing L29:

- `main` from `9619b37` to `201ee36`.

GitHub CI:

- Run: `25705113500`
- URL:
  `https://github.com/Brandcode-Studio/brandsystem-mcp/actions/runs/25705113500`
- Result: success.
- Node 20, Node 22, and Node 24 jobs passed `npm ci`, `npm run build`,
  `npm run lint`, `npm test`, and `npm audit --audit-level=high`.

No release, npm publish, public MCP directory submission, public listing
metadata change, hosted tool addition, selected-kit default behavior, custody
relaxation, production client key generation, self-serve deletion/export
operation, public SLA, legal terms, or production endpoint proof happened.

## 2026-05-12 - M001-L29 Closed

Closed M001-L29 as a docs-only limited-client go/no-go lane.

Added:

- `specs/brandcode-mcp-limited-client-go-no-go-checklist.md`

The checklist:

- separates staging readiness, production proof readiness, and public release
  readiness;
- records per-client evidence fields for approval, endpoint, key posture,
  service-token env, durable rate limits, smoke proof, locked 8-tool order,
  scope behavior, package-safe custody, feedback posture, client config proof,
  support intake, deletion/export posture, and CI freshness;
- makes production proof dependent on explicit Jason approval;
- keeps public release blocked until final legal/subprocessor launch language,
  future public package/source approval, directory metadata, and explicit
  Jason release approval exist;
- includes fail-closed criteria for missing approval, missing or unsafe keys,
  missing hosted proof, private/provider URL exposure, no package-safe asset
  for required asset delivery, absent support ownership, failing CI, and
  release-shaped actions without Jason approval.

Next Ready lane:

- M001-L30 - Limited Client Staging Freshness Proof.

## 2026-05-12 - M001-L30 Closed With Staging Key-Input Blocker

Applied the M001-L29 limited-client go/no-go checklist to the current Column
Five Brandcode staging route.

Updated:

- `specs/brandcode-mcp-column-five-brandcode-staging-onboarding-proof.md`
- `specs/brandcode-mcp-limited-client-go-no-go-checklist.md`
- `.claudex/packets/M001-L30-limited-client-staging-freshness-proof.md`
- `.claudex/sprints/current.md`
- `HANDOFF.md`

Redacted evidence:

- Endpoint checked:
  `https://mcp.staging.brandcode.studio/brandcode`.
- Unauthenticated route check returned `401 missing_bearer` with slug
  `brandcode`, proving the route is reachable and bearer-gated.
- Vercel inspect found Ready Preview deployment
  `dpl_E45BFFLXS2H2BJWz9TvBuZv8Cgtb` at
  `https://brandsystem-umyitawby-column-five.vercel.app`.
- Latest pushed CI run `25705113500` remains green on
  `201ee36d8c140e811950eb4e7d9d69a64a5a08db`.
- Local `.env.local` contains only `VERCEL_OIDC_TOKEN`; no staging full/read
  Brandcode MCP smoke bearer keys were available.
- `npm run smoke:hosted-mcp -- --json` stopped before MCP initialize with
  `status: "blocked"`, `fail: 0`, `blocked: 1`, and blocker
  `Missing required live proof env: BRANDCODE_MCP_SMOKE_FULL_KEY`.

Not refreshed:

- locked 8-tool order;
- `brand_status.rate_limits.status`;
- package-safe custody for `brandcode:logo:c5-logomark-red.svg`;
- `brand_feedback` append;
- read-only insufficient-scope behavior;
- real MCP client path.

Verification:

- `git diff --check` passed.
- No code changed, so lint/build/tests were skipped as docs/proof-only.

No release, npm publish, public MCP directory submission, public listing
metadata change, hosted tool addition, selected-kit default behavior, custody
relaxation, production client key generation, self-serve deletion/export
operation, public SLA, legal terms, or production endpoint proof happened.

No next Ready lane remains because the next action is a named Jason decision
blocker: provide safe staging full/read key material for this proof
environment, or explicitly authorize a staging-only generate-and-run key
refresh for the `brandcode` staging slug before rerunning proof.

## 2026-05-12 - M001-L30 Reopened And Completed After Key Generation

Jason asked to generate the needed staging keys, resolving the key-input
blocker for L30.

Actions:

- Generated fresh staging-only `bck_test_` full/read keys into `0600` temp
  files.
- Installed the key bundle as sensitive all-Preview
  `BRANDCODE_MCP_TEST_KEYS` through the Vercel API with `gitBranch: null`.
- Deployed fresh Preview
  `https://brandsystem-pwnz9m3oy-column-five.vercel.app`.
- Re-aliased `https://mcp.staging.brandcode.studio` to that deployment.
- Used the temp keys for proof and removed them locally afterward.

Fresh proof:

- Vercel inspect found Ready Preview deployment
  `dpl_4aQ9vVdsXC6SD5u7TMqXZKs4eCQC`.
- Hosted smoke against
  `https://mcp.staging.brandcode.studio/brandcode` passed at
  `2026-05-12T02:25:44.680Z`: `ok: true`, `status: "pass"`,
  `fail: 0`, `blocked: 0`, `skipped: 0`.
- Locked 8-tool order passed:
  `brand_runtime`, `brand_search`, `brand_check`, `brand_status`,
  `list_brand_assets`, `get_brand_asset`, `brand_feedback`, `brand_history`.
- `brand_status.rate_limits.status` returned `active_durable_shared` with
  `durable_shared_redis_fixed_window` enforcement.
- `get_brand_asset` passed for `brandcode:logo:c5-logomark-red.svg` with
  package-safe custody, `safe_for_mcp: true`,
  `blocked_private_provider_url: false`, `delivery_posture: "package_safe"`,
  `delivery_ref_kind: "package_path"`, and
  `raw_private_provider_url_exposed: false`.
- `brand_feedback` append returned `append_status: "recorded"`.
- Read-only scope proof returned structured `insufficient_scope` payloads with
  status `403`, required scope `check` for `brand_check`, and required scope
  `feedback` for `brand_feedback`.

Updated:

- `specs/brandcode-mcp-column-five-brandcode-staging-onboarding-proof.md`
- `specs/brandcode-mcp-limited-client-go-no-go-checklist.md`
- `.claudex/packets/M001-L30-limited-client-staging-freshness-proof.md`
- `.claudex/sprints/current.md`
- `HANDOFF.md`

Verification:

- `git diff --check` passed.
- No code changed, so lint/build/tests were skipped as docs/proof-only.

No release, npm publish, public MCP directory submission, public listing
metadata change, hosted tool addition, selected-kit default behavior, custody
relaxation, production client key generation, self-serve deletion/export
operation, public SLA, legal terms, or production endpoint proof happened.

No next Ready lane remains because the next useful actions are named
Jason/legal/ops decision blockers: explicit production proof/live-key
approval, final public legal/subprocessor launch language, future public
package/source approval, directory metadata, and explicit release approval.

## 2026-05-12 - M001-L30 Pushed And CI-Proven

Jason asked to push L30 and verify CI.

Pushed:

- `main` from `201ee36` to `3961be4`.

GitHub CI:

- Run: `25710999132`
- URL:
  `https://github.com/Brandcode-Studio/brandsystem-mcp/actions/runs/25710999132`
- Result: success.
- Node 20, Node 22, and Node 24 jobs passed `npm ci`, `npm run build`,
  `npm run lint`, `npm test`, and `npm audit --audit-level=high`.

No release, npm publish, public MCP directory submission, public listing
metadata change, hosted tool addition, selected-kit default behavior, custody
relaxation, production client handoff, self-serve deletion/export operation,
public SLA, legal terms, or public release proof happened.

## 2026-05-12 - Production Proof Authorized And Preflighted

Jason explicitly authorized #3: production proof/live-key testing for the
`brandcode` slug.

Preflight result:

- Production proof is authorized but blocked on route/env provisioning.
- `https://mcp.brandcode.studio/brandcode` does not resolve:
  `curl` returned `Could not resolve host: mcp.brandcode.studio`.
- `vercel alias ls` shows `mcp.staging.brandcode.studio`, but no production
  `mcp.brandcode.studio` alias.
- `vercel env ls production` lists only `MCP_LOG_LEVEL`, `NODE_ENV`, and
  `UCS_API_BASE_URL`.
- Production does not currently list `BRANDCODE_MCP_ENV=production`,
  `BRANDCODE_MCP_TEST_KEYS` or equivalent live-key seed env,
  `BRANDCODE_MCP_SERVICE_TOKEN`, or durable shared rate-limit env.
- No `bck_live_` keys were generated because the production endpoint/env
  baseline is not ready for proof.

Recorded durable preflight:

- `specs/brandcode-mcp-production-proof-preflight.md`

## 2026-05-12 - M001-L31 Shaped

Prepared the next Ready lane:

- `.claudex/packets/M001-L31-limited-client-handoff-packet.md`
- `.claudex/prompts/M001-L31-limited-client-handoff-packet.md`

Purpose:

- draft the handoff packet an approved limited-client staging user could
  receive;
- include setup shape, approved claims, non-claims, support/intake route,
  key/scope posture, custody expectations, smoke/proof expectations, rotation
  and offboarding notes;
- reference the production proof blocker truthfully without generating live
  keys or implying public release.

Current Ready lane:

- M001-L31 - Limited Client Handoff Packet.

## 2026-05-12 - M001-L31 Closed

Closed M001-L31 as a docs-only limited-client handoff packet lane.

Added:

- `specs/brandcode-mcp-limited-client-handoff-packet.md`

The handoff packet:

- gives approved limited-client staging users a setup shape, including generic
  HTTP MCP client configuration without secrets;
- separates approved staging/limited-client claims from explicit non-claims for
  public release, package/source access, production proof, public SLA, and
  public deletion/export;
- documents key/scope posture, tool expectations, custody expectations,
  smoke/proof expectations, support/intake routing, rotation, revocation, and
  offboarding;
- includes the Column Five Brandcode internal staging example using redacted
  M001-L30 proof only;
- keeps production proof truth explicit: Jason authorized production
  proof/live-key testing for `brandcode`, but proof remains blocked on
  `mcp.brandcode.studio` DNS/alias and missing Production env for hosted MCP
  mode, live-key seed, service token, and durable shared rate limits.

Updated:

- `.claudex/packets/M001-L31-limited-client-handoff-packet.md`
- `.claudex/sprints/current.md`
- `HANDOFF.md`

Verification:

- `git diff --check` passed.
- No code changed, so lint/build/tests were skipped as docs-only.

No release, npm publish, public MCP directory submission, public listing
metadata change, hosted tool addition, selected-kit default behavior, custody
relaxation, production client handoff, production key generation, production
endpoint proof, self-serve deletion/export operation, public SLA, legal terms,
or public release proof happened.

No next Ready lane remains because the next useful proof step is blocked on
external production route/env provisioning. Public release also remains blocked
on final legal/subprocessor launch language, future public package/source
approval, directory metadata, and explicit Jason release approval.

## 2026-05-12 - L31 Pushed And CI-Proven

Jason asked to push M001-L31.

Pushed:

- `main` to `d0e06b3`.

GitHub CI:

- Run: `25746822612`
- URL:
  `https://github.com/Brandcode-Studio/brandsystem-mcp/actions/runs/25746822612`
- Result: success.
- Node 20, Node 22, and Node 24 jobs passed `npm ci`, `npm run build`,
  `npm run lint`, `npm test`, and `npm audit --audit-level=high`.

No release, npm publish, public MCP directory submission, public listing
metadata change, hosted tool addition, selected-kit default behavior, custody
relaxation, production client handoff, production key generation, production
endpoint proof, self-serve deletion/export operation, public SLA, legal terms,
or public release proof happened.

## 2026-05-12 - Operational Roadmap Shaped

Jason agreed that the next work should stay operational: make limited use real,
then production proof real, then later reopen package/directory questions.

Added:

- `specs/brandcode-mcp-operational-roadmap-m001-m003.md`
- `.claudex/packets/M001-L32-production-route-env-repair.md`
- `.claudex/prompts/M001-L32-production-route-env-repair.md`

Roadmap sequence:

- M001 remainder: production route/env repair, production live-key smoke proof,
  M001 closeout and M002 opening.
- M002: approved-client handoff rehearsal, support-ledger dogfood, key
  rotation/revocation/offboarding drill, non-Brandcode brand proof, and one
  evidence-led quality repair.
- M003A: hosted observability event matrix, hosted error/abuse evidence
  capture, leak/abuse drill, backup ops owner/escalation, and legal/subprocessor
  launch-language review packet.

Current Ready lane:

- M001-L32 - Production Route And Env Repair.

The L32 lane must not generate `bck_live_` keys or run production smoke. It
only repairs/records production route and env readiness so the following lane
can run production proof safely.
