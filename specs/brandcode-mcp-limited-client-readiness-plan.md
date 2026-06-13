# Brandcode MCP Limited Client Readiness Plan

**Status:** Draft plan for approved-client pre-release; public release still blocked
**Date:** 2026-05-11
**Applies to:** hosted `@brandcode/mcp` Use MCP limited-client rollout
**Package/source posture:** Option 4 approved for v0.1 limited-client work:
defer public `@brandcode/mcp` package/source distribution
**Release posture:** no public release, npm publish, package listing, MCP
directory submission, public listing metadata, production launch claim, or
public source/license posture change until Jason explicitly approves.

## Executive Readout

Brandcode MCP can move toward limited approved-client use without publishing a
package or listing the service publicly. The approved v0.1 posture is hosted,
brand-scoped, bearer-key gated, and pre-release. The first client rollout
should be treated as a governed operations lane, not as a public launch.

Readiness means each approved brand has:

- explicit client and brand eligibility approval;
- a chosen staging or production endpoint posture;
- scoped API keys with rotation, revocation, and leak response ownership;
- per-client smoke proof before handoff;
- clear support, abuse, deletion/export, and incident intake;
- package-safe asset custody proof or a visible blocker;
- durable/shared rate-limit and service-token env checks;
- Option 4 guardrails against package, directory, or listing drift.

This plan does not authorize production-client keys, public release, npm
publish, directory metadata, or public listing copy by itself.

## Eligibility

An approved limited-client brand must satisfy all of the following before key
issuance:

- Jason has approved the client and brand slug for limited-client MCP access.
- The brand has a hosted Brandcode runtime package available through the
  Brandcode Studio hosted package route.
- The intended MCP route is brand-scoped:
  `https://mcp.staging.brandcode.studio/{slug}` for staging proof or
  `https://mcp.brandcode.studio/{slug}` for production access after explicit
  approval.
- The client understands that v0.1 limited-client access is hosted
  pre-release, not public availability.
- The client understands source/package access is not part of the v0.1
  entitlement. Public `@brandcode/mcp` package/source distribution is deferred.
- A Brandcode operator owns support, abuse response, deletion/export intake,
  and key operations for the client.

Do not onboard a brand if its runtime depends on private-provider-only asset
delivery for expected MCP asset use. The asset may remain in the runtime, but
`get_brand_asset` must block unsafe delivery rather than substitute or expose a
private URL.

## Endpoint Posture

Use staging first unless Jason explicitly approves production-client access.

| Endpoint | Use when | Key prefix | Required proof |
| --- | --- | --- | --- |
| `https://mcp.staging.brandcode.studio/{slug}` | Operator smoke, client setup rehearsal, pre-release acceptance | `bck_test_` | Hosted smoke passes with the client slug and scoped test keys |
| `https://mcp.brandcode.studio/{slug}` | Jason-approved limited production client access | `bck_live_` | Fresh production smoke passes after env/key setup and before handoff |

Staging proof may validate readiness, client instructions, and custody, but it
does not authorize production access. Production access requires explicit Jason
approval for the client/brand, live key issuance, and production route proof.

## Key Operations

Keys are operational credentials, not product copy. Do not commit them, paste
them into docs, echo them in terminals, include them in MCP responses, or place
them in directory/listing metadata.

### Issuance

For each approved client brand, define:

- brand slug;
- environment: staging or production;
- key posture: read-only, check-enabled, feedback-enabled, or full;
- allowed scopes: `read`, `check`, and/or `feedback`;
- intended client tool: Claude Code, MCP Inspector, Cursor, another MCP client,
  or internal operator smoke;
- expiration or review date if one is set;
- operator owner.

Recommended starting postures:

- **Read-only key:** `read` for runtime, search, status, assets, and history.
- **Check key:** `read,check` when the client will use `brand_check`.
- **Feedback key:** `read,feedback` or `read,check,feedback` only when the
  client is approved to leave append-only review feedback.
- **Full proof key:** `read,check,feedback` for operator smoke and controlled
  acceptance only.

### Rotation And Revocation

Jason Lankow / Brandcode Studio Ops `<jlankow@columnfive.com>` owns
pre-release abuse response and may revoke, rotate, suspend, or throttle hosted
Brandcode MCP API keys for abuse, leaked keys, excessive traffic, security
risk, or service-stability risk.

Rotate or revoke a key when:

- the key is pasted into chat, docs, logs, screenshots, or support artifacts;
- the client no longer needs access;
- the client changes agencies, vendors, or MCP tools;
- the key has broader scopes than the approved use needs;
- rate-limit, abuse, or suspicious access evidence appears;
- a Brandcode operator cannot identify who controls the key.

Leak response:

1. Revoke or rotate the affected key first.
2. Check whether the key id, brand slug, endpoint, and scope were exposed.
3. Rerun the hosted smoke with replacement credentials.
4. Record the incident, response, and any client-facing follow-up in the
   limited-client support notes. Do not store the raw leaked key.

## Per-Client Smoke Proof

Run smoke proof for each client brand before handoff. A generic Brandcode smoke
does not stand in for client-specific readiness.

Required command shape:

```bash
BRANDCODE_MCP_SMOKE_URL="https://mcp.staging.brandcode.studio/{slug}" \
BRANDCODE_MCP_SMOKE_FULL_KEY="bck_test_..." \
BRANDCODE_MCP_SMOKE_READ_KEY="bck_test_..." \
BRANDCODE_MCP_SMOKE_ASSET_ID="brandcode:logo:c5-logomark-red.svg" \
npm run smoke:hosted-mcp -- --json
```

For production, use the production endpoint and `bck_live_` keys only after
Jason approves production access for that client/brand.

Minimum acceptance:

- MCP initialize succeeds for the brand-scoped route.
- `tools/list` returns the locked hosted order:
  `brand_runtime`, `brand_search`, `brand_check`, `brand_status`,
  `list_brand_assets`, `get_brand_asset`, `brand_feedback`, `capture_taste`,
  `brand_history`.
- `brand_status` reports the expected brand slug and rate-limit posture.
- Read key can call read-scope tools.
- Read-only key receives structured `insufficient_scope` for `brand_check`,
  `brand_feedback`, and `capture_taste`.
- Full or approved scoped key can call `brand_check` when check scope is
  present.
- Feedback append is either recorded with `append_status: recorded` or skipped
  with `BRANDCODE_MCP_SMOKE_SKIP_FEEDBACK=1` and a named reason.
- Asset proof passes for at least one expected production-approved,
  package-safe asset, or the client rollout records an explicit asset-custody
  blocker.
- Smoke result has `fail: 0`. Any `blocked` or `skipped` result must have a
  named owner and disposition before client handoff.

Preserve the proof summary, not the secrets.

## Custody Expectations

Hosted MCP may expose package-safe asset metadata and package-safe delivery
references. It must not expose raw private provider URLs, private Blob URLs,
service-token data, bearer keys, or raw custody paths.

For each limited-client brand, record whether expected assets are:

- **package-safe:** approved for MCP delivery;
- **blocked private-provider-only:** present but not deliverable through MCP;
- **not needed for v0.1 client workflow:** no asset proof required for initial
  handoff, with explicit client expectation set.

If the client workflow requires assets and no package-safe fixture exists,
create an upstream package-data repair lane before handoff. Do not relax MCP
custody to satisfy the client proof.

## Rate-Limit And Env Checks

Before each limited-client handoff, confirm:

- `BRANDCODE_MCP_SERVICE_TOKEN` is configured for hosted server-to-server UCS
  calls.
- The legacy `UCS_SERVICE_TOKEN` name is not used as the MCP service-token
  contract.
- Durable/shared Redis REST rate-limit env is configured for hosted proof:
  `BRANDCODE_MCP_RATE_LIMIT_REDIS_REST_URL` /
  `BRANDCODE_MCP_RATE_LIMIT_REDIS_REST_TOKEN`, or accepted Vercel/Upstash
  aliases `UPSTASH_REDIS_REST_*` / `KV_REST_API_*`.
- `brand_status.rate_limits.status` reports `active_durable_shared` on the
  hosted route used for client handoff.
- The route returns `x-ratelimit-*` headers.
- If the durable store is configured but unavailable, requests fail closed with
  `503 rate_limit_unavailable` before MCP tool dispatch.

The in-process limiter is acceptable for local tests and development fallback
only. Do not use local/pre-release fallback as production client readiness
proof.

## Support, Abuse, Deletion, Export, And Incidents

Limited-client support intake must route to Brandcode Studio Ops. Until public
launch terms are approved, do not promise self-serve deletion/export, public
support SLAs, or public service availability.

Intake categories:

- access setup: endpoint, MCP client config, missing bearer key, wrong slug;
- auth/scope: invalid token, wrong-environment prefix, insufficient scope;
- custody: asset blocked because delivery is private-provider-only;
- quality: runtime/search/check result does not match brand expectation;
- feedback/history: append failed, missing receipt, history summary confusing;
- deletion/export: manual pre-release ops review only;
- abuse/security: leaked key, excessive traffic, suspicious access, service
  stability risk.

Deletion/export requests remain manual pre-release ops review through
Brandcode/UCS operations. Public launch still requires Jason/legal/ops
approval of requester authorization, deletion/export scope, export package
format, response windows, support escalation, and any required legal or
subprocessor language.

## Option 4 Guardrails

For v0.1 limited-client work, do not:

- publish `@brandcode/mcp` to npm;
- rename or alter package metadata for a hosted Brandcode MCP public package;
- submit Brandcode MCP to MCP directories;
- draft public directory/listing metadata as final copy;
- claim public release, public availability, directory readiness, or
  release-candidate status;
- change source/license posture for future `@brandcode/mcp`;
- add hosted tools outside the locked v0.1 surface;
- make selected Brand Kits or campaign/exploratory kits the default hosted MCP
  object;
- expose raw private/provider URLs or weaken package-safe custody;
- generate or expose production client keys without explicit Jason approval.

Allowed in limited-client lanes:

- client-specific readiness docs and runbooks;
- staging smoke proof;
- production smoke proof only after Jason approves production access;
- key-scope planning and redacted key-operation records;
- support/deletion/export intake routing;
- package-safe asset proof and upstream package-data repair packets;
- evidence capture for a future Option 3 connector/client artifact.

## Future Option 3 Signals To Capture

Option 3 remains the likely future public direction, but it is not implemented
in this lane. During limited-client use, capture evidence that would shape a
narrow public connector/client artifact later:

- which MCP clients need the most setup help;
- whether endpoint/key configuration is the main adoption friction;
- whether clients need a config helper, package wrapper, docs-only recipe, or
  directory metadata first;
- which scopes are over-granted or under-granted in real workflows;
- which custody blockers recur and which assets should be package-safe by
  default;
- whether read-only runtime/search is enough for first value, or check/feedback
  is needed immediately;
- what support questions are repeated across clients;
- what public copy would prevent entitlement confusion between the connector,
  hosted service access, and client-owned brand data.

Do not convert these signals into public package/source work until Jason
approves an Option 3 lane.

## Readiness Checklist

Before limited-client handoff:

- [ ] Jason approved the client and brand slug.
- [ ] Endpoint posture is chosen: staging proof or production access.
- [ ] The brand runtime package is available through Brandcode hosted package
      fetch.
- [ ] Key scopes are chosen and least-privilege for the intended workflow.
- [ ] Key owner, rotation path, and revocation path are recorded.
- [ ] Service-token env is configured.
- [ ] Durable/shared rate-limit env is configured for hosted proof.
- [ ] Per-client hosted smoke passes with `fail: 0`.
- [ ] Package-safe asset proof passes, or asset custody blocker is named.
- [ ] Support, abuse, deletion/export, and incident intake path is provided.
- [ ] Option 4 guardrails are checked: no package, directory, listing, public
      source, or release action.

## Remaining Blockers

Limited-client readiness still requires named client/brand approval before
production handoff. Public launch remains blocked by:

- explicit Jason release/publish approval;
- final deletion/export public launch language and support/legal terms;
- future public package/source posture approval if Brandcode moves beyond
  Option 4;
- Brandcode Use directory metadata;
- fresh hosted proof for the target production route before any production
  client handoff.

## Next Operational Lane

The next useful lane is a reusable limited-client onboarding packet and smoke
checklist. It should turn this plan into a per-client template without issuing
production keys or naming a real client unless Jason approves one in-thread.
