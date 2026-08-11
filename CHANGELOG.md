# Changelog

## Unreleased

### Security

- Resolve all 18 open Dependabot alerts with in-range lockfile bumps: pdfjs-dist 6.2.108 (arbitrary JS execution on malicious PDF), undici 7.29.0, fast-uri 3.1.5, ip-address 10.5.0 (SSRF/trust-boundary bypasses), hono 4.13.1, @hono/node-server 2.1.0, body-parser 2.3.0, nanoid, postcss. `npm audit` is clean; zod 4 and @types/node 26 majors deliberately deferred as migrations, not security fixes.

### Changed

- Hosted MCP smoke workflow no longer fails every scheduled run while live-proof credentials are unconfigured: strict mode (blocked → failure) now applies only when `BRANDCODE_MCP_SMOKE_URL` and `BRANDCODE_MCP_SMOKE_FULL_KEY` are set; otherwise the run reports blocked in the job summary and stays green.
- VOICE.md example tool count updated from the stale "34 tools" to "12 Core tools, 40+ in the full profile".

## 0.16.1 (2026-07-18)

Truth patch from the 0.16.0 Codex review — three findings, all conceded.

### Fixed

- **Fenced errors keep MCP error semantics**: the #45 error fence returned the structured envelope without `isError: true`, so generic MCP clients could classify a failed execution as success. The fence now returns `isError: true` with the same fenced envelope.
- **brand_context instructions point at real paths**: `next_steps` and the tool description referenced `data.context` / `data.output_contract`, but `buildResponse` spreads data at the top level — the paths didn't exist. Corrected; the client-level test now asserts the referenced paths exist and `data.*` paths don't.
- **A/B receipt-arm documentation corrected**: the RESULTS.md claim that clean/dirty tree stamps distinguish experiment arms was wrong (receipts accumulate as untracked files, dirtying later runs in both arms). Prose corrected without changing scores; receipts now stamp `experiment_arm` (EVAL_ARM env) and a dirty-diff hash for future A/Bs.

## 0.16.0 (2026-07-18)

Robustness release: closes #45 (both 0.14 fuzzing findings) and adds the output_contract affordance. (No 0.15 was released; the 0.15 candidate list shipped here.)

### Fixed

- **extractLogos bounded on hostile pages** (#45, #57): the superlinear cost was one context-scoped `find()` inside logo-cloud detection that cheerio evaluates in seconds on large bodies. Bounded manual walk + candidate caps (10/selector, 15 total) + per-parent verdict cache: 7.3s → ~180ms at 50k elements, linear to 100k. Also fixes a pre-existing detection flaw the walk exposed: a client-logo section anywhere on the page flagged `<body>` as a logo cloud and rejected the real header logo.
- **Handler errors fenced at the tool boundary** (#45, #57): parser throws (e.g. YAML alias-bomb messages that quote hostile input) no longer surface as raw SDK isError text. Every handler is wrapped at the registration choke point; errors return the structured envelope with a templated summary and the original message fenced + truncated.

### Added

- **`output_contract` on brand_context** (#58): deterministic per-task_type delivery rules (single fenced block for code-ui/landing-page; content-only for text tasks) served adjacent to the brand data. Measured honestly in a 6-run A/B: no effect distinguishable from noise at n=3 per arm (40% vs 33% mean completion) — ships as a structural affordance, not a claimed win. Receipts committed; eval/RESULTS.md has the full table.

## 0.14.4 (2026-07-18)

Ships the theme-dimension completion (#35 gap 1, tool/catalog/response layers) to npm consumers, plus the canonical landing-page metadata.

### Fixed

- **Dark-theme colors survive the source catalog** (#54): dark entries get their own catalog field (`colors.<role>.dark`) so a dark surface no longer collides with — or falsely conflicts against — the light surface; catalog metadata carries `theme`, and conflict resolution operates within the (role, theme) slot only.
- **Agents can see the theme dimension** (#55): `all_colors` and `confirmation_needed.colors.all_extracted` in `brand_extract_web` and `brand_start` auto mode now carry `theme` — the files preserved dark/light identity but the response projection dropped it. End-to-end test mocks the `safeFetch` boundary and verifies dark CSS → ColorEntry → catalog → MCP response.

### Changed

- `homepage`/`websiteUrl` point at the live landing page https://www.brandcode.studio/mcp (#52), and the release invariant (tag ↔ version ↔ npm ↔ boundary) now runs automatically at the end of every publish.

## 0.14.3 (2026-07-18)

Installed-package closure: v0.14.2 was tagged before the final CodeQL fix merged, so npm 0.14.2 lacked it. This release ships it to actual consumers, plus two truthfulness fixes.

### Fixed

- **Fixed-point SVG comment removal now reaches npm consumers** (was on `main` via PR #50 but missed the v0.14.2 tag — release-boundary gap caught in review). Interleaved comment fragments cannot reassemble into a live `<!--` after sanitization.
- **Preflight message matches its verdict**: a WARN from unresolved CSS variables no longer says "All checks pass — content is brand-compliant"; it now says what to fix before the content can be verified.
- **Benchmark validators enforce what instructions request**: the blog task ("3 sentences") enforces exactly three (min+max), and the CTA task requires the headline, button/link, and `<style>` block its instruction asks for (`must_match` now supports arrays; `min_sentences` added).

## 0.14.2 (2026-07-18)

Truth-and-security patch: the five 0.14.1 adjacent-edge closures, an SVG beacon fix, and scanner-facing hygiene.

### Security

- **External `url()` references stripped from sanitized SVG** (real finding from adversarial review, CodeQL-adjacent): allowlisted attributes (`fill`, `filter`, `mask`, `clip-path`, ...) may now reference only local fragments (`url(#id)`); external URLs — which would beacon out when brand-report.html is opened — are removed. Hostile-value tests added.
- **Restrictive CSP on generated brand reports** (`default-src 'none'` + inline styles/script + `data:` only): the report is self-contained by design, so even a value that survived sanitization cannot phone home.

### Fixed (0.14.1 adjacent edges — each previously fixed for the tested case only)

- **Publish gate**: keys on the open color clarification itself, not on whether this content tripped a warning — on-palette-against-a-wrong-palette (or colorless) content can no longer earn "safe to publish" while clarify-primary is open.
- **Preflight verdict**: unresolved CSS variables cap the overall result at WARN — unverifiable is not "brand-compliant."
- **Token keys**: full 6-char hex suffix — the truncated suffix reintroduced collisions (#112233 vs #1122ff).
- **Structural contracts**: blog (max 3 sentences) and CTA (must contain a `<style>` block) tasks now carry validators; their previous "structure: satisfied" was vacuous.
- **Receipt filenames**: timestamps to seconds — same-minute runs no longer collide.

### Changed

- Lockfile synced to MCP SDK 1.29.0 (what fresh consumers install).
- Source maps excluded from the tarball (425 → 234 files; they referenced src/ we do not ship). Pack-allowlist test enforces it.
- `SECURITY.md` gains a "package capabilities and why scanners flag them" section (Socket-style heuristics mapped to intentional functions, with verifiable facts).
- CodeQL: two verified false positives formally dismissed with reasons; the SVG family alert closes with this release's fix.

## 0.14.1 (2026-07-18)

Truth-and-trust patch from the Codex 0.13.4 review (all findings verified).

### Fixed

- **The publish gate no longer calls unresolved governance "safe."** While the color-advisory gate is open (unconfirmed primary), `brand_check_compliance` returns `result: "pass_with_advisories"` with `publish_ready: false` and an explicit resolve-clarify-primary instruction — never "safe to publish." `brand_check` stays permissive for iteration; the publish gate does not.
- **Taint closure reaches tokens.json, and keys can no longer collide.** New central `colorTokenKey()` (sanitized slug + short hex suffix): deterministic, collision-safe identifiers for unknown-role colors in runtime records and DTCG token keys; `$description` carries the sanitized display name. Two hostile "blues" no longer overwrite each other, and raw extracted names now survive only in quarantined evidence.
- **Receipts identify reproducible source**: each receipt records the tree state (clean vs dirty-with-count), and filenames carry timestamp + commit so same-day runs never overwrite. The 0.13.4-era receipt was generated against a dirty tree — superseded by a clean-tree rerun receipt.
- **Second-agent structural contracts**: fixture-declared validators (sentence limits, required `Subject:`/blank-line shape, fence-only output) now feed `status: incomplete`; the old presence-only field is honestly renamed `required_inputs`.
- **Dogfood counting excludes test records** (`record_kind: dogfood | test`): the real count is 4, not 5, and only dogfood records advance the 50-capture holdout threshold.

## 0.14.0 (2026-07-17)

Theme-aware color governance, preflight truth, ingestion hardening, and the TypeScript 7 migration.

### Added

- **Theme-aware color roles** (#35 gap 1, option (a) per the issue analysis). `ColorEntry` gains optional `theme: "light" | "dark"`; the merge key becomes `(role, theme)`, so dual-theme palettes no longer collapse — a dark surface stops evicting the light one. Extraction tags themes only on explicit signals (`[data-theme="dark"]`, `.dark` class scope, `prefers-color-scheme: dark`); no value-based guessing. Dark colors compile into optional `identity.colors_dark` in the runtime, a `dark` DTCG token group, their own design-synthesis group + DESIGN.md line, and both theme lanes join the check-engine palette (with hex dedupe). Fully additive: existing YAML/runtimes unchanged. The dual-theme corpus fixture's merge-collapse known_gap is removed — dark surface/text are now hard recall targets.
- **Ingestion robustness suite** (`test/security/ingestion-robustness.test.ts`, 21 tests): CSS/HTML/SVG/YAML/JSON parsers driven with unterminated blocks, parser bombs, alias-amplification YAML, entity payloads, attribute bombs, and multi-MB values — all degrade or throw controlled Errors, none hang (per-test timeouts make a hang fail CI). Findings that need src changes are tracked in #45 (extractLogos superlinear DOM cost; raw parser error text reaching agents).
- **Poisoned-runtime runbook exercised** (`test/security/runbook-exercise.test.ts`): first scripted execution of the documented flow — tamper (never_say injection + approval forgery) → provenance-integrity detection fires on both → runbook response recompiles clean → detection passes. The runbook's exercise log has its first row; live-client drill honestly noted as still pending.

### Fixed

- **Preflight resolves same-document CSS variables** (#43): `var(--x)` and `var(--x, fallback)` substitute from the document's own definitions before rule checks (balanced-paren parser, cycle guard); unresolvable variables surface as a new info-severity `V-UNRESOLVED` check instead of false non-brand-font/color violations. **Bonus real bug**: the font-family capture group aborted at double quotes, so quoted families (`"Inter", sans-serif`) were silently never checked.
- **Preflight recognizes `<img>` logos** (#43): filename patterns (logo/wordmark/logomark/brandmark) or alt/aria-label matching the client name count as logo evidence.

### Changed

- **TypeScript 7.0.2** (native compiler). Migration verified by same-source dist-diff against 5.9: emitted runtime JavaScript is byte-identical; the only declaration differences are zod-inferred property ordering. Resolves the parked Dependabot #18 investigation.

Tests: 922 → 986.

## 0.13.4 (2026-07-17)

Field-report release: fixes from the first real second-agent run against a live brand (Colovore, #41-#43).

### Fixed

- **Uncertain primaries can no longer poison the check loop** (#41). When extraction crowns an achromatic primary while chromatic candidates exist (or the primary is below high confidence, or missing), both `brand_compile` and `brand_start` auto mode now generate a stable, targetable high-priority `clarify-primary` item listing the candidates. `brand_clarify` resolves it (bare hex, hex-in-text, or color description) — re-roling the chosen color to confirmed primary and demoting the old one sensibly. While it is open, `brand_check`/`brand_check_compliance` **soften color verdicts to advisory warnings** ("primary color unconfirmed — resolve clarify-primary") instead of failing the brand's own true colors. A human-confirmed primary — even an achromatic one — never re-fires the item.
- **Unknown arguments now teach instead of swallowing** (#42): `{url: ...}` returns `Unknown argument: "url" (did you mean "website_url"?)` with the full valid-argument list, centrally in `safeParseParams`.
- **Core-profile guidance is now profile-aware** (#42): `next_steps` referencing full-only tools are annotated with the `--profile=full` restart instruction instead of leading agents into unknown-tool errors.
- **Alpha-hex artifacts excluded from extraction** (#42): `#0000`/8-digit low-alpha hexes are dropped as non-brand; opaque-enough short RGBA forms normalize to their RGB (white at 40% is white, not "Red").
- **`brandcode_onramp` appears once per session** (#42) instead of on every response.

### Added

- Four dogfood captures from the field run (source: colovore) — the first real-usage entries toward the 0.12 holdout.

Preflight var()-resolution and `<img>` logo detection are tracked in #43 for 0.14.

## 0.13.3 (2026-07-17)

Benchmark truth + taint closure repair (Codex review findings, all verified).

### Fixed

- **Second-agent "job completion" redefined honestly.** Completion now requires: output contract satisfied (required CSS/color inputs actually present in the reply) + `brand_check` pass + compliance pass + `rules_checked > 0`. Missing required inputs → `incomplete`; zero rules → `unscored` (never PASS). Checker acceptance reports separately. **Corrected result: 20% (1/5), down from the previously published 5/5** — the old number counted an empty-checker acceptance as completion. Correction published in eval/RESULTS.md with the original claim annotated, not erased.
- **Vacuous compliance passes closed:** the benchmark fixture now carries a governed-voice overlay (never-say, anchors, tone, AI-ism patterns), so text tasks measure brand transfer instead of checker emptiness.
- **Hostile color names sanitized at every agent-facing compile sink** (taint closure): runtime color keys for `role: unknown` (`runtime-compiler.ts` — served directly by `brand_context`), design-synthesis color signals, and `brand_write` visual briefs now route through `cleanColorName` (instruction-shape replacement included). Raw extracted names remain only in quarantined `core-identity.yaml` evidence. New adversarial test proves a hostile unknown-role name cannot become a runtime key.

### Added

- **Committed machine-readable run receipts** (`eval/receipts/`): commit hash, package version, provider/model, per-task output-contract status, rule coverage, verdicts, and token estimates for every published LLM run — independently inspectable evidence.

## 0.13.2 (2026-07-17)

### Fixed

- Cline installation now delegates to `cline mcp install` so Cline owns its evolving MCP settings schema. The 0.13.1 direct entry used the legacy `{ command, args }` shape, which Cline CLI 3.0.44 did not attach.

## 0.13.1 (2026-07-17)

### Added

- Cline-native installation via `npx @brandsystem/mcp install --client cline --write`.
- `llms-install.md`, a compact agent-readable setup and verification contract, plus a dedicated 400 x 400 marketplace icon.

## 0.13.0 (2026-07-17)

Second-agent benchmarks, extraction quality fixes, and the dependency majors — individually triaged.

### Added

- **Second-agent benchmark** (`npm run eval -- --with-llm --scenario second-agent`). Measures the product's core promise: a fresh model given ONLY `brand_context` output (system-prompted as data, not instructions) produces content for 5 task fixtures; the real `brand_check` + `brand_check_compliance` score every artifact deterministically. Metrics: job completion rate, mean flags per artifact, token cost per artifact, meta-commentary count. First live run (claude-haiku-4-5): **5/5 compliance PASS, 0 flags, 144 output / 325 context tokens per artifact** (eval/RESULTS.md).
- **First live negative-routing run:** false-positive invocation rate **0.0% (0/7)** on vocabulary-baited prompts — the anti-intrusiveness number, now measured.
- `--scenario` flag (routing | second-agent | all) so LLM scenarios run independently.

### Fixed (extraction gaps from #35, each flipping labeled corpus expectations)

- **Dark chromatic colors can now be primary candidates.** `isChromatic()` rewritten to HSL (saturation ≥ 25%, lightness 8–90%): dark navy/forest/burgundy brands extract correctly; true near-blacks/whites/grays still excluded. Frequency still decides promotion.
- **Generic web-safe fallbacks (Arial et al.) no longer leak** from font stacks — position-aware: dropped only as fallbacks (stack index > 0); a brand genuinely using Arial first still extracts it. Corpus font-precision threshold restored 0.6 → 0.95.
- **Instruction-shaped extracted color names are replaced** with generated color names (URL/imperative/system-prompt/exfiltration patterns, >24-char multi-word prose) at both extraction-time naming and display cleaning; 48-char flatten kept as backstop.
- Merge-collapse (one color per role, dual-theme loss) analyzed and deferred with a schema recommendation on #35 — a `(role, theme)` merge-key decision, not a patch.

### Changed

- **Dependency majors, individually triaged:** vitest 4.1, actions/checkout v7 + setup-node v7 (immutable SHA re-pins verified), puppeteer-core 25 (8-method stable API surface reviewed), pdfjs-dist 6 (gated by the real end-to-end PDF parse test in CI). TypeScript 7 investigated — the full project typechecks clean under 7.0.2 — and deliberately parked for a standalone 0.14 PR with dist-diff review (findings on PR #18).

Tests: 859 → 896 passing.

## 0.12.0 (2026-07-17)

Evidence release: unbiased evaluation infrastructure, real-transport testing, labeled extraction quality, and the end-to-end job scenario. No tool-surface changes.

### Added

- **Holdout evaluation protocol.** The 12 routing prompts are now explicitly the public *development* set; holdout sets live outside the repo, frozen with canonical serialization, and committed publicly by SHA-256 + case count + category distribution in `eval/HOLDOUT-COMMITMENTS.md` **before** testing (protocol: source-split, description authors see the dev set only, separate evaluator holds the prompts, reveal-and-rotate optional). Harness accepts `BRANDSYSTEM_EVAL_HOLDOUT=<path>`; holdout results print separately, stamped with the commitment hash.
- **Negative routing cases + false-positive invocation metric.** 7 dev-set cases where the correct answer is invoking NO brandsystem tool (with deliberate vocabulary bait: "design team", "logo", "PDF contract"). False-positive invocation rate reports as its own headline metric — over-triggering is the fastest way for an MCP server to feel intrusive.
- **Deterministic end-to-end job scenario** in the eval harness: adopt → compile (engineered low-confidence value) → clarify every item with answers scripted from fixture ground truth → verify promotion to `human_confirmed_local` → recompile → `brand_context` → `brand_check` passes an on-brand snippet. Six steps, all gating the deterministic exit code. This measures a *completed job*, not just first-tool choice.
- **Provider/model adapters** for the LLM tier: anthropic, openai, and openai-compatible base-URL override; model via `--model`/`BRANDSYSTEM_EVAL_MODEL`; results stamp provider + model + set.
- **Real stdio-transport test** (`test/stdio-transport.test.ts`): spawns `dist/index.js` as a child process via `StdioClientTransport` — exact core tool set over the wire, structuredContent envelope on a real call, clean process exit.
- **Deterministic extraction quality corpus** (`test/fixtures/extraction-corpus/`, 76 release-gating tests): six frozen labeled fixtures (clean semantic, messy inline, ambiguous palette, dual theme, logo variants, hostile) scored for precision/recall against expected identity, roles, confidence tiers, logo choice, SVG sanitization, and clarification outcomes. Four real extractor gaps are labeled `known_gap` in the fixtures rather than hidden behind loose thresholds — tracked in #35.
- **Dogfood prompt capture** (`eval/dogfood/`, `scripts/dogfood-capture.mjs`): privacy-safe JSONL capture to a private file outside the repo (intent, redacted prompt, source key, tools, outcome, friction, repair — never brand content), with a local denylist that refuses unredacted brand names. Real captured prompts are the source for the 0.12+ holdout.
- **Per-tool output schemas** for `brand_status`, `brand_runtime`, and `brand_check` (joining `brand_context`) — four of twelve core tools now typed beyond the shared envelope.

### Changed

- **Extraction audit split into two lanes.** `scripts/extraction-audit.mjs` → `scripts/extraction-canary.mjs`: explicitly a non-blocking live-yield canary (ten sites, per-site errors reported not thrown, real package version in metadata instead of hardcoded 0.3.12, `--limit`/`--compare` modes). benchmark.yml now downloads the previous run's artifact and prints per-site yield deltas in the job summary — warn-only, never failing. Release gating moved to the deterministic corpus in `npm test`.
- yaml 2.8.3 → 2.9.0 (minor). Majors (TypeScript 7, PDF.js 6, Puppeteer 25, Vitest 4, Actions v7s) deliberately not bundled — individual triage per the 0.12 plan, TS 7 as its own migration investigation.

## 0.11.3 (2026-07-17)

### Fixed

- Keep the MCP Registry description within its 100-character publishing limit and enforce that constraint in the release metadata gate.

## 0.11.2 (2026-07-17)

Agent onboarding and discovery release: a first-class Codex install path, clearer protocol guidance, and intent-led package metadata.

### Added

- **Codex installer path.** `npx @brandsystem/mcp install --client codex --write` delegates to the official `codex mcp add` command; dry-run remains the default.
- **Protocol-level agent instructions.** MCP initialization now explains the adopt → resume → contextualize → check → export workflow, the untrusted-data boundary, and when not to invoke Brandsystem.

### Changed

- Unknown `BRANDSYSTEM_PROFILE` values now preserve the 12-tool Core default instead of silently expanding to the full authoring surface.
- npm and MCP Registry descriptions now lead with the user intent “use existing brand guidelines with AI,” add agent-oriented discovery terms, and point to a working package homepage instead of the removed `/mcp` route.
- README and `llms.txt` now put the shortest agent onboarding path before the deeper architecture.

## 0.11.1 (2026-07-17)

Patch release: the first eval-driven improvements, plus a parser fix the eval suite surfaced.

### Fixed

- **Compliance parser: font-family extraction no longer bleeds across joined CSS chunks** (#26, PR #27). A `font-family` declaration without a trailing semicolon could consume text past the newline where style chunks are joined, misreading fonts during compliance checks. Found while verifying eval fixtures reproduce.

### Changed

- **Adoption prompts now route to `brand_start`** (#28, PR #30). Description-only pass measured against the unchanged eval fixtures with claude-haiku-4-5: first-tool selection 66.7% → 100% in two iterations (the intermediate regression — team-sharing prompts pulled toward brand_start — is documented in eval/RESULTS.md). `brand_start` leads with adoption triggers (existing guidelines, PDF guide, Figma library) plus NOT-for boundaries; `brand_context` claims "write this in our voice"; `brand_brandcode_connect` claims team sharing.
- **eval/RESULTS.md reframed**: the 12-prompt routing score is explicitly labeled a development set (descriptions were iterated against these fixtures); a source-split, hash-committed private holdout is planned for 0.12. Routing numbers are capability evidence, not generalization claims.

## 0.11.0 (2026-07-16)

Reliable agent interoperability: protocol-native structured outputs, enforced token budgets, and a public agent-evaluation suite.

### Added

- **Structured outputs on every tool.** All responses now carry MCP `structuredContent` (mirroring the text payload, which remains the fallback), and every registration declares the response-envelope `outputSchema` (`{_metadata: {what_happened, next_steps}, ...data}`) via a single registration choke point — the SDK validates every response against it. `brand_context` ships the first stabilized per-tool schema as the exemplar; others specialize over time via `TOOL_OUTPUT_SCHEMAS`.
- **Enforced token budgets** (`test/response-budgets.test.ts`). Budgets are token estimates (~4 chars each) set from measured actuals with headroom; the tests fail on breach and the numbers are not to be raised without a deliberate decision. `brand_status` getting-started: ≤950; recurring with-brand status: ≤850 (measured 808 on the maximal all-sessions fixture); `brand_context` standard ≤900 / compact ≤500.
- **Public agent-evaluation suite** (`eval/`, `npm run eval`). Fixtures from real user prompts (first-tool selection), labeled compliance cases derived from the test brand, and a runnable harness with two tiers: deterministic (CI-safe — budgets, envelope conformance, second-agent runtime usability, compliance accuracy) and model-dependent (first-tool selection via the Claude API, opt-in, results stamped with model + date). The repo ships fixtures and methodology; results are published only from actual runs.

### Changed

- **Compact JSON serialization** for all tool responses (~25% token reduction on every response at zero information loss; agents parse, they don't read indentation).
- **No more mid-JSON truncation.** Oversized responses now elide their largest data values behind a structured `response_overflow` marker (with original size and retrieval hint) — the payload stays valid JSON at every size.
- **`brand_status` slimmed** — 1830 → ~880 tokens (getting-started) and 1567 → ~810 (maximal with-brand): removed the 30-line tool list (agents have `listTools`), compressed session overviews, moved the `tool_sessions` taxonomy to the getting-started response only, and reduced structured recovery data to readiness (formatted guidance stays in `status`, top actions in `next_steps`).
- **Taint-audit carryovers closed:** `brand_write` responses carry a `brief_provenance` evidence envelope (approval level, `instructional: false`, data-not-commands note); `cleanColorName` flattens control characters and caps length on extracted color names (hostile CSS custom-property/Figma swatch names can no longer smuggle multi-line content into VIM/exports/DESIGN.md); interaction-policy rule presentation reviewed — covered by approval surfacing + the provenance-integrity detector, no further change.

### Migration notes

- Tool response text is now compact JSON (no indentation). Anything parsing it is unaffected; anything regex-matching pretty-printed layout must switch to parsing.
- Recurring `brand_status` calls no longer include `tool_sessions`; read it from the getting-started (no `.brand/`) response or `listTools`.

## 0.10.0 (2026-07-16)

Agent-first product surface. One breaking-by-default change: the server now registers the **Core profile** (12 tools) unless the full authoring surface is requested.

### Added

- **Core tool profile (default).** The server registers 12 tools covering the complete value loop — adopt (`brand_start`), orient (`brand_status`), consume (`brand_runtime`, `brand_context`), verify (`brand_check`, `brand_preflight`), deliver (`brand_report`, `brand_export`), review/promote (`brand_clarify`, `brand_compile`), and connect (`brand_brandcode_auth`, `brand_brandcode_connect`). The full 44-tool authoring surface is available via `BRANDSYSTEM_PROFILE=full` or `--profile=full` in the MCP config args. Tests pin the core set exactly and prove full is a strict superset with no tool renamed or removed.
- **`brand_context` — task-scoped deterministic context selection.** `task_type` (enum) maps to runtime sections through a fixed table; `audience` matches governed personas by normalized comparison; `budget: compact` returns identity + hard rules only. Returns `matched_selectors` (what was chosen and why) and an explicit `no_governed_match` instead of silently falling back. No model-side inference — judgment stays with the calling agent.
- **Promotion gate.** Approval levels: `provisional_extracted` → `human_confirmed_local` (conferred when a human resolves the final clarification via `brand_clarify`) → `production_approved` (conferred **only** by Brandcode Studio, per the Phase 0 lock reserving canonical approval). The state is bound to a sha256 fingerprint of the source YAMLs — any re-extraction or edit demotes the effective level back to provisional at the next compile. Exports stamp the level-appropriate provenance notice; every level keeps the data-not-instructions clause.
- **Provenance-integrity detector** (`brand_audit`). Fails when the runtime claims an approval level the stored state doesn't support, or when any policy-bearing field (anti-patterns, never_say, ai-ism patterns, tone, anchor terms) diverges from a fresh compile of current sources — catching tampered or stale runtimes. This is the detection mechanism the poisoned-runtime response runbook referenced.
- **`brand_start` universal adoption.** New source params: `guideline_pdf` (routes through `brand_extract_pdf`; path validated symlink-safe inside the working directory), `figma_file_key`, `brandcode_url` (routes through the connector). Interactive mode now runs a read-only depth-1 discovery scan of the working directory (guideline PDFs, token files, asset folders) and returns a `source_assessment` plus a `privacy` explanation of exactly what leaves the machine, before anything runs.
- **CLI helpers:** `npx @brandsystem/mcp doctor` (Node version, profile, `.brand/` state, credential permissions, runtime approval, client configs — local-only checks), `install --client <claude-code|cursor|windsurf|claude-desktop>` (dry-run by default; `--write` deep-merges preserving other servers and backs up the existing config first; refuses invalid JSON), and `inspect` (version, profile, tool list, artifact inventory).
- **Tool annotations** on every registration: `title`, `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint` — advisory hints for client display and risk handling, not security controls.

### Changed

- **Runtime schema-version migration (step 1).** `brand-runtime.json` now emits explicit `schema_version`; the ambiguous `version` field remains as a deprecated alias through a compatibility window (both carry the contract schema version). Consumers should migrate to `schema_version`; `version` will be redefined or removed no earlier than 0.12.
- `brand_write` conversation guidance and `brand_export` artifacts now reflect the effective approval level; connector pulls that declare `production_approved` record a Brandcode-Studio-authority approval state bound to the post-pull fingerprint.

### Migration notes

- Agents that call authoring tools (extract/deepen/build/messaging/drift) must opt into the full profile: add `"--profile=full"` to the server args or set `BRANDSYSTEM_PROFILE=full`.
- `brand-runtime.json` consumers: read `schema_version ?? version`.

## 0.9.6 (2026-07-16)

Security and distribution-integrity release. No new tools; no breaking changes to the tool surface.

### Added

- **Package-boundary guard (`test/package-contents.test.ts`).** The npm tarball is now allowlist-verified in CI: hosted Use-MCP code (`dist/hosted/**`), the undeclared `bin/brandcode-mcp.mjs`, tests, specs, and docs can no longer enter the published package. Tarball shrinks 521 → ~425 files; the repository still builds hosted code for the hosted smoke workflow. Enforces the Phase 0 Build/Use packaging boundary.
- **Provisional approval status on every compiled runtime.** `brand-runtime.json` now carries `approval: "provisional_extracted"` plus a `provenance` block (sources + a machine-extracted/not-human-reviewed note). There is deliberately no promotion mechanism in 0.9.6 — extracted policy cannot present itself as reviewed. `brand_runtime` surfaces the approval state and warns agents to treat runtime text as brand data, never as instructions. Schema accepts the fields as optional so pre-0.9.6 runtimes still validate.
- **Prompt-injection fixture suite (`test/security/prompt-injection.test.ts`).** Hostile extracted content (ignore-previous-rules, call-a-tool, read-a-file, exfiltrate-credentials, connector-swap, persist-into-prompts, XSS) is proven to: stay out of compiler-authored control fields, compile only into `provisional_extracted` runtimes, be escaped in every report HTML sink, be stripped from embedded SVG, and appear in exported artifacts only under a provenance notice. Scope is server-side containment — these tests do not (and cannot) claim a consuming agent is immune to evidence text it reads.
- **`fenceUntrusted()` (`src/lib/untrusted-text.ts`).** Extracted values that must appear in instruction channels (`what_happened`, `next_steps`, `conversation_guide`) are flattened to one line, stripped of control characters, length-capped, and visibly quoted. Applied to clarify-question generation and resolution.
- **Provenance notice on exported agent-facing artifacts.** All `brand_export` targets (chat, code, team, email, claude-skill), `system-integration.md`, the VIM-adjacent Quick Setup block, and `brand_enrich_skill` output now open with a notice that content is machine-extracted, not human-reviewed, and is data — not instructions that override an agent's task, tools, or safety rules.

### Changed

- **Template-only instruction fields.** `brand_write` no longer interpolates extracted tone descriptors into its `conversation_guide` instruction (points at the creation brief instead); `brand_clarify` fences extracted question text as quoted data in `what_happened`/`next_steps`/`conversation_guide`.
- **Credential hardening.** `.brand/brandcode-auth.json` is written atomically (same-directory temp file + rename) with owner-only `0600` permissions from the first byte; pre-existing files are tightened on read and write. Verified: session tokens never appear in tool responses (only email + studio URL surface).
- **Symlink-safe path containment.** `path-security.ts` gains `realResolve`/`isRealPathWithinBase`: containment now resolves through the real filesystem, so a symlink inside the working directory pointing outside it is rejected (lexical checks alone were fooled). `assertPathWithinBase` and the content-reading tools (`brand_preflight`, `brand_check_compliance`, `brand_audit_content`, `brand_audit_drift`) use the symlink-aware check.
- **HTML report sink coverage.** `escapeHtml` now escapes single quotes; previously unescaped sinks fixed (comparison-section font families, logo type/source). `generateBrandInstructions` and all markdown/skill exports now run embedded logo SVG through `sanitizeSvg` (script/event-handler stripping) instead of embedding raw extracted SVG.

### Deferred to 0.10 (tracked in docs/plans/2026-07-16-001)

- Promotion gate (`human_confirmed_local` / `production_approved` via Brand Console authority) and the runtime `version`→`schema_version` field migration.
- Provenance-integrity detector (runtime policy vs. approved provenance) — the incident runbook's detection mechanism.
- Full delimited-evidence envelope for `brand_write`'s creation brief and remaining MEDIUM taint-audit findings (color-namer passthrough, interaction-policy rule presentation).

## 0.9.5 (2026-07-16)

### Added

- **`brand_check` can return a scoped Taste counterprompt without faking semantic compliance.** Optional `artifact_kind` / `surface` context selects only matching approved Taste Guidance for revision. The ordinary text/color/font/CSS verdict stays independent, unavailable guidance fails soft, and every response labels Taste semantics `not_evaluated`.
- **External AI tools receive an explicit Taste workflow.** Hosted full/voice runtime responses tell agents to apply only relevant approved Taste Guidance, honor fresh-direction requests, and offer review-only `capture_taste` only after a concrete user judgment when the MCP key carries capture scope. Read-only keys never imply capture is available, and passive capture remains prohibited.
- **Reviewed Taste Memory now closes the hosted MCP loop.** `capture_taste` accepts artifact/surface/runtime context and returns the Brandcode review route while remaining queue-only. Approved Brandcode Taste Guidance is projected into full and voice `brand_runtime` slices and appears as high-confidence `review_evidence` in `brand_search`; pending or quarantined captures never reach agents, and guidance failures remain fail-soft for ordinary runtime and search reads.
- **Hosted AgentRun telemetry is live for every hosted tool call.** `createHostedServer` now wraps `server.tool()` registration with a single telemetry choke point (`wrapServerWithTelemetry`), so each of the 9 hosted tools POSTs an AgentRunHistoryEntry-shaped record to UCS (`surface: mcp-hosted`) with outcome classification (ok/auth_error/upstream_error/tool_error), latency, keyId, and requestId — without editing any individual tool file. Fire-and-forget and fail-open: the POST is registered with Vercel's `waitUntil()` so a Fluid Compute isolate freeze can't drop it mid-flight, carries a 15s timeout, never blocks or alters the tool's real MCP response, and never logs the raw bearer or service token. `brand_status`, `brand_feedback`, and `brand_history` now derive their telemetry posture from the one shared `HOSTED_AGENT_RUN_TELEMETRY_STATUS` constant instead of three hand-written literals.
- **Scheduled hosted smoke CI (`.github/workflows/hosted-smoke.yml`).** Runs `npm run smoke:hosted-mcp` against the live staging deployment daily and on manual dispatch, with a job summary. Deliberately not a PR-blocking check — it exercises a live endpoint with real secrets.
- **Hosted capability-surface lock test (`test/hosted/registrations.test.ts`).** Locks the 9-tool surface at the source-file level: exact tool count (not a floor), per-file `server.tool(` call-site counts, and the file inventory itself — a second registration sneaking into an existing hosted tool file now fails CI instead of silently growing the locked surface.
- **UCS contract fixture test (`test/connectors/brandcode-contract-fixture.test.ts`).** First coverage of `fetchHostedBrandPackage`, plus hosted `brand_runtime`/`brand_search`/`list_brand_assets` consuming a realistic redacted UCS pull-response fixture end-to-end — including a regression-guard test proving the suite catches UCS shape drift (the historical bug class where the contract was only ever tested against self-authored mocks).
- **`HOSTED_TOOL_ORDER` single source of truth (`src/hosted/tool-order.mjs`).** `registrations.ts` and `scripts/hosted-mcp-smoke.mjs` now import one list instead of maintaining hand-synced copies (`tsconfig.json` gains `allowJs` so tsc ships the `.mjs` into `dist/`).
- **Local `brand_status` now returns a `tool_sessions` taxonomy** grouping all 43 registered tools by session/purpose, cross-checked against the live registry by test. `brand_extract_web`/`brand_extract_site` descriptions carry reciprocal NOT-for disambiguation, enforced by a new description-quality test gate (verb-start, sub-300-char first sentence, curated ambiguous pairs).
- **`brand_history` malformed-UCS-body responses now carry `error: "ucs_history_contract_error"`** so AgentRun telemetry classifies a degraded 200-with-garbage-body as `upstream_error` instead of recording it as a healthy call. The hosted router also now constructs the per-request server inside its try/catch, so a registration-time failure degrades to one scoped `internal_error` response instead of an unhandled platform exception across all brands.
- **Hosted `capture_taste` contribute tier.** The hosted Brandcode MCP now includes `capture_taste` behind an explicit `capture` scope. It captures an attribute-level taste judgment (candidate_ref + verdict + required attribute_reason), posts through the UCS `/runtime/taste-capture` route with hosted service authority, and **queues candidates for human review — it never promotes canon or adds anything to the brand.**
- **Typed knowledge/retrieval contract on the connector (`src/connectors/brandcode/knowledge-types.ts`).** Models the `brandKnowledgeCorpus`, `retrievalManifest`, and structured `brandInstance` governance arrays (narratives, proof points, application rules, brand phrases, stats, strategy moves) that UCS ships in the compiled pull package, mirroring `app/tools/lib/brand-instance-types.ts`. `BrandPackagePayload` is now a typed-but-open interface (known fields modeled, index signature retained) instead of a bare `Record<string, unknown>`, so the hosted tools consume real types while staying tolerant of unknown/new fields.

### Changed

- **Pinned outbound fetches now enforce response limits while bytes are still on the socket.** HTML,
  CSS, messaging, site-discovery, and logo fetches reject oversized declared or streamed bodies
  before buffering them in memory. Redirect bodies are canceled before the next validated hop. This
  closes a public-server memory-exhaustion path but does not claim browser worker or network-namespace
  isolation.
- **Hosted runtime ingress now consumes the UCS-owned `brandcode-runtime-contract/v1`.** The external adapter is pinned to the MCPX-5A fixture bundle, preserves explicit Full Brand Runtime, Official Brand, Production-Approved Asset, selected-kit, exploratory-kit, and reviewed-Taste authority objects, negotiates compatible `v0.9` producers with a warning, tolerates unknown fields, and fails incompatible or semantically incomplete contracts without legacy fallback.
- **Hosted asset delivery now returns usable package URLs only from trusted Brandcode HTTPS origins.** Public Brandcode package endpoints remain intact for agents to consume; private-looking and untrusted third-party URLs stay blocked and redacted.
- **Visual extraction now keeps Chromium sandboxed and validates every network request.** Single-page and representative-site extraction reject loopback, private-network, cloud-metadata, and unsupported-protocol navigations for both main documents and subresources. Constrained containers must explicitly set `BRANDSYSTEM_UNSAFE_DISABLE_CHROME_SANDBOX=1` to accept the sandbox downgrade.

- **Hosted MCP runs are now first-class in UCS telemetry via the `mcp-hosted` surface.** UCS added `mcp-hosted` to its `AgentSupportSurface` enum (paired UCS change), so the MCP now tags hosted `brand_feedback` history writes with `surface: "mcp-hosted"` (was the placeholder `"runtime"`) and `brand_history` filters by that surface. The MCP no longer sends `provider=mcp` on the history query — UCS models provider as the downstream model (openai/claude/gemini), not the transport, so a `provider=mcp` filter matched nothing; surface is the correct discriminator. Closes the telemetry-attribution gap where MCP-originated runs were unfindable.
- **Hosted `brand_search` now ranks UCS's compiled knowledge corpus** instead of doing an ad-hoc keyword scan over `brandInstance` arrays. When the pull package carries `brandKnowledgeCorpus` + `retrievalManifest` (every compiled brand), search runs the same retrieval engine UCS uses for Brand Console — mode-aware kind boosting, approval/confidence weighting — and returns hits with `citation`, `source_class`, and `confidence`, plus `coverage`, `blind_spots`, and `warnings` so answers can be hedged. New optional `mode` param (`fact_lookup` default, `doctrine_retrieval`, `asset_retrieval`, `evidence_retrieval`, `coverage_discovery`). Packages without a corpus fall back to the prior keyword scan (tagged `retrieval_engine: "keyword_fallback"`), so nothing regresses. URL-bearing citations/excerpts stay redacted for custody safety.
- **Hosted `brand_runtime` now populates the `voice` and `strategy` slices** (previously hardcoded `null`, deferred as "Milestone B"). `voice` is built from the governance model UCS actually serves — prose `verbalIdentity` + `perspective` + deployable `brandPhrases`; `strategy` from `narratives` + `applicationRules` + `proofPoints` + `strategyMoves` summaries with counts. Both stay `null` when the brand carries no governance. `visual` remains `null` by design: the hosted `brandInstance` carries identity tokens (already mapped) but not the composition/anti-pattern structures the local compiler's `RuntimeVisual` models, so there is nothing honest to fill it with.
- **Inbound capture moved out of the public Build MCP.** Public stdio `@brandsystem/mcp` no longer registers `capture_taste` or `run_research_recipe`. Local Build remains the author/compile/onramp MCP; hosted Brandcode MCP owns per-brand use/contribute runtime actions. Research recipe execution is intentionally held for steward automation rather than a per-creator hosted tool.
- **GitHub Actions Node 24 compatibility.** CI now tests Node 20, 22, and 24; publish and benchmark workflows run on Node 24; first-party GitHub actions were updated to Node 24 runtime majors.
- **Hosted MCP now validates per-brand keys against UCS (`buildUcsValidator`).** The hosted auth boundary previously had only the local env-seeded validator (`BRANDCODE_MCP_TEST_KEYS`). It now POSTs the bearer key to the UCS `/api/brandcode-mcp/keys/validate` endpoint with the hosted service token as the caller credential, and maps the `{valid, keyId, environment, scopes, allowedSlugs}` response onto `BrandcodeMcpAuthInfo` (paired UCS change: the Blob-backed key registry shipped on the UCS side). Resolution order in `authorizeRequest`: injected `validateToken` → env-seeded keys when `BRANDCODE_MCP_TEST_KEYS` is set (local dev / staging smoke) → UCS validation (default in production). The validator fails closed — any upstream, caller-auth, or parse failure returns null (→ 401) and never logs the token — does a cheap prefix/environment gate before any round trip, and defensively parses the upstream response. Slug binding stays in `authorizeRequest` (so a key without the requested slug still yields a precise 403 `slug_forbidden`), so the key is sent to UCS without the slug.
- **Production hosted MCP no longer lets env-seeded test keys silently override UCS validation.** `BRANDCODE_MCP_TEST_KEYS` remains the default staging smoke path, but production now uses UCS validation unless the runtime explicitly opts into `allowEnvTestKeys` for a controlled smoke test.

### Changed

- **Tool descriptions sharpened across 6 tools** to improve agent disambiguation. `brand_resolve_conflicts` (was the lowest-scoring tool on Glama at 3.6/5): now describes both modes, when to call, what each returns, and how it relates to brand_audit. `brand_check` and `brand_check_compliance` now have crisp, mutually exclusive descriptions: `brand_check` is the inline linter you call WHILE writing (one or more fields, fast pass/fail per input); `brand_check_compliance` is the publish-time gate (single PASS/FAIL on a finished piece, optional strict mode). `brand_build_journey`, `brand_export`, and `brand_feedback` rewritten with explicit trigger phrases, mode/target enumerations, and NOT-for clarifications.
- **`brand_compile_messaging` interview returns ONE section at a time** instead of all three. The conversation_guide always said "work through ONE section at a time" but the response shipped perspective + voice + brand_story upfront — ~10K chars per call, of which the agent could only act on the first. Now returns the first missing section with a `remaining_sections` list and a section-targeted intro. Response size dropped from ~9.9K to ~3.2K. Calling `mode='interview'` again after each `mode='record'` returns the next section. No schema break — agents that read the existing `interview` array still work because the agenda is still under `interview`, just narrowed.
- **`brand_build_journey` interview drops the duplicate `defaults_full` field** and trims the conversation_guide. The response previously emitted both a stripped `default_stages` table and a full `defaults_full` array containing the same 4 stages with extra fields the server already auto-applies on `mode='record'` with no answers. Customizable field shape stays in the conversation_guide. Response size dropped from ~5.9K to under 5K.

## 0.9.2 (2026-04-21)

### Added

- **`brand_enrich_skill` tool (S010 N-2 PR3).** Takes a Claude Design-style auto-generated `SKILL.md`, diffs it against `.brand/governance/` YAML (narrative-library, valid-proof-points, anti-patterns, application-rules, taste-codes), and returns an enriched `SKILL.md` with missing governance content injected, cited by ID, and grouped into canonical sections. Additive only — never rewrites existing content; appends to existing guardrail-like sections ("Hard rules", "Guardrails") instead of duplicating. Response shape includes `diff_summary` with per-category add counts plus warnings.

### Changed

- **GitHub org rename.** Repo moved from `github.com/Brand-System/brandsystem-mcp` to `github.com/Brandcode-Studio/brandsystem-mcp`. Updated `repository.url`, `bugs`, `mcpName` (`io.github.Brandcode-Studio/brandsystem-mcp`), `server.json.name`, and all README/llms.txt badge + link references. MCP registry consumers with the old identifier cached will re-discover on next refresh.

## 0.9.1 (2026-04-19)

### Added

- **Brandcode MCP Phase 0 lock.** Added `specs/brandcode-mcp-phase-0-lock.md` to lock the S009 G-5b decisions: 8-tool hosted surface, `@brandcode/mcp` naming, `mcp.brandcode.studio/{slug}` URL structure, free-v1 pricing posture, and the Phase 1 staging-prototype handoff.
- **Hosted MCP status surfacing.** `brand_brandcode_status` now returns `brandcode_mcp_available`, `brandcode_mcp_phase`, `brandcode_mcp_url`, and the locked 8-tool surface so agents can distinguish the Phase 0 lock from the Phase 1 hosted launch.
- **Brandcode MCP Phase 1 staging scaffold (G-5b Milestone A).** New `src/hosted/` surface registers the locked 8-tool list and serves the hosted runtime over Web Standard Streamable HTTP. Bearer-token auth with per-brand scopes, path-based slug routing (`/{slug}`), memoized service-token pull from UCS, silent upstream fallback. `brand_runtime` and `brand_status` fully wired; the other 6 tools registered with descriptive stubs pending Milestone B. Deploy scaffold: `api/[slug].ts` Vercel Function, `vercel.json` rewrite, `bin/brandcode-mcp.mjs` local dev entry. Does not affect the published `@brandsystem/mcp` stdio server — additive scaffolding only.

### Fixed

- **Hosted MCP service-token header (G-5g).** The hosted surface now sends `Authorization: Bearer <service-token>` when calling UCS, matching the G-5d validator. Previously sent a custom `x-brandcode-mcp-service-token` header that UCS ignored, causing every hosted pull to fail auth and return `not_compiled` at the runtime slicer.
- **Hosted runtime slicer normalizes brandInstance shape (G-5h).** `extractRuntime` now recognizes the flat brandInstance shape UCS actually serves (`tokens`, `fonts`, `assets`, `verbalIdentity` as siblings) and normalizes it into the runtime-like object `sliceRuntime` expects. Minimal/visual/voice slices now return real colors, typography, and logo references instead of null.

### Changed

- README and `llms.txt` now clarify the "Two MCPs, one brand" story: `@brandsystem/mcp` is the local Build MCP; Brandcode MCP is the upcoming hosted Use MCP.

## 0.9.0 (2026-04-18)

### Added

- **Live Mode (G-5a).** New tool `brand_brandcode_live` toggles Live Mode on a connected Brandcode Studio brand. When on, read-only tools (`brand_runtime`, `brand_check`, `brand_audit_content`, `brand_check_compliance`, `brand_preview`, `brand_status`) refresh from the hosted runtime on each call within a short cache TTL (default 60s). Governance edits in Brand Console propagate on the next tool call without a manual sync. Backed by a per-process in-memory cache that invalidates on explicit `brand_brandcode_sync`. Requires prior `brand_brandcode_connect` and `brand_brandcode_auth`.
- **`brand_runtime` live routing.** When Live Mode is on, the runtime is extracted from the hosted package and tagged `runtime_origin: "live"`. Supports hosted package shapes `pkg.runtime`, `pkg.brandInstance.runtime`, and "package is a runtime".
- **Silent network-failure fallback.** Every live-aware tool falls back to the on-disk mirror when the Studio pull fails. The failure surfaces as a `live.fallback_reason` field in the response — never as a user-visible error.
- **Git-connected repo tools (C-1/C-7).** `brand_connect_repo` and `brand_repo_status` wire a GitHub repo's `.brand/` directory as the source of truth for a hosted brand; Studio polls every five minutes.

### Changed

- **`ConnectorConfig` extended** with optional `liveMode`, `liveModeActivatedAt`, `liveCacheTTLSeconds`. Existing connector configs without these fields default to Live Mode off — zero behavior change for unconnected users.
- **`brand_brandcode_sync` invalidates the live cache** on pull and push so the next live read observes the freshest state.
- **`brand_status` surfaces Live Mode state** under the Brandcode Studio section, including cache warmth and fallback indicators.

### Notes

- Live Mode is opt-in, per-session. The 3000+ existing MCP users who never connect to Studio see zero behavior change.
- Write tools (extract/build/mutate) stay local-first; Live Mode is read-only by design. To push local changes to hosted, use `brand_brandcode_sync direction="push"`.
- In-memory cache is process-local; not shared across processes and not persisted to disk.

## 0.8.2 (2026-04-16)

### Fixed

- **Compile batches all schema errors (M-21).** `brand_compile` now catches all Zod validation errors from config, identity, visual, messaging, and strategy files upfront and returns them in one response. Optional session files degrade gracefully with warnings instead of aborting.
- **SVG gradient fill inference (M-24).** Empty gradient stops (renders as black rectangles) are auto-filled from sibling stop colors or brand primary/secondary. Runs automatically during logo resolution.
- **Auth hints recommend `activate` mode (M-22/M-23).** All auth error messages, next_steps, and recovery guidance now recommend `mode="activate"` (device code) over `mode="login"` (magic link). `set_key` hints include `studio_url` explicitly.

## 0.8.1 (2026-04-16)

### Fixed

- **Studio API URL.** All API calls now use `www.brandcode.studio` (CNAME-backed, serves directly). The non-www apex domain routes through a proxy that was 301-redirecting `/api/auth/*` paths, stripping POST bodies. User-facing text still shows the shorter `brandcode.studio`.

## 0.8.0 (2026-04-16)

### Added

- **Device code authentication.** `brand_brandcode_auth mode="activate"` displays a short human-readable code (e.g. BRAND-7K4X) for the user to enter at brandcode.studio/activate. No JWT copy-paste, no leaving the agent session to hunt for tokens. The agent polls for completion automatically. This is now the recommended auth flow for MCP users.

### Changed

- **Auth deferred from happy path.** Extraction, preview, brand_check, and all local tools work without authentication. Studio activation is positioned as an optional upgrade for users who want cloud persistence and team sharing, not a prerequisite. Tool descriptions, prompts, and recovery guidance updated accordingly.
- **`brand_brandcode_auth` description** now leads with `activate` mode and explicitly states auth is NOT needed for extraction or brand_check.

## 0.7.2 (2026-04-16)

### Fixed

- **Studio URL redirect.** Default Studio URL changed from `www.brandcode.studio` to `brandcode.studio`. The `www` subdomain issued a 301 redirect that stripped POST bodies, breaking magic link auth and brand save endpoints.

## 0.7.1 (2026-04-16)

### Added

- **Brand preview (M-15).** `brand_preview` generates a single-page visual proof from brand-runtime.json — color swatches, typography hierarchy, buttons, cards, and a WCAG contrast accessibility matrix. Screenshot-ready, shareable. Writes `.brand/brand-preview.html`.

### Fixed

- **Color role assignment.** Extraction now uses selector context (header/hero bg → primary, link/button → action, body text → text) and CSS property type (background-color + chromatic + high frequency → primary). Reduces `role: unknown` on sites with plain CSS names.
- **Blank visual/voice fields.** `brand_deepen_identity` and `brand_compile_messaging` now reject all-empty answers instead of writing blank files. Guides agents to use interactive mode or skip the session.
- **Feedback schema alias.** `brand_feedback` now accepts `type` as an alias for `category` — common agent misguess.

### Improved

- **Diff engine key paths (M-17).** Normalizes package structure to find runtime at `package.runtime`, `package.brandInstance.runtime`, or the package itself.
- **Recovery-driven next_steps (M-18).** `brand_status` uses ranked recovery guidance for next_steps when available, falling back to linear session progression only when recovery can't assess.
- **Compile cache invalidation (M-19).** `brand_compile` invalidates the `brand_check` cache after writing new runtime/policy files.

## 0.7.0 (2026-04-15)

### Added

- **Brand diff on sync (M-12).** When `brand_brandcode_sync` pulls or pushes, the response now includes a structured brand diff instead of generic "files changed" messages. Color changes show hex values, CIE76 ΔE perceptual distance, and WCAG contrast impact against text colors. Font changes flag family swaps as breaking. Voice changes detail tone register shifts, never_say list additions/removals, and anchor vocabulary changes. Visual changes track anti-pattern rule additions. Strategy changes report persona and matrix size shifts. Each change is tagged with severity (breaking/significant/minor).
- **Extraction recovery guidance (M-13).** `brand_status` now includes a ranked list of what to do next, sorted by readiness impact. Each missing capability maps to: the specific tool to run, what downstream capabilities it unlocks, readiness point impact (+Npp), and estimated effort (quick/moderate/deep). Example: "Add a logo SVG via brand_set_logo → Unlocks VIM generation, brand report logo section → Readiness: 23% → 35% (+12pp)." Powered by a capability dependency graph that knows which fields each tool needs.

## 0.6.2 (2026-04-15)

### Added

- **MCP prompts.** Four reusable interaction templates: `extract-brand` (full extraction pipeline from URL), `check-brand` (inline brand compliance check), `write-on-brand` (load brand context then generate content), `brand-overview` (full status overview). Prompts guide agents through common workflows.
- **Smithery config.** Added `smithery.yaml` for one-click installation via Smithery registry.

## 0.6.1 (2026-04-15)

### Fixed

- **Replaced `pdf-parse` with `pdfjs-dist`.** The bundled pdfjs v1.10.100 in `pdf-parse` fails with "bad XRef entry" on Node 24. Switched to `pdfjs-dist` v5.6.205 which is actively maintained and works across all supported Node versions.

## 0.6.0 (2026-04-15)

### Added

- **Inline brand gate (`brand_check`).** Fast pass/fail check against the compiled brand identity in under 1ms (cached). Pass any combination of text, color, font, or CSS. Text checks flag never-say words, anchor term misuse (with word-boundary matching), and AI-ism patterns. Color checks compute CIE76 ΔE distance in Lab space and return the nearest brand color with perceptual distance. Font checks are case-insensitive against brand typography with system font passthrough. CSS checks match against visual anti-pattern rules (shadows, gradients, blur). Returns specific fix suggestions per flag and the full brand palette on color failures for agent self-correction. 21 unit tests.
- **Studio authentication (`brand_brandcode_auth`).** Magic link auth flow with four modes: `status` checks auth state, `login` sends magic link email (auto-verifies in dev mode), `set_key` stores a session JWT after clicking the link, `logout` clears credentials. Credentials stored in `.brand/brandcode-auth.json` (auto-gitignored by `brand_init`). Token expiry checked on read with automatic cleanup.
- **Save to Studio (`brand_brandcode_connect` mode="save").** Upload a local `.brand/` directory to Brandcode Studio. Requires authentication. Creates connector config and sync history on success. Returns slug, hosted URL, and sync token.
- **Push to Studio (`brand_brandcode_sync` direction="push").** Push local brand changes to a previously connected Studio brand. Validates ownership via auth token. Updates connector config with new sync token.
- **Auth error codes.** `NOT_AUTHENTICATED`, `AUTH_FAILED`, `AUTH_EXPIRED`, `FORBIDDEN` for clear error handling in auth flows.

### Improved

- **Brandcode client now supports POST requests and auth tokens.** Added `requestMagicLink()`, `verifyMagicLink()`, and `saveBrandToStudio()` to the HTTP client. Request layer supports `authToken` option for Bearer token auth.

## 0.4.0 (2026-04-10)

### Added

- **Multimodal visual extraction (I8).** Added `brand_extract_visual` for rendered-page extraction via headless Chrome. The tool captures a 2x DPR screenshot, extracts computed styles from semantic elements plus `:root` CSS custom properties, infers likely color roles from visual context, and returns the screenshot as an MCP image block for agent-side vision analysis.
- **Deep site extraction (Phase 1).** Added `brand_extract_site` for representative multi-page extraction. The tool discovers high-signal pages on the same domain, captures desktop and mobile screenshots, samples multiple components per page, persists `.brand/extraction-evidence.json`, and merges additional colors/fonts into `core-identity.yaml`.
- **Design synthesis + DESIGN.md (Phase 2/3).** Added `brand_generate_designmd` plus the shared synthesis pipeline that writes `.brand/design-synthesis.json` and `.brand/DESIGN.md`. The synthesis layer turns extracted evidence into radius, shadow, spacing, layout, motion, component, and personality signals for both humans and agents.

### Improved

- **Extraction quality scoring recalibrated (I7).** Replaced the simple point accumulation with weighted scoring: colors 35%, fonts 20%, logo 20%, role assignment 15%, primary identification 10%. Zero colors now gets a specific "JavaScript-applied styles" remediation message. Role assignment rate factors into the score (brands with many unknown-role colors get penalized). MEDIUM score now includes specific gap identification with remediation steps.
- **`brand_start` auto-mode visual fallback.** When static CSS extraction scores LOW or finds fewer than two colors, `brand_start` now attempts visual extraction, merges the computed colors/fonts into `core-identity.yaml`, rescales quality, and includes the screenshot in the MCP response for visual validation.
- **`brand_start` deep fallback.** When the cheap CSS pass is weak and Chrome is available, `brand_start` now tries the multi-page site extractor before dropping back to the single-page visual fallback. This saves `extraction-evidence.json` and uses richer multi-page evidence when possible.
- **Richer compiled token output.** `brand_compile` and `brand_start(auto)` now compile synthesis-driven radius, shadow, layout, spacing, and motion groups into `tokens.json` when those signals are present.
- **Canonical compile parity.** `brand_compile` and `brand_start(auto)` now both generate `design-synthesis.json` and `DESIGN.md`, keeping the default URL onboarding flow aligned with the manual compile flow.

## 0.3.17 (2026-04-10)

### Improved

- **Voice extraction audit (I6).** `brand_extract_messaging` response now includes hedging frequency, jargon density, formality context ("Formal — similar to enterprise SaaS"), and total unique term count. Distinctive term detection filters common web/product vocabulary ("product", "team", "features") to surface actually distinctive brand language. Lowered threshold from 5 to 3 occurrences for distinctive classification.
- **Known gap:** Text extraction from HTML DOM can include rendered JavaScript state (e.g., React component names). Deeper HTML text extraction filtering needed for cleaner vocabulary analysis.

## 0.3.16 (2026-04-10)

### Improved

- **Confidence model recalibrated (I5).** Replaced the simple source-type + frequency model with a multi-signal scoring approach. Confidence now factors in: source type, frequency, semantic role keywords in the property name, structural selector context (header, nav, hero), platform default detection (auto-low), page builder brand variable detection (auto-high), and scale representative status. Platform defaults no longer get `high` confidence just because they appear frequently.

## 0.3.15 (2026-04-10)

### Fixed

- **Font extraction cap raised from 5 to 8.** Every brand was returning exactly 5 fonts due to a hardcoded `.slice(0, 5)`. Raised to 8 and added filtering for CSS variable references (e.g., `var(--font-family-graphik)` no longer appears as a font name).
- **Logo gradient stop detection (I4).** SVGs with `<linearGradient>` or `<radialGradient>` stops missing `stop-color` attributes are now flagged. The extraction quality score is reduced and the response warns: "Logo SVG has empty gradient stops (may render as black)." Addresses Mira's Booth Beacon logo bug.

## 0.3.14 (2026-04-10)

### Improved

- **Design token scale grouping (I2).** Detects `{hue} {scale}` patterns in CSS variable names (e.g., `mulberry 30`, `violet-50`, `blue 700`). Groups colors by hue, keeps the median-scale value as the representative, folds the rest as tints. Reduces the number of `unknown` role colors for brands using modern design token systems (Loom: 9/13 unknown → 5/11, Superhuman: scale members consolidated to single representatives).

## 0.3.13 (2026-04-10)

### Improved

- **Inline style extraction:** `brand_extract_web` and `brand_start` now parse inline `style` attributes from semantic HTML elements (body, header, nav, footer, hero, headings, buttons, sections). Catches page builder colors (Elementor, Squarespace, Wix) that exist as inline styles rather than CSS variables.
- **Platform default blocklist:** WordPress default palette (`--wp--preset--color--*`), Bootstrap (`--bs-*`), Chakra UI, Mantine, and other framework CSS variables are deprioritized instead of treated as brand colors. Reduces noise in extraction results.
- **Page builder brand detection:** Elementor globals (`--e-global-color-*`), Squarespace (`--sqs-*`), and Webflow (`--wf-*`) brand variables get highest priority, correctly outranking platform defaults in the same stylesheet.
- **34% faster extraction** on average (924ms vs 1,399ms baseline) from reduced processing of platform defaults.

## 0.3.12 (2026-04-06)

### Added

- **Figma import artifact in extraction response.** `brand_extract_figma` ingest mode now returns a `brandcode_figma_import_v1` artifact alongside the extraction data. This artifact can be pasted or uploaded directly into Brandcode Studio Brand Loader, eliminating the manual transport seam between MCP extraction and Studio onboarding.
- Plan mode response now notes the artifact interop so agents know what's coming after ingest.
- Next steps updated to mention runtime + policy outputs and the Brand Loader import path.

## 0.3.11 (2026-04-06)

### Fixed

- **Removed phantom Sessions 5-6 from status.** `brand_status` no longer shows "Session 5: Full Governance ○ Not started" and "Session 6: Content Operations ○ Not started" which had no corresponding tools. The MCP brand system is complete at Session 4. Governance and operations live in Brandcode Studio.
- **Completion message.** When all 4 sessions are done, status now shows "Brand system complete" with actionable next steps: generate content, run audit, or connect to Brandcode Studio.

## 0.3.10 (2026-04-06)

### Fixed

- **Session 4 counter not advancing:** `brand_build_personas`, `brand_build_journey`, `brand_build_themes`, and `brand_build_matrix` now bump `brand.config.yaml` session to 4 after writing strategy data. Previously the counter stayed at 3 even after Session 4 completion.
- **Strategy write race condition:** Session 4 tools now use `BrandDir.readOrCreateStrategy()` which reads or creates `strategy.yaml` under a lock. Prevents the second tool in a sequence from clobbering the first tool's data when both check `hasStrategy()` before either writes.

## 0.3.9 (2026-04-06)

### Fixed

- **Flexible answers parsing across all interview tools.** All 6 interview/record tools (`brand_compile_messaging`, `brand_deepen_identity`, `brand_build_personas`, `brand_build_journey`, `brand_build_themes`, `brand_build_matrix`) now accept answers as a JSON object, a JSON-encoded string, or plain text. MCP clients differ in how they serialize args — some send `{"answers": "{\"key\":\"val\"}"}` (string), others send `{"answers": {"key":"val"}}` (object). The new `parseAnswers()` helper handles both, eliminating the `invalid_json` errors agents were hitting.

## 0.3.8 (2026-04-06)

### Fixed

- **Session 3 tool discoverability:** Agents guessed `brand_voice` and `brand_messaging` (which don't exist) instead of the real tools `brand_extract_messaging` and `brand_compile_messaging`. Added natural language trigger phrases ("define brand voice", "brand messaging", "brand story", "start Session 3") to both tool descriptions so agents find the right tool on first attempt.
- **brand_status next step specificity:** When Session 3 is the next step, status now shows exact tool names and the recommended order (`brand_extract_messaging` then `brand_compile_messaging`) instead of a generic suggestion.

## 0.3.7 (2026-04-06)

### Fixed

- **Session 2 persistence verification:** `brand_deepen_identity` now verifies the `visual-identity.yaml` write succeeded by checking file existence after writing. If the write fails (e.g., wrong working directory), the response warns the agent immediately instead of returning silent success.
- **Session counter auto-bump:** `brand_deepen_identity` now bumps `brand.config.yaml` session to 2 when all 6 visual identity sections are complete. Previously the counter only bumped during `brand_compile`, creating a gap where Session 2 data existed but the system still reported Session 1.
- **Feedback smoke test cleanup:** Tests now clean up feedback files after each run, preventing the rate limiter from blocking subsequent test executions.

## 0.3.6 (2026-04-06)

### Fixed

- **Expanded color role enum:** Added `tint`, `overlay`, `border`, `gradient`, `highlight` to the accepted roles in `brand_clarify`, core-identity schema, and CSS role inference. Agents no longer need to map tint/overlay colors to the nearest valid role.
- **CSS role inference expanded:** The color extractor now detects tint/alpha, overlay, border/divider, gradient, and highlight/focus roles from CSS variable names.

### Improved

- **brand_clarify param description:** Now lists all 12 valid roles so agents know the full vocabulary.

## 0.3.5 (2026-04-06)

### Improved

- **Session progression framing:** Rewrote all session transition guidance based on agent feedback. Session 2+ is now pitched by what it adds to the runtime ("agents will reject off-brand layouts") rather than as checklist completion ("run brand_deepen_identity"). Agents are told what they get, not what to do next.
- **Reduced clarification gate:** Clarification items no longer block the Session 2 transition. The compile conversation guide presents clarifications and Session 2 in parallel, not as a sequential prerequisite chain.
- **brand_write gap surfacing:** When content is requested with only Session 1 data, warnings explain what the runtime is missing in concrete terms ("agents would know not just the right colors but how to use them") instead of clinical notes.
- **Report session descriptions:** HTML report session timeline now describes each session's concrete output artifact and what it adds to the brand-runtime.json.

## 0.3.4 (2026-04-06)

### Fixed

- **Feedback body persistence (B1):** `detail` field expanded from 2,000 to 10,000 characters. Added `message` as an alias field. Agents can use either; both merge if provided. Previously only the 200-char `summary` survived to disk.
- **Alpha color grouping (F1):** CSS parser now consolidates `#rrggbbaa` variants into their `#rrggbb` parent color. Alpha tints (e.g., `#f48fb133`, `#f48fb11a`) merge into the base color's frequency count instead of appearing as separate `role: unknown` entries.
- **Feedback schema documented (F2):** README Troubleshooting section now includes a `brand_feedback` usage example with all required and optional fields.

### Known Issues

- Logo SVG gradient stops may extract with empty `stop-color` attributes, rendering as black rectangles. Workaround: use `brand_set_logo` with the correct SVG. Fix tracked in Lane I (extraction quality audit, ticket I4).

## 0.3.3 (2026-04-05)

### Improved

- Full architecture alignment audit across all 34 tools. Every tool description, what_happened, next_steps, and conversation_guide now accurately reflects the current architecture (runtime + policy + connector).
- `brand_start`: description, auto-mode response, existing-brand guidance, and interactive-mode conversation guide all updated to mention runtime, interaction policy, and Brandcode Studio connector.
- `brand_status`: quickstart text mentions runtime + policy outputs and connector option. Getting-started guide lists connector tools. Status output shows runtime artifact and Brandcode Studio connection sections.
- `brand_audit`: now validates existence of brand-runtime.json and interaction-policy.json alongside tokens.json.
- `brand_brandcode_connect`: response field renamed from `brand_name` to `client_name` for consistency.
- `llms.txt`: added connector capability and portability description.
- `CLAUDE.md`: added Architecture Alignment Checklist (28 checks across 4 scenarios) referenced from "How to Add a New Tool" to prevent future drift.

## 0.3.2 (2026-04-05)

- Harden outbound fetches against DNS rebinding by pinning requests to the validated IP address on every hop.
- Centralize path containment checks and apply them to `.brand/` writes plus cwd-scoped local file readers.
- Add regression coverage for pinned transport behavior and sibling-prefix traversal escapes.

## 0.3.1 (2026-04-05)

### Security

- **Path traversal fix:** `brand_audit_content`, `brand_check_compliance`, and `brand_audit_drift` accepted file paths without cwd validation. An agent could read any `.html`/`.md`/`.txt` file on the filesystem. Now all three resolve paths relative to cwd and reject escapes.
- **SSRF bypass fix:** `brand_extract_messaging` used bare `fetch()` instead of `safeFetch()`, bypassing all SSRF protection. Now all outbound HTTP goes through `safeFetch()`.
- **Response size limits:** HTML responses capped at 5MB, CSS at 1MB per stylesheet. Prevents memory exhaustion from malicious URLs.
- **Feedback rate limiting:** Max 10 entries/hour, 100 total files. Prevents disk exhaustion from agent flooding.

## 0.3.0 (2026-04-03)

### Security

- SVG sanitizer rewritten: Cheerio DOM whitelist replaces regex blocklist. Blocks entity-encoded XSS, `<style>` injection, `<foreignObject>`, external `<use>` refs, and unknown elements.
- Zod input validation on all 28 tool inputs and all BrandDir YAML/JSON reads. Malformed input returns structured errors, never crashes.
- 10MB asset size limit on writeAsset().
- npm audit clean (0 vulnerabilities).

### Added

- `brand_runtime` tool: read compiled brand runtime contract.
- Runtime compiler: `brand_compile` now produces `brand-runtime.json` and `interaction-policy.json`.
- Interaction policy compiler: enforceable rules from visual anti-patterns, voice constraints, and content claims.
- MCP smoke tests for all 28 tools via InMemoryTransport.
- CI pipeline (GitHub Actions): build + lint + test across Node 20/22.

### Improved

- Tool descriptions rewritten for agent clarity.
- `brand_status` returns full getting-started guide when no `.brand/` exists.
- README: troubleshooting section, Claude Desktop/Windsurf/Cursor MCP configs.
- 216 tests across 15 files (up from 85 at 0.2.0).

## 0.1.0 (2026-03-22)

### Session 1: Core Identity

- `brand_start` — Onboarding entry point with source menu and interview questions
- `brand_init` — Directory scaffolding
- `brand_extract_web` — Website extraction (colors, fonts, inline SVG logos)
- `brand_extract_figma` — Figma extraction (plan/ingest modes)
- `brand_compile` — DTCG token compilation + VIM generation
- `brand_clarify` — Interactive clarification resolution
- `brand_audit` — Schema validation (11 checks)
- `brand_status` — Progress dashboard with session tracking
- `brand_report` — Portable HTML report with platform-specific setup tabs

### Session 2: Visual Identity

- `brand_deepen_identity` — 6-section visual identity interview
- `brand_ingest_assets` — Asset scanning and manifest generation
- `brand_preflight` — HTML compliance checking against brand rules

### Session 3: Core Messaging

- `brand_extract_messaging` — Website voice fingerprint and claims analysis
- `brand_compile_messaging` — Perspective, voice codex, and brand story
- `brand_write` — Content generation context loader

### Extraction Improvements

- System font filtering (30+ fonts excluded)
- Luminance-based color role detection
- Primary color promotion by frequency
- Inline SVG logo capture from HTML
- Web/JS/CSS artifact filtering in vocabulary analysis

### Security

- Path traversal protection in asset writes
- HTTP response status checks on all fetches
- File read boundary enforcement in preflight
- Top-level error handlers for process stability
- SVG sanitization for XSS prevention

### Testing

- 41 tests across 5 test files (css-parser, dtcg-compiler, confidence, report-html, server smoke)
