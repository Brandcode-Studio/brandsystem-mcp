# The /mcp landing page — context and maintenance

**Live URL (canonical):** https://www.brandcode.studio/mcp
**Served from:** the UCS repo (`zk-xyz/column-five-prototypes`), `public/mcp/`
(static Claude Design export + `/mcp → /mcp/index.html` rewrite in
`next.config.ts`). This repo references the page; it does not host it.

## Why it exists

npm, the MCP Registry, GitHub, and third-party directories all need one
authoritative destination. `package.json#homepage` and `server.json#websiteUrl`
point here. The page was designed via Claude Design from the 2026-07-17 brief
(archived in the UCS repo) against the "Use your brand guidelines with AI"
positioning, with an "Evidence, not claims" section mirroring this repo's
honesty policy.

## Fact-check checklist (run whenever the page is touched, and after releases)

The page is a static export — it does NOT update itself. Stale facts on the
canonical page are worse than no page. Check:

- [ ] Version chip + npm line match the current npm `latest`
- [ ] Test count in the trust strip matches `npm test` on the released tag
- [ ] Install selector lists every client `install --client` supports
      (source of truth: `src/cli/install.ts`)
- [ ] Install commands match README exactly
- [ ] Any quantitative claim traces to a published receipt in `eval/receipts/`
      or a measured value in eval/RESULTS.md — never repurpose a statistic
      from a different context (a "~25% token efficiency" claim was caught
      doing exactly this before first deploy)
- [ ] No personal contact details — route contact through GitHub issues /
      Security Advisories (a `mailto:` to a personal address was caught
      before first deploy; the NOW-bucket scrub applies to this page too)
- [ ] Hosted `@brandcode/mcp` remains marked pre-release until that changes

## Deployment note

Asset paths in the export must be absolute (`/mcp/support.js`, `/mcp/fonts/…`)
— relative paths 404 under the clean-URL rewrite and the page renders with raw
`{{ }}` template placeholders (unhydrated). Verified fix pattern lives in the
gstack learnings log.

## Release coupling

`homepage`/`websiteUrl` shipping in npm/registry metadata point at this page,
so the page must be deployed (or at minimum not 404) before the next release
is cut. The 0.11.2 release previously had to *remove* a dead `/mcp` pointer —
don't reintroduce that class of bug.
