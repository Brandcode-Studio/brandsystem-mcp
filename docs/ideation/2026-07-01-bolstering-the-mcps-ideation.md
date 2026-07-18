---
date: 2026-07-01
topic: bolstering-the-mcps
focus: improvements and next steps for both @brandsystem/mcp (local Build) and the hosted Brandcode MCP (Use), given current real state
mode: repo-grounded
---

# Ideation: Bolstering the MCPs

## Grounding Context (Codebase)

**This ideation supersedes most of `docs/ideation/2026-06-27-hosted-mcp-production-cutover-ideation.md`.** In the four days since that doc, an entire parallel operational workstream (M001-L01 through L32, recorded in `HANDOFF.md` and `specs/brandcode-mcp-operational-roadmap-m001-m003.md`) shipped staging deploy, durable Redis rate-limiting, a real limited-client pilot (Column Five Brandcode), a full legal/data-policy/support posture, and an operational roadmap through M003A. The prior plan's U2 (smoke harness) and U3 (CI) already exist as `scripts/hosted-mcp-smoke.mjs`; U5 (hashing decision) is moot — UCS has moved on to unrelated work. **Only U1 (telemetry) from that plan is still genuinely open**, confirmed today by direct re-read of `src/hosted/telemetry.ts`.

**Current real state (verified today, 2026-07-01):**
- `@brandsystem/mcp` (local Build MCP): 41 tool files, 556 tests passing, build/lint clean. Untouched since a description-quality pass at v0.9.3 (~2 months ago).
- Hosted "Brandcode MCP" (Use): 8-tool locked surface + `capture_taste` (9th, contribute-tier). Auth fully wired to UCS's key registry. Rate limiting supports durable-shared Redis (Upstash), **proven on staging** (`active_durable_shared`).
- **Production is blocked purely on infra access Jason alone has**: DNS for `mcp.brandcode.studio` doesn't resolve; Production env is missing `BRANDCODE_MCP_SERVICE_TOKEN` and durable rate-limit vars. The roadmap's own words: **"No lane is Ready."** Jason has explicitly said he doesn't want to release yet, pending legal/approval review. **This ideation does not propose touching that path** — it's already fully specified and is not an open decision.
- `emitAgentRunRecord()` in `src/hosted/telemetry.ts` is still a literal no-op (`return;`). The UCS sink it should POST to (`/api/brand/hosted/{slug}/agent/history`, `{ entry: AgentRunHistoryEntry }`) is already proven — `src/hosted/feedback-fetcher.ts` uses the identical contract successfully today.
- `scripts/hosted-mcp-smoke.mjs` is a complete, well-built smoke harness (locked tool-order assertion, `--strict`/`--json` modes, proper exit codes) but is invoked only by hand — no `.github/workflows/` file references it.
- The connector's pinned contract version (`2026-04-05-connect`, `src/connectors/brandcode/types.ts:3`) is asserted only in this repo's own test mocks, never checked against a real UCS response at runtime. Two named historical bugs (G-5g service-token header mismatch, G-5h brandInstance shape mismatch) are the direct product of this exact gap.
- The hosted MCP's locked tool-order list exists as two independently-hardcoded arrays (`src/hosted/registrations.ts`'s `HOSTED_TOOL_ORDER`, `scripts/hosted-mcp-smoke.mjs`'s `LOCKED_TOOL_ORDER`) — found independently by two different ideation frames using unrelated reasoning paths.
- `brand_feedback` (local MCP) registers **three** separate tools from one file (`brand_feedback`, `brand_feedback_review`, `brand_feedback_triage`). The hosted "eight-tool lock" is enforced only as a count of registered tool *names* — nothing would stop a future hosted tool from shipping as a sub-mode inside an existing file, passing "still 9 names" while quietly growing capability, exactly the pattern already present locally.
- HANDOFF.md is now 780 lines of hand-narrated prose; `.claudex/packets/` (30 files) and `.claudex/prompts/` (28 files) already hold the same information in structured, per-lane form — the prose narrative and the structured data are two sources of truth kept in sync by hand.
- Per HANDOFF.md, the sole abuse-response/on-call authority for the hosted service is one named person (Jason), with no documented backup, even though M003A already plans to eventually name one.

## Topic Axes
- A1 — Hosted MCP: agent-completable observability & operational readiness (explicitly NOT the DNS/env HITL blocker)
- A2 — Local Build MCP: tool-surface coherence, Glama-relevant quality, description/doc accuracy
- A3 — Local Build MCP: new capability gaps
- A4 — Cross-cutting quality bar: contract-drift prevention, governance integrity between the two MCPs
- A5 — Operator/process experience: what de-risks the existing roadmap without duplicating it

## Ranked Ideas

### 1. Wire hosted telemetry using the already-proven feedback contract, and thread call-sites now
**Description:** Replace `emitAgentRunRecord()`'s no-op body with a real fire-and-forget POST mirroring `src/hosted/feedback-fetcher.ts`'s exact working pattern (same endpoint, same `{ entry: AgentRunHistoryEntry }` envelope, same service-token auth). Separately — and this is the leverage refinement multiple frames converged on — thread the call site through every hosted tool handler *now*, passing outcome/latency/requestId at the point each is already computed, even though today the function they call is a no-op. This converts the roadmap's future M003-L01 ("Hosted Observability Event Matrix") from "find every place telemetry should fire and rewire tool handlers" into "swap one function body."
**Axis:** A1
**Basis:** `direct:` `src/hosted/telemetry.ts` — "UCS history POST expects `{ entry: AgentRunHistoryEntry }`... Milestone D owns wiring the real contract... Until then, this helper is a no-op that never writes history," contrasted directly with `feedback-fetcher.ts`'s working implementation of the identical contract. `grep -n "emitAgentRunRecord" -r src/hosted/` confirms zero call sites in `src/hosted/tools/*.ts` today.
**Rationale:** Independently proposed (from 5 different angles: mechanical port, call-site-only threading, minimal-signal-first, sentinel-instrumentation, local-file fallback) by 5 of 6 ideation frames — the strongest convergence signal in this entire ideation pass. It is explicitly named in the codebase's own comments as blocking a roadmap-recognized future lane (M003-L01). It requires zero new UCS-side work since the sink is already proven.
**Downsides:** Must be strictly fire-and-forget / fail-open (never delay or break a tool response on telemetry failure) — a real implementation discipline, not a design risk.
**Confidence:** 92%
**Complexity:** Medium
**Status:** Unexplored

### 2. Govern the tool-count lock by capability surface, not registration-name count
**Description:** The hosted MCP's entire trust posture rests on "eight (now nine) tools, locked" — but that lock is enforced only as a count of names in `tools/list`. The local MCP already demonstrates the failure mode: `brand_feedback` is one file registering three separate tool names (`brand_feedback`, `brand_feedback_review`, `brand_feedback_triage`). Nothing stops a future hosted tool from adding capability as a `mode` parameter or sibling registration inside an existing file — passing "still 9 names" while quietly growing scope. Define what the lock is actually meant to bound (distinct write-paths / distinct scopes / distinct side effects) and add a test that catches capability growth the name-count can't see.
**Axis:** A4
**Basis:** `direct:` `src/tools/brand-feedback.ts:566,578` registers `brand_feedback_review` and `brand_feedback_triage` as separate `server.tool()` calls in the same file as `brand_feedback`; `specs/brandcode-mcp-operational-roadmap-m001-m003.md` defines the guardrail as "Eight-tool lock: no ninth hosted tool" — a pure count.
**Rationale:** This is the single sharpest, most novel finding in this ideation pass — a real integrity gap in the exact claim ("small, locked, auditable surface") the limited-client trust story is built on. It's cheap to answer now (one client, one key, low stakes) and expensive to discover later after a second/third client has built expectations around the current surface.
**Downsides:** Requires first agreeing on what "capability" means precisely enough to test (a real definitional decision, not a trivial lint).
**Confidence:** 85%
**Complexity:** Low-Medium
**Status:** Unexplored

### 3. Wire the existing hosted smoke script into CI as a scheduled, non-blocking staging gate
**Description:** `scripts/hosted-mcp-smoke.mjs` already exists, is well-built (proper exit codes, `--strict`/`--json` flags, locked tool-order assertion), and has been re-run by hand at nearly every roadmap milestone per HANDOFF.md. Add a `workflow_dispatch` + scheduled (e.g. daily) GitHub Actions workflow that runs it against staging using repo secrets. Not a PR-blocking gate initially — it hits a live external endpoint with real keys and could fail on staging downtime unrelated to any code change — but a continuous signal instead of "did anyone check staging lately."
**Axis:** A1
**Basis:** `direct:` `.github/workflows/` contains only `ci.yml`, `publish.yml`, `benchmark.yml` — none reference `smoke:hosted-mcp` (confirmed by reading all three in full); HANDOFF.md repeatedly narrates this exact script being run by hand at milestones L11, L20, L24, L25, L30.
**Rationale:** Cited independently by all 6 frames as the second-most-convergent finding. The tool is designed for exactly this (its own `--help` text and flag set anticipate CI use) and closing this gap is fully agent-completable — it needs only a workflow file and secrets configuration, no DNS/production access.
**Downsides:** Needs a decision on where staging secrets live in GitHub Actions and what "alert on failure" means operationally — a real but small scoping choice.
**Confidence:** 90%
**Complexity:** Low
**Status:** Unexplored

### 4. Close the two forms of tool-order duplication and add a real contract-conformance check
**Description:** Two fixes, same root cause (multiple hand-maintained copies of a fact that must stay in sync): (a) `src/hosted/registrations.ts`'s `HOSTED_TOOL_ORDER` and `scripts/hosted-mcp-smoke.mjs`'s `LOCKED_TOOL_ORDER` are two independently-hardcoded 9-name arrays that could silently drift from each other — export one, import it in both places. (b) The connector's pinned `2026-04-05-connect` contract version is currently asserted only inside this repo's own test mocks (proving the mock matches itself), never checked against a real recorded UCS response — add a golden-fixture test using an actual UCS response shape so contract drift fails a build instead of shipping a repair commit after the fact.
**Axis:** A4
**Basis:** `direct:` `src/hosted/registrations.ts` and `scripts/hosted-mcp-smoke.mjs` both hardcode the same 9 names independently — found by two unrelated ideation frames using different reasoning paths (an F1 "parc fermé" analogy and a direct code comparison), a strong convergence signal. `direct:` `grep -n "2026-04-05-connect"` shows the string in one source comment and six test-mock literals, zero runtime comparisons; CHANGELOG.md documents two named historical bugs from exactly this failure mode (G-5g, G-5h).
**Rationale:** This directly targets a proven, repeating failure pattern (at least 4 "Repair ___" commits in git history) with a cheap, mechanical fix for (a) and a moderate, high-leverage fix for (b).
**Downsides:** (b) requires deciding where the golden fixture lives and who refreshes it when UCS changes intentionally — an ownership question.
**Confidence:** 82%
**Complexity:** Low (a) / Medium (b)
**Status:** Unexplored

### 5. Make local Build MCP tool-surface coherence self-verifying instead of memory-dependent
**Description:** Three small, independent fixes bundled because they attack the same symptom (Glama previously flagged "Tool Count 2/5" as the one lingering coherence gap, unverified whether still current): (a) CLAUDE.md claims "34 files, 36 tools" — actual is 41 files / 43 registrations; fix the drift and consider generating the count rather than hand-typing it. (b) The tool-description quality pass documented in the CHANGELOG ("brand_resolve_conflicts was the lowest-scoring tool on Glama at 3.6/5... now describes both modes...") was manual and one-time; CLAUDE.md's own "Tool Description Guidelines" already enumerate mechanically-checkable criteria (verb-first, trigger phrases, NOT-for, 300-char limit) — encode the checkable subset as a standing test so quality doesn't silently regress on tool #42. (c) `src/server.ts` already groups all 41 tools into 9 documented session/phase comments — expose that existing structure to connecting agents (e.g., via `brand_status`) instead of leaving it as a comment only a human reads, addressing the actual discoverability complaint behind "too many tools" without a risky consolidation.
**Axis:** A2
**Basis:** `direct:` CLAUDE.md text vs. `ls src/tools/ | wc -l` (41) and registration grep (43); CHANGELOG.md's Glama-score quote; `src/server.ts` lines 56-116 showing the 9-group comment structure that exists only as source comments today.
**Rationale:** Three independent frames converged on different facets of the same underlying gap (stale docs, no regression guard on a quality bar that was manually established once, and an unexploited existing information architecture). None require the risky, larger consolidation effort a raw "reduce tool count" idea would.
**Downsides:** (c) in particular needs a decision on where session metadata is surfaced (response field vs. new resource) — small design choice, not a rewrite.
**Confidence:** 75%
**Complexity:** Low (a) / Low-Medium (b) / Medium (c)
**Status:** Unexplored

### 6. Name a backup operator/escalation path before an incident forces the question
**Description:** Per HANDOFF.md, the sole abuse-response and on-call authority for the entire hosted service — with power to revoke, rotate, suspend, or throttle any key — is one named person. M003A already plans a "Backup Ops Owner And Escalation Brief" lane, but that's scheduled for later, after production trust work. Write the short "if the primary operator is unreachable" decision tree now: who (if anyone) can revoke a leaked key, throttle abusive traffic, or say "cut off this client's access" in an emergency, even informally, before it's needed.
**Axis:** A5
**Basis:** `direct:` HANDOFF.md: "Pre-release abuse response owner is Jason Lankow / Brandcode Studio Ops... with authority to revoke, rotate, suspend, or throttle hosted Brandcode MCP API keys for abuse, leaked keys, excessive traffic, security risk, or service-stability risk" — no alternate or backup named anywhere.
**Rationale:** The cheapest possible risk-reduction move in this entire ideation set (pure documentation, no code, no locked-surface risk) against a real single-point-of-failure that today has a same-day-incident blast radius of "nobody can act."
**Downsides:** Requires Jason's own judgment call on who (if anyone) to name — an agent can draft the decision tree structure but not decide the answer.
**Confidence:** 70%
**Complexity:** Low
**Status:** Unexplored

### 7. Give the local Build MCP a search primitive over freshly-extracted `.brand/` data
**Description:** The hosted MCP's `brand_search` queries a rich `BrandKnowledgeCorpus` built from UCS's compiled package — but the local MCP, which does all the extraction and accumulates dozens of YAML/JSON fields across Sessions 1-4, has no equivalent way to semantically query what's already been extracted before it's ever synced to UCS. A local, file-based search over `core-identity.yaml` + `design-synthesis.json` + `extraction-evidence.json` doesn't need UCS or auth at all.
**Axis:** A3
**Basis:** `direct:` `src/hosted/tools/search.ts` imports `queryBrandKnowledgeCorpus` from a hosted-only module (`../brand-retrieval.js`) with no `src/lib/` counterpart; grep of `src/tools/*.ts` for search-related tool names returns nothing.
**Rationale:** A genuine capability gap, not a quality fix — would reduce token overhead across later-session tools (no more re-reading whole YAML files to answer "what did we learn about tone of voice") and would let the eventual hosted `brand_search` UX be proven locally first, decoupled from network/auth.
**Downsides:** This is new feature work, not hardening — bigger scope than the other 6 ideas, and less urgent since nothing is currently broken by its absence.
**Confidence:** 55%
**Complexity:** Medium-High
**Status:** Unexplored

## Rejection Summary

| # | Idea (representative of cluster) | Frames that raised a variant | Reason Rejected / Deferred |
|---|------|------|-----------------|
| 1 | Local JSONL telemetry fallback (skip UCS contract entirely) | Constraint-flipping | Superseded by survivor #1 once verified the UCS sink already works end-to-end (proven by feedback-fetcher.ts) — no need for a local-only fallback |
| 2 | HANDOFF.md restructuring / generate Current State from `.claudex/packets/` | Pain&friction, Inversion, Constraint-flip, Cross-domain (x2) | Real and well-evidenced, but changes a working daily habit of the human operator's own process — needs Jason's explicit buy-in on format before any agent touches it; noted as a live option, not actioned here |
| 3 | Template-generate `.claudex/prompts/` from `.claudex/packets/` | Inversion, Leverage | Same reasoning as above — process-tooling change belonging to the operator's own workflow, not this codebase's product surface |
| 4 | Consolidate 5 separate limited-client onboarding docs into one generated manifest | Leverage, Cross-domain (x2) | Real observation, but premature — only one client has ever been onboarded; better decided after M002's second pilot (already the roadmap's own plan) reveals whether the docs actually diverge in practice |
| 5 | Reorganize `src/tools/` into physical session subdirectories | Inversion | Wide-blast-radius refactor (41 import paths) for a cosmetic win; survivor #5(c) achieves the same discoverability goal without the churn |
| 6 | `capture_taste` vs `brand_feedback` scope-tier conflation (security) | Cross-domain, Assumption-break | Plausible and worth a quick read of `scope.ts`, but unverified — don't know yet if it's actually wrong; needs a verification spike before it's an actionable idea, not speculation dressed as a finding |
| 7 | `brand_start.ts` (1004 lines) may reimplement canonical compiler logic inline | Assumption-breaking | Same as above — a real code smell (size, self-contained pipeline logic) but the claim that it violates the canonical-compiler pattern is unconfirmed; needs a read-through before action, not proposed as a fix here |
| 8 | Expose `brand_status` (hosted) as cold-start orientation instead of operational health check | Assumption-breaking | Reasonable but lower urgency — exactly one client has ever connected, and it was hand-held via the existing onboarding packet; revisit once M002's second pilot needs to self-orient |
| 9 | `brand_check_compliance` binary gate → expose underlying continuous score | Cross-domain | Speculative — didn't verify whether `content-scorer.ts`'s threshold is already configurable; a real production tool with existing callers, so this needs its own scoped investigation, not a bundled ideation guess |
| 10 | `bin/brandcode-mcp.mjs` missing from `package.json`'s `bin` field | Assumption-breaking | Real 2-minute check, but fails the meeting-test floor on its own — too small to warrant a discussion; fold into whichever unit touches `src/hosted/` next rather than standing alone |
| 11 | 1000x-user / 0-tools thought experiments | Constraint-flipping | Explicitly framed by their own authors as design retrospectives, not proposals — valuable as reasoning exercises, not standalone actionable ideas |
| 12 | Extend `benchmark.yml`'s extraction-audit harness to cover session-flow regression | Leverage | Reasonable "reuse sunk infrastructure" argument, but conflates two different concerns (extraction quality vs. tool-flow regression) that likely deserve separate harnesses — not grounded enough in a specific gap to promote over the smoke-CI idea (survivor #3), which already covers hosted regression |
| 13 | Audit connector code for single-brand-instance assumptions before M002's second brand | Leverage | Reasonable pre-emptive hygiene, but the roadmap's own M002-L04/L05 already plans exactly this discovery as "turn real friction into repair lanes" — duplicates existing roadmap intent rather than adding to it |

**Axis coverage:** A1 (#1, #3), A2 (#5), A3 (#7), A4 (#2, #4), A5 (#6). All five axes covered.

## Recommended next step

Survivors **#1, #2, #3, #4, and #5** are all fully agent-completable today — no DNS, no Vercel access, no production risk, and no dependency on the (already fully-planned, HITL-blocked) production cutover path. They cluster naturally into one hardening pass: close the observability gap, close the governance-integrity gap on the tool lock, close the CI-regression gap, close the contract-drift gap, and close the local-MCP coherence gap. **#6** (backup-operator runbook) is equally cheap but requires Jason's own decision, not code. **#7** (local search) is a legitimate but larger, lower-urgency feature deserving separate focus. Proceeding to `ce-plan` on **#1-#5** as one bundled hardening plan.
