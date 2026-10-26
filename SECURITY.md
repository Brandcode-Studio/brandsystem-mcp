# Security Policy

## Supported Versions

Security fixes are applied to the latest published version of
`@brandsystem/mcp` and to the current `main` branch. Older releases may not
receive patches; users should upgrade to the latest npm release.

## Reporting a Vulnerability

Please report suspected vulnerabilities privately. Do not include technical
details, proofs of concept, secrets, or customer data in a public issue.

Preferred method:

1. Open the repository's **Security** page.
2. Select **Advisories**.
3. Choose **Report a vulnerability**.

GitHub Private Vulnerability Reporting keeps the report and subsequent
discussion visible only to the reporter and repository security maintainers.

If GitHub reporting is unavailable, email `security@brandcode.studio`.

Include, when available:

- the affected package version, commit, tool, or endpoint;
- a clear description of the behavior and potential impact;
- minimal steps to reproduce;
- a safely redacted proof of concept; and
- any suggested mitigation.

## What to Expect

This is a small team, so these are targets we commit to working toward rather
than contractual guarantees. If we are going to miss one, we will tell you.

| Step | Target |
|---|---|
| Acknowledge the report | within 2 business days |
| Triage: reproduce, assign a severity (CVSS), share our assessment | within 7 calendar days |
| Fixed release (or a documented mitigation) — Critical | within 7 days of triage |
| Fixed release — High | within 30 days of triage |
| Fixed release — Medium | within 90 days of triage |
| Fixed release — Low | next scheduled release, best effort |

We coordinate the advisory text, CVE request, credit, and publication date with
the reporter. Advisories are published on GitHub once a fixed version is on
npm, normally within 7 days of the fix, unless the reporter asks us to wait
longer for downstream users to upgrade.

## Past Advisories

| Advisory | Summary | Fixed in |
|---|---|---|
| [GHSA-j3rv-rv99-hg74](https://github.com/Brandcode-Studio/brandsystem-mcp/security/advisories/GHSA-j3rv-rv99-hg74) | SSRF guard bypass: IPv4 addresses embedded in IPv6 literals (e.g. `[::ffff:169.254.169.254]`) reached cloud-metadata and loopback addresses. | 0.17.0 |

## Scope

This policy covers security issues in:

- the published `@brandsystem/mcp` package;
- source code and hosted MCP behavior implemented in this repository; and
- this repository's build and package-release workflow.

General product support, feature requests, and non-sensitive bugs should use
the public issue tracker. Vulnerabilities in third-party products should be
reported to their maintainers unless the issue is caused by this project's
integration with that product.

## Research and Disclosure

Please act in good faith:

- test only accounts, brands, data, and systems you are authorized to use;
- avoid privacy violations, service disruption, data destruction, and
  unnecessary access or persistence;
- collect only the evidence needed to demonstrate the issue;
- remove secrets and personal or customer information from reports; and
- allow a reasonable opportunity to investigate and remediate before public
  disclosure.

We will work in good faith with researchers who follow this policy and will
credit valid reports when requested and appropriate.

## Package capabilities and why security scanners flag them

Behavioral scanners (Socket and similar) flag this package for capabilities
that are intentional product functions, not vulnerabilities:

| Flag | Why it exists |
|---|---|
| Network access | Fetching the websites you explicitly provide (Figma data arrives through your Figma MCP, not over the network); the Brandcode Studio connector when you use it; `brand_feedback` reports (full profile only); opt-in telemetry and opt-in Firecrawl rendering; and, when a site has no detectable logo, a logo lookup by domain at Clearbit and Google's favicon service (turn off with `BRANDSYSTEM_THIRD_PARTY_LOGO_FALLBACK=off`). Nothing on startup. Every destination is listed in [docs/DATA-FLOWS.md](docs/DATA-FLOWS.md) and enforced by `test/security/egress-allowlist.test.ts`. |
| Filesystem access | Reading and writing the local `.brand/` runtime — the product's core artifact. |
| Environment variables | `BRANDSYSTEM_PROFILE`, opt-in telemetry (`BRANDSYSTEM_TELEMETRY`), opt-in Firecrawl (`FIRECRAWL_API_KEY`), extra trusted Studio origins (`BRANDCODE_STUDIO_TRUSTED_ORIGINS`), the third-party logo fallback switch (`BRANDSYSTEM_THIRD_PARTY_LOGO_FALLBACK`), and connector credentials. |
| Shell access | Only in the explicit installer (`install --client codex/cline` delegates to those tools' official CLIs) and Puppeteer launching a local Chromium for rendered extraction. |
| Native/WASM/minified code | PDF.js (PDF guideline extraction) and browser tooling — upstream, integrity-hashed dependencies. |

Independent facts a reviewer can verify: zero npm advisories on install, zero
open Dependabot alerts, registry signatures + SLSA provenance on every
release, no install lifecycle scripts in the production dependency tree, and
an allowlist-tested tarball (`test/package-contents.test.ts`) that excludes
hosted code, tests, specs, and source maps.
A CycloneDX SBOM and `SHA256SUMS` are attached to every GitHub release
published after 0.17.0 (see below).

## Verifying a Release

Every release is built, tested and packed by
[`.github/workflows/publish.yml`](.github/workflows/publish.yml) in a job with
no publish credentials, then published from that exact tarball with npm
trusted publishing (OIDC) and SLSA provenance. To check what you install:

1. **Provenance attestation exists.** Replace `<v>` with the version:

   ```sh
   npm view @brandsystem/mcp@<v> dist.attestations
   ```

   Expect a `provenance` entry with `predicateType`
   `https://slsa.dev/provenance/v1`. The npm package page also links the
   provenance to the exact commit and workflow run.

2. **Signatures and attestations verify.** In a project where the package is
   installed:

   ```sh
   npm audit signatures
   ```

   This checks the registry signature of every installed package and the
   provenance attestation of every package that has one, including
   `@brandsystem/mcp`. Our CI runs the same check on this repo's dependency
   tree on every pull request.

3. **The tarball matches the release evidence.** Releases after 0.17.0 carry
   `SHA256SUMS`, `brandsystem-mcp.cdx.json` (CycloneDX SBOM of the production
   dependency tree) and `build-info.json` (commit, Node and npm versions, run
   URL):

   ```sh
   gh release download v<v> --repo Brandcode-Studio/brandsystem-mcp \
     -p SHA256SUMS -p brandsystem-mcp.cdx.json -p build-info.json
   npm pack @brandsystem/mcp@<v>      # downloads the registry tarball
   sha256sum --check SHA256SUMS       # tarball and SBOM must both say OK
   ```

4. **Optional: rebuild from source.** The `reproducible-build` CI job builds
   and packs twice from a clean tree and requires identical sha256. To rebuild
   a release yourself, check out the tag, use the Node and npm versions from
   `build-info.json`, and run `npm ci --ignore-scripts && npm run build &&
   npm pack`. With a different npm or Node version the gzip bytes can differ;
   in that case compare the unpacked contents (`tar -xzf` both tarballs and
   `diff -r`), which should be identical.

## Network Egress and Data Flows

[docs/DATA-FLOWS.md](docs/DATA-FLOWS.md) lists every network destination the
package can contact, when, what it sends, whether it is opt-in, and how to turn
it off. It is generated from `security/egress-allowlist.json`, and a test fails
if the code contacts a hard-coded host that is not on that list.
