# Changelog

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
