# Published Evaluation Results

Results here come only from actual runs, stamped with package version, model, and date.
Method: [eval/README.md](README.md). Reproduce with `npm run eval` (deterministic) or
`ANTHROPIC_API_KEY=... npm run eval -- --with-llm` (adds first-tool selection).

> **Scope note (added 2026-07-17):** the 12 first-tool-selection prompts below are a
> **development set**. The tool descriptions shipped in 0.11.1 were iterated against
> these exact fixtures, so the scores measure how well the descriptions fit these
> prompts — not generalization to unfamiliar phrasing. A frozen, source-split holdout
> set (collected from real usage, held privately, committed publicly by hash and
> category distribution before any testing) is planned for 0.12; until holdout scores
> exist, treat the routing numbers as capability evidence, not accuracy claims.

---

## Run: 2026-07-17

- **Package:** `@brandsystem/mcp` 0.11.0
- **Environment:** local (macOS, Node 26), in-memory MCP client
- **Model (first-tool selection):** `claude-haiku-4-5-20251001`

### Deterministic tier — 23/23 PASS

| Metric | Value | Target |
|---|---|---|
| brand_status getting-started budget | 882 tokens | ≤ 950 |
| brand_status with-brand budget (maximal fixture) | 808 tokens | ≤ 850 |
| brand_context standard budget | 387 tokens | ≤ 900 |
| brand_context compact budget | 312 tokens | ≤ 500 |
| Envelope conformance (12 core tools) | 12/12 well-formed | all |
| Second-agent runtime usability | runtime valid vs schema; approval + provenance present; brand_runtime + brand_context succeed on a fresh server | pass |
| Compliance-check accuracy (labeled cases) | **100% (12/12)** | ≥ 90% |

### Model-dependent tier — first-tool selection: 66.7% (8/12)

One API call per prompt: the model sees the user prompt plus the tool list
(names, descriptions, annotations) for the fixture's profile and names the
tool it would call first. Exact-match scoring against acceptable tools.

**Correct (8):** check-social-post, share-with-team, brand-system-state,
subagent-colors-fonts, resume-where-left-off, export-to-cursor,
audit-drafts-folder, fix-wrong-color.

**Missed (4):**

| Fixture | Selected | Expected | Reading |
|---|---|---|---|
| adopt-existing-guidelines ("How do I use my existing brand guidelines with AI?") | `brand_runtime` | `brand_start` | "use" read as consume, not adopt — brand_start's description doesn't carry the adopt-existing-guidelines trigger phrase strongly enough |
| adopt-pdf-guide ("I have a PDF brand guide.") | `brand_status` | `brand_start` | PDF adoption path (guideline_pdf param) not salient in descriptions |
| adopt-figma-library ("Use our Figma library for our brand.") | `brand_brandcode_connect` | `brand_start` | Figma adoption routed to the wrong connector |
| write-linkedin-in-voice ("Write this LinkedIn post in our voice.") | non-tool reply ("I") | `brand_context` / `brand_write` | model answered prose instead of a tool name; counted as a miss |

**Honest readout:** the consumption loop (status/runtime/context/check/export/
clarify) routes correctly; the *adoption* prompts — the exact "how do I use my
brand guidelines with AI?" motivator this package exists for — under-route to
`brand_start` with this (smallest-tier) model. That is a tool-description
finding, not a surface finding, and is tracked for a follow-up description
pass measured against these same fixtures. Results with larger models are
expected to differ; runs will be added here as they are performed.

---

## Run: 2026-07-17 (after the #28 description pass)

- **Package:** post-0.11.0 main (description-only changes, issue #28)
- **Model:** `claude-haiku-4-5-20251001` — same model, same unchanged fixtures
- **Change under test:** rewrote `brand_start`'s description to lead with
  adoption trigger phrases (existing guidelines, PDF guide, Figma library)
  and carry a NOT-for boundary; added "write this in our voice" triggers to
  `brand_context`; added the team-sharing trigger to `brand_brandcode_connect`.

### First-tool selection: 66.7% → 100% (12/12), in two measured iterations

1. **Iteration 1 (91.7%):** all four adoption misses fixed. One NEW miss
   appeared — "make our brand available to my whole team" routed to
   `brand_start`, pulled by the newly added "hosted Brandcode Studio brand"
   phrase. Descriptions interact; fixing one boundary can soften another.
2. **Iteration 2 (100%):** boundary tightened from both sides —
   `brand_brandcode_connect` claims the team-sharing phrases, `brand_start`
   explicitly disclaims them.

Deterministic tier re-run after the changes: 23/23 PASS (unchanged).

**Method note:** fixtures were not modified at any point — descriptions bend
to fixtures, never the reverse. The intermediate regression is reported
because it is instructive: single-description edits are not free, and this
suite is the instrument that catches the interaction effects.

---

## Run: 2026-07-17 (0.13 — negatives + second-agent benchmark, first live run)

- **Package:** post-0.12.0 main (0.13 branch), all five dependency majors merged
- **Model:** `claude-haiku-4-5-20251001` (anthropic adapter)

### Routing — DEVELOPMENT set: 19/19 (12/12 positive, 0/7 false-positive invocations)

The seven new negative cases (prompts where no brandsystem tool applies, with
deliberate vocabulary bait — "design team", "logo quiz", "PDF contract") all
correctly returned NONE. **False-positive invocation rate: 0.0%** — the
headline anti-intrusiveness number. Dev-set caveats apply as before: the 12
positive prompts were tuned against in 0.11.1; the negatives are new but
maintainer-authored. Holdout scores remain the generalization standard.

### Second-agent benchmark: 5/5 job completion

A fresh model given ONLY `brand_context` output (system-prompted as data, not
instructions) produced content for 5 tasks; the real `brand_check` +
`brand_check_compliance` scored every artifact deterministically.

| Metric | Value |
|---|---|
| Job completion (compliance PASS / tasks) | **100% (5/5)** |
| Mean brand_check flags per artifact | 0.00 |
| Token cost per artifact (output / context served) | 144 / 325 |
| Meta-commentary despite content-only instruction | 0/5 |

Honest notes: the `hero-section-css` reply contained no fenced CSS block, so
that task scored text-only (recorded in-results, not hidden); tasks are
synthetic and few; compliance is checker-approximate (rule-based), not human
judgment. The claim this run supports: *a fresh model given only governed
context produced content the deterministic checker accepts, at ~325 context
tokens per task* — the runtime-transfer promise, measured.

---

## CORRECTION + Run: 2026-07-17 (0.13.1 — benchmark truth repair)

**The "5/5 job completion" published above is corrected.** A Codex review found
two defects in the claim (verified against the harness source):

1. "Completion" counted only `brand_check_compliance` acceptance — not the
   task's output contract (the hero task required fenced CSS, produced none,
   and was still counted) and not `brand_check`.
2. The benchmark fixture had no messaging layer, so text tasks were scored
   against **zero voice rules** — `rules_checked: 0` passes vacuously.

The honest label for that run is: *5/5 artifacts accepted by an
effectively-empty compliance checker.* Not job completion.

### Corrected run (same model, governed-voice overlay, honest definition)

Completion now requires: output contract satisfied + `brand_check` pass +
compliance pass + `rules_checked > 0`. The fixture now carries a governed
voice (never-say list, anchors, tone, AI-ism patterns).

| Metric | Value |
|---|---|
| **Job completion (honest definition)** | **20% (1/5) — 2 incomplete (missing fenced CSS), 3 with voice flags** |
| Checker acceptance (previous metric, reported separately) | 80% (4/5) |
| Mean brand_check flags per artifact | 0.60 |
| Token cost per artifact (output / context) | 143 / 417 |

**What the honest number teaches:** the model ignores "return only CSS in a
fenced block" (2/2 markup tasks), and under real voice rules produces
warning-level violations in 3/5 artifacts. These are the actual gaps between
"runtime served" and "job done" — invisible under the old definition.

Machine-readable per-task receipt: `eval/receipts/2026-07-17-llm-receipt.json`
(commit, package, provider/model, per-task contract status, rule coverage,
verdicts, token estimates). Receipts are committed for every published run
from now on.

---

## Run: 2026-07-18 (first fully reproducible receipt — clean tree, v0.14.1)

- **Receipt:** `eval/receipts/2026-07-18T0600-ced7e5e-llm-receipt.json` — tree **clean**, commit `ced7e5e` (= published v0.14.1). Reproducible from source for the first time; supersedes the 0.13.4-era dirty-tree receipt.
- **Model:** `claude-haiku-4-5-20251001`

### Routing — development set: 94.7% (18/19), false-positive invocation 0/7

One stochastic miss: `fix-wrong-color` returned prose instead of a tool name
(the same failure mode seen in the very first run; it passed in between).
Single-run scores on a 19-case set move ±1 case run-to-run — treat trends,
not single points.

### Second-agent: 40% (2/5) under the stricter 0.14.1 definition

Now measured with structural validators active (sentence limits, Subject
shape, fence-only) plus the honest completion gate:

| Task | Status | Why |
|---|---|---|
| social-post-launch | **completed** | contract + structure + check + compliance |
| email-renewal | **completed** | Subject/blank-line/≤3-sentence structure satisfied |
| blog-intro-consistency | failed | brand_check voice flag under governed rules |
| hero-section-css | incomplete | still no fenced CSS despite explicit instruction |
| cta-card-html | incomplete | same |

Checker acceptance was 5/5 — the completion gap is entirely brand_check
voice adherence and fenced-output instruction-following, the two failure
modes every honest run since the correction has named. 20% → 40% across
runs is within single-run noise on 5 tasks; the stable signal is *which*
tasks fail and why.
