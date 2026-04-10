# Changelog

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
