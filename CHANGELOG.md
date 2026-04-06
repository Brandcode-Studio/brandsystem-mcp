# Changelog

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
