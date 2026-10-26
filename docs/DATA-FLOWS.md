# Data flows and network egress

This page lists every network destination the published `@brandsystem/mcp`
package can contact, when it does, what it sends, and how to turn it off.

Scope: the npm package — the local stdio MCP server (`brandsystem-mcp`,
`npx @brandsystem/mcp`) and its CLI. The hosted Brandcode MCP (`src/hosted/`,
`api/`) is a separate deployment, is not shipped in the package, and is not
covered here.

## Defaults at a glance

- **Starting the server makes no network requests.** Nothing phones home on
  startup, and there is no update check.
- **Network use is tied to tool calls.** Extraction tools fetch the URLs you
  give them; connector tools talk to Brandcode Studio. Everything else
  (validation, compile, scoring, reports, exports) is local file I/O in
  `.brand/`.
- **One default-on third party:** when web extraction can't find a logo on the
  site itself, the site's *domain* is sent to Clearbit's logo service and then
  Google's favicon service as fallbacks. See
  [Logo fallback services](#logo-fallbacks).
- **Opt-in only:** anonymous telemetry (`BRANDSYSTEM_TELEMETRY`), Firecrawl
  rendering (`FIRECRAWL_API_KEY`), and extra Studio origins
  (`BRANDCODE_STUDIO_TRUSTED_ORIGINS`).
- **No install-time network or code:** the package and its production
  dependency tree have no install lifecycle scripts. Puppeteer uses the Chrome
  already on your machine (no browser download) and launches it with
  background networking, component updates, sync and domain-reliability
  reporting disabled, behind a loopback egress proxy that is its only network
  path.

## Environment variables that change network behavior

| Variable | Default | Effect |
|---|---|---|
| `BRANDSYSTEM_TELEMETRY` | unset (off) | `true`/`1`/`yes` sends anonymous tool-call telemetry. |
| `FIRECRAWL_API_KEY` | unset (off) | Routes web extraction through Firecrawl's API. |
| `BRANDCODE_STUDIO_TRUSTED_ORIGINS` | unset | Adds Studio origins (staging, self-hosted, localhost) the connector may send credentials to. |
| `BRANDSYSTEM_PROFILE` | `core` | `full` always lists `brand_feedback`, which can POST feedback when called; `core` lists it only after a tool failure in that session. |

## How this is enforced

`security/egress-allowlist.json` is the source of truth for the destinations
below, and `test/security/egress-allowlist.test.ts` (part of `npm test`, so it
gates every PR and every release build) enforces it:

- It scans `src/` and the built `dist/` (excluding `src/hosted` / `dist/hosted`,
  which are not in the package) plus `bin/brandsystem-mcp.mjs` for every
  hard-coded `http(s)://` / `ws(s)://` host. Each occurrence must belong to a
  listed destination *in a listed source module*, or match an explicit ignore
  rule with a written reason (XML namespaces, example URLs in tool
  descriptions, attribution links in generated files, loopback).
- Every hard-coded endpoint below must still exist in both `src/` and `dist/`,
  and every allowlisted host and ignore rule must still match something, so
  the list can't go stale in either direction.
- The section between the markers below is generated from the allowlist and
  the test fails if it differs, so this page can't drift from what is enforced.

Limits of a static scan: it covers this package's own code, not third-party
dependency internals, and cannot see a host assembled at runtime from
non-URL fragments. User-supplied URLs are covered at runtime instead, by the
SSRF guard in `src/lib/url-validator.ts` and the browser egress proxy in
`src/lib/browser-egress-proxy.ts`.

To add a destination: add it to `security/egress-allowlist.json`, run
`node scripts/render-data-flows.mjs --write`, and commit both files.

<!-- BEGIN GENERATED FROM security/egress-allowlist.json — edit that file, then run `node scripts/render-data-flows.mjs --write` -->

## Summary

| Destination | Hosts | Consent | Tools |
|---|---|---|---|
| [Sources you point a tool at](#user-sources) | *any URL you provide* | user-initiated | brand_start, brand_extract_web, brand_extract_site, brand_extract_visual, brand_extract_messaging, brand_set_logo |
| [Logo fallback services (Clearbit, Google favicons)](#logo-fallbacks) | `logo.clearbit.com`, `www.google.com` | default-on fallback | brand_start, brand_extract_web |
| [Firecrawl rendering API](#firecrawl) | `api.firecrawl.dev` | opt-in | brand_start, brand_extract_web |
| [Brandcode Studio connector](#brandcode-studio-connector) | `www.brandcode.studio`, `brandcode.studio` | user-initiated | brand_brandcode_auth, brand_brandcode_connect, brand_brandcode_sync, brand_brandcode_live, brand_connect_repo, brand_repo_status, CLI: brandsystem-mcp brandcode connect\|sync |
| [brand_feedback reports](#feedback) | `www.brandcode.studio` | user-initiated | brand_feedback (full profile; in core, offered only after a failure) |
| [Anonymous usage telemetry](#telemetry) | `www.brandcode.studio` | opt-in | all tools (when enabled) |
| [Hosted MCP entry (not used by the local server)](#hosted-entry) | `www.brandcode.studio` | not used locally | none — dist/index-http.js is the hosted Brandcode MCP adapter |

### <a id="user-sources"></a>Sources you point a tool at

- **Hosts:** *any URL you provide*
- **Which URLs:** Any http(s) URL you pass to a tool (website, page list, logo URL), plus same-site stylesheets, sitemap.xml, common logo paths and pages linked from it.
- **Consent:** user-initiated
- **Tools:** brand_start, brand_extract_web, brand_extract_site, brand_extract_visual, brand_extract_messaging, brand_set_logo
- **When it is contacted:** Only when you call one of these tools with a URL. Rendered extraction launches your local Chrome with this package's loopback egress proxy as its only network path.
- **What is sent:** Plain GET/HEAD requests with a `brandsystem-mcp/<version>` (or headless Chrome) User-Agent. No cookies, credentials, or local brand data. Private, loopback, link-local and metadata addresses are refused (SSRF guard, re-checked on every redirect and every browser connection).
- **How to disable:** Don't pass URLs; use brand_extract_pdf / brand_extract_figma / brand_set_logo with inline SVG or data_uri instead.
- **Source:** `src/lib/url-validator.ts`, `src/lib/visual-extractor.ts`, `src/lib/browser-egress-proxy.ts`, `src/lib/logo-extractor.ts`, `src/lib/site-evidence.ts`

### <a id="logo-fallbacks"></a>Logo fallback services (Clearbit, Google favicons)

- **Hosts:** `logo.clearbit.com`, `www.google.com`
- **Consent:** default-on fallback
- **Tools:** brand_start, brand_extract_web
- **When it is contacted:** During web extraction, only if no usable logo was found on the site itself. Clearbit is tried first; the Google favicon service is the last resort.
- **What is sent:** The domain of the site being extracted (in the request URL) and a `brandsystem-mcp/<version>` User-Agent. Nothing else.
- **How to disable:** Set BRANDSYSTEM_THIRD_PARTY_LOGO_FALLBACK=off (also 0/false/no). You can also give brand_extract_web a `logo_url`, or set the logo afterwards with brand_set_logo.
- **Hard-coded endpoints:** `https://logo.clearbit.com/`, `https://www.google.com/s2/favicons?domain=`
- **Source:** `src/lib/logo-extractor.ts`

### <a id="firecrawl"></a>Firecrawl rendering API

- **Hosts:** `api.firecrawl.dev`
- **Consent:** opt-in
- **Tools:** brand_start, brand_extract_web
- **When it is contacted:** Only when the FIRECRAWL_API_KEY environment variable is set; used instead of a direct fetch to render JavaScript-heavy sites.
- **What is sent:** The URL you asked to extract, plus your FIRECRAWL_API_KEY as a bearer token.
- **How to disable:** Leave FIRECRAWL_API_KEY unset (the default).
- **Hard-coded endpoints:** `https://api.firecrawl.dev/v1/scrape`
- **Source:** `src/lib/firecrawl.ts`

### <a id="brandcode-studio-connector"></a>Brandcode Studio connector

- **Hosts:** `www.brandcode.studio`, `brandcode.studio`
- **Consent:** user-initiated
- **Tools:** brand_brandcode_auth, brand_brandcode_connect, brand_brandcode_sync, brand_brandcode_live, brand_connect_repo, brand_repo_status, CLI: brandsystem-mcp brandcode connect|sync
- **When it is contacted:** Only when you call a connector tool, or — after you turn on Live Mode with brand_brandcode_live — when brand_status, brand_check, brand_check_compliance, brand_runtime, brand_preview or brand_audit_content refresh an expired cached package. Additional Studio origins (staging, self-hosted, localhost) are trusted only if you list them in BRANDCODE_STUDIO_TRUSTED_ORIGINS. A brand URL on any other (custom) domain is read only as a public package: https only, through the SSRF guard, with no credentials.
- **What is sent:** Brand slug and share token (pull); email address (sign-in: magic link / device code); session token; the compiled brand package (push/save); repo owner/name, branch and path (repo connect). Credentials are sent only to trusted Studio origins, and never to a different origin (redirects included).
- **How to disable:** Don't call the connector tools and leave Live Mode off (the default). `brand_brandcode_live mode="off"` stops background refreshes.
- **Hard-coded endpoints:** `https://www.brandcode.studio`, `https://brandcode.studio`
- **Source:** `src/connectors/brandcode/trust.ts`, `src/connectors/brandcode/resolve.ts`, `src/tools/brand-brandcode-auth.ts`, `src/tools/brand-repo-connect.ts`, `src/tools/brand-repo-status.ts`

### <a id="feedback"></a>brand_feedback reports

- **Hosts:** `www.brandcode.studio`
- **Consent:** user-initiated
- **Tools:** brand_feedback (full profile; in core, offered only after a failure)
- **When it is contacted:** Only when brand_feedback is called. It also retries earlier reports in ~/.brandsystem/feedback/ that never reached the server. In the default `core` profile the tool stays hidden until a tool response in that session reports a failure (an error, an elided oversized response, or a LOW/empty extraction); revealing it sends nothing — a report is sent only when an agent calls it.
- **What is sent:** The feedback item: category, severity, summary/detail text (sanitized), tool name, error context; for `agent_signal` items also the brand's client_name, session number and schema version from .brand/brand.config.yaml. Saved locally first.
- **How to disable:** Don't call brand_feedback (in the default `core` profile it is not even listed until a failure). brand_feedback_review and brand_feedback_triage are local-only.
- **Hard-coded endpoints:** `https://www.brandcode.studio/api/feedback`
- **Source:** `src/tools/brand-feedback.ts`

### <a id="telemetry"></a>Anonymous usage telemetry

- **Hosts:** `www.brandcode.studio`
- **Consent:** opt-in
- **Tools:** all tools (when enabled)
- **When it is contacted:** Only when BRANDSYSTEM_TELEMETRY is `true`, `1` or `yes`. Off by default.
- **What is sent:** Tool name, success/error code, duration, extraction-quality grade, session number, package version, a random per-process session id, and the MCP_CLIENT env value. No brand content, URLs, file paths, or user data.
- **How to disable:** Leave BRANDSYSTEM_TELEMETRY unset (the default).
- **Hard-coded endpoints:** `https://www.brandcode.studio/api/telemetry`
- **Source:** `src/lib/telemetry.ts`

### <a id="hosted-entry"></a>Hosted MCP entry (not used by the local server)

- **Hosts:** `www.brandcode.studio`
- **Consent:** not used locally
- **Tools:** none — dist/index-http.js is the hosted Brandcode MCP adapter
- **When it is contacted:** Never by `brandsystem-mcp` / `npx @brandsystem/mcp`. The file ships in dist/ but its hosted router (dist/hosted) is excluded from the package, so it cannot start from an installed copy.
- **What is sent:** Nothing from a local install.
- **How to disable:** Nothing to disable.
- **Hard-coded endpoints:** `https://www.brandcode.studio`
- **Source:** `src/index-http.ts`

<!-- END GENERATED -->

## Reporting

If you find network traffic not described here, please report it as a
security issue — see [SECURITY.md](../SECURITY.md).
