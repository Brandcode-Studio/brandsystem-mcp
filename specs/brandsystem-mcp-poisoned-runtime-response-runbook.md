# Poisoned-Runtime Response Runbook

**Status:** Exercised in scripted form 2026-07-17 (automated in
`test/security/runbook-exercise.test.ts`, run on every CI build); a live-client
drill has not yet been performed. Do not make public incident-readiness claims
beyond what the scripted exercise covers until a live drill is completed.
**Scope:** A `brand-runtime.json` (or exported policy-bearing artifact) that contains
injected instructions or hostile policy content, whether shipped locally to a user or
synced to a Brandcode Studio client.

## Threat

The compiled runtime is deliberately consumed by future agent sessions as trusted brand
policy. A hostile source (website, PDF, Figma text) extracted once and compiled can
persist injected content across every subsequent agent session that loads the runtime —
stored prompt injection with a distribution layer.

## Detection

As of 0.10, `brand_audit` includes the **provenance-integrity detector**
(`src/lib/provenance-integrity.ts`): it fails when (a) the runtime claims an approval
level the stored approval state does not support, or (b) any policy-bearing runtime
field (anti-patterns, never_say, ai_ism_patterns, tone, anchor terms) diverges from a
fresh compile of the current source YAMLs — catching hand-edited/tampered runtimes and
stale runtimes left behind after sources were cleaned. Run `brand_audit` as the first
diagnostic step.

Manual signals remain relevant alongside it:

1. A user or client reports agent behavior that contradicts their actual brand
   (unexpected instructions, tool-call redirection, requests for secrets).
2. Manual inspection of exported skill files for instruction-shaped content — the
   detector covers `brand-runtime.json`, not previously exported artifacts.

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
| 2026-07-17 | Scripted tamper (never_say injection + approval forgery), automated in `test/security/runbook-exercise.test.ts` | Detection and response both worked: `checkProvenanceIntegrity` failed both the approval-claim check (forged `production_approved` vs supported `provisional_extracted`) and the policy-fields check (naming `voice.never_say`); recompiling from sources removed the injected instruction and demoted approval to the supported level; detection passed clean afterward. | Exported-artifact coverage (skill exports, reports) remains manual per the Detection section's own note — the detector covers `brand-runtime.json` only. Containment (step 1) and hosted-sync/notification (steps 4–5, Notification) were not exercisable in script; they still need a live-client drill. |
