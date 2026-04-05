[![CI](https://github.com/Brand-System/brandsystem-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Brand-System/brandsystem-mcp/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@brandsystem/mcp)](https://www.npmjs.com/package/@brandsystem/mcp)
[![Node](https://img.shields.io/node/v/@brandsystem/mcp)](https://www.npmjs.com/package/@brandsystem/mcp)

# @brandsystem/mcp

Extract and manage brand identity for AI tools -- logo, colors, typography, voice, and visual rules.

## What It Solves

AI tools produce generic output because they have no brand context. Brand guidelines live in PDFs, Figma files, and people's heads -- none of which AI tools can read.

This MCP server extracts brand identity from live sources (websites, Figma files), compiles it into structured design tokens, and makes it available to any AI tool through the [Model Context Protocol](https://modelcontextprotocol.io). The result is a `.brand/` directory with your colors, fonts, logos, voice rules, and DTCG tokens -- portable, version-controlled, and ready for any AI tool to consume.

---

## Quick Start

### 1. Add to your MCP config

Copy this into `.mcp.json` (Claude Code), `.cursor/mcp.json` (Cursor), or Windsurf MCP settings:

```json
{
  "mcpServers": {
    "brandsystem": {
      "command": "npx",
      "args": ["-y", "@brandsystem/mcp"]
    }
  }
}
```

### 2. Create your brand system

Tell your AI tool:

> Run brand_start for "Acme Corp" with website https://acme.com in auto mode

That single command extracts colors, fonts, and logo from the website, compiles DTCG tokens, and generates a portable HTML brand report -- all in under 60 seconds.

### 3. Use it

> Run brand_write for a social-graphic about "Q3 product launch"

The AI now has your full brand context -- colors, typography, logo, anti-patterns, voice rules -- and generates on-brand content.

---

## What It Does

**Session 1: Core Identity** -- Extract colors, fonts, and logo from a website or Figma file. Compile into DTCG tokens. Generate a portable HTML report.

**Session 2: Visual Identity** -- Define composition rules, pattern language, illustration style, and anti-patterns through a guided interview. Anti-patterns become enforceable compliance rules.

**Session 3: Messaging** -- Audit existing website voice, then define perspective, voice codex (tone, vocabulary, AI-ism detection), and brand story through a guided interview.

**Session 4: Content Strategy** -- Build buyer personas, journey stages, editorial themes, and a persona x stage messaging matrix.

Each session builds on the previous. Stop anywhere -- you get value immediately.

---

## Tools Reference

### Entry Points

| Tool | What it does |
|------|-------------|
| `brand_start` | **Begin here.** Creates a brand system from a website URL in under 60 seconds. Use `mode='auto'` for one-call setup. |
| `brand_status` | Check progress, get next steps, or see a getting-started guide if no brand exists yet. |

### Session 1: Core Identity

| Tool | What it does |
|------|-------------|
| `brand_extract_web` | Extract logo (SVG/PNG), colors, and fonts from any website URL. |
| `brand_extract_figma` | Extract from Figma design files (higher accuracy). Two-phase: plan then ingest. |
| `brand_set_logo` | Add/replace logo via SVG markup, URL, or data URI. |
| `brand_compile` | Generate DTCG design tokens, brand runtime contract, and interaction policy from extracted data. |
| `brand_clarify` | Resolve ambiguous brand values interactively (color roles, font confirmations). |
| `brand_audit` | Validate .brand/ directory for completeness and correctness. |
| `brand_report` | Generate portable HTML brand report. Upload to any AI chat as instant guidelines. |
| `brand_init` | Low-level directory scaffolding. Prefer `brand_start` instead. |

### Session 2: Visual Identity

| Tool | What it does |
|------|-------------|
| `brand_deepen_identity` | Define composition rules, patterns, illustration style, and anti-patterns (6 interview sections). |
| `brand_ingest_assets` | Scan and catalog brand assets with MANIFEST.yaml metadata. |
| `brand_preflight` | Check HTML/CSS against brand rules -- catches off-brand colors, wrong fonts, anti-pattern violations. |

### Session 3: Messaging

| Tool | What it does |
|------|-------------|
| `brand_extract_messaging` | Audit existing website voice -- fingerprint, vocabulary, claims, AI-isms, gaps. |
| `brand_compile_messaging` | Define perspective, voice codex (tone, vocabulary, AI-ism detection), and brand story. |

### Session 4: Content Strategy

| Tool | What it does |
|------|-------------|
| `brand_build_personas` | Build buyer personas through a 7-question guided interview. |
| `brand_build_journey` | Define buyer journey stages (ships with 4 proven defaults). |
| `brand_build_themes` | Define editorial content themes balanced across awareness, engagement, and conversion. |
| `brand_build_matrix` | Generate messaging variants for every persona x journey stage combination. |

### Content Scoring

| Tool | What it does |
|------|-------------|
| `brand_audit_content` | Score content against brand rules (0-100) across multiple dimensions. |
| `brand_check_compliance` | Quick pass/fail compliance gate before publishing. |
| `brand_audit_drift` | Detect systematic brand drift across multiple pieces of content. |

### Runtime + Utilities

| Tool | What it does |
|------|-------------|
| `brand_runtime` | Read the compiled brand runtime contract (single-document brand context for AI agents). |
| `brand_write` | Load full brand context (visual + voice + strategy) for content generation. |
| `brand_export` | Generate portable brand files for Chat, Code, team sharing, or email. |
| `brand_feedback` | Report bugs, friction, or feature ideas to the brandsystem team. |

### Tool Flow

Tools auto-chain -- each tool's response tells the LLM what to run next:

```
Session 1: brand_start → brand_extract_web → brand_compile → brand_clarify → brand_report
Session 2: brand_deepen_identity (interview x 6) → brand_compile (generates VIM)
Session 3: brand_extract_messaging → brand_compile_messaging (interview x 3) → brand_write
Session 4: brand_build_personas → brand_build_journey → brand_build_themes → brand_build_matrix
```

`brand_status` can be called at any point. `brand_preflight` runs after any content generation.

---

## The `.brand/` Directory

After running the full pipeline, your `.brand/` directory looks like this:

```
.brand/
  brand.config.yaml              # Client name, industry, source URLs, session state
  core-identity.yaml             # Colors, typography, logos with confidence scores
  tokens.json                    # DTCG design tokens (compiled output)
  brand-runtime.json             # Compiled runtime contract (single-doc brand context)
  interaction-policy.json        # Enforceable rules (anti-patterns, voice, claims)
  needs-clarification.yaml       # Items requiring human review
  brand-report.html              # Portable HTML brand report
  visual-identity.yaml           # Session 2: composition, patterns, anti-patterns
  visual-identity-manifest.md    # Session 2: compiled VIM document
  system-integration.md          # Session 2: CLAUDE.md / .cursorrules setup guide
  messaging.yaml                 # Session 3: perspective, voice, brand story
  messaging-audit.md             # Session 3: voice fingerprint analysis
  brand-story.md                 # Session 3: compiled brand narrative
  assets/
    logo/
      logo-wordmark.svg          # Extracted logo files
    illustrations/               # Brand illustrations with MANIFEST.yaml
    stickers/                    # Brand stickers with MANIFEST.yaml
    patterns/                    # Brand patterns with MANIFEST.yaml
```

### File Details

| File | Format | Purpose |
|------|--------|---------|
| `brand.config.yaml` | YAML | Project metadata: client name, industry, website URL, Figma file key, session number, schema version |
| `core-identity.yaml` | YAML | All extracted brand data: colors (with roles and confidence), typography (with families and weights), logo specs (with inline SVG and data URIs), spacing |
| `tokens.json` | JSON | [DTCG](https://tr.designtokens.org/format/) design tokens. Only includes values with medium+ confidence. Each token carries `$extensions` with source and confidence metadata |
| `brand-runtime.json` | JSON | Single-document brand contract for AI agents. Merges all 4 session YAMLs into flat, fast-access format. Only medium+ confidence values. Compiled by `brand_compile`, read by `brand_runtime` |
| `interaction-policy.json` | JSON | Enforceable rules engine. Visual anti-patterns, voice constraints (never-say, AI-ism patterns), and content claims policies. Used by preflight and scoring tools |
| `needs-clarification.yaml` | YAML | Prioritized list of items the system could not resolve confidently: missing primary color, low-confidence values, unassigned roles |
| `brand-report.html` | HTML | Self-contained brand report. Works offline, embeds all assets inline. Paste into any AI tool as brand guidelines |
| `assets/logo/` | SVG/PNG | Extracted logo files. SVGs include inline path data in `core-identity.yaml` for portability |

---

## Platform Setup

### Claude Code

Create `.mcp.json` in your project root:

```json
{
  "mcpServers": {
    "brandsystem": {
      "command": "npx",
      "args": ["-y", "@brandsystem/mcp"]
    }
  }
}
```

### Cursor

Create `.cursor/mcp.json` in your project root:

```json
{
  "mcpServers": {
    "brandsystem": {
      "command": "npx",
      "args": ["-y", "@brandsystem/mcp"]
    }
  }
}
```

### Windsurf

Create `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "brandsystem": {
      "command": "npx",
      "args": ["-y", "@brandsystem/mcp"]
    }
  }
}
```

### Claude Desktop

Open Settings > Developer > Edit Config (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "brandsystem": {
      "command": "npx",
      "args": ["-y", "@brandsystem/mcp"]
    }
  }
}
```

### Claude Chat (no MCP)

If you are using Claude Chat without MCP support:

1. Run the pipeline in a code environment first to generate `brand-report.html`
2. Upload the HTML file to your Claude Chat conversation
3. Say: "Use this as my brand guidelines for everything we create"

The report HTML is self-contained and works as a standalone brand reference in any AI tool.

---

## Troubleshooting

### "No .brand/ directory found"

Every tool except `brand_start`, `brand_init`, and `brand_feedback` requires a `.brand/` directory. Run `brand_start` first.

### Empty extraction (no colors or fonts found)

This usually means the website loads CSS dynamically via JavaScript. `brand_extract_web` only parses static CSS from `<style>` blocks and linked stylesheets. Solutions:

- **Try a different page** that uses more inline/linked CSS (e.g., the homepage, a blog post)
- **Use Figma extraction** (`brand_extract_figma`) for higher accuracy
- **Set values manually** using `brand_clarify` after extraction

### Figma extraction fails

`brand_extract_figma` doesn't connect to Figma directly. It works in two phases:

1. **Plan** returns instructions for what data to fetch (variables, styles, logo)
2. **Ingest** processes data you pass back from the Figma MCP tools

Make sure you have a separate Figma MCP server connected (e.g., `@anthropics/figma-mcp`) and pass the fetched data to `brand_extract_figma` in ingest mode.

### Logo not detected

Web extraction looks for `<img>`, `<svg>`, and `<link rel="icon">` elements. If your logo is rendered via JavaScript or embedded as a CSS background, use `brand_set_logo` to add it manually with SVG markup, a URL, or a data URI.

### "Response size exceeds 5K target" (console warning)

This is a soft warning, not an error. Some tools (brand_write, brand_deepen_identity) return rich conversation guides that exceed 5K characters. The hard limit is 50K, which triggers truncation.

### Server won't start

```bash
# Verify Node.js >= 18
node --version

# Test the server manually
npx @brandsystem/mcp

# Check for port conflicts (stdio transport shouldn't have any)
# The server uses stdio, not HTTP -- it reads from stdin and writes to stdout
```

---

## How It Works

### Confidence Scoring

Every extracted value carries a confidence level:

| Level | Meaning | Token Behavior |
|-------|---------|----------------|
| `confirmed` | Human-verified | Included in tokens |
| `high` | Strong signal (e.g., Figma variable, CSS custom property named `--brand-primary`) | Included in tokens |
| `medium` | Reasonable inference (e.g., most-frequent chromatic color in CSS) | Included in tokens |
| `low` | Weak signal (e.g., color appears once in a generic property) | Excluded from tokens, added to `needs-clarification.yaml` |

### Source Precedence

When the same brand element is found in multiple sources, the higher-precedence source wins:

```
figma > manual > web
```

A Figma-sourced primary color will replace a web-extracted one. A manually confirmed value overrides both automated sources. Within the same source, higher confidence wins.

### Web Extraction

`brand_extract_web` fetches the target URL and:

1. Parses all `<style>` blocks and up to 5 linked stylesheets
2. Extracts color values from CSS properties and custom properties
3. Infers color roles from property names (e.g., `--primary`, `--brand-accent`)
4. Promotes the most-frequent chromatic color to "primary" if no explicit primary is found
5. Extracts font families and ranks by frequency
6. Finds logo candidates from `<img>`, `<svg>`, and `<link rel="icon">` elements
7. Downloads and embeds logos as inline SVG or base64 data URIs

### Figma Extraction

`brand_extract_figma` works in two steps to bridge between the Figma MCP and brandsystem:

1. **Plan mode** -- Returns specific instructions for what data to fetch from Figma (variables, text styles, logo components)
2. **Ingest mode** -- Processes the collected Figma data, maps variable names to roles, and merges into `core-identity.yaml` at `high` confidence

### DTCG Token Compilation

`brand_compile` transforms `core-identity.yaml` into [Design Tokens Community Group](https://tr.designtokens.org/format/) format:

- Colors become `$type: "color"` tokens keyed by role
- Typography becomes grouped tokens with `fontFamily`, `dimension` (size), and `fontWeight` entries
- Spacing becomes `dimension` tokens with scale values
- Each token includes `$extensions["com.brandsystem"]` with source and confidence metadata
- Only values with `medium` or higher confidence are included

---

## The Bigger Picture

brandsystem.app is a standalone product — it works for any brand, in any AI tool, with no external dependencies. But it's also the first-touch onramp into a larger system.

### Relationship to Brandcode

[Brandcode](https://github.com/Brand-System/column-five-prototypes) is an end-to-end content system that governs everything from brand identity to production to measurement — and loops measurement insights back into the brand. brandsystem.app is the marketing-first entry point that creates the Brand OS, which naturally draws clients into operationalizing it within Brandcode.

```
                    ┌──────────────────────┐
                    │   Brand OS Creation   │
                    │  ★ brandsystem.app    │
                    └──────────┬───────────┘
                               │ creates
                               ▼
┌──────────────────────────────────────────────────┐
│                   Brandcode                       │
│                                                   │
│  Market Intelligence ──→ Brand Perspective         │
│         ▲                      │                  │
│         │               Governance layer          │
│         │          (claims, narratives, rules)     │
│         │                      │                  │
│         │               Production engines        │
│         │          (web, PDF, viz, copywriting)    │
│         │                      │                  │
│         └──── Measurement ◄────┘                  │
│               (performance → insights → loop)     │
└──────────────────────────────────────────────────┘
```

**brandsystem.app creates the Brand OS** — the first artifact of Brandcode. Colors, typography, voice, composition rules, messaging. This is valuable on its own: paste the report into any AI tool and get better brand compliance immediately.

**The pull into Brandcode comes naturally.** Once you have a Brand OS, the next questions are operational: What can we claim? How should different content types use this identity? How do we measure whether it's working? That's the Brandcode governance and production loop — Market Intelligence feeds new insights into the brand perspective, production creates governed content, measurement evaluates performance, and those insights loop back to evolve the Brand OS.

**You don't need the full loop.** brandsystem.app delivers standalone value at every session. The Brandcode ecosystem is there when you're ready to operationalize.

### Progressive Depth

Each stage builds on the previous. Stop anywhere — you get value immediately.

| Stage | What You Get | How |
|-------|-------------|-----|
| **1. Free scan** | Brand tokens + HTML report with platform setup guides | `brand_extract_web` → `brand_compile` → `brand_report` |
| **2. MCP depth** | Figma extraction, clarification, full audit | Session 1 with `brand_extract_figma` + `brand_clarify` |
| **3. Visual identity** | Composition rules, patterns, anti-patterns, VIM | Session 2: `brand_deepen_identity` → `brand_compile` |
| **4. Core messaging** | Voice profile, perspective, brand story | Session 3: `brand_extract_messaging` → `brand_compile_messaging` |
| **5. Brandcode governance** | Claims, narratives, application rules, scoring, measurement | Operationalize the Brand OS within Brandcode |
| **6. Full loop** | Market Intelligence → production → measurement → insights back into Brand OS | Brandcode end-to-end |

Stages 1–4 are brandsystem.app. Open source, fully portable, no dependencies.

Stages 5–6 are the full Brandcode ecosystem — where the Brand OS becomes operational. Available through [Column Five Media](https://columnfivemedia.com).

### What's Portable

| Artifact | Portable? | Owned By |
|----------|-----------|----------|
| brandsystem.app (tools) | Fully — open source, any brand | MIT license |
| `.brand/` directory (outputs) | Fully — works in any tool | Client |
| Brandcode framework (schema + workflows) | Yes — universal | Open |
| Client claims, narratives, rules | Per-instance | Client |

---

## Development

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Watch mode for development
npm run dev

# Run tests
npm test

# Watch mode for tests
npm run test:watch

# Type check without emitting
npm run lint

# Start the server (stdio transport)
npm start
```

### Project Structure

```
src/
  index.ts              # Entry point -- stdio transport
  server.ts             # MCP server creation and tool registration (28 tools)
  tools/                # One file per tool (26 files, 28 tools)
    brand-start.ts              # Entry point (Session 1)
    brand-status.ts             # Progress dashboard
    brand-extract-web.ts        # Website extraction
    brand-extract-figma.ts      # Figma extraction (plan/ingest)
    brand-set-logo.ts           # Manual logo add/replace
    brand-compile.ts            # Token + VIM + runtime compilation
    brand-clarify.ts            # Interactive clarification
    brand-audit.ts              # Schema validation
    brand-report.ts             # HTML report generation
    brand-init.ts               # Low-level directory scaffolding
    brand-deepen-identity.ts    # Session 2: visual identity interview
    brand-ingest-assets.ts      # Session 2: asset cataloging
    brand-preflight.ts          # Session 2: HTML compliance checking
    brand-extract-messaging.ts  # Session 3: voice/messaging audit
    brand-compile-messaging.ts  # Session 3: perspective + voice interview
    brand-build-personas.ts     # Session 4: buyer personas
    brand-build-journey.ts      # Session 4: buyer journey stages
    brand-build-themes.ts       # Session 4: editorial themes
    brand-build-matrix.ts       # Session 4: messaging matrix
    brand-audit-content.ts      # Content scoring (0-100)
    brand-check-compliance.ts   # Binary pass/fail compliance gate
    brand-audit-drift.ts        # Batch drift detection
    brand-runtime.ts            # Read compiled brand runtime contract
    brand-write.ts              # Content generation context loader
    brand-export.ts             # Portable brand file export
    brand-feedback.ts           # Bug reports + feedback (3 tools)
  lib/                  # Shared utilities
    brand-dir.ts        # .brand/ directory I/O (YAML, JSON, markdown, assets)
    confidence.ts       # Confidence scoring and source precedence
    css-parser.ts       # CSS color and font extraction
    dtcg-compiler.ts    # DTCG token compilation
    color-namer.ts      # Human-readable color name generation
    content-scorer.ts   # Brand compliance scoring engine
    logo-extractor.ts   # Logo candidate detection
    svg-resolver.ts     # SVG inlining and base64 encoding
    report-html.ts      # HTML report generation
    vim-generator.ts    # Visual Identity Manifest + system integration markdown
    runtime-compiler.ts # Compile brand-runtime.json from 4 source YAMLs
    interaction-policy-compiler.ts  # Compile interaction-policy.json (enforceable rules)
    response.ts         # Structured MCP response builder
    version.ts          # Package version reader
  types/
    index.ts            # TypeScript type definitions
  schemas/
    index.ts            # Zod schemas for validation (7 schema files)
bin/
  brandsystem-mcp.mjs   # CLI entry point
specs/
  brand-runtime-schema.md         # Runtime contract documentation
  interaction-policy-schema.md    # Interaction policy documentation
test/
  lib/                  # Library unit tests (9 files)
  tools/                # Tool tests (2 files: export + smoke)
  server.test.ts        # Server creation smoke test
```

---

## License

MIT
