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
