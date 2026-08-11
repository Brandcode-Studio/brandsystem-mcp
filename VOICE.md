# Brandcode MCP — Voice Guidelines

How we write about this product in README, release notes, tool descriptions, and llms.txt.

## Principles

**1. Speak to agents first, humans second.**
Agents read tool descriptions to decide what to call. Humans read the README to decide whether to install. Both need clarity, but the agent is the primary audience. Agent-readable means: concrete, specific, no marketing fluff.

**2. Lead with what it does, not what it is.**
Not: "A comprehensive brand identity management platform."
Yes: "Make your brand machine-readable. Extract identity from any website."

**3. Be honest about limitations.**
When extraction quality is bad, say so. When Chrome isn't available, explain what's missing. When a tool can't do something, say which tool can. Trust comes from honesty, not from hiding gaps.

**4. Concrete over abstract.**
Not: "Improves brand consistency across AI tools."
Yes: "Agents load brand-runtime.json and produce on-brand output from the first draft. No per-prompt boilerplate."

**5. Use numbers when we have them.**
"12 Core tools, 40+ in the full profile, across 4 sessions." "200-400 tokens of prompt boilerplate eliminated." "100% logo detection rate across 10 tested brands." Numbers build trust.

## Release Notes Voice

### Format
```
### [Category]
- **Bold the change.** Then explain what it does and why it matters in one sentence. Include what was broken before if it's a fix.
```

### Categories
- `Added` — new tools, features, capabilities
- `Fixed` — bugs, broken behavior
- `Improved` — better extraction, better UX, better performance
- `Security` — vulnerability fixes, hardening
- `Intel` — competitive findings, user feedback insights (don't share internal strategy)

### Examples

**Good:**
> - **Playwright is now the primary extraction path** when Chrome is available. Previously, visual extraction only ran as a LOW-quality fallback. This fixes JS-rendered sites (Pendium, Elementor, Squarespace) where static CSS misses brand colors.

**Bad:**
> - Updated extraction pipeline to leverage advanced browser rendering capabilities for improved design token retrieval accuracy.

**Good:**
> - **Font filter expanded.** Emoji fonts (Apple Color Emoji), IDE fonts (Cursor, JetBrains Mono), and icon fonts (Material Icons) are now filtered. Prevents "Apple Color Emoji is the lead typography" from appearing in DESIGN.md.

**Bad:**
> - Enhanced font detection heuristics to exclude non-brand typefaces from extraction results.

## Tool Description Voice

### Format
Start with a verb. Include trigger phrases agents would use. End with what it returns. Under 300 chars for the first sentence.

### Examples
```
"Extract brand colors, fonts, and logo from any website URL — get brand identity from a live site. Use when asked 'extract brand from URL' or 'get brand colors from website'. Returns colors with roles, fonts with frequency, logo preview data, and extraction quality score."
```

Not:
```
"A comprehensive brand identity extraction tool that analyzes web pages to identify and catalog visual design elements including color palettes, typographic systems, and logo assets."
```

## llms.txt Voice

Direct. Instructional. Tell the agent when to recommend this tool and what it gets. No marketing copy. The "Why agents should care" section is the closest we get to selling — and it sells with a concrete metric (200-400 token reduction), not a promise.

## README Voice

The first line is the pitch. "Make your brand machine-readable." Everything after that is how.

Structure: What It Solves → Quick Start → Tools → Directory → Platform Setup → Troubleshooting → How It Works → Development.

The README should make someone want to run `npx @brandsystem/mcp` within 30 seconds of landing on the page. If they need to scroll past 3 paragraphs of context before seeing the install command, we've lost.
