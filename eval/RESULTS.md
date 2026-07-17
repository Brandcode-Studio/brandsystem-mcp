# Published Evaluation Results

Results here come only from actual runs, stamped with package version, model, and date.
Method: [eval/README.md](README.md). Reproduce with `npm run eval` (deterministic) or
`ANTHROPIC_API_KEY=... npm run eval -- --with-llm` (adds first-tool selection).

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
