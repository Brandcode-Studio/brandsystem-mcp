# Changelog

## Unreleased

### Added

- **`brand_check` can return a scoped Taste counterprompt without faking semantic compliance.** Optional `artifact_kind` / `surface` context selects only matching approved Taste Guidance for revision. The ordinary text/color/font/CSS verdict stays independent, unavailable guidance fails soft, and every response labels Taste semantics `not_evaluated`.
- **External AI tools receive an explicit Taste workflow.** Hosted full/voice runtime responses tell agents to apply only relevant approved Taste Guidance, honor fresh-direction requests, and offer review-only `capture_taste` only after a concrete user judgment when the MCP key carries capture scope. Read-only keys never imply capture is available, and passive capture remains prohibited.
- **Reviewed Taste Memory now closes the hosted MCP loop.** `capture_taste` accepts artifact/surface/runtime context and returns the Brandcode review route while remaining queue-only. Approved Brandcode Taste Guidance is projected into full and voice `brand_runtime` slices and appears as high-confidence `review_evidence` in `brand_search`; pending or quarantined captures never reach agents, and guidance failures remain fail-soft for ordinary runtime and search reads.
- **Hosted AgentRun telemetry is live for every hosted tool call.** `createHostedServer` now wraps `server.tool()` registration with a single telemetry choke point (`wrapServerWithTelemetry`), so each of the 9 hosted tools POSTs an AgentRunHistoryEntry-shaped record to UCS (`surface: mcp-hosted`) with outcome classification (ok/auth_error/upstream_error/tool_error), latency, keyId, and requestId — without editing any individual tool file. Fire-and-forget and fail-open: the POST is registered with Vercel's `waitUntil()` so a Fluid Compute isolate freeze can't drop it mid-flight, carries a 15s timeout, never blocks or alters the tool's real MCP response, and never logs the raw bearer or service token. `brand_status`, `brand_feedback`, and `brand_history` now derive their telemetry posture from the one shared `HOSTED_AGENT_RUN_TELEMETRY_STATUS` constant instead of three hand-written literals.
- **Scheduled hosted smoke CI (`.github/workflows/hosted-smoke.yml`).** Runs `npm run smoke:hosted-mcp` against the live staging deployment daily and on manual dispatch, with a job summary. Deliberately not a PR-blocking check — it exercises a live endpoint with real secrets.
- **Hosted capability-surface lock test (`test/hosted/registrations.test.ts`).** Locks the 9-tool surface at the source-file level: exact tool count (not a floor), per-file `server.tool(` call-site counts, and the file inventory itself — a second registration sneaking into an existing hosted tool file now fails CI instead of silently growing the locked surface.
- **UCS contract fixture test (`test/connectors/brandcode-contract-fixture.test.ts`).** First coverage of `fetchHostedBrandPackage`, plus hosted `brand_runtime`/`brand_search`/`list_brand_assets` consuming a realistic redacted UCS pull-response fixture end-to-end — including a regression-guard test proving the suite catches UCS shape drift (the historical bug class where the contract was only ever tested against self-authored mocks).
- **`HOSTED_TOOL_ORDER` single source of truth (`src/hosted/tool-order.mjs`).** `registrations.ts` and `scripts/hosted-mcp-smoke.mjs` now import one list instead of maintaining hand-synced copies (`tsconfig.json` gains `allowJs` so tsc ships the `.mjs` into `dist/`).
- **Local `brand_status` now returns a `tool_sessions` taxonomy** grouping all 43 registered tools by session/purpose, cross-checked against the live registry by test. `brand_extract_web`/`brand_extract_site` descriptions carry reciprocal NOT-for disambiguation, enforced by a new description-quality test gate (verb-start, sub-300-char first sentence, curated ambiguous pairs).
- **`brand_history` malformed-UCS-body responses now carry `error: "ucs_history_contract_error"`** so AgentRun telemetry classifies a degraded 200-with-garbage-body as `upstream_error` instead of recording it as a healthy call. The hosted router also now constructs the per-request server inside its try/catch, so a registration-time failure degrades to one scoped `internal_error` response instead of an unhandled platform exception across all brands.
- **Hosted `capture_taste` contribute tier.** The hosted Brandcode MCP now includes `capture_taste` behind an explicit `capture` scope. It captures an attribute-level taste judgment (candidate_ref + verdict + required attribute_reason), posts through the UCS `/runtime/taste-capture` route with hosted service authority, and **queues candidates for human review — it never promotes canon or adds anything to the brand.**
- **Typed knowledge/retrieval contract on the connector (`src/connectors/brandcode/knowledge-types.ts`).** Models the `brandKnowledgeCorpus`, `retrievalManifest`, and structured `brandInstance` governance arrays (narratives, proof points, application rules, brand phrases, stats, strategy moves) that UCS ships in the compiled pull package, mirroring `app/tools/lib/brand-instance-types.ts`. `BrandPackagePayload` is now a typed-but-open interface (known fields modeled, index signature retained) instead of a bare `Record<string, unknown>`, so the hosted tools consume real types while staying tolerant of unknown/new fields.

### Changed

- **Hosted MCP runs are now first-class in UCS telemetry via the `mcp-hosted` surface.** UCS added `mcp-hosted` to its `AgentSupportSurface` enum (paired UCS change), so the MCP now tags hosted `brand_feedback` history writes with `surface: "mcp-hosted"` (was the placeholder `"runtime"`) and `brand_history` filters by that surface. The MCP no longer sends `provider=mcp` on the history query — UCS models provider as the downstream model (openai/claude/gemini), not the transport, so a `provider=mcp` filter matched nothing; surface is the correct discriminator. Closes the telemetry-attribution gap where MCP-originated runs were unfindable.
- **Hosted `brand_search` now ranks UCS's compiled knowledge corpus** instead of doing an ad-hoc keyword scan over `brandInstance` arrays. When the pull package carries `brandKnowledgeCorpus` + `retrievalManifest` (every compiled brand), search runs the same retrieval engine UCS uses for Brand Console — mode-aware kind boosting, approval/confidence weighting — and returns hits with `citation`, `source_class`, and `confidence`, plus `coverage`, `blind_spots`, and `warnings` so answers can be hedged. New optional `mode` param (`fact_lookup` default, `doctrine_retrieval`, `asset_retrieval`, `evidence_retrieval`, `coverage_discovery`). Packages without a corpus fall back to the prior keyword scan (tagged `retrieval_engine: "keyword_fallback"`), so nothing regresses. URL-bearing citations/excerpts stay redacted for custody safety.
- **Hosted `brand_runtime` now populates the `voice` and `strategy` slices** (previously hardcoded `null`, deferred as "Milestone B"). `voice` is built from the governance model UCS actually serves — prose `verbalIdentity` + `perspective` + deployable `brandPhrases`; `strategy` from `narratives` + `applicationRules` + `proofPoints` + `strategyMoves` summaries with counts. Both stay `null` when the brand carries no governance. `visual` remains `null` by design: the hosted `brandInstance` carries identity tokens (already mapped) but not the composition/anti-pattern structures the local compiler's `RuntimeVisual` models, so there is nothing honest to fill it with.
- **Inbound capture moved out of the public Build MCP.** Public stdio `@brandsystem/mcp` no longer registers `capture_taste` or `run_research_recipe`. Local Build remains the author/compile/onramp MCP; hosted Brandcode MCP owns per-brand use/contribute runtime actions. Research recipe execution is intentionally held for steward automation rather than a per-creator hosted tool.
- **GitHub Actions Node 24 compatibility.** CI now tests Node 20, 22, and 24; publish and benchmark workflows run on Node 24; first-party GitHub actions were updated to Node 24 runtime majors.
- **Hosted MCP now validates per-brand keys against UCS (`buildUcsValidator`).** The hosted auth boundary previously had only the local env-seeded validator (`BRANDCODE_MCP_TEST_KEYS`). It now POSTs the bearer key to the UCS `/api/brandcode-mcp/keys/validate` endpoint with the hosted service token as the caller credential, and maps the `{valid, keyId, environment, scopes, allowedSlugs}` response onto `BrandcodeMcpAuthInfo` (paired UCS change: the Blob-backed key registry shipped on the UCS side). Resolution order in `authorizeRequest`: injected `validateToken` → env-seeded keys when `BRANDCODE_MCP_TEST_KEYS` is set (local dev / staging smoke) → UCS validation (default in production). The validator fails closed — any upstream, caller-auth, or parse failure returns null (→ 401) and never logs the token — does a cheap prefix/environment gate before any round trip, and defensively parses the upstream response. Slug binding stays in `authorizeRequest` (so a key without the requested slug still yields a precise 403 `slug_forbidden`), so the key is sent to UCS without the slug.
- **Production hosted MCP no longer lets env-seeded test keys silently override UCS validation.** `BRANDCODE_MCP_TEST_KEYS` remains the default staging smoke path, but production now uses UCS validation unless the runtime explicitly opts into `allowEnvTestKeys` for a controlled smoke test.

### Changed

- **Tool descriptions sharpened across 6 tools** to improve agent disambiguation. `brand_resolve_conflicts` (was the lowest-scoring tool on Glama at 3.6/5): now describes both modes, when to call, what each returns, and how it relates to brand_audit. `brand_check` and `brand_check_compliance` now have crisp, mutually exclusive descriptions: `brand_check` is the inline linter you call WHILE writing (one or more fields, fast pass/fail per input); `brand_check_compliance` is the publish-time gate (single PASS/FAIL on a finished piece, optional strict mode). `brand_build_journey`, `brand_export`, and `brand_feedback` rewritten with explicit trigger phrases, mode/target enumerations, and NOT-for clarifications.
- **`brand_compile_messaging` interview returns ONE section at a time** instead of all three. The conversation_guide always said "work through ONE section at a time" but the response shipped perspective + voice + brand_story upfront — ~10K chars per call, of which the agent could only act on the first. Now returns the first missing section with a `remaining_sections` list and a section-targeted intro. Response size dropped from ~9.9K to ~3.2K. Calling `mode='interview'` again after each `mode='record'` returns the next section. No schema break — agents that read the existing `interview` array still work because the agenda is still under `interview`, just narrowed.
- **`brand_build_journey` interview drops the duplicate `defaults_full` field** and trims the conversation_guide. The response previously emitted both a stripped `default_stages` table and a full `defaults_full` array containing the same 4 stages with extra fields the server already auto-applies on `mode='record'` with no answers. Customizable field shape stays in the conversation_guide. Response size dropped from ~5.9K to under 5K.

### Added

- **`brand_enrich_skill` tool (S010 N-2 PR3).** Takes a Claude Design-style auto-generated `SKILL.md`, diffs it against `.brand/governance/` YAML (narrative-library, valid-proof-points, anti-patterns, application-rules, taste-codes), and returns an enriched `SKILL.md` with missing governance content injected, cited by ID, and grouped into canonical sections. Additive only — never rewrites existing content; appends to existing guardrail-like sections ("Hard rules", "Guardrails") instead of duplicating. Response shape includes `diff_summary` with per-category add counts plus warnings.

### Changed

- **GitHub org rename.** Repo moved from `github.com/Brand-System/brandsystem-mcp` to `github.com/Brandcode-Studio/brandsystem-mcp`. Updated `repository.url`, `bugs`, `mcpName` (`io.github.Brandcode-Studio/brandsystem-mcp`), `server.json.name`, and all README/llms.txt badge + link references. MCP registry consumers with the old identifier cached will re-discover on next refresh.

## 0.9.1 (2026-04-19)

### Added

- **Brandcode MCP Phase 0 lock.** Added `specs/brandcode-mcp-phase-0-lock.md` to lock the S009 G-5b decisions: 8-tool hosted surface, `@brandcode/mcp` naming, `mcp.brandcode.studio/{slug}` URL structure, free-v1 pricing posture, and the Phase 1 staging-prototype handoff.
- **Hosted MCP status surfacing.** `brand_brandcode_status` now returns `brandcode_mcp_available`, `brandcode_mcp_phase`, `brandcode_mcp_url`, and the locked 8-tool surface so agents can distinguish the Phase 0 lock from the Phase 1 hosted launch.
- **Brandcode MCP Phase 1 staging scaffold (G-5b Milestone A).** New `src/hosted/` surface registers the locked 8-tool list and serves the hosted runtime over Web Standard Streamable HTTP. Bearer-token auth with per-brand scopes, path-based slug routing (`/{slug}`), memoized service-token pull from UCS, silent upstream fallback. `brand_runtime` and `brand_status` fully wired; the other 6 tools registered with descriptive stubs pending Milestone B. Deploy scaffold: `api/[slug].ts` Vercel Function, `vercel.json` rewrite, `bin/brandcode-mcp.mjs` local dev entry. Does not affect the published `@brandsystem/mcp` stdio server — additive scaffolding only.

### Fixed

- **Hosted MCP service-token header (G-5g).** The hosted surface now sends `Authorization: Bearer <service-token>` when calling UCS, matching the G-5d validator. Previously sent a custom `x-brandcode-mcp-service-token` header that UCS ignored, causing every hosted pull to fail auth and return `not_compiled` at the runtime slicer.
- **Hosted runtime slicer normalizes brandInstance shape (G-5h).** `extractRuntime` now recognizes the flat brandInstance shape UCS actually serves (`tokens`, `fonts`, `assets`, `verbalIdentity` as siblings) and normalizes it into the runtime-like object `sliceRuntime` expects. Minimal/visual/voice slices now return real colors, typography, and logo references instead of null.

### Changed

- README and `llms.txt` now clarify the "Two MCPs, one brand" story: `@brandsystem/mcp` is the local Build MCP; Brandcode MCP is the upcoming hosted Use MCP.

## 0.9.0 (2026-04-18)

### Added

- **Live Mode (G-5a).** New tool `brand_brandcode_live` toggles Live Mode on a connected Brandcode Studio brand. When on, read-only tools (`brand_runtime`, `brand_check`, `brand_audit_content`, `brand_check_compliance`, `brand_preview`, `brand_status`) refresh from the hosted runtime on each call within a short cache TTL (default 60s). Governance edits in Brand Console propagate on the next tool call without a manual sync. Backed by a per-process in-memory cache that invalidates on explicit `brand_brandcode_sync`. Requires prior `brand_brandcode_connect` and `brand_brandcode_auth`.
- **`brand_runtime` live routing.** When Live Mode is on, the runtime is extracted from the hosted package and tagged `runtime_origin: "live"`. Supports hosted package shapes `pkg.runtime`, `pkg.brandInstance.runtime`, and "package is a runtime".
- **Silent network-failure fallback.** Every live-aware tool falls back to the on-disk mirror when the Studio pull fails. The failure surfaces as a `live.fallback_reason` field in the response — never as a user-visible error.
- **Git-connected repo tools (C-1/C-7).** `brand_connect_repo` and `brand_repo_status` wire a GitHub repo's `.brand/` directory as the source of truth for a hosted brand; Studio polls every five minutes.

### Changed

- **`ConnectorConfig` extended** with optional `liveMode`, `liveModeActivatedAt`, `liveCacheTTLSeconds`. Existing connector configs without these fields default to Live Mode off — zero behavior change for unconnected users.
- **`brand_brandcode_sync` invalidates the live cache** on pull and push so the next live read observes the freshest state.
- **`brand_status` surfaces Live Mode state** under the Brandcode Studio section, including cache warmth and fallback indicators.

### Notes

- Live Mode is opt-in, per-session. The 3000+ existing MCP users who never connect to Studio see zero behavior change.
- Write tools (extract/build/mutate) stay local-first; Live Mode is read-only by design. To push local changes to hosted, use `brand_brandcode_sync direction="push"`.
- In-memory cache is process-local; not shared across processes and not persisted to disk.

## 0.8.2 (2026-04-16)

### Fixed

- **Compile batches all schema errors (M-21).** `brand_compile` now catches all Zod validation errors from config, identity, visual, messaging, and strategy files upfront and returns them in one response. Optional session files degrade gracefully with warnings instead of aborting.
- **SVG gradient fill inference (M-24).** Empty gradient stops (renders as black rectangles) are auto-filled from sibling stop colors or brand primary/secondary. Runs automatically during logo resolution.
- **Auth hints recommend `activate` mode (M-22/M-23).** All auth error messages, next_steps, and recovery guidance now recommend `mode="activate"` (device code) over `mode="login"` (magic link). `set_key` hints include `studio_url` explicitly.

## 0.8.1 (2026-04-16)

### Fixed

- **Studio API URL.** All API calls now use `www.brandcode.studio` (CNAME-backed, serves directly). The non-www apex domain routes through a proxy that was 301-redirecting `/api/auth/*` paths, stripping POST bodies. User-facing text still shows the shorter `brandcode.studio`.

## 0.8.0 (2026-04-16)

### Added

- **Device code authentication.** `brand_brandcode_auth mode="activate"` displays a short human-readable code (e.g. BRAND-7K4X) for the user to enter at brandcode.studio/activate. No JWT copy-paste, no leaving the agent session to hunt for tokens. The agent polls for completion automatically. This is now the recommended auth flow for MCP users.

### Changed

- **Auth deferred from happy path.** Extraction, preview, brand_check, and all local tools work without authentication. Studio activation is positioned as an optional upgrade for users who want cloud persistence and team sharing, not a prerequisite. Tool descriptions, prompts, and recovery guidance updated accordingly.
- **`brand_brandcode_auth` description** now leads with `activate` mode and explicitly states auth is NOT needed for extraction or brand_check.

## 0.7.2 (2026-04-16)

### Fixed

- **Studio URL redirect.** Default Studio URL changed from `www.brandcode.studio` to `brandcode.studio`. The `www` subdomain issued a 301 redirect that stripped POST bodies, breaking magic link auth and brand save endpoints.

## 0.7.1 (2026-04-16)

### Added

- **Brand preview (M-15).** `brand_preview` generates a single-page visual proof from brand-runtime.json — color swatches, typography hierarchy, buttons, cards, and a WCAG contrast accessibility matrix. Screenshot-ready, shareable. Writes `.brand/brand-preview.html`.

### Fixed

- **Color role assignment.** Extraction now uses selector context (header/hero bg → primary, link/button → action, body text → text) and CSS property type (background-color + chromatic + high frequency → primary). Reduces `role: unknown` on sites with plain CSS names.
- **Blank visual/voice fields.** `brand_deepen_identity` and `brand_compile_messaging` now reject all-empty answers instead of writing blank files. Guides agents to use interactive mode or skip the session.
- **Feedback schema alias.** `brand_feedback` now accepts `type` as an alias for `category` — common agent misguess.

### Improved

- **Diff engine key paths (M-17).** Normalizes package structure to find runtime at `package.runtime`, `package.brandInstance.runtime`, or the package itself.
- **Recovery-driven next_steps (M-18).** `brand_status` uses ranked recovery guidance for next_steps when available, falling back to linear session progression only when recovery can't assess.
- **Compile cache invalidation (M-19).** `brand_compile` invalidates the `brand_check` cache after writing new runtime/policy files.

## 0.7.0 (2026-04-15)

### Added

- **Brand diff on sync (M-12).** When `brand_brandcode_sync` pulls or pushes, the response now includes a structured brand diff instead of generic "files changed" messages. Color changes show hex values, CIE76 ΔE perceptual distance, and WCAG contrast impact against text colors. Font changes flag family swaps as breaking. Voice changes detail tone register shifts, never_say list additions/removals, and anchor vocabulary changes. Visual changes track anti-pattern rule additions. Strategy changes report persona and matrix size shifts. Each change is tagged with severity (breaking/significant/minor).
- **Extraction recovery guidance (M-13).** `brand_status` now includes a ranked list of what to do next, sorted by readiness impact. Each missing capability maps to: the specific tool to run, what downstream capabilities it unlocks, readiness point impact (+Npp), and estimated effort (quick/moderate/deep). Example: "Add a logo SVG via brand_set_logo → Unlocks VIM generation, brand report logo section → Readiness: 23% → 35% (+12pp)." Powered by a capability dependency graph that knows which fields each tool needs.

## 0.6.2 (2026-04-15)

### Added

- **MCP prompts.** Four reusable interaction templates: `extract-brand` (full extraction pipeline from URL), `check-brand` (inline brand compliance check), `write-on-brand` (load brand context then generate content), `brand-overview` (full status overview). Prompts guide agents through common workflows.
- **Smithery config.** Added `smithery.yaml` for one-click installation via Smithery registry.

## 0.6.1 (2026-04-15)

### Fixed

- **Replaced `pdf-parse` with `pdfjs-dist`.** The bundled pdfjs v1.10.100 in `pdf-parse` fails with "bad XRef entry" on Node 24. Switched to `pdfjs-dist` v5.6.205 which is actively maintained and works across all supported Node versions.

## 0.6.0 (2026-04-15)

### Added

- **Inline brand gate (`brand_check`).** Fast pass/fail check against the compiled brand identity in under 1ms (cached). Pass any combination of text, color, font, or CSS. Text checks flag never-say words, anchor term misuse (with word-boundary matching), and AI-ism patterns. Color checks compute CIE76 ΔE distance in Lab space and return the nearest brand color with perceptual distance. Font checks are case-insensitive against brand typography with system font passthrough. CSS checks match against visual anti-pattern rules (shadows, gradients, blur). Returns specific fix suggestions per flag and the full brand palette on color failures for agent self-correction. 21 unit tests.
- **Studio authentication (`brand_brandcode_auth`).** Magic link auth flow with four modes: `status` checks auth state, `login` sends magic link email (auto-verifies in dev mode), `set_key` stores a session JWT after clicking the link, `logout` clears credentials. Credentials stored in `.brand/brandcode-auth.json` (auto-gitignored by `brand_init`). Token expiry checked on read with automatic cleanup.
- **Save to Studio (`brand_brandcode_connect` mode="save").** Upload a local `.brand/` directory to Brandcode Studio. Requires authentication. Creates connector config and sync history on success. Returns slug, hosted URL, and sync token.
- **Push to Studio (`brand_brandcode_sync` direction="push").** Push local brand changes to a previously connected Studio brand. Validates ownership via auth token. Updates connector config with new sync token.
- **Auth error codes.** `NOT_AUTHENTICATED`, `AUTH_FAILED`, `AUTH_EXPIRED`, `FORBIDDEN` for clear error handling in auth flows.

### Improved

- **Brandcode client now supports POST requests and auth tokens.** Added `requestMagicLink()`, `verifyMagicLink()`, and `saveBrandToStudio()` to the HTTP client. Request layer supports `authToken` option for Bearer token auth.

## 0.4.0 (2026-04-10)

### Added

- **Multimodal visual extraction (I8).** Added `brand_extract_visual` for rendered-page extraction via headless Chrome. The tool captures a 2x DPR screenshot, extracts computed styles from semantic elements plus `:root` CSS custom properties, infers likely color roles from visual context, and returns the screenshot as an MCP image block for agent-side vision analysis.
- **Deep site extraction (Phase 1).** Added `brand_extract_site` for representative multi-page extraction. The tool discovers high-signal pages on the same domain, captures desktop and mobile screenshots, samples multiple components per page, persists `.brand/extraction-evidence.json`, and merges additional colors/fonts into `core-identity.yaml`.
- **Design synthesis + DESIGN.md (Phase 2/3).** Added `brand_generate_designmd` plus the shared synthesis pipeline that writes `.brand/design-synthesis.json` and `.brand/DESIGN.md`. The synthesis layer turns extracted evidence into radius, shadow, spacing, layout, motion, component, and personality signals for both humans and agents.

### Improved

- **Extraction quality scoring recalibrated (I7).** Replaced the simple point accumulation with weighted scoring: colors 35%, fonts 20%, logo 20%, role assignment 15%, primary identification 10%. Zero colors now gets a specific "JavaScript-applied styles" remediation message. Role assignment rate factors into the score (brands with many unknown-role colors get penalized). MEDIUM score now includes specific gap identification with remediation steps.
- **`brand_start` auto-mode visual fallback.** When static CSS extraction scores LOW or finds fewer than two colors, `brand_start` now attempts visual extraction, merges the computed colors/fonts into `core-identity.yaml`, rescales quality, and includes the screenshot in the MCP response for visual validation.
- **`brand_start` deep fallback.** When the cheap CSS pass is weak and Chrome is available, `brand_start` now tries the multi-page site extractor before dropping back to the single-page visual fallback. This saves `extraction-evidence.json` and uses richer multi-page evidence when possible.
- **Richer compiled token output.** `brand_compile` and `brand_start(auto)` now compile synthesis-driven radius, shadow, layout, spacing, and motion groups into `tokens.json` when those signals are present.
- **Canonical compile parity.** `brand_compile` and `brand_start(auto)` now both generate `design-synthesis.json` and `DESIGN.md`, keeping the default URL onboarding flow aligned with the manual compile flow.

## 0.3.17 (2026-04-10)

### Improved

- **Voice extraction audit (I6).** `brand_extract_messaging` response now includes hedging frequency, jargon density, formality context ("Formal — similar to enterprise SaaS"), and total unique term count. Distinctive term detection filters common web/product vocabulary ("product", "team", "features") to surface actually distinctive brand language. Lowered threshold from 5 to 3 occurrences for distinctive classification.
- **Known gap:** Text extraction from HTML DOM can include rendered JavaScript state (e.g., React component names). Deeper HTML text extraction filtering needed for cleaner vocabulary analysis.

## 0.3.16 (2026-04-10)

### Improved

- **Confidence model recalibrated (I5).** Replaced the simple source-type + frequency model with a multi-signal scoring approach. Confidence now factors in: source type, frequency, semantic role keywords in the property name, structural selector context (header, nav, hero), platform default detection (auto-low), page builder brand variable detection (auto-high), and scale representative status. Platform defaults no longer get `high` confidence just because they appear frequently.

## 0.3.15 (2026-04-10)

### Fixed

- **Font extraction cap raised from 5 to 8.** Every brand was returning exactly 5 fonts due to a hardcoded `.slice(0, 5)`. Raised to 8 and added filtering for CSS variable references (e.g., `var(--font-family-graphik)` no longer appears as a font name).
- **Logo gradient stop detection (I4).** SVGs with `<linearGradient>` or `<radialGradient>` stops missing `stop-color` attributes are now flagged. The extraction quality score is reduced and the response warns: "Logo SVG has empty gradient stops (may render as black)." Addresses Mira's Booth Beacon logo bug.

## 0.3.14 (2026-04-10)

### Improved

- **Design token scale grouping (I2).** Detects `{hue} {scale}` patterns in CSS variable names (e.g., `mulberry 30`, `violet-50`, `blue 700`). Groups colors by hue, keeps the median-scale value as the representative, folds the rest as tints. Reduces the number of `unknown` role colors for brands using modern design token systems (Loom: 9/13 unknown → 5/11, Superhuman: scale members consolidated to single representatives).

## 0.3.13 (2026-04-10)

### Improved

- **Inline style extraction:** `brand_extract_web` and `brand_start` now parse inline `style` attributes from semantic HTML elements (body, header, nav, footer, hero, headings, buttons, sections). Catches page builder colors (Elementor, Squarespace, Wix) that exist as inline styles rather than CSS variables.
- **Platform default blocklist:** WordPress default palette (`--wp--preset--color--*`), Bootstrap (`--bs-*`), Chakra UI, Mantine, and other framework CSS variables are deprioritized instead of treated as brand colors. Reduces noise in extraction results.
- **Page builder brand detection:** Elementor globals (`--e-global-color-*`), Squarespace (`--sqs-*`), and Webflow (`--wf-*`) brand variables get highest priority, correctly outranking platform defaults in the same stylesheet.
- **34% faster extraction** on average (924ms vs 1,399ms baseline) from reduced processing of platform defaults.

## 0.3.12 (2026-04-06)

### Added

- **Figma import artifact in extraction response.** `brand_extract_figma` ingest mode now returns a `brandcode_figma_import_v1` artifact alongside the extraction data. This artifact can be pasted or uploaded directly into Brandcode Studio Brand Loader, eliminating the manual transport seam between MCP extraction and Studio onboarding.
- Plan mode response now notes the artifact interop so agents know what's coming after ingest.
- Next steps updated to mention runtime + policy outputs and the Brand Loader import path.

## 0.3.11 (2026-04-06)

### Fixed

- **Removed phantom Sessions 5-6 from status.** `brand_status` no longer shows "Session 5: Full Governance ○ Not started" and "Session 6: Content Operations ○ Not started" which had no corresponding tools. The MCP brand system is complete at Session 4. Governance and operations live in Brandcode Studio.
- **Completion message.** When all 4 sessions are done, status now shows "Brand system complete" with actionable next steps: generate content, run audit, or connect to Brandcode Studio.

## 0.3.10 (2026-04-06)

### Fixed

- **Session 4 counter not advancing:** `brand_build_personas`, `brand_build_journey`, `brand_build_themes`, and `brand_build_matrix` now bump `brand.config.yaml` session to 4 after writing strategy data. Previously the counter stayed at 3 even after Session 4 completion.
- **Strategy write race condition:** Session 4 tools now use `BrandDir.readOrCreateStrategy()` which reads or creates `strategy.yaml` under a lock. Prevents the second tool in a sequence from clobbering the first tool's data when both check `hasStrategy()` before either writes.

## 0.3.9 (2026-04-06)

### Fixed

- **Flexible answers parsing across all interview tools.** All 6 interview/record tools (`brand_compile_messaging`, `brand_deepen_identity`, `brand_build_personas`, `brand_build_journey`, `brand_build_themes`, `brand_build_matrix`) now accept answers as a JSON object, a JSON-encoded string, or plain text. MCP clients differ in how they serialize args — some send `{"answers": "{\"key\":\"val\"}"}` (string), others send `{"answers": {"key":"val"}}` (object). The new `parseAnswers()` helper handles both, eliminating the `invalid_json` errors agents were hitting.

## 0.3.8 (2026-04-06)

### Fixed

- **Session 3 tool discoverability:** Agents guessed `brand_voice` and `brand_messaging` (which don't exist) instead of the real tools `brand_extract_messaging` and `brand_compile_messaging`. Added natural language trigger phrases ("define brand voice", "brand messaging", "brand story", "start Session 3") to both tool descriptions so agents find the right tool on first attempt.
- **brand_status next step specificity:** When Session 3 is the next step, status now shows exact tool names and the recommended order (`brand_extract_messaging` then `brand_compile_messaging`) instead of a generic suggestion.

## 0.3.7 (2026-04-06)

### Fixed

- **Session 2 persistence verification:** `brand_deepen_identity` now verifies the `visual-identity.yaml` write succeeded by checking file existence after writing. If the write fails (e.g., wrong working directory), the response warns the agent immediately instead of returning silent success.
- **Session counter auto-bump:** `brand_deepen_identity` now bumps `brand.config.yaml` session to 2 when all 6 visual identity sections are complete. Previously the counter only bumped during `brand_compile`, creating a gap where Session 2 data existed but the system still reported Session 1.
- **Feedback smoke test cleanup:** Tests now clean up feedback files after each run, preventing the rate limiter from blocking subsequent test executions.

## 0.3.6 (2026-04-06)

### Fixed

- **Expanded color role enum:** Added `tint`, `overlay`, `border`, `gradient`, `highlight` to the accepted roles in `brand_clarify`, core-identity schema, and CSS role inference. Agents no longer need to map tint/overlay colors to the nearest valid role.
- **CSS role inference expanded:** The color extractor now detects tint/alpha, overlay, border/divider, gradient, and highlight/focus roles from CSS variable names.

### Improved

- **brand_clarify param description:** Now lists all 12 valid roles so agents know the full vocabulary.

## 0.3.5 (2026-04-06)

### Improved

- **Session progression framing:** Rewrote all session transition guidance based on agent feedback. Session 2+ is now pitched by what it adds to the runtime ("agents will reject off-brand layouts") rather than as checklist completion ("run brand_deepen_identity"). Agents are told what they get, not what to do next.
- **Reduced clarification gate:** Clarification items no longer block the Session 2 transition. The compile conversation guide presents clarifications and Session 2 in parallel, not as a sequential prerequisite chain.
- **brand_write gap surfacing:** When content is requested with only Session 1 data, warnings explain what the runtime is missing in concrete terms ("agents would know not just the right colors but how to use them") instead of clinical notes.
- **Report session descriptions:** HTML report session timeline now describes each session's concrete output artifact and what it adds to the brand-runtime.json.

## 0.3.4 (2026-04-06)

### Fixed

- **Feedback body persistence (B1):** `detail` field expanded from 2,000 to 10,000 characters. Added `message` as an alias field. Agents can use either; both merge if provided. Previously only the 200-char `summary` survived to disk.
- **Alpha color grouping (F1):** CSS parser now consolidates `#rrggbbaa` variants into their `#rrggbb` parent color. Alpha tints (e.g., `#f48fb133`, `#f48fb11a`) merge into the base color's frequency count instead of appearing as separate `role: unknown` entries.
- **Feedback schema documented (F2):** README Troubleshooting section now includes a `brand_feedback` usage example with all required and optional fields.

### Known Issues

- Logo SVG gradient stops may extract with empty `stop-color` attributes, rendering as black rectangles. Workaround: use `brand_set_logo` with the correct SVG. Fix tracked in Lane I (extraction quality audit, ticket I4).

## 0.3.3 (2026-04-05)

### Improved

- Full architecture alignment audit across all 34 tools. Every tool description, what_happened, next_steps, and conversation_guide now accurately reflects the current architecture (runtime + policy + connector).
- `brand_start`: description, auto-mode response, existing-brand guidance, and interactive-mode conversation guide all updated to mention runtime, interaction policy, and Brandcode Studio connector.
- `brand_status`: quickstart text mentions runtime + policy outputs and connector option. Getting-started guide lists connector tools. Status output shows runtime artifact and Brandcode Studio connection sections.
- `brand_audit`: now validates existence of brand-runtime.json and interaction-policy.json alongside tokens.json.
- `brand_brandcode_connect`: response field renamed from `brand_name` to `client_name` for consistency.
- `llms.txt`: added connector capability and portability description.
- `CLAUDE.md`: added Architecture Alignment Checklist (28 checks across 4 scenarios) referenced from "How to Add a New Tool" to prevent future drift.

## 0.3.2 (2026-04-05)

- Harden outbound fetches against DNS rebinding by pinning requests to the validated IP address on every hop.
- Centralize path containment checks and apply them to `.brand/` writes plus cwd-scoped local file readers.
- Add regression coverage for pinned transport behavior and sibling-prefix traversal escapes.

## 0.3.1 (2026-04-05)

### Security

- **Path traversal fix:** `brand_audit_content`, `brand_check_compliance`, and `brand_audit_drift` accepted file paths without cwd validation. An agent could read any `.html`/`.md`/`.txt` file on the filesystem. Now all three resolve paths relative to cwd and reject escapes.
- **SSRF bypass fix:** `brand_extract_messaging` used bare `fetch()` instead of `safeFetch()`, bypassing all SSRF protection. Now all outbound HTTP goes through `safeFetch()`.
- **Response size limits:** HTML responses capped at 5MB, CSS at 1MB per stylesheet. Prevents memory exhaustion from malicious URLs.
- **Feedback rate limiting:** Max 10 entries/hour, 100 total files. Prevents disk exhaustion from agent flooding.

## 0.3.0 (2026-04-03)

### Security

- SVG sanitizer rewritten: Cheerio DOM whitelist replaces regex blocklist. Blocks entity-encoded XSS, `<style>` injection, `<foreignObject>`, external `<use>` refs, and unknown elements.
- Zod input validation on all 28 tool inputs and all BrandDir YAML/JSON reads. Malformed input returns structured errors, never crashes.
- 10MB asset size limit on writeAsset().
- npm audit clean (0 vulnerabilities).

### Added

- `brand_runtime` tool: read compiled brand runtime contract.
- Runtime compiler: `brand_compile` now produces `brand-runtime.json` and `interaction-policy.json`.
- Interaction policy compiler: enforceable rules from visual anti-patterns, voice constraints, and content claims.
- MCP smoke tests for all 28 tools via InMemoryTransport.
- CI pipeline (GitHub Actions): build + lint + test across Node 20/22.

### Improved

- Tool descriptions rewritten for agent clarity.
- `brand_status` returns full getting-started guide when no `.brand/` exists.
- README: troubleshooting section, Claude Desktop/Windsurf/Cursor MCP configs.
- 216 tests across 15 files (up from 85 at 0.2.0).

## 0.1.0 (2026-03-22)

### Session 1: Core Identity

- `brand_start` — Onboarding entry point with source menu and interview questions
- `brand_init` — Directory scaffolding
- `brand_extract_web` — Website extraction (colors, fonts, inline SVG logos)
- `brand_extract_figma` — Figma extraction (plan/ingest modes)
- `brand_compile` — DTCG token compilation + VIM generation
- `brand_clarify` — Interactive clarification resolution
- `brand_audit` — Schema validation (11 checks)
- `brand_status` — Progress dashboard with session tracking
- `brand_report` — Portable HTML report with platform-specific setup tabs

### Session 2: Visual Identity

- `brand_deepen_identity` — 6-section visual identity interview
- `brand_ingest_assets` — Asset scanning and manifest generation
- `brand_preflight` — HTML compliance checking against brand rules

### Session 3: Core Messaging

- `brand_extract_messaging` — Website voice fingerprint and claims analysis
- `brand_compile_messaging` — Perspective, voice codex, and brand story
- `brand_write` — Content generation context loader

### Extraction Improvements

- System font filtering (30+ fonts excluded)
- Luminance-based color role detection
- Primary color promotion by frequency
- Inline SVG logo capture from HTML
- Web/JS/CSS artifact filtering in vocabulary analysis

### Security

- Path traversal protection in asset writes
- HTTP response status checks on all fetches
- File read boundary enforcement in preflight
- Top-level error handlers for process stability
- SVG sanitization for XSS prevention

### Testing

- 41 tests across 5 test files (css-parser, dtcg-compiler, confidence, report-html, server smoke)
