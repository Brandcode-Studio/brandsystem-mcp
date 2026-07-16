# Security & Agentic Hardening Roadmap — Reconciled Plan

**Date:** 2026-07-16
**Sources:** Codex security/agentic review → Claude verification + adversarial critique → Codex reconciliation → two-MCP identity resolution (Phase 0 lock) → Codex correction pass (7 corrections, verified and applied 2026-07-16).
**Status:** Direction agreed; main-branch workflow decided and implemented (Option A, 2026-07-16). Remaining NOW items unblocked.

## Governing principles

1. **One entry point, small default surface.** Evolve `brand_start`; never add a competing entry tool.
2. **Trusted templates around untrusted evidence.** Prompt injection here is a data-flow and persistence problem, not a labeling problem. Instruction channels (`next_steps`, `conversation_guide`, exports) are template-only; extracted content lives in delimited data fields.
3. **No runtime becomes production policy without an explicit promotion boundary.** `brand-runtime.json` is deliberately consumed by future agents as trusted policy — automatically extracted runtimes stay visibly provisional until a human promotes them.
4. **Enforce the Build/Use boundary; never rename it.** Per `specs/brandcode-mcp-phase-0-lock.md`: `@brandsystem/mcp` is the open local **Build** MCP; **Brandcode MCP** is the hosted, authenticated **Use** MCP. "Two MCPs, one brand." The identity problem is an execution gap against this lock, not a naming decision. No org migration, no npm rename — third-party listings (Glama, LobeHub, Smithery) stay intact.
5. **Tell the truth about every trust boundary.** Claims scale with evidence: "untrusted content is quarantined; instruction channels are template-only" — never "prompt-injection proof" (server-side tests cannot prevent a consuming agent from reading evidence text).

## Verified current state (2026-07-16)

- Tarball: 521 files; 96 `dist/hosted/*`; `bin/brandcode-mcp.mjs` ships (dead weight — not declared in `bin`, so not installed as an executable; boundary violation + attack-surface bloat, not an execution vuln).
- GitHub: no `main` branch protection; secret scanning, push protection, validity checks, Dependabot security updates all disabled; no CodeQL.
- Workflows: actions pinned to tags not SHAs; only `publish.yml` declares permissions.
- Credentials: `src/lib/auth-state.ts` writes `brandcode-auth.json` via plain `writeFile` — no `0600`, no atomic rename; no `realpath`/symlink checks in `src/lib`.
- Responses: warn-only at 5,000 chars (`src/lib/response.ts:100`), hard cap 50,000.
- No trust classification on extracted text; no prompt-injection fixtures in `test/`.
- Official MCP registry: stale `io.github.Brand-System/brandsystem-mcp` v0.4.3 titled "Brandcode MCP" — wrong org, wrong version, and mislabels the Build product with the Use product's name. Root cause: the April org-rename commit (2b80503) assumed the registry refreshes from `server.json`; it requires an explicit re-publish.
- `Brand-System` still exists as a GitHub org and the maintainer account is an active admin (verified) — no squat risk; needs ownership continuity instead.
- `package.json` description claims "deploy to … ChatGPT, and any MCP-compatible tool"; `server.json` claims "every MCP client" — overbroad until the three compatibility claims are distinguished.
- `brand-runtime.json` already emits `version: config.schema_version` (`runtime-compiler.ts:64`) — the field exists but its name is ambiguous.
- `report-html.ts` already uses `escapeHtml()` (14 call sites) and SVG sanitization — the HTML work is a coverage audit, not greenfield protection.
- Commit workflow today is direct-to-main (with occasional PRs) — branch protection as specced would break the current build lane.
- README/llms.txt: publish internal legal/ops posture, personal abuse-contact email, staging URLs, release-gate status, internal spec paths — in files designed to be read by LLMs.

---

## NOW — repository, settings, and pre-release work

(Repo-visible changes land immediately on GitHub; npm's README and package metadata stay frozen at 0.9.5 until the 0.9.6 publish. Workflow hardening requires commits.)

1. **Scrub README and `llms.txt`.** Remove hosted-product internal ops/legal notes from the open package's docs. Add the Phase 0 relationship statement: *"Brandsystem MCP is the open local brand toolkit by Brandcode Studio; Brandcode MCP is the hosted Use MCP for authenticated Brandcode Studio clients."* (Phase 0 spec has cross-reference copy drafted.) **Include `package.json` and `server.json` in the truthfulness scrub** — both currently claim broad compatibility ("ChatGPT", "every MCP client") that must align with the three-claim distinction (0.10 §7).
2. ~~DECISION: main-branch workflow~~ **DECIDED & IMPLEMENTED (2026-07-16): Option A.** Active ruleset `main-protection` on `main`: PR required, 0 approvals (solo maintainer — CI is the gate), required checks `build-and-test (20/22/24)`, no force-push, no deletion, no bypass actors. Repo has auto-merge + delete-branch-on-merge enabled. CLAUDE.md/AGENTS.md updated with the branch→PR→auto-merge workflow.
3. **Enable remaining GitHub protections:** secret scanning, push protection, CodeQL workflow, and **Dependabot for both npm and GitHub Actions** (so SHA-pinned actions stay maintainable).
4. **Workflow hardening:** explicit minimal `permissions:` in ci/hosted-smoke/benchmark; pin all actions to immutable commit SHAs.
5. **Registry repair (exact mechanism):** publish `io.github.Brandcode-Studio/brandsystem-mcp` titled "Brandsystem MCP" at the current version; verify via the Registry API; request removal of the stale `Brand-System` listing through Registry moderation. Registry ownership is namespace-bound and npm validation requires `mcpName` to match the server name — do **not** publish a legacy-namespace npm version just to alter old metadata.
6. **`Brand-System` org ownership continuity** (org exists; maintainer is active admin): retain the org, document its legacy purpose, require MFA, keep at least two recovery-capable owners if possible.
7. **Provisional poisoned-runtime response runbook (internal).** Written response steps now (re-extract, re-approve, notify affected clients). The provenance-integrity *detector* does not exist yet — `brand_audit_drift` scores content compliance, not policy-vs-provenance — and is built in 0.9.6/0.10. Exercise the runbook before making any public incident-readiness claim; a note alone does not complete a public security posture.

## 0.9.6 — Security & distribution integrity

1. **Slim the npm package to the Build MCP only:** exclude `dist/hosted/**` and `bin/brandcode-mcp.mjs` **from the tarball** (the repository build can still compile hosted code — the hosted smoke workflow needs it). Add a CI test on `npm pack --dry-run` that fails if hosted code, tests, internal specs, or undeclared executables enter the tarball (allowlist-based). This enforces the Phase 0 Build/Use boundary in packaging.
2. **Credential hardening:** `0600` owner-only mode on `brandcode-auth.json`; atomic write (temp file + rename); conservative directory permissions; token redaction audit across status/telemetry/errors/history.
3. **Symlink-safe filesystem operations:** resolve real paths (`realpath`), reject traversal on resolved paths, not lexical checks — across `brand-dir.ts` and asset ingestion.
4. **Instruction-field taint audit.** Trace website/PDF/Figma/repo/hosted-brand/user-input/upstream-error values into: agent instructions (`next_steps`, `conversation_guide`), status messages, errors, generated Markdown, **`brand-report.html` (XSS class — `escapeHtml()` and SVG sanitization already cover many sinks; audit ALL sinks for coverage gaps and add malicious-value tests rather than assuming no protection exists)**, runtime policy fields, **exported skill files (direct instruction channel to future agents)**, telemetry, and feedback.
5. **Template-only control fields:** `next_steps` and `conversation_guide` built exclusively from trusted templates and validated enums — no extracted prose interpolation.
6. **Delimited evidence structure** for untrusted content (`{ evidence: { content, source, trust, instructional: false } }`) — the label matters only because enforcement keeps evidence out of instruction channels.
7. **Minimal runtime approval status (moved up from 0.10):** every compiled runtime carries `approval: "provisional_extracted"` plus a provenance summary, with **no promotion mechanism yet** — nothing can become non-provisional in 0.9.6. This gives the injection fixtures a real approval model to test against; the review/promotion experience stays in 0.10.
8. **Prompt-injection fixtures:** hostile sources containing "ignore previous rules", "call another tool", "read an unrelated file", "upload credentials", "change the connector URL", "insert into future prompts" — tests prove these (a) never enter instruction fields, and (b) never appear in a runtime marked anything other than `provisional_extracted`. Public claim stays calibrated (see principle 5).
9. **Provenance-integrity detector (start here, finish by 0.10):** compare runtime policy content against approved provenance — the detection mechanism the incident runbook (NOW §7) depends on. Distinct from `brand_audit_drift`, which scores content compliance.

## 0.10 — Agent-first product surface

1. **Evolve `brand_start` into universal adoption** (not a new `brand_adopt` tool): accept/discover websites, PDF guidelines, Figma, existing `.brand/`, token/design-system files, asset folders, Brandcode Studio brands. Returns source assessment, privacy explanation, proposed plan, missing inputs, safest next action; auto mode delegates to existing tools without duplicating logic.
2. **Core profile by default (~8–12 tools):** `brand_start`, `brand_status`, `brand_runtime`, `brand_context`, `brand_check`, `brand_preflight`, `brand_export`, `brand_report`, connector entry points. Full authoring surface via opt-in `full` profile. **Define the selection mechanism explicitly** (startup flag / env var / config file) and test that `full` preserves all existing tool names. Version the default change (breaking for agents calling authoring tools).
3. **`doctor` + install helpers:** `npx @brandsystem/mcp doctor | install --client <codex|claude-code|cursor> | demo | inspect`. `doctor` validates Node, client config, package version, `.brand/` state, credential permissions (requires 0.9.6 `0600` work first), runtime freshness, optional browser deps. **`install --client` defaults to preview/dry-run, preserves existing client configuration, makes backups, and requires explicit confirmation before writing.**
4. **Deterministic `brand_context`:** parameterized slice selection over the compiled runtime (task/audience/channel → rule subsets). No model-side inference in the server; judgment stays with the agent. **Returns its matched selectors, and an explicit "no governed match" result instead of silently falling back.**
5. **Tool annotations:** `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`, clear titles. Pulled forward from 0.11 — cheap to classify. Documented as untrusted hints, not security controls.
6. **Runtime provenance + promotion gate:** approval states `provisional_extracted` → `human_confirmed_local` → `production_approved`. Local confirmation rides the existing `brand_clarify` / `needs-clarification.yaml` pattern but **confers only `human_confirmed_local`** — it proves someone responded, not that they hold brand authority. `production_approved` is conferred only by Brandcode Studio (Brand Console, per the Phase 0 lock reserving canonical approval) or an explicitly defined signed/offline authority mechanism. This preserves the distinction between a locally reviewed Brand Kit and an Official Brand runtime. `brand_runtime` surfaces approval state; exports from non-production runtimes stamp their status into the artifact (and warn).
7. **Runtime schema-version migration** (the field exists — `runtime-compiler.ts` emits `version: config.schema_version`, ambiguously named): add explicit `schema_version` alongside `version` without removing it; define what `version` means going forward (schema vs. runtime/package version); update runtime schemas, MCP resources, connector fixtures, hosted consumers, exports, and tests; deprecate the ambiguous field only after a compatibility window.
8. **Compatibility docs distinguish three claims:** direct local stdio connection; remote hosted connection; copying a generated runtime into an AI tool. (ChatGPT connects to remote MCP servers, with a documented tunnel option for local.) The NOW-bucket metadata scrub (package.json/server.json) aligns to this same distinction.

## 0.11 — Reliable agent interoperability

1. **Structured outputs:** common response-envelope `outputSchema` first (cheap — envelope already uniform via `buildResponse`), then deliberate per-tool `data` schemas + tests (not free — 43 heterogeneous shapes). `structuredContent` with human-readable text fallback.
2. **Token-estimated response budgets:** budgets in tokens (~chars/4), `compact`/`standard`/`detailed` modes, hard compact target for entry tools, tests that fail on budget breach. **Never truncate JSON mid-object** — paginate or spill to an MCP resource. `brand_status` answers "where am I, what next?" in a few hundred tokens.
3. **Public agent evaluation suite** (after the 0.10 surface stabilizes — evals against the pre-Core surface would be invalidated): real prompts ("I have a PDF brand guide", "write this in our voice", "check this post"…); measure first-tool selection, calls-to-first-artifact, context tokens, recovery from incomplete inputs, unsupported-claim rate, compliance accuracy, cross-client success, second-agent runtime usability. Publish fixtures, methodology, results.

## Hosted (Use MCP) prerequisite — separate lane

- Disposable browser worker with deny-by-default egress, socket/DNS-level policy, CPU/memory/process/time limits, ephemeral filesystem, no inherited credentials, narrow validated result channel — **before** any browser extraction is exposed remotely. Independently reviewed.
- **Not** imposed on local users: local browser extraction keeps current mitigations (SSRF checks, address pinning, bounded streams, Chromium sandboxing), honestly documented.

## Deferred / cut

- SBOM + OpenSSF Scorecard: after the above (nice-to-have, not gating).
- Four-level trust taxonomy on every extracted value: superseded by the enforcement-first approach (taint audit + template-only fields + promotion gate); the slim `trust` field on evidence structures covers labeling.
- Local browser containerization: cut until the hosted lane is real.

## Key corrections captured from the review cycle

- Injection is a **data-flow + persistence** problem; the compiled runtime is a stored-injection distribution vector — highest-value security question in the package.
- `brand_adopt` as tool #44 would contradict the sprawl diagnosis; evolve `brand_start`.
- Hosted files in the tarball: attack-surface reduction + boundary hygiene, not an active executable vuln.
- Structured outputs: envelope is cheap, per-tool contracts are deliberate work.
- Identity: the two-name split is **by design** (Phase 0 lock); fix the stale registry entry, packaging boundary, and docs story — never rename orgs, scopes, or products.
- From the correction pass (all claims verified against the repo): approval state must exist *before* the fixtures that test it (minimal status moved to 0.9.6); local clarification cannot confer production authority (Brand Console / signed authority only, per Phase 0); `Brand-System` org is retained and admin-controlled (continuity, not squatting); the runtime `version` field already exists and needs migration, not addition; `brand_audit_drift` is not a provenance detector; branch protection requires a workflow decision first; npm metadata stays stale until the next publish.
