# Brandcode MCP Operational Roadmap: M001 Remainder Through M003A

**Status:** Operational roadmap for the next 1.5 sprints
**Date:** 2026-05-12
**Applies to:** hosted Brandcode MCP pre-release, limited-client, and
production-trust work
**Product spine:** Full Brand Runtime by default; authorized hosted Use;
package-safe custody; append-only feedback; scoped history; no canonical
mutation from MCP; no public package/source distribution for v0.1
limited-client work.
**Release posture:** no public release, npm publish, MCP directory submission,
public listing metadata, public package/source claim, public deletion/export
launch language, public SLA, or self-serve deletion/export until Jason
explicitly approves.

## Executive Readout

The highest-impact sequence is operational, not promotional:

1. finish M001 by repairing production infrastructure enough to run a real
   production smoke proof, then close the sprint cleanly;
2. spend M002 on one approved limited-client pilot loop and one non-Brandcode
   brand proof, turning real friction into repair lanes;
3. start M003 with production observability, incident/key drills, backup owner
   posture, and legal/subprocessor launch-language readiness.

Directory metadata, npm/package work, and Option 3 public connector work should
stay downstream until the hosted service survives real limited use and
production proof.

## Product Spine Guardrails

Every lane in this roadmap must preserve:

- **Build vs Use split:** `@brandsystem/mcp` builds `.brand`; hosted
  Brandcode MCP serves authorized Use over HTTP.
- **Full Brand Runtime default:** selected Brand Kits and campaign/exploratory
  kits do not become the default v0.1 hosted object.
- **Eight-tool lock:** no ninth hosted tool in this roadmap.
- **Read/append posture:** `brand_feedback` remains append-only review input,
  not canonical mutation.
- **Custody:** assets must be package-safe or blocked; no raw private/provider
  URLs.
- **Option 4:** no public `@brandcode/mcp` package/source distribution for
  v0.1 limited-client work.
- **Release approval:** Jason approval remains a hard blocker for release,
  publish, directory submission, public listing, and public package/source
  posture changes.

## M001 Remainder: Production Proof And Clean Close

Objective: close M001 with staging handoff ready, production proof truthfully
attempted or blocked, and M002 opened around real limited use.

| Order | Lane | Purpose | Exit |
| --- | --- | --- | --- |
| 1 | M001-L32 Production Route And Env Repair | Make `mcp.brandcode.studio` routable and configure Production hosted MCP env baseline. | Production route resolves and unauthenticated route returns hosted bearer-gate response, or a precise external DNS/Vercel blocker is recorded. |
| 2 | M001-L33 Production Live-Key Smoke Proof | Generate scoped `bck_live_` full/read keys only after L32 passes, install them safely, deploy/promote, and run smoke. | Production smoke passes or fails with durable blocker; no keys are documented. |
| 3 | M001-L34 M001 Closeout And M002 Opening | Close M001 with proof matrix, release blockers, and one Ready M002 pilot lane. | M002 opens with exactly one Ready lane and no public-release ambiguity. |

Do not do in M001:

- directory metadata;
- npm/package work;
- public listing copy;
- public legal launch copy;
- Option 3 connector design;
- tool expansion.

## M002: Limited Client Pilot And Proof Diversity

Objective: prove the limited-client loop with real usage pressure while
keeping public release blocked.

| Order | Lane | Purpose | Exit |
| --- | --- | --- | --- |
| 1 | M002-L01 Approved Client Handoff Rehearsal | Use the L31 handoff packet with one approved internal/client rehearsal user. | Handoff completed or blocked with setup friction captured. |
| 2 | M002-L02 Support Ledger Dogfood | Route all rehearsal issues through the support intake ledger. | Setup/auth/custody/quality/feedback/history/offboarding categories each have a tested intake path or explicit deferral. |
| 3 | M002-L03 Key Rotation Revocation Offboarding Drill | Prove rotate/revoke/offboard flow without exposing keys. | Old key denied, replacement key works, evidence redacted. |
| 4 | M002-L04 Non-Brandcode Brand Candidate Inventory | Find one non-Brandcode brand with hosted runtime and package-safe asset potential. | Candidate chosen or upstream package-data blocker recorded. |
| 5 | M002-L05 Non-Brandcode Brand Smoke Proof | Run hosted smoke against the chosen non-Brandcode brand. | Smoke passes, or a narrow custody/runtime repair lane is created. |
| 6 | M002-L06 Pilot Quality Repair Lane | Fix the highest-impact quality gap from real usage, likely search/check/assets/history. | One concrete user-facing improvement lands with focused tests/proof. |
| 7 | M002-L07 M002 Closeout And M003 Opening | Decide whether production trust work has enough evidence to proceed. | M003 opens with observability/incident/legal readiness focus. |

M002 success means the service has been used like a product, not merely
smoked like an endpoint.

## M003A: Production Trust Foundation

Objective: build operational trust before any directory/public posture work.

| Order | Lane | Purpose | Exit |
| --- | --- | --- | --- |
| 1 | M003-L01 Hosted Observability Event Matrix | Define events and evidence for auth failures, rate limits, upstream errors, feedback/history failures, and custody blockers. | Operators can see what happened without exposing secrets. |
| 2 | M003-L02 Hosted Error And Abuse Evidence Capture | Implement or wire the highest-value non-secret evidence capture. | Abuse/rate-limit/key failures have usable operator evidence. |
| 3 | M003-L03 Leak Abuse Incident Drill | Run a controlled drill for leaked key, excessive traffic, and suspicious access. | Revocation/throttle/communication path is proven. |
| 4 | M003-L04 Backup Ops Owner And Escalation Brief | Name backup operations owner and legal/privacy escalation path. | Release blocker moves from "single operator" to reviewed owner posture. |
| 5 | M003-L05 Legal Subprocessor Launch Language Review Packet | Prepare public-language candidate for legal review without publishing. | Legal review input exists; public launch copy remains blocked until approved. |

M003A does not include public directory submission or npm release. It creates
the operational evidence those later reviews need.

## Deferred Until After M003A

Do not start these until production proof, limited-client pilot, and
production trust foundations are done:

- Option 3 connector/package design;
- Brandcode Use directory metadata;
- Glama/Smithery/LobeHub/MCP Registry submissions;
- public pricing/free-in-v1 copy;
- public package/source license posture change;
- public release-candidate claim.

## Current Next Lane

The next Ready lane is:

- `M001-L32 - Production Route And Env Repair`

That lane should repair route/env readiness only. It should not generate
`bck_live_` keys or run production smoke until the route resolves and
Production env baseline is complete.
