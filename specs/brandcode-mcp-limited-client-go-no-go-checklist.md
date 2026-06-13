# Brandcode MCP Limited Client Go No-Go Checklist

**Status:** Operator checklist for approved-client pre-release
**Date:** 2026-05-12
**Applies to:** hosted Brandcode MCP limited-client staging and production
proof decisions
**Package/source posture:** Option 4 - no public `@brandcode/mcp`
package/source distribution for v0.1 limited-client work
**Release posture:** public release, npm publish, MCP directory submission,
public listing metadata, production launch claim, and public deletion/export
launch language remain blocked until Jason explicitly approves.

## Executive Readout

This checklist decides whether a specific approved brand/client is ready for
staging handoff or production proof. It does not approve public launch.

Use it per client and per brand slug. Preserve evidence links and redacted
summaries. Do not store bearer keys, service tokens, raw private/provider URLs,
private custody paths, or sensitive env values in this document.

## Decision Levels

| Decision | Meaning | Current release posture |
| --- | --- | --- |
| Staging readiness | The client/brand can use a staging endpoint for setup rehearsal, smoke proof, and limited acceptance. | Allowed for approved clients with `bck_test_` keys and passing evidence. |
| Production proof readiness | Brandcode Ops can request or run a production endpoint proof for a named approved client/brand. | Requires explicit Jason approval before production keys or production proof. |
| Public release readiness | Brandcode MCP can be published, listed, or described as publicly available. | Blocked. Requires final legal/subprocessor launch language, future public package/source approval, directory metadata, and explicit Jason release approval. |

## Checklist Record

Copy this section for each client/brand review.

| Field | Value |
| --- | --- |
| Client |  |
| Brand slug |  |
| Brand owner/admin |  |
| Brandcode Ops owner | Jason Lankow / Brandcode Studio Ops `<jlankow@columnfive.com>` |
| Environment requested | Staging / production proof / public release |
| Endpoint |  |
| Key posture | Read-only / check-enabled / feedback-enabled / full proof |
| Required asset id, if any |  |
| Review date |  |
| Staging verdict | Go / no-go / blocked |
| Production proof verdict | Go / no-go / blocked |
| Public release verdict | Blocked unless separately approved |
| Blockers |  |
| Evidence links |  |

## Staging Readiness

Staging can be marked go only when all required items below are satisfied.

| Gate | Required evidence | Verdict |
| --- | --- | --- |
| Client and brand approval | Jason approved the client and brand slug for limited-client MCP access. |  |
| Endpoint | Brand-scoped staging route is known, for example `https://mcp.staging.brandcode.studio/{slug}`. |  |
| Key posture | `bck_test_` keys are scoped to the brand and minimum needed scopes. Key values are not stored in docs or logs. |  |
| Service token | Hosted route has `BRANDCODE_MCP_SERVICE_TOKEN` configured for UCS calls. |  |
| Durable rate limit | Hosted `brand_status.rate_limits.status` reports `active_durable_shared` for the handoff route. |  |
| Smoke proof | `npm run smoke:hosted-mcp -- --json` passes for the client slug with `fail: 0`. |  |
| Tool surface | `tools/list` returns the locked hosted order: `brand_runtime`, `brand_search`, `brand_check`, `brand_status`, `list_brand_assets`, `get_brand_asset`, `brand_feedback`, `capture_taste`, `brand_history`. |  |
| Scope proof | Read-only key can call read tools and receives structured `insufficient_scope` for `brand_check`, `brand_feedback`, and `capture_taste`. |  |
| Asset custody | Required assets are package-safe, or a named asset-custody blocker is accepted before handoff. No raw private/provider URLs are exposed. |  |
| Feedback posture | Feedback append is approved and proves `append_status: recorded`, or feedback is intentionally skipped with a named reason. |  |
| Client config proof | At least one intended MCP client path is proven or the handoff is explicitly operator-only. |  |
| Support intake | The limited-client support intake ledger is ready for setup, auth/scope, custody, quality, feedback/history, deletion/export, incident, and offboarding requests. |  |
| Deletion/export posture | Pre-release manual deletion/export ops review is accepted for this client; no public SLA or self-serve operation is promised. |  |
| CI freshness | The pushed repo tip that affects hosted behavior has a green GitHub CI run across Node 20, 22, and 24. |  |

## Production Proof Readiness

Production proof is not the same as public release. Mark production proof go
only when all staging gates pass and these additional gates are satisfied.

| Gate | Required evidence | Verdict |
| --- | --- | --- |
| Explicit Jason approval | Jason approved production proof for the named client and brand slug. |  |
| Production endpoint | Production route is known, for example `https://mcp.brandcode.studio/{slug}`. |  |
| Live key issuance | `bck_live_` key generation is approved, scoped, documented by non-secret metadata, and not printed or committed. |  |
| Production env | Production service-token and durable shared rate-limit env are configured. |  |
| Production smoke | Fresh production smoke passes with `fail: 0` before handoff. |  |
| Abuse/key owner | Jason Lankow / Brandcode Studio Ops remains the named abuse and key-response owner, or a replacement owner is recorded. |  |
| Client expectations | The client understands hosted pre-release access, no public package/source entitlement, no public SLA, and manual deletion/export review. |  |

## Public Release Readiness

Public release remains blocked unless each item below is separately approved
and evidenced. A staging or production proof pass does not satisfy this gate.

| Gate | Status |
| --- | --- |
| Explicit Jason release approval | Blocked until recorded. |
| Public `@brandcode/mcp` package/source posture | Blocked. Option 4 defers public package/source distribution for v0.1 limited-client work. |
| npm publish | Blocked until Jason approves package/source posture and publish. |
| MCP directory submission | Blocked until separate Brandcode Use metadata and release approval exist. |
| Public listing metadata | Blocked until release posture, directory metadata, and public terms are approved. |
| Legal/subprocessor launch language | Blocked until final legal/ops review. Draft language is review input only. |
| Public deletion/export SLA or self-serve operations | Blocked. Current posture is manual pre-release ops review only. |
| Production rollout | Blocked until production proof, support/abuse ownership, data-policy language, and release approval are complete. |

## Fail-Closed Criteria

Any item below makes the current review a no-go until repaired or explicitly
accepted as a named blocker:

- missing Jason approval for the client, brand, environment, or production
  proof;
- missing, leaked, wrong-prefix, wrong-scope, or unowned API keys;
- missing `BRANDCODE_MCP_SERVICE_TOKEN` on a hosted route that needs UCS calls;
- hosted route reports no durable shared rate-limit enforcement for client
  handoff;
- hosted smoke fails or cannot run for the target brand/endpoint;
- `tools/list` does not match the locked hosted surface;
- read-only scope proof does not return structured `insufficient_scope` for
  check/feedback tools;
- a required asset exposes raw private/provider URLs, private Blob URLs,
  service tokens, bearer keys, raw custody paths, or private delivery refs;
- no package-safe asset exists for a workflow that requires asset delivery;
- support, abuse, deletion/export, incident, or offboarding intake has no
  named owner;
- GitHub CI is failing or missing for a hosted-affecting pushed change;
- public deletion/export launch language is treated as approved before
  legal/subprocessor review;
- production proof, production key issuance, npm publish, directory
  submission, or public release is attempted without explicit Jason approval.

## Evidence Index

Use these repo artifacts as the starting evidence set:

- Limited-client readiness plan:
  `specs/brandcode-mcp-limited-client-readiness-plan.md`
- Limited-client onboarding template:
  `specs/brandcode-mcp-limited-client-onboarding-template.md`
- Internal Column Five Brandcode staging proof:
  `specs/brandcode-mcp-column-five-brandcode-staging-onboarding-proof.md`
- Column Five client-config dry run:
  `specs/brandcode-mcp-column-five-client-config-dry-run.md`
- Key operations runbook:
  `specs/brandcode-mcp-limited-client-key-ops-runbook.md`
- Support intake ledger:
  `specs/brandcode-mcp-limited-client-support-intake-ledger.md`
- Hosted data policy:
  `specs/brandcode-mcp-hosted-data-policy.md`
- Deletion/export launch decision brief:
  `specs/brandcode-mcp-deletion-export-launch-decision-brief.md`
- Latest pushed CI proof for M001-L28 and accepted L28 decisions:
  `https://github.com/Brandcode-Studio/brandsystem-mcp/actions/runs/25705113500`

## Column Five Brandcode Current Read

This example reflects the latest recorded internal proof plus the M001-L30
freshness proof after Jason-authorized staging-only key generation. It is not
an evergreen claim.

| Decision | Current read | Evidence |
| --- | --- | --- |
| Staging readiness | Go for internal Column Five Brandcode staging rehearsal. Fresh staging-only full/read keys were generated, installed in Vercel Preview, deployed behind staging, proven, and removed locally after proof. | Freshness proof recorded in `specs/brandcode-mcp-column-five-brandcode-staging-onboarding-proof.md`. |
| Production proof readiness | Blocked until Jason explicitly approves production proof and live key issuance for the `brandcode` slug. | No production endpoint proof or production key issuance has been approved. |
| Public release readiness | Blocked. | Option 4 defers public package/source distribution; final legal/subprocessor launch language, directory metadata, and explicit release approval are still missing. |

### 2026-05-12 Column Five Staging Checklist Application

| Gate | Fresh read |
| --- | --- |
| Client and brand approval | Pass for internal Column Five Brandcode staging rehearsal based on the existing approved-brand proof posture. |
| Endpoint | Pass. `https://mcp.staging.brandcode.studio/brandcode` is reachable and points to Ready Preview deployment `dpl_4aQ9vVdsXC6SD5u7TMqXZKs4eCQC` / `https://brandsystem-pwnz9m3oy-column-five.vercel.app`. |
| Key posture | Pass. Fresh staging-only `bck_test_` full/read keys were generated into `0600` temp files, installed as sensitive Vercel Preview env, used for proof, and removed locally. |
| Service token | Pass. Authenticated `brand_history` returned scoped hosted MCP history shape and `brand_feedback` append returned `append_status: "recorded"`. |
| Durable rate limit | Pass. Authenticated `brand_status` returned `rate_limits.status: "active_durable_shared"` and `enforcement: "durable_shared_redis_fixed_window"`. |
| Smoke proof | Pass. Hosted smoke returned `ok: true`, `status: "pass"`, `fail: 0`, `blocked: 0`, and `skipped: 0` at `2026-05-12T02:25:44.680Z`. |
| Tool surface | Pass. `tools/list` returned the locked hosted order. |
| Scope proof | Pass. Read-only key returned structured `insufficient_scope` payloads with status `403` for `brand_check` and `brand_feedback`. |
| Asset custody | Pass. `get_brand_asset` for `brandcode:logo:c5-logomark-red.svg` returned package-safe custody, `safe_for_mcp: true`, and no raw private/provider URL exposure. |
| Feedback posture | Pass. `brand_feedback` append returned `append_status: "recorded"`. |
| Client config proof | Not refreshed; latest real client path proof remains the 2026-05-11 Claude Code dry run. |
| Support intake | Pass. Limited-client support intake ledger exists and names owners/categories. |
| Deletion/export posture | Pass for pre-release manual ops review; public launch language remains blocked. |
| CI freshness | Pass for latest pushed hosted-affecting baseline: GitHub Actions run `25705113500` succeeded on `201ee36d8c140e811950eb4e7d9d69a64a5a08db`. Local L29/L30 docs are not hosted-affecting. |

## Closeout Rule

When a client/brand passes this checklist, the allowed claim is limited to that
specific decision level. Do not collapse staging readiness, production proof
readiness, and public release readiness into one claim.

This checklist does not authorize release, npm publish, MCP directory
submission, public listing metadata, production client keys, public
deletion/export SLA, self-serve deletion/export operations, hosted tool
additions, selected Brand Kit defaults, or custody relaxation.
