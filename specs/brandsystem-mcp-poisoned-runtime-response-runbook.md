# Poisoned-Runtime Response Runbook (Provisional)

**Status:** Provisional — written 2026-07-16, not yet exercised. Do not make public
incident-readiness claims until this runbook has been exercised at least once.
**Scope:** A `brand-runtime.json` (or exported policy-bearing artifact) that contains
injected instructions or hostile policy content, whether shipped locally to a user or
synced to a Brandcode Studio client.

## Threat

The compiled runtime is deliberately consumed by future agent sessions as trusted brand
policy. A hostile source (website, PDF, Figma text) extracted once and compiled can
persist injected content across every subsequent agent session that loads the runtime —
stored prompt injection with a distribution layer.

## Detection

Current state (0.9.5): **no automated detector exists.** `brand_audit_drift` scores
content compliance, not policy-vs-provenance integrity. Detection today is manual:

1. A user or client reports agent behavior that contradicts their actual brand
   (unexpected instructions, tool-call redirection, requests for secrets).
2. Manual inspection of `brand-runtime.json`, `interaction-policy.json`, and exported
   skill files for instruction-shaped content in policy fields.

Planned (0.9.6–0.10): provenance-integrity detector that compares runtime policy content
against approved provenance records, plus `provisional_extracted` approval state on every
compiled runtime.

## Response

1. **Contain:** instruct the affected user/client to stop loading the runtime
   (remove `.brand/brand-runtime.json` from agent context; disconnect Live Mode via
   `brand_brandcode_live` if hosted-synced).
2. **Identify the source:** check `brand.config.yaml` source URLs and
   `extraction-evidence.json` for the extraction that introduced the content.
3. **Re-extract from a trusted source** or manually correct, then recompile with
   `brand_compile` and re-review policy-bearing fields before redistribution.
4. **If hosted-synced:** verify the hosted brand package, re-issue, and notify any other
   clients of the same brand.
5. **Record:** what was injected, which channel it entered through, which output
   surfaces it reached (runtime, exports, reports), and what fixture should be added to
   the prompt-injection test suite so it cannot recur silently.

## Notification

Affected clients are notified through their Brandcode Studio contact. If the vector is a
package vulnerability (not a hostile source), follow SECURITY.md and issue a GitHub
security advisory.

## Exercise log

| Date | Scenario | Outcome | Gaps found |
|------|----------|---------|------------|
| —    | Not yet exercised | — | — |
