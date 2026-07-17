# Agent evaluation suite

Evidence that agents can trust this MCP server — as **fixtures plus a runnable
harness**, not as published claims. This repo ships the methodology and the
inputs; numbers exist only as the output of a run you (or CI) actually execute.

## Honesty policy

- **Results are published only from actual runs**, stamped with the date, the
  package version, the Node version, and — for model-dependent metrics — the
  exact model id used. The harness writes every run to `eval/results/`
  (git-ignored) with those stamps embedded.
- The repository ships **fixtures + harness, not claims**. If you see an
  accuracy number quoted anywhere, it must be traceable to a stated model
  version and run date. Model-dependent numbers vary by model and prompt
  surface and are expected to change between models; they are informational,
  never a gate.
- Fixtures were verified to reproduce their labels before being committed
  (a compliance case that doesn't produce its expected verdict is worse than
  no case at all — it silently corrupts the accuracy metric).

## How to run

```bash
npm run build          # the harness runs against dist/
npm run eval           # deterministic tier (exit 1 on any failure)

# optional model-dependent tier (never run in CI):
ANTHROPIC_API_KEY=... npm run eval -- --with-llm
```

Output: a markdown summary on stdout and a JSON record at
`eval/results/<date>-{deterministic|full}.json`.

## Two tiers

### Tier 1 — DETERMINISTIC (runs in CI, no LLM, gates exit code)

| Check | What is measured | What it claims / does NOT claim |
|---|---|---|
| **Entry-tool response budgets** | Token estimate (~4 chars/token, same `estimateTokens` the server uses) of `brand_status` (empty dir + `brand-complete` fixture) and `brand_context` (standard + compact) responses, against the budgets in `test/response-budgets.test.ts` (950 / 850 / 900 / 500). | Claims: entry tools answer "where am I, what next?" within a bounded token cost on the maximal fixture. Does NOT claim: budgets hold for arbitrarily large real-world brands. |
| **Envelope conformance** | Every tool in the CORE profile (12 tools), called with minimal empty-safe args on a `brand-complete` copy, returns `structuredContent` with `_metadata.what_happened` + `_metadata.next_steps`, and a text payload that parses to the same JSON. Network-dependent tools (`brand_brandcode_auth`, `brand_brandcode_connect`) are called in their network-free modes (`status`, `pull` with no URL) — a graceful, well-formed response (including a structured error payload) **is** the pass condition. | Claims: no core tool crashes or breaks the response contract on a routine call. Does NOT claim: full input-space coverage, or that connector tools succeed against the hosted service. |
| **Second-agent runtime usability** | A fresh copy of `brand-complete` is compiled (`brand_compile`), then a consuming agent reads it via `brand_runtime` + `brand_context` on a new server. Asserts the runtime carries `approval`, `provenance`, and `schema_version` (or the legacy `version` alias), and that the on-disk `brand-runtime.json` validates against `BrandRuntimeSchema`. `brand_compile` runs first because approval/provenance fields are emitted by the compiler (0.9.6+); the checked-in fixture runtime predates them — the scenario models "agent 1 compiles, agent 2 consumes". | Claims: a second agent with zero conversation context can load a trustworthy, schema-valid runtime contract. Does NOT claim: anything about the *quality* of extracted brand values. |
| **Compliance accuracy** | Each labeled case in `fixtures/compliance/cases.json` (12 cases: on-brand and off-brand HTML/text derived from the `brand-complete` fixture's actual governed values) is scored with `brand_check_compliance`; reported as accuracy %, target >= 90%. | Claims: the compliance gate reproduces known-correct verdicts on color, font, and drop-shadow anti-pattern rules. Does NOT claim: coverage of never-say vocabulary rules — the `brand-complete` fixture has no messaging layer, so those checks don't activate against it (see fixture file notes). Does NOT claim: accuracy on subjective voice/tone judgments — the gate is deliberately rule-based. |

Any deterministic failure exits 1. These checks are reproducible: same code,
same fixtures, same numbers.

### Tier 2 — MODEL-DEPENDENT (requires `ANTHROPIC_API_KEY`, never in CI)

| Check | What is measured | What it claims / does NOT claim |
|---|---|---|
| **First-tool selection** | For each case in `fixtures/prompts.json` (12 realistic user asks), the harness builds the actual tool list (name, description, annotations) from a live server with the case's profile (`core` or `full`), sends **one** API call to `claude-haiku-4-5` (model id `claude-haiku-4-5-20251001`, `max_tokens` 100) with the system prompt "You are choosing which MCP tool to call first for the user's request. Reply with ONLY the tool name.", and exact-matches the reply against `expected_tools`. | Claims: given only tool names/descriptions, a small model picks an acceptable first tool N% of the time *on that model, on that date* — a proxy for how well tool descriptions route intent. Does NOT claim: behavior of other models or agent harnesses, or end-to-end task success. Results vary by model version; every reported number is stamped with model id + date. |

Model-dependent results **never affect the exit code** and are excluded from
CI by construction (no key, no calls).

## Fixtures

- `fixtures/prompts.json` — first-tool-selection cases: `{id, prompt, expected_tools, profile, notes}`. `expected_tools` lists every acceptable first call, because several asks legitimately map to more than one tool.
- `fixtures/compliance/cases.json` — labeled compliance cases: `{id, content, expected, reason}`. On-brand cases use the fixture brand's real values (`#2a4494`, `#e8523f`, `#f5a623`, Inter); off-brand cases violate them (off-palette hex/rgb, non-brand fonts, drop shadows — the fixture's one hard anti-pattern).

## Extending

- New compliance case: add it to `cases.json`, then run `npm run eval` and
  confirm the verdict matches your label **before** committing. Never commit a
  case you haven't verified.
- New prompt case: keep `expected_tools` honest — list every first call a
  reasonable agent could defend, not just your favorite.
- Changing a budget number here without changing
  `test/response-budgets.test.ts` (or vice versa) is drift; keep them in sync.
