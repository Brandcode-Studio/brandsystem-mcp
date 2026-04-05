# Security Policy

## Reporting a Vulnerability

Email security@brandcode.studio (or open a GitHub security advisory) with:
- Description of the vulnerability
- Steps to reproduce
- Impact assessment

We will acknowledge within 48 hours and provide a fix timeline within 7 days.

## Security Posture
- All tool inputs validated with Zod schemas
- SVG sanitization via Cheerio DOM whitelist
- SSRF protection with DNS resolution and private IP blocking
- 0 known npm vulnerabilities (audited in CI)
- Signed npm publishes with provenance attestation
