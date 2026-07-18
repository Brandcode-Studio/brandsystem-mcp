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

We aim to acknowledge new reports within two business days. After reproducing
and assessing a report, we will share its status and coordinate remediation and
disclosure with the reporter. Fix and disclosure timing depends on severity,
complexity, and downstream impact.

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
| Network access | Fetching the websites/Figma sources you explicitly provide; optional Brandcode Studio connector; optional `brand_feedback` reports. No other outbound traffic. |
| Filesystem access | Reading and writing the local `.brand/` runtime — the product's core artifact. |
| Environment variables | `BRANDSYSTEM_PROFILE`, opt-in telemetry, and connector credentials. |
| Shell access | Only in the explicit installer (`install --client codex/cline` delegates to those tools' official CLIs) and Puppeteer launching a local Chromium for rendered extraction. |
| Native/WASM/minified code | PDF.js (PDF guideline extraction) and browser tooling — upstream, integrity-hashed dependencies. |

Independent facts a reviewer can verify: zero npm advisories on install, zero
open Dependabot alerts, registry signatures + SLSA provenance on every
release, no install lifecycle scripts in the production dependency tree, and
an allowlist-tested tarball (`test/package-contents.test.ts`) that excludes
hosted code, tests, specs, and source maps.
