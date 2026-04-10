# Brand Extraction v0.4 — Multi-Page Crawl, Multimodal Synthesis, and DESIGN.md

## Status

Proposed implementation spec for `@brandsystem/mcp` after v0.3.18.

This spec upgrades URL-based brand loading from:

`single page CSS parse + optional single screenshot fallback`

to:

`site discovery + rendered crawl + evidence bundle + multimodal synthesis + tokens + DESIGN.md`

It is designed to power both:

- MCP tools such as `brand_start`
- Brandcode Studio `/start` when the user provides a URL

---

## Why v0.4 exists

v0.3.18 solved the canonical static-CSS failure class with `brand_extract_visual`:

- JS-rendered sites now yield colors and fonts
- rendered buttons can become primary colors
- screenshot evidence can be attached for agent-side visual analysis

But the current system is still intentionally shallow:

- one page only
- above-the-fold only
- first matching selector only
- limited component coverage
- no multi-viewport analysis
- no first-class synthesis layer
- no `DESIGN.md` artifact

The result is better extraction, but not yet a reusable brand system document comparable to the strongest `DESIGN.md` workflows.

v0.4 closes that gap by making URL loading a three-layer pipeline:

1. Crawl and render representative pages
2. Extract structured visual evidence from many instances
3. Synthesize portable outputs: DTCG tokens, runtime JSON, and `DESIGN.md`

---

## Goals

1. Improve extraction accuracy for modern marketing sites, docs sites, app shells, and page builders.
2. Capture more than colors and font family names: spacing, radius, elevation, density, component variants, and brand personality.
3. Produce outputs that are useful to both machines and agents:
   - `tokens.json`
   - `brand-runtime.json`
   - `interaction-policy.json`
   - `DESIGN.md`
4. Keep the default path local-first and deterministic, with external APIs as optional enrichers.
5. Make `/start(url=...)` feel meaningfully stronger, not just more expensive.

---

## Non-goals

1. Full visual regression or perfect design system reconstruction from arbitrary URLs.
2. Replacing Figma extraction as the highest-confidence source.
3. Generating production UI code directly from extracted brand evidence.
4. Requiring third-party APIs for the core path.

---

## Current baseline

v0.3.18 currently provides:

- `brand_extract_web`
  - parses `<style>` blocks
  - fetches up to 5 linked stylesheets
  - extracts inline styles from selected semantic elements
  - infers colors and font families from CSS
- `brand_extract_visual`
  - launches Chrome via `puppeteer-core`
  - captures a single 1280x800 viewport at 2x DPR
  - extracts computed styles from 12 semantic selectors
  - extracts all `:root` custom properties
  - infers color roles from visual context
  - returns screenshot + text in MCP multi-content format
- `brand_start(mode="auto")`
  - runs CSS extraction first
  - falls back to visual extraction if quality is LOW or colors < 2
  - compiles tokens/runtime/policy
  - generates report

v0.4 keeps all of this and adds a new higher-level site extraction and synthesis layer.

---

## Product decision

### Keep the current tools

These remain valid:

- `brand_extract_web` for cheap CSS-only extraction
- `brand_extract_visual` for one-page rendered rescue
- `brand_start` as the entry point

### Add two new first-class tools

#### 1. `brand_extract_site`

Purpose:

- Crawl a domain
- discover representative pages
- capture screenshots and computed evidence across multiple templates
- return or persist a normalized evidence bundle

This becomes the new high-confidence URL extraction path for `brand_start(mode="auto")`.

#### 2. `brand_generate_designmd`

Purpose:

- Take the evidence bundle plus current `.brand/core-identity.yaml`
- synthesize a portable `DESIGN.md`
- optionally emit a structured intermediate JSON used to expand tokens and runtime

This is the bridge from "evidence" to "usable design system".

---

## New `/start` flow

### v0.3.18

`brand_start(auto)` currently does:

1. CSS extraction
2. optional visual fallback
3. compile
4. report

### v0.4

`brand_start(auto, website_url)` should do:

1. Initialize `.brand/`
2. Run cheap CSS extraction as a seed
3. Run `brand_extract_site` if:
   - CSS quality is LOW
   - site is clearly JS-rendered
   - user selected "deep URL scan"
   - or a `depth="deep"` mode is requested
4. Merge extracted evidence into `core-identity.yaml`
5. Run `brand_generate_designmd`
6. Expand token compilation using the richer identity data
7. Generate runtime, policy, report, and `DESIGN.md`

### Default behavior

`brand_start(auto)` should still be safe by default:

- Small site budget
- no external APIs required
- bounded crawl depth
- deterministic file outputs

### Optional behavior

If API keys are configured, `/start` may additionally call enrichers:

- Firecrawl
- Context.dev / Brand.dev
- Brandfetch

These must be additive, not required.

---

## New pipeline architecture

## Layer 1 — Site discovery

`brand_extract_site(url)` should identify representative pages instead of trusting the homepage alone.

### Discovery inputs

- sitemap URLs if available
- homepage links
- common path heuristics
- canonical nav items

### Candidate page classes

- home
- product or pricing
- docs or blog
- about or company
- auth or app shell
- contact or footer-heavy utility page

### Selection rules

Pick up to 5 representative pages:

1. homepage
2. highest-signal marketing page
3. content-heavy page
4. interactive/form-heavy page
5. docs/app page if present

Each selected page should carry:

- `page_type`
- `selection_reason`
- `priority`

---

## Layer 2 — Rendered evidence extraction

Each selected page is rendered in headless Chrome.

### Viewports

Capture:

- desktop: `1440x960 @ 2x`
- mobile: `390x844 @ 3x`

Optional:

- full-page desktop screenshot for long-form marketing pages

### Element coverage

v0.3.18 uses first-match semantic selectors. v0.4 should extract multiple instances per component class.

Collect:

- `body`
- `header`
- `nav links`
- `hero section`
- `hero heading`
- `hero subheading`
- `primary buttons` (top 5 unique variants)
- `secondary buttons` (top 5 unique variants)
- `text links`
- `cards` (top 10)
- `inputs`
- `badges`
- `alerts`
- `footer`
- `section backgrounds`
- `code blocks` when present
- `tables` when present

### Per-instance properties

For each sampled element, collect:

- `selector_name`
- `dom_path`
- `text_sample`
- `color`
- `backgroundColor`
- `borderColor`
- `outlineColor`
- `fontFamily`
- `fontSize`
- `fontWeight`
- `lineHeight`
- `letterSpacing`
- `textTransform`
- `borderRadius`
- `boxShadow`
- `padding`
- `gap`
- `display`
- `position`

### Page-level evidence

Also collect:

- all `:root` CSS custom properties
- all `@font-face` declarations
- favicon and app icons
- OG image
- inline SVG logos and marks
- dominant image colors from logos/OG assets
- color frequency histogram
- border radius histogram
- spacing histogram
- shadow signature histogram

---

## Layer 3 — Evidence bundle

v0.4 introduces a first-class persisted artifact:

- `.brand/extraction-evidence.json`

This is the canonical machine-readable input to synthesis.

### Proposed shape

```json
{
  "schema_version": "0.4.0",
  "source_url": "https://example.com",
  "pages": [
    {
      "url": "https://example.com/pricing",
      "page_type": "pricing",
      "title": "Pricing",
      "screenshots": {
        "desktop_viewport": "assets/evidence/pricing-desktop.png",
        "mobile_viewport": "assets/evidence/pricing-mobile.png",
        "desktop_fullpage": "assets/evidence/pricing-full.png"
      },
      "elements": [],
      "css_custom_properties": {},
      "font_faces": [],
      "logo_candidates": [],
      "metrics": {
        "color_histogram": [],
        "radius_histogram": [],
        "spacing_histogram": [],
        "shadow_histogram": []
      }
    }
  ],
  "site_summary": {
    "discovered_pages": 34,
    "selected_pages": 5,
    "dominant_fonts": [],
    "dominant_colors": [],
    "component_variants": {
      "button": [],
      "card": [],
      "input": [],
      "badge": []
    }
  }
}
```

### Why this matters

This artifact lets us:

- rerun synthesis without recrawling
- compare extraction quality across versions
- benchmark brands over time
- debug token decisions with provenance

---

## Layer 4 — Multimodal synthesis

The evidence bundle is still not the design system. We need a synthesis pass.

### Recommendation

Use a multimodal model with structured outputs.

Primary recommendation:

- Gemini image understanding + structured JSON output

Why:

- handles screenshots directly
- supports schema-constrained output
- supports URL context if needed for copy/personality grounding

### Synthesis inputs

- top screenshots from all selected pages
- extracted evidence bundle
- existing `core-identity.yaml` seed from CSS extraction
- logo evidence
- any optional external enricher output

### Synthesis outputs

Two outputs should be produced together:

1. `design-synthesis.json`
2. `DESIGN.md`

#### `.brand/design-synthesis.json`

Structured output used by token compilation.

Proposed categories:

- colors
  - brand
  - semantic
  - surface scale
  - text scale
  - borders
- typography
  - font families
  - role mapping
  - scale
  - weights
  - line heights
  - letter spacing
  - font feature settings when known
- shape
  - radius scale
- depth
  - shadow/elevation scale
- spacing
  - base unit
  - section spacing
  - component spacing
- layout
  - content width
  - grid feel
  - density
- components
  - button variants
  - card variants
  - input variants
  - nav treatment
  - badge/chip treatment
- personality
  - adjectives
  - tone
  - warmth/coolness
  - precision/playfulness
  - premium/accessibility
- confidence and provenance

#### `.brand/DESIGN.md`

Portable prose document for AI agents.

Minimum sections:

1. Visual Theme and Atmosphere
2. Color Palette and Roles
3. Typography Rules
4. Component Styling
5. Layout Principles
6. Depth and Elevation
7. Motion and Interaction Tone
8. Do and Do Not rules
9. Agent Prompt Guide

This should be inspired by the strongest public `DESIGN.md` patterns, but grounded in our extracted evidence.

---

## Token model expansion

Today `tokens.json` is mostly color + typography + spacing.

v0.4 should expand compilation to include:

- color
- typography
- spacing
- borderRadius
- shadow
- stroke/border
- layout
- motion

### New DTCG groups

Proposed additions:

- `brand.radius`
- `brand.shadow`
- `brand.border`
- `brand.layout`
- `brand.motion`
- `brand.component`

### Important rule

`DESIGN.md` is not the source of truth for tokens.

The source of truth order stays:

`figma > manual > synthesized site evidence > raw web extraction`

`DESIGN.md` is a portable agent-facing interpretation of the richer structured layer.

---

## Tool specs

## `brand_extract_site`

### Purpose

Deep URL-based extraction across multiple representative pages and viewports.

### Parameters

```ts
{
  url: string;
  page_limit?: number;        // default 5
  crawl_limit?: number;       // default 40 discovered URLs
  viewports?: ("desktop" | "mobile")[]; // default both
  fullpage?: boolean;         // default true on selected pages
  merge?: boolean;            // default true
  use_external_enrichers?: boolean; // default false
}
```

### Writes

- `.brand/extraction-evidence.json`
- `.brand/assets/evidence/*.png`
- updates `core-identity.yaml`

### Returns

Multi-content MCP response:

1. image blocks for the selected summary screenshots
2. text block containing:
   - selected pages
   - extracted component variants
   - summary histograms
   - merge counts
   - evidence quality score

---

## `brand_generate_designmd`

### Purpose

Generate a grounded `DESIGN.md` and structured design synthesis from evidence.

### Parameters

```ts
{
  source?: "evidence" | "current-brand"; // default evidence
  model?: "gemini" | "agent-native";     // default agent-native local orchestration
  overwrite?: boolean;                   // default true
}
```

### Reads

- `.brand/extraction-evidence.json`
- `.brand/core-identity.yaml`
- `.brand/tokens.json` if already compiled

### Writes

- `.brand/design-synthesis.json`
- `.brand/DESIGN.md`

### Returns

Text block with:

- generated sections
- confidence summary
- unresolved ambiguities

---

## `/start` integration behavior

### Studio `/start`

When the user enters a URL in Brandcode Studio `/start`:

1. run a cheap homepage seed extraction immediately
2. show a fast first impression within seconds
3. continue the deep site extraction asynchronously
4. upgrade the extracted brand when deeper evidence is ready

### MCP `brand_start`

When `brand_start(mode="auto", website_url=...)` runs locally:

- use a bounded synchronous version of the same pipeline
- return the best screenshots and a quality explanation
- explicitly mention whether results came from:
  - CSS only
  - CSS + visual
  - CSS + site crawl + synthesis

### User-facing rule

If the crawl is partial, say so.

Do not present `DESIGN.md` as exact truth when it is synthesized from incomplete evidence.

---

## Optional external enrichers

These are not part of the core path, but v0.4 should define interfaces for them.

### Firecrawl

Use for:

- recursive page discovery
- screenshot capture
- branding baseline comparison

Best use:

- optional benchmark against our local output
- fallback when local rendering fails

### Context.dev / Brand.dev

Use for:

- logos
- colors
- fonts
- metadata
- styleguide bootstrap

Best use:

- onboarding accelerant
- logo recovery

### Brandfetch

Use for:

- logos
- color schemes
- brand assets

Best use:

- logo and metadata enrichment

### Rule

External enricher output must be tagged as:

- `source: "external"`
- `provider: "firecrawl" | "context" | "brandfetch"`

and must never silently override manual or Figma data.

---

## Quality scoring v0.4

The current 10-point heuristic is a good start but should be expanded.

### New dimensions

- page coverage
- viewport coverage
- component coverage
- role assignment coverage
- typography richness
- layout signal
- personality confidence
- logo confidence
- agreement across pages

### Suggested score bands

- `HIGH`
  - representative pages covered
  - strong agreement across pages
  - component variants detected
  - `DESIGN.md` generated with low ambiguity
- `MEDIUM`
  - good color/font extraction
  - partial component/layout coverage
  - some ambiguous roles
- `LOW`
  - sparse evidence
  - weak cross-page consistency
  - little component structure

---

## Benchmarking plan

Expand `scripts/extraction-audit.mjs`.

### Keep the current 10-brand audit

Still useful for:

- extraction quality
- colors/fonts/logo counts
- runtime generation

### Add new audit dimensions

- pages discovered
- pages selected
- desktop + mobile screenshot count
- component variant counts
- radius/shadow/spacing extraction counts
- `DESIGN.md` section completeness
- human-rated fidelity

### Add a golden set

Target brands:

- Linear
- Stripe
- Notion
- Vercel
- Figma
- Basecamp
- Superhuman
- Framer
- Ramp
- Airbnb

For each brand, manually record:

- primary CTA color
- heading font
- body font
- radius feel
- density feel
- one-line brand personality

This gives us a grounded human eval target.

---

## Implementation phases

## Phase 1 — evidence bundle

Ship:

- `brand_extract_site`
- multi-page selection
- desktop/mobile screenshots
- multi-instance computed style extraction
- `.brand/extraction-evidence.json`

No `DESIGN.md` generation yet.

Success condition:

- better multi-page extraction without regressing `brand_start`

## Phase 2 — structured synthesis

Ship:

- `.brand/design-synthesis.json`
- expanded token compilation
- richer quality scoring

Success condition:

- tokens include radius/shadow/layout evidence

## Phase 3 — `DESIGN.md`

Ship:

- `brand_generate_designmd`
- `.brand/DESIGN.md`
- `/start` and MCP response updates

Success condition:

- agents can use the generated file to create closer on-brand UI

## Phase 4 — optional enrichers

Ship:

- provider adapters
- provenance tagging
- config/env gates

Success condition:

- enrichers improve weak cases without becoming the core dependency

---

## Open questions

1. Should `DESIGN.md` live at `.brand/DESIGN.md`, project root `DESIGN.md`, or both?
2. Should `/start` default to deep crawl or expose `fast` vs `deep` modes?
3. How many screenshots are safe to return in MCP multi-content responses before clients become unhappy?
4. Should component variant extraction be schema-first or cluster-first?
5. Which multimodal synthesis model becomes the default in hosted mode vs local mode?

---

## Recommended defaults

If we need immediate decisions:

1. Store canonical output at `.brand/DESIGN.md`
2. Add root export later via `brand_export`
3. Keep `brand_start(auto)` on a bounded deep crawl:
   - 5 selected pages
   - desktop + mobile
   - full-page only for homepage
4. Keep external enrichers off by default
5. Make `brand_extract_visual` remain the cheap one-page fallback, not the main path

---

## Summary

v0.4 should not be "better screenshot extraction."

It should be:

- a multi-page rendered evidence system
- a grounded multimodal synthesis layer
- a richer token compiler
- and a first-class `DESIGN.md` generator

That is the change that moves `@brandsystem/mcp` from "website scraper with token output" toward "URL-to-brand-system runtime".
