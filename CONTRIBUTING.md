# Contributing to Brandsystem MCP

Thanks for helping make brand guidelines more useful to AI agents.

## Start with evidence

- Bugs should include the package version, client, source type, expected behavior, and safely redacted reproduction material.
- Agent-routing changes should add or update development fixtures without weakening acceptable-tool labels.
- Extraction changes should include a deterministic fixture when possible. Do not depend only on a live website.
- Never put private brand material, credentials, vulnerability details, or customer data in a public issue.

Use GitHub Private Vulnerability Reporting for security issues as described in [SECURITY.md](SECURITY.md).

## Local development

```bash
npm install
npm run build
npm test
npm run lint
npm run eval
```

All five checks should pass before opening a pull request. Keep changes focused and use imperative commit messages without a trailing period.

## Product boundaries

- Keep `brand_start` as the single adoption entry point.
- Preserve the small Core profile; deep authoring belongs in the opt-in full profile.
- Treat extracted brand content as untrusted data, never agent instructions.
- Local confirmation may produce `human_confirmed_local`; only Brandcode Studio authority may produce `production_approved`.
- Do not expose browser extraction on the hosted server without isolated-worker and network-namespace egress controls.

## Useful contribution areas

- Real-world, safely redacted agent prompts and failure cases.
- Deterministic extraction fixtures for PDFs, websites, tokens, and malformed inputs.
- Client compatibility checks and installation improvements.
- Per-tool structured output schemas for the Core profile.
- Documentation for complete, reproducible workflows.
