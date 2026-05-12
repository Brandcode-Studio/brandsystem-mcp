# Brandcode MCP Limited Client Handoff Packet

**Status:** Reusable packet for approved limited-client staging handoff
**Date:** 2026-05-12
**Applies to:** hosted Brandcode MCP approved-client pre-release access
**Default endpoint posture:** staging rehearsal unless production proof is
separately approved and proven
**Package/source posture:** Option 4 - no public `@brandcode/mcp`
package/source distribution for v0.1 limited-client work
**Release posture:** public release, npm publish, MCP directory submission,
public listing metadata, production launch claims, public deletion/export
launch language, public SLA, and self-serve deletion/export remain blocked.

## Executive Readout

Brandcode MCP limited-client access is hosted, approved-brand,
bearer-key-gated, and pre-release. This packet is the handoff shape for a
client or internal rehearsal user who has been approved for a specific brand
slug and endpoint.

Use this packet only after the per-client go/no-go checklist passes for the
requested environment. For the current Column Five Brandcode read, staging is
go for internal rehearsal. Production proof for the `brandcode` slug is
authorized but blocked on production DNS and Vercel Production environment
provisioning, so this packet does not authorize production client handoff.

## Approved Claims

For an approved staging client, it is accurate to say:

- Brandcode MCP provides hosted MCP access to an approved brand runtime through
  a brand-scoped endpoint.
- Access is controlled by bearer keys scoped to the approved brand and least
  privilege needed for the workflow.
- The current locked v0.1 hosted tool surface has 8 tools:
  `brand_runtime`, `brand_search`, `brand_check`, `brand_status`,
  `list_brand_assets`, `get_brand_asset`, `brand_feedback`, and
  `brand_history`.
- `brand_feedback` is append-only review input and does not mutate canonical
  governance.
- `brand_history` is read-only compact history.
- Asset delivery must remain package-safe for MCP handoff; raw
  private/provider URLs are not an approved delivery path.
- Deletion/export requests are handled by manual pre-release Brandcode Studio
  Ops review.

## Explicit Non-Claims

This handoff does not authorize or imply:

- public Brandcode MCP release;
- npm publish;
- MCP directory submission;
- public listing metadata;
- public `@brandcode/mcp` package/source access;
- production endpoint proof or production client access;
- production `bck_live_` key issuance;
- public support SLA;
- approved public legal/subprocessor launch language;
- self-serve deletion/export;
- hosted tool additions;
- selected Brand Kit or campaign kit default behavior;
- custody relaxation or exposure of raw private/provider URLs.

## Client Setup

Use the endpoint for the approved brand slug only.

Staging endpoint shape:

```text
https://mcp.staging.brandcode.studio/[slug]
```

Production endpoint shape, only after production proof is separately approved
and passes:

```text
https://mcp.brandcode.studio/[slug]
```

Generic HTTP MCP configuration shape:

```json
{
  "url": "https://mcp.staging.brandcode.studio/[slug]",
  "headers": {
    "Authorization": "Bearer ${BRANDCODE_MCP_BEARER_KEY}"
  }
}
```

Client setup rules:

- Store the bearer key only in the MCP client's secret path or a local secret
  environment variable.
- Do not paste bearer keys into shared docs, tickets, screenshots, logs,
  committed configs, or chat.
- Do not share the endpoint/key pair outside the approved brand workflow.
- Use the staging endpoint with `bck_test_` keys unless production access is
  explicitly approved and proven.
- Report setup friction as product evidence instead of broadening key scopes or
  changing release posture.

## Key And Scope Posture

Brandcode MCP keys are brand-scoped and least-privilege by default.

| Key posture | Scopes | Typical use |
| --- | --- | --- |
| Read-only | `read` | Runtime, search, status, asset catalog, package-safe asset reads, and compact history |
| Check-enabled | `read,check` | Adds draft validation through `brand_check` |
| Feedback-enabled | `read,feedback` | Adds append-only review input |
| Full controlled proof | `read,check,feedback` | Operator smoke and controlled acceptance only |

Expected scope behavior:

- A read-only key can call read tools.
- A read-only key receives structured `403 insufficient_scope` responses for
  `brand_check` and `brand_feedback`.
- Staging keys use the `bck_test_` prefix.
- Production keys use the `bck_live_` prefix and require explicit production
  approval, production route readiness, production env readiness, and fresh
  production smoke proof.

## Tool Expectations

| Tool | Client-facing meaning |
| --- | --- |
| `brand_runtime` | Returns the hosted Full Brand Runtime for the approved brand. |
| `brand_search` | Searches governed brand runtime content. |
| `brand_check` | Checks draft content against available brand rules when the key has `check` scope. |
| `brand_status` | Reports current hosted MCP capability, custody, and rate-limit posture. |
| `list_brand_assets` | Lists available custody-safe asset summaries. |
| `get_brand_asset` | Returns a package-safe asset delivery when available, otherwise a truthful blocker. |
| `brand_feedback` | Records append-only review input when the key has `feedback` scope. |
| `brand_history` | Returns compact, scoped hosted MCP history. |

## Custody Expectations

Asset delivery is allowed only when the MCP can return a package-safe delivery
posture. If an asset is private-provider-only or lacks a package-safe delivery
ref, the correct outcome is a visible custody blocker, not a substituted asset
or exposed private URL.

For handoff proof, asset checks should record:

- asset id;
- delivery posture;
- whether `safe_for_mcp` is true;
- whether raw private/provider URL exposure is false;
- any blocker if package-safe delivery is unavailable.

## Smoke And Proof Expectations

Brandcode Studio Ops should run smoke before handoff and preserve only redacted
summary evidence.

Staging command shape:

```bash
BRANDCODE_MCP_SMOKE_URL="https://mcp.staging.brandcode.studio/[slug]" \
BRANDCODE_MCP_SMOKE_FULL_KEY="[redacted full/check/feedback key]" \
BRANDCODE_MCP_SMOKE_READ_KEY="[redacted read-only key]" \
BRANDCODE_MCP_SMOKE_ASSET_ID="[package-safe asset id]" \
npm run smoke:hosted-mcp -- --json
```

Minimum pass bar:

- `ok: true`;
- `status: "pass"`;
- `fail: 0`;
- locked 8-tool order;
- `brand_status.rate_limits.status: "active_durable_shared"` for hosted
  handoff routes;
- package-safe custody for required asset delivery, or a named blocker before
  handoff;
- no raw private/provider URL exposure;
- `brand_feedback` append recorded, or skipped with a named reason;
- read-only key receives structured `insufficient_scope` for `brand_check` and
  `brand_feedback`.

## Support And Intake

Route limited-client support to Brandcode Studio Ops using the current support
intake ledger. Every request should include the approved brand slug, endpoint,
MCP client, non-secret key label or posture, factual impact, owner, status,
next action, and redacted evidence link.

Supported intake categories:

- access setup;
- auth/scope;
- custody;
- runtime/search/check quality;
- feedback/history;
- deletion/export;
- abuse/security;
- incident;
- offboarding.

Deletion/export requests remain manual pre-release ops review. Do not promise
public response windows, public SLA, self-serve tooling, legal outcome, or
export package format.

## Rotation, Revocation, And Offboarding

Brandcode Studio Ops may revoke, rotate, suspend, or throttle hosted Brandcode
MCP keys for abuse, leaked keys, excessive traffic, security risk, client
offboarding, wrong-scope access, unknown ownership, or service-stability risk.

Before offboarding or rotation:

- identify the approved client, brand slug, endpoint, non-secret key label,
  scopes, and owner;
- remove or replace the affected key in the hosted key store;
- deploy or alias if the key-store change requires it;
- prove the replacement or revoked-key behavior without printing the raw key;
- record redacted evidence in the client support ledger.

## Column Five Brandcode Internal Example

This example is internal proof for the Column Five Brandcode `brandcode`
staging route. It is not an evergreen claim and not production approval.

| Field | Redacted read |
| --- | --- |
| Brand slug | `brandcode` |
| Endpoint | `https://mcp.staging.brandcode.studio/brandcode` |
| Checked at | `2026-05-12T02:25:44.680Z` |
| Deployment | Ready Preview `dpl_4aQ9vVdsXC6SD5u7TMqXZKs4eCQC` / `https://brandsystem-pwnz9m3oy-column-five.vercel.app` |
| Key posture | Fresh staging-only `bck_test_` full/read keys generated, installed as sensitive Preview env, used for proof, and removed locally |
| Smoke result | `ok: true`, `status: "pass"`, `fail: 0`, `blocked: 0`, `skipped: 0` |
| Tool order | Locked 8-tool order passed |
| Rate limit | `active_durable_shared` with `durable_shared_redis_fixed_window` enforcement |
| Asset proof | `brandcode:logo:c5-logomark-red.svg` returned package-safe custody, `safe_for_mcp: true`, and no raw private/provider URL exposure |
| Feedback | `brand_feedback` append returned `append_status: "recorded"` |
| Read-only scope | `brand_check` and `brand_feedback` returned structured `403 insufficient_scope` |
| Staging verdict | Go for internal Column Five Brandcode staging rehearsal only |

## Current Production Blocker

Jason authorized production proof/live-key testing for the `brandcode` slug on
2026-05-12. M001-L32 added the `mcp.brandcode.studio` production alias and
Production `BRANDCODE_MCP_ENV=production`, but production proof is currently
blocked:

- `mcp.brandcode.studio` does not resolve;
- Vercel says external DNS must set `A mcp.brandcode.studio 76.76.21.21`, or
  the domain nameservers must move to Vercel;
- Production does not currently list `BRANDCODE_MCP_TEST_KEYS` or equivalent
  live-key seed env;
- Production does not currently list `BRANDCODE_MCP_SERVICE_TOKEN`;
- Production does not currently list durable shared rate-limit env.

No `bck_live_` keys should be generated, installed, or handed off until the
production route and env baseline are repaired and fresh production smoke
passes.

## Evidence Index

- Limited-client go/no-go checklist:
  `specs/brandcode-mcp-limited-client-go-no-go-checklist.md`
- Column Five Brandcode staging proof:
  `specs/brandcode-mcp-column-five-brandcode-staging-onboarding-proof.md`
- Production proof preflight:
  `specs/brandcode-mcp-production-proof-preflight.md`
- Limited-client onboarding template:
  `specs/brandcode-mcp-limited-client-onboarding-template.md`
- Limited-client key ops runbook:
  `specs/brandcode-mcp-limited-client-key-ops-runbook.md`
- Limited-client support intake ledger:
  `specs/brandcode-mcp-limited-client-support-intake-ledger.md`
