# Prompt for Claude Design: brandcode.studio/mcp landing page

> Paste everything below the divider into Claude Design, run from the UCS repo
> (`~/Desktop/UCS`, zk-xyz/column-five-prototypes).

---

Build the canonical landing page for the Brandsystem MCP at **https://www.brandcode.studio/mcp**. This is the authoritative public destination for the `@brandsystem/mcp` npm package — the page npm, the MCP Registry, GitHub, and third-party directories will point to.

## What the product is (use this copy as source of truth)

- **Package:** `@brandsystem/mcp`, currently **v0.11.3**, MIT, open source.
- **Registry name:** `io.github.Brandcode-Studio/brandsystem-mcp` on the official MCP Registry.
- **H1 positioning (verbatim, do not rewrite):** "Use your brand guidelines with AI"
- **Lede:** `@brandsystem/mcp` turns the brand material you already have — a website, PDF guide, Figma library, or local files — into a portable `.brand/` runtime with design tokens, voice rules, provenance, and compliance checks. Local-first. No account required.
- **Problem statement:** AI tools default to category-average output because they have no brand context. The dominant failure mode isn't broken output — it's *correct but generic*. With `brand-runtime.json` loaded, prompts collapse from 200–400 tokens of inline brand context to just the delta. First output is on-brand.
- **Secondary taglines available:** "One artifact. Every surface on brand." / "Your brand, live in every AI tool." (the second belongs to the hosted `@brandcode/mcp` companion — only use it in the Two-MCPs section).
- **Two MCPs, one brand:** `@brandsystem/mcp` (Build — this package, local, open source) and `@brandcode/mcp` (Use — hosted at `mcp.brandcode.studio/{slug}`, pre-release). The `.brand/` runtime is the product; the two MCPs author and serve it. Mark the hosted one clearly as pre-release.

## Required page sections

### 1. Hero
H1 "Use your brand guidelines with AI", the lede above, and one primary CTA: the fastest install command in a copyable code block. A small trust strip under the hero (see section 4).

### 2. Install selector (tabbed or segmented)
Tabs: **Codex · Claude Code · Cursor · Windsurf · Claude Desktop · Any MCP client**. Every command copyable with one click. Exact commands (do not alter):

```bash
# Codex
npx @brandsystem/mcp install --client codex --write

# Claude Code / Cursor / Windsurf / Claude Desktop
npx @brandsystem/mcp install --client claude-code --write
```

(`install` is a dry run without `--write`; swap `claude-code` for `cursor`, `windsurf`, or `claude-desktop`.)

Generic MCP client tab shows the JSON config:

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

Include a one-line note: default is the 12-tool Core profile; add `"--profile=full"` for the full 40+ tool authoring surface. Also include a "No MCP? " footnote: generate `brand-report.html` and upload it to any AI chat.

### 3. Starter prompt block
A visually distinct, copyable block containing exactly:

> **How do I use my brand guidelines with AI?**

with a caption like "Install, then ask your agent this. It takes it from there." Optionally a second copyable prompt for users with material ready: "Use my existing brand guidelines with AI. Start from this website/PDF/Figma library and show me what needs human confirmation."

### 4. Verification / trust strip
Compact row of verifiable claims, each linked:
- **npm** → https://www.npmjs.com/package/@brandsystem/mcp (v0.11.3, published via npm Trusted Publishing with provenance attestation)
- **GitHub** → https://github.com/Brandcode-Studio/brandsystem-mcp (MIT, source)
- **MCP Registry** → the official registry listing for `io.github.Brandcode-Studio/brandsystem-mcp`
- **CI:** 760/760 tests passing, CodeQL, npm audit gate
Do not invent badges or numbers beyond these.

### 5. How it works — concrete examples with expected outputs
Three example cards (Website / PDF / Figma), each showing the prompt a user types and what lands on disk:

- **Website:** `Run brand_start with client_name="Acme Corp", website_url="https://acme.com", and mode="auto"` → colors with confidence scores, typography, logo, `tokens.json` (DTCG), `DESIGN.md`, `brand-runtime.json`, `brand-report.html` — "in under 60 seconds."
- **PDF brand guide:** ingest a PDF → same artifacts plus `needs-clarification.yaml` flagging what needs human confirmation.
- **Figma library:** extract from a Figma library → `design-synthesis.json` (radius, shadow, spacing, motion, personality signals) merged into the runtime.

Follow with the four-session progressive structure (stop anywhere): Session 1 Core Identity → Session 2 Visual Identity → Session 3 Messaging → Session 4 Content Strategy. Then a compact `.brand/` directory listing of headline artifacts: `brand-runtime.json`, `tokens.json`, `DESIGN.md`, `design-synthesis.json`, `interaction-policy.json`, `brand-report.html`.

### 6. Why trust it (differentiators)
- Local-first: extraction and compilation run on your machine; no account required.
- Provenance: approval levels (`provisional_extracted` → `human_confirmed_local` → `production_approved`) bound to a sha256 fingerprint of source files; edits demote the level; `brand_audit` detects tampered runtimes.
- Protocol-native: structured outputs with declared `outputSchema` on every tool, enforced token budgets, no mid-JSON truncation.
- Evidence, not claims: public agent-eval suite in-repo (`npm run eval`); results published only from actual runs with stated model versions; a hash-committed private holdout is planned for 0.12.
- Safe defaults: unknown profile values preserve the 12-tool Core surface.

### 7. FAQ (brief, also the JSON-LD FAQPage source)
Suggested: "Do I need an account?" (no) / "What AI tools does it work with?" (any MCP client via stdio; ChatGPT and remote clients via the hosted runtime or by uploading `brand-report.html`) / "What does it cost?" (open source, MIT) / "How is this different from pasting my brand guide into a prompt?" (portable, governed, provenance-tracked, ~25% more token-efficient structured runtime vs. 200–400 tokens of pasted context per prompt).

## Accuracy guardrails
- Tool counts: say **"12 core tools"** and **"40+ tools in full profile"** — never a specific full-profile number (docs disagree: 41/43/44).
- Test count is **760/760** as of v0.11.3 — don't use older 556 figures from repo docs.
- The hosted `@brandcode/mcp` is **pre-release** — never imply it's generally available.
- Never use "brand_name" in copy examples; the canonical field is `client_name`.
- Every external claim (provenance, registry, tests) must link to its verification source.

## Implementation constraints (this repo — read these files first)

- **Route:** create `app/brandcode/mcp/page.tsx` so it inherits `app/brandcode/layout.tsx` (BrandcodeHeader, BrandcodeFooter, MotionTierProvider, `brandcode.css`). Then in **`proxy.ts`**: add `"/mcp"` to `PRODUCT_PREFIXES` and rewrite `/mcp` → `/brandcode/mcp` on the product domain (mirror how `/` rewrites to `/brandcode`). Canonical URL must be `https://www.brandcode.studio/mcp`.
- **Metadata:** most brandcode pages are `"use client"` and can't export `metadata`. Make `page.tsx` a server component that exports full `Metadata` (title ≈ "Brandsystem MCP — Use your brand guidelines with AI", description, OpenGraph, Twitter card, `alternates.canonical: "https://www.brandcode.studio/mcp"`), rendering a client child for interactivity (tabs, copy buttons).
- **Structured data (net-new to this repo):** inline JSON-LD — `SoftwareApplication` (name, version 0.11.3, operatingSystem "Node.js", offers price 0, license MIT, sameAs → npm/GitHub/registry URLs) + `FAQPage` from section 7.
- **Sitemap/robots (net-new):** add `app/sitemap.ts` and `app/robots.ts` (App Router conventions) covering at least the brandcode marketing routes and `/mcp`.
- **llms.txt:** update `public/llms.txt` to reference this page as canonical, and **fix the stale GitHub org** — it currently says `github.com/Brand-System/brandsystem-mcp`; correct org is `Brandcode-Studio`. Refresh version references to 0.11.3.
- **Nav:** add an "MCP" entry to `NAV_ITEMS` in `app/brandcode/BrandcodeHeader.tsx`.
- **Redirects:** check for any legacy `/mcp`-adjacent paths in `proxy.ts` / `next.config.ts` and 308 them to `/mcp`; the bare-domain → `www` redirect already exists, leave it.

## Design constraints

- Match the brandcode "brutalist editorial dashboard" aesthetic in `app/brandcode/brandcode.css`: dark surface `#1a171a`, accent `#f44d37` (hover `#e4250c`), acid green `#b9ec3b` sparingly for success/verified states, light pink `#fbdbf2` only if a campaign surface is needed.
- Type: Inter (already loaded via `next/font/local` in `app/lib/fonts.ts` — do NOT re-import) for display/body; mono stack (`--bc-mono`) for labels, commands, file names, and the install/starter-prompt blocks. Big editorial display sizes, tight tracking, per the existing `--web-display-size` scale.
- **Plain CSS with the existing `--bc-*` custom properties and `.bc-*` classes — no Tailwind.** Reuse existing components/primitives from `app/brandcode/page.tsx` (HeroTitle, GrainOverlay, AmbientGlow) where they fit.
- Motion: `motion/react` scroll reveals that animate **position only, never opacity** — content must be fully readable with JS disabled (deliberate pattern for crawlers and AI extraction; this page especially will be read by agents).
- Code blocks and the starter prompt are the visual heroes of the page — make copy-to-clipboard obvious and satisfying.

## Acceptance checklist
- [ ] `https://www.brandcode.studio/mcp` resolves on the product domain (proxy allowlist + rewrite done)
- [ ] All five install tabs render with working copy buttons; commands byte-identical to this brief
- [ ] Starter prompt block copyable
- [ ] Trust strip links resolve to npm, GitHub, and the MCP Registry listing
- [ ] `Metadata` + canonical + OG tags present; JSON-LD validates (SoftwareApplication + FAQPage)
- [ ] `app/sitemap.ts` and `app/robots.ts` served; `/mcp` included
- [ ] `public/llms.txt` updated (canonical URL, correct GitHub org, v0.11.3)
- [ ] Nav entry added; page readable with JS disabled; no Tailwind introduced
- [ ] No invented numbers — tool counts and test counts match the guardrails above
