# Brandcode MCP Production Proof Preflight

**Status:** Authorized but blocked on external DNS and Production secret env provisioning
**Date:** 2026-05-12
**Applies to:** Column Five Brandcode `brandcode` hosted MCP production proof
**Endpoint under test:** `https://mcp.brandcode.studio/brandcode`
**Authorization:** Jason authorized production proof and live-key testing in
thread on 2026-05-12
**Release posture:** not a public release, npm publish, directory submission,
public package/source approval, public listing change, or client handoff.

## Executive Readout

Production proof is now authorized for the `brandcode` slug, but it cannot be
run truthfully yet. M001-L32 added the `mcp.brandcode.studio` production alias
to the `brandsystem-mcp` Vercel project and added
`BRANDCODE_MCP_ENV=production` to Production env. The host still does not
resolve because external DNS is not configured at the third-party DNS provider,
and Production secret env still lacks the hosted MCP service token and durable
shared rate-limit values required for safe live-key proof.

No `bck_live_` keys were generated during this preflight. Creating live keys
before a routable production endpoint and production env baseline exists would
create sensitive production credentials without a valid proof path.

## Preflight Evidence

| Check | Result |
| --- | --- |
| Pushed code freshness | Pass. `main` was pushed to `3961be4`. |
| GitHub CI | Pass. Run `25710999132` passed on Node 20, 22, and 24. |
| Production endpoint DNS | Blocked. `dig +short mcp.brandcode.studio` returned no records, and `curl https://mcp.brandcode.studio/brandcode` failed with `Could not resolve host: mcp.brandcode.studio`. |
| Vercel alias/domain visibility | Partial repair. `vercel domains add mcp.brandcode.studio` succeeded and `vercel alias ls` now shows `brandsystem-az14haxle-column-five.vercel.app -> mcp.brandcode.studio`; Vercel still reports the domain is not configured until external DNS adds `A mcp.brandcode.studio 76.76.21.21` or nameservers are moved. |
| Production env listing | Partial repair. `vercel env ls production` now lists `BRANDCODE_MCP_ENV`, `MCP_LOG_LEVEL`, `NODE_ENV`, and `UCS_API_BASE_URL`. |
| Production MCP mode | Pass. `BRANDCODE_MCP_ENV=production` is listed for Production. A fresh Production deployment will still be required after the remaining env baseline is complete. |
| Production key store | Blocked. Production `BRANDCODE_MCP_TEST_KEYS` / live-key seed env is not listed. |
| Production service token | Blocked. `BRANDCODE_MCP_SERVICE_TOKEN` is not listed for Production. |
| Production durable rate limit | Blocked. No Production `BRANDCODE_MCP_RATE_LIMIT_REDIS_REST_*`, `UPSTASH_REDIS_REST_*`, or `KV_REST_API_*` variables were listed. Preview lists `KV_REST_API_URL` and `KV_REST_API_TOKEN`, but the CLI could not safely read their values back for Production copying. |
| Direct production deployment check | Blocked. `https://brandsystem-az14haxle-column-five.vercel.app/brandcode` reaches the hosted app but returns a misconfigured service-token response, so it is not yet the app-level bearer gate. |

## Required Repair Before Live-Key Proof

Before generating `bck_live_` keys or running production smoke:

1. Configure DNS so `mcp.brandcode.studio` resolves to the Vercel-managed
   project target.
   - Current Vercel instruction: set `A mcp.brandcode.studio 76.76.21.21`
     at the third-party DNS provider, or move nameservers to Vercel.
2. Configure Production `BRANDCODE_MCP_SERVICE_TOKEN`.
3. Configure Production durable shared rate-limit env using the accepted
   Redis REST env names.
   - Accepted current names include `KV_REST_API_URL` and
     `KV_REST_API_TOKEN`, matching the proven Preview posture.
4. Keep Production `BRANDCODE_MCP_TEST_KEYS` unset until L33 generates scoped
   `bck_live_` keys.
5. Deploy or promote a fresh Production deployment after DNS and env are ready.
6. Generate scoped `bck_live_` full/read keys only after the endpoint and env
   baseline are ready.
7. Install the live-key bundle as sensitive Production env without printing or
   committing key values.
8. Run hosted smoke against
   `https://mcp.brandcode.studio/brandcode` with
   `BRANDCODE_MCP_SMOKE_ASSET_ID=brandcode:logo:c5-logomark-red.svg`.

## Proof Bar

Production proof must show:

- `ok: true`, `status: "pass"`, `fail: 0`;
- locked 8-tool order;
- `brand_status.rate_limits.status: "active_durable_shared"`;
- package-safe `get_brand_asset` custody for
  `brandcode:logo:c5-logomark-red.svg`;
- `brand_feedback` append recorded or explicitly skipped with a named reason;
- read-only `brand_check` and `brand_feedback` return structured
  `403 insufficient_scope`;
- no raw private/provider URL exposure;
- no raw bearer keys, service tokens, or sensitive env values in docs, logs,
  screenshots, commits, or client configs.

## Not Approved By This Preflight

This preflight does not approve public release, npm publish, public
`@brandcode/mcp` package/source distribution, MCP directory submission, public
listing metadata, production client handoff, public deletion/export SLA,
self-serve deletion/export operations, hosted tool additions, selected Brand
Kit defaults, or custody relaxation.
