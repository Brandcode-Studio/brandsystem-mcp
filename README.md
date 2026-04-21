[![CI](https://github.com/Brandcode-Studio/brandsystem-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Brandcode-Studio/brandsystem-mcp/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@brandsystem/mcp)](https://www.npmjs.com/package/@brandsystem/mcp)
[![Node](https://img.shields.io/node/v/@brandsystem/mcp)](https://www.npmjs.com/package/@brandsystem/mcp)
[![brandsystem-mcp MCP server](https://glama.ai/mcp/servers/Brandcode-Studio/brandsystem-mcp/badges/score.svg)](https://glama.ai/mcp/servers/Brandcode-Studio/brandsystem-mcp)
[![npm downloads](https://img.shields.io/npm/dw/@brandsystem/mcp)](https://www.npmjs.com/package/@brandsystem/mcp)
[![MCP Badge](https://lobehub.com/badge/mcp/brandcode-studio-brandsystem-mcp)](https://lobehub.com/mcp/brandcode-studio-brandsystem-mcp)

# @brandsystem/mcp — Build

**The authoring tool for the portable `.brand` runtime.** Extract identity from websites, Figma, and PDFs. Compile governance, tokens, and voice rules into a single `.brand/` directory. Deploy that runtime to Claude Design, Claude Code, Cursor, ChatGPT — every surface that can read a governed brand. One artifact, every surface on brand.

## What It Solves

AI tools default to category-average output because they have no brand context. Brand guidelines live in PDFs, Figma files, and people's heads — none of which AI tools can read at the moment of creation. The dominant failure mode isn't "broken output"; it's "correct but generic" — output that passes mechanical checks but reads like a competent generalist could have made it.

This MCP server is the authoring half of the **"Two MCPs, One Brand"** model. It extracts brand identity from live sources, compiles it into a `.brand/` directory with structured governance (anti-patterns, proof-point status, voice rules, application rules) plus DTCG tokens, brand-runtime.json, and interaction-policy.json. That directory is the **portable brand runtime** — the artifact that travels with your brand from surface to surface.

- **Claude Design** reads the `.brand/` directory natively when pointed at a governed repo
- **Claude Code**, **Cursor**, **ChatGPT**, **Windsurf**, and any other MCP client load `brand-runtime.json` at generation time
- **@brandcode/mcp** (the hosted Use MCP) serves the same runtime over HTTP for teams that want live reads at `mcp.brandcode.studio/{slug}`

With brand-runtime.json loaded, agent prompts collapse from 200-400 tokens of inline brand context to just the delta. First output is on-brand. No review bottleneck.

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

> Run brand_start with client_name="Acme Corp", website_url="https://acme.com", and mode="auto"

That single command extracts colors, fonts, and logo from the website, escalates to rendered or deeper multi-page extraction when the cheap pass is weak, compiles DTCG tokens, generates `design-synthesis.json` + `DESIGN.md`, and generates a portable HTML brand report -- all in under 60 seconds.

### 3. What you get

```
.brand/
  brand.config.yaml          ← brand name, source URLs, session state
  core-identity.yaml         ← colors (with roles), fonts, logo specs
  tokens.json                ← DTCG design tokens
  brand-runtime.json         ← single-file brand context for any AI agent
  interaction-policy.json    ← anti-patterns, voice constraints, never-say words
  design-synthesis.json      ← spacing, radius, shadows, component signals
  DESIGN.md                  ← portable design brief (agent-readable)
  brand-report.html          ← visual report (paste into any AI chat)
  assets/logo/               ← extracted logo files (SVG/PNG)
```

Load `brand-runtime.json` into any sub-agent's context. First output is on-brand. No per-prompt boilerplate.

### 4. Use it

> Run brand_write for a social-graphic about "Q3 product launch"

The AI now has your full brand context — colors, typography, logo, anti-patterns, voice rules — and generates on-brand content.

### 5. Go deeper (optional)

| Session | What it adds | Command |
|---------|-------------|---------|
| 1. Core Identity | Colors, fonts, logo, tokens | `brand_start` (done above) |
| 2. Visual Identity | Composition, anti-patterns, illustration style | `brand_deepen_identity` |
| 3. Messaging | Voice, tone, never-say words, brand story | `brand_compile_messaging` |
| 4. Content Strategy | Personas, journey stages, themes | `brand_build_personas` |

Each session enriches `brand-runtime.json`. Stop at any point — Session 1 alone is valuable.

### 6. Share with your team

> Run brand_brandcode_connect to save on Brandcode Studio

Your brand persists on [brandcode.studio](https://brandcode.studio). Teammates pull the same brand into their tools. One source of truth.

---

## What It Does

**Session 1: Core Identity** -- Extract colors, fonts, and logo from a website or Figma file. Compile into DTCG tokens, a structured design synthesis layer, a portable `DESIGN.md`, and an HTML report.

**Session 2: Visual Identity** -- Define composition rules, pattern language, illustration style, and anti-patterns through a guided interview. Anti-patterns become enforceable compliance rules.

**Session 3: Messaging** -- Audit existing website voice, then define perspective, voice codex (tone, vocabulary, AI-ism detection), and brand story through a guided interview.

**Session 4: Content Strategy** -- Build buyer personas, journey stages, editorial themes, and a persona x stage messaging matrix.

Each session builds on the previous. Stop anywhere -- you get value immediately.

### Two Ways To Use It

**Local-first MCP flow** -- Start from a website or Figma file, build a `.brand/` directory locally, and use it immediately in chat or code tools with no account required.

**Brandcode Studio-connected flow** -- Connect an existing hosted brand from Brandcode Studio, pull the packaged brand into `.brand/`, and keep it synced over time.

### Two MCPs, One Brand

The `.brand` runtime is the product. Two MCPs serve it:

**`@brandsystem/mcp` — Build (this package).** Author and compile the `.brand` runtime locally. Extract from websites, Figma, and PDFs. Compile governance (anti-patterns, proof-point status, voice rules, application rules) plus DTCG tokens, brand-runtime.json, and interaction-policy.json into a single `.brand/` directory. Portable, versionable, ready to commit to any repo.

**`@brandcode/mcp` — Use (hosted).** Connect any MCP client to a live governed brand at `https://mcp.brandcode.studio/{slug}`. Agents fetch the current runtime, search approved knowledge, check drafts, retrieve assets, and leave feedback — no per-tool guideline copy, no stale snapshots. Tagline: *"Your brand, live in every AI tool."*

Same `.brand` runtime artifact. Two consumption paths. Build authors it; Use serves it.

Phase 0 for Brandcode MCP is locked in [specs/brandcode-mcp-phase-0-lock.md](specs/brandcode-mcp-phase-0-lock.md) (8-tool read/append-only surface, per-brand API keys, scope-based auth). Phase 1 staging prototype closed its sprint gate on 2026-04-19. Until the production launch, use `@brandsystem/mcp` for local build/sync, and Live Mode (`brand_brandcode_live`) for connected reads that refresh from the hosted runtime within a short cache TTL.

### Claude Design integration

The `.brand/` directory is engineered as a first-class input for [Claude Design](https://www.anthropic.com/news/claude-design). Point Claude Design at a repo that contains `.brand/` — governance YAML, narrative library, proof-point files, taste notes, DTCG tokens — and it grounds on the governed brand instead of improvising from uploaded assets. This is the Deploy path: author once with `@brandsystem/mcp`, then every Anthropic surface (Claude Design, Claude Code, Chat via compile packs) consumes the same runtime.

---

## Tools Reference

### Entry Points

| Tool | What it does |
|------|-------------|
| `brand_start` | **Begin here.** Creates a brand system from a website URL in under 60 seconds. Use `mode='auto'` for one-call setup with rendered and deep-site fallback on weak JS-rendered sites. |
| `brand_status` | Check progress, get next steps, or see a getting-started guide if no brand exists yet. |

### Session 1: Core Identity

| Tool | What it does |
|------|-------------|
| `brand_extract_web` | Extract logo (SVG/PNG), colors, and fonts from any website URL. |
| `brand_extract_visual` | Screenshot the rendered page in headless Chrome and extract computed colors, fonts, and visual context from JS-heavy sites. |
| `brand_extract_site` | Discover representative pages, render them across desktop and mobile, capture screenshots, sample multiple components, and persist `extraction-evidence.json`. |
| `brand_generate_designmd` | Generate `design-synthesis.json` and `DESIGN.md` from extracted evidence or the current brand state. |
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

### Brandcode Studio Connector

| Tool | What it does |
|------|-------------|
| `brand_brandcode_connect` | Connect a local `.brand/` directory to a hosted Brandcode Studio brand and pull the current package. |
| `brand_brandcode_sync` | Pull updates from a previously connected hosted brand using sync-token-aware delta behavior. |
| `brand_brandcode_status` | Inspect the current Brandcode Studio connection, sync history, and local package summary. |
| `brand_brandcode_live` | Toggle connected read tools to refresh from the hosted runtime within a short cache TTL. |

### Tool Flow

Tools auto-chain -- each tool's response tells the LLM what to run next:

```
Session 1: brand_start → brand_extract_web or brand_extract_visual or brand_extract_site → brand_generate_designmd → brand_compile → brand_clarify → brand_report
Session 2: brand_deepen_identity (interview x 6) → brand_compile (generates VIM)
Session 3: brand_extract_messaging → brand_compile_messaging (interview x 3) → brand_write
Session 4: brand_build_personas → brand_build_journey → brand_build_themes → brand_build_matrix
```

`brand_status` can be called at any point. `brand_preflight` runs after any content generation.

### CLI Connector Commands

The npm package also ships a CLI entrypoint for the hosted-brand connector:

```bash
npx @brandsystem/mcp brandcode connect https://brandcode.studio/start/brands/pendium
npx @brandsystem/mcp brandcode sync
npx @brandsystem/mcp brandcode status
```

For protected hosted brands, add `--share-token=TOKEN`.

---

## The `.brand/` Directory

After running the full pipeline, your `.brand/` directory looks like this:

```
.brand/
  brand.config.yaml              # Client name, industry, source URLs, session state
  core-identity.yaml             # Colors, typography, logos with confidence scores
  extraction-evidence.json       # Multi-page rendered evidence bundle (optional)
  design-synthesis.json          # Structured design synthesis (radius, shadow, layout, personality)
  DESIGN.md                      # Portable agent-facing design brief
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
| `extraction-evidence.json` | JSON | Multi-page rendered evidence captured from representative pages and viewports. Contains screenshots, computed elements, and CSS custom properties used to ground synthesis |
| `design-synthesis.json` | JSON | Structured design interpretation of the brand. Includes radius, shadow, spacing, layout, component, motion, and personality signals derived from evidence and current identity |
| `DESIGN.md` | Markdown | Portable agent-facing design brief synthesized from the evidence bundle and current brand state |
| `tokens.json` | JSON | [DTCG](https://tr.designtokens.org/format/) design tokens. Includes colors and typography plus synthesis-driven radius, shadow, layout, spacing, and motion groups when available |
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

If you are using the hosted-brand flow instead of local extraction, `brand_brandcode_connect` also scaffolds `.brand/` automatically on first connect.

### Empty extraction (no colors or fonts found)

This usually means the website loads CSS dynamically via JavaScript. `brand_extract_web` only parses static CSS from `<style>` blocks and linked stylesheets. Solutions:

- **Run `brand_extract_visual`** to analyze a single rendered page with headless Chrome and computed styles
- **Run `brand_extract_site`** to sample representative pages across desktop and mobile and save `extraction-evidence.json`
- **Run `brand_generate_designmd`** after extraction or manual edits to regenerate `design-synthesis.json` and `DESIGN.md`
- **Try a different page** that uses more inline/linked CSS (e.g., the homepage, a blog post)
- **Use Figma extraction** (`brand_extract_figma`) for higher accuracy
- **Set values manually** using `brand_clarify` after extraction

`brand_start` in `mode='auto'` already tries this visual fallback when extraction quality is low and Chrome/Chromium is available, then generates `design-synthesis.json` and `DESIGN.md` from the best available evidence.

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

### Reporting feedback

Use `brand_feedback` to report bugs, friction, or ideas:

```
brand_feedback with category="bug", summary="Logo SVG has empty gradient stops",
  detail="The extractor found the SVG structure but <linearGradient> stops have no
  stop-color attributes. Logo renders as a black rectangle.",
  tool_name="brand_extract_web", severity="degrades_experience"
```

For agent telemetry, use `category="agent_signal"` with `signal`, `tool_used`, and `signal_context`. Brand context is auto-populated from `.brand/config`.

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

### Visual Extraction

`brand_extract_visual` launches headless Chrome against the target URL and:

1. Captures a 2x DPR screenshot of the rendered page
2. Extracts computed styles from semantic elements such as body, header, hero, links, cards, and buttons
3. Reads CSS custom properties from `:root`
4. Infers likely color roles from visual context (for example, button background → primary)
5. Returns the screenshot as an MCP image block so the calling agent can do qualitative visual analysis

This is the fallback path for JS-rendered apps and page builders where static CSS parsing misses key brand signals.

### Deep Site Extraction

`brand_extract_site` extends the rendered-path beyond the homepage:

1. Discovers representative pages on the same domain
2. Captures desktop and mobile screenshots for each selected page
3. Samples multiple instances of buttons, cards, links, inputs, sections, and other components
4. Persists the results to `.brand/extraction-evidence.json`
5. Feeds that evidence into `brand_generate_designmd` / `brand_compile` to produce `.brand/design-synthesis.json` and `.brand/DESIGN.md`
5. Merges additional colors and fonts back into `core-identity.yaml` when `merge=true`

Use this when the homepage is not enough to understand the brand system, or when you want richer evidence before token compilation.

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

Four verbs stack — Build, Use, Evolve, Deploy. `@brandsystem/mcp` owns Build. The `.brand` runtime is what moves between them.

```
 Build                    Use                        Deploy
 ─────                    ───                        ──────
 @brandsystem/mcp   ────►  @brandcode/mcp     ────►   Every surface
 (this package)            (mcp.brandcode.studio)      Claude Design
                                                       Claude Code
 authors the ─────────►  .brand/ runtime  ─────────►  Cursor
 portable runtime           (portable artifact)        ChatGPT
                                                       NotebookLM
                           ▲                           Gemini
                           │                           ...any MCP client
                           │
                    Evolve ─── Brandcode Studio
                    (governance promotion,
                     taste compilation,
                     memory wall)
```

**Build** — this package. Extract identity. Compile governance. Produce a `.brand/` directory.

**Use** — `@brandcode/mcp` hosted at `mcp.brandcode.studio/{slug}`. Any MCP client fetches the live governed brand.

**Evolve** — [Brandcode Studio](https://brandcode.studio). Taste notes graduate from memory to formal governance. Anti-patterns accumulate. The runtime sharpens with every production cycle.

**Deploy** — the governed `.brand` repo travels with you. Point Claude Design at it. Compile packs for Claude Code, Chat, Gemini, NotebookLM. Every surface consumes the same runtime.

### Progressive Depth

Each stage builds on the previous. Stop anywhere — you get value immediately.

| Stage | What You Get | How |
|-------|-------------|-----|
| **1. Free scan** | Brand tokens + DESIGN.md + HTML report with platform setup guides | `brand_start` (auto) or `brand_extract_web` / `brand_extract_visual` / `brand_extract_site` → `brand_generate_designmd` → `brand_compile` → `brand_report` |
| **2. MCP depth** | Figma extraction, clarification, full audit | Session 1 with `brand_extract_figma` + `brand_clarify` |
| **3. Visual identity** | Composition rules, patterns, anti-patterns, VIM | Session 2: `brand_deepen_identity` → `brand_compile` |
| **4. Core messaging** | Voice profile, perspective, brand story | Session 3: `brand_extract_messaging` → `brand_compile_messaging` |
| **5. Studio sync** | Hosted package pull, sync history, shared distribution | `brand_brandcode_connect` → `brand_brandcode_sync` → `brand_brandcode_live` for Live Mode reads |
| **6. Live Use MCP** | Agents anywhere hit `mcp.brandcode.studio/{slug}` for current runtime, knowledge search, draft checks, asset fetch | `@brandcode/mcp` connects once; reads stay fresh across agent sessions |
| **7. Deploy to Claude Design** | Claude Design grounds on the `.brand/` directory natively — governance, narratives, proof points, taste notes all load without translation | Point Claude Design at a repo containing `.brand/`; output is on-brand from the first generation |

Stages 1–4 are the standalone local MCP flow. Open source, fully portable, no account required.

Stages 5–7 are the Deploy path — where the `.brand` runtime becomes shared, served live, and consumed by every generation surface. Available through [Brandcode Studio](https://brandcode.studio) and [Column Five Media](https://columnfivemedia.com).

### What's Portable

| Artifact | Portable? | Owned By |
|----------|-----------|----------|
| `@brandsystem/mcp` (authoring tool) | Fully — open source, any brand | MIT license |
| `.brand/` directory (the runtime) | Fully — the portable artifact that travels with your brand | Client |
| Brandcode framework (schema + stances + U-mech) | Fully — universal layer imported by every brand instance | Open |
| Client claims, narratives, rules (I-content) | Per-instance — unique to each brand | Client |
| `@brandcode/mcp` (hosted Use MCP) | Serves the runtime — any MCP client connects | Brandcode |

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
  cli.ts                # CLI entry point for brandcode connect/sync/status
  server.ts             # MCP server creation and tool registration (29 tools)
  tools/                # One file per tool
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
    brand-brandcode-connect.ts  # Hosted brand connect
    brand-brandcode-sync.ts     # Hosted brand sync
    brand-brandcode-status.ts   # Hosted brand status
    brand-write.ts              # Content generation context loader
    brand-export.ts             # Portable brand file export
    brand-feedback.ts           # Bug reports + feedback
  connectors/
    brandcode/                  # Hosted brand client, persistence, and URL resolution
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
