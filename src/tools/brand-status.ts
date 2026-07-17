import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BrandDir } from "../lib/brand-dir.js";
import { buildResponse } from "../lib/response.js";
import { ERROR_CODES, type Confidence } from "../types/index.js";
import { readConnectorConfig } from "../connectors/brandcode/persistence.js";
import {
  ensureLiveFreshness,
  buildLiveIndicator,
} from "../connectors/brandcode/live-source.js";
import { generateRecoveryGuidance } from "../lib/recovery-guidance.js";

/**
 * Session/phase taxonomy — mirrors the inline `// ── Section ──` comment
 * groups and registration order in src/server.ts's createServer(). This is
 * the single place that taxonomy is duplicated outside server.ts; if the
 * grouping there changes, update this list to match.
 *
 * Kept here (rather than a shared lib) because brand_status is the only
 * consumer today — the "what can I do?" resume point is the natural place
 * for agents to discover the phase structure.
 */
export const TOOL_SESSIONS: ReadonlyArray<{ name: string; tools: readonly string[] }> = [
  {
    name: "Entry points",
    tools: ["brand_start", "brand_status"],
  },
  {
    name: "Session 1: Core Identity",
    tools: [
      "brand_extract_web",
      "brand_extract_visual",
      "brand_extract_site",
      "brand_extract_pdf",
      "brand_resolve_conflicts",
      "brand_generate_designmd",
      "brand_extract_figma",
      "brand_set_logo",
      "brand_compile",
      "brand_clarify",
      "brand_audit",
      "brand_report",
      "brand_init",
    ],
  },
  {
    name: "Session 2: Visual Identity",
    tools: ["brand_deepen_identity", "brand_ingest_assets", "brand_preflight"],
  },
  {
    name: "Session 3: Messaging",
    tools: ["brand_extract_messaging", "brand_compile_messaging"],
  },
  {
    name: "Session 4: Content Strategy",
    tools: [
      "brand_build_personas",
      "brand_build_journey",
      "brand_build_themes",
      "brand_build_matrix",
    ],
  },
  {
    name: "Content scoring",
    tools: ["brand_audit_content", "brand_check_compliance", "brand_audit_drift"],
  },
  {
    name: "Runtime",
    tools: ["brand_runtime", "brand_context", "brand_check", "brand_preview"],
  },
  {
    name: "Brandcode Studio connector",
    tools: [
      "brand_brandcode_auth",
      "brand_brandcode_connect",
      "brand_brandcode_sync",
      "brand_brandcode_status",
      "brand_brandcode_live",
    ],
  },
  {
    name: "Git-connected source",
    tools: ["brand_connect_repo", "brand_repo_status"],
  },
  {
    name: "Cross-session utilities",
    tools: [
      "brand_write",
      "brand_export",
      "brand_enrich_skill",
      "brand_feedback",
      "brand_feedback_review",
      "brand_feedback_triage",
    ],
  },
];

async function handler() {
  const cwd = process.cwd();
  const brandDir = new BrandDir(cwd);

  // Refresh local mirror first if Live Mode is on — status should reflect
  // hosted state when the user has opted in.
  const live = await ensureLiveFreshness(cwd);
  const liveIndicator = buildLiveIndicator(live);

  if (!(await brandDir.exists())) {
    return buildResponse({
      what_happened: "No .brand/ directory found in this project. Run brand_start to create one.",
      next_steps: [
        "Run brand_start with a client_name and website_url to create a brand system in under 60 seconds",
      ],
      data: {
        error: ERROR_CODES.NOT_FOUND,
        tool_sessions: TOOL_SESSIONS,
        getting_started: {
          what_is_brandsystem: "brandsystem extracts and manages brand identity (logo, colors, fonts, voice, visual rules) so AI tools produce on-brand output. It creates a .brand/ directory with structured YAML, DTCG tokens, and a portable HTML report.",
          quickstart: "Run brand_start with client_name='Your Brand' and website_url='https://yourbrand.com' and mode='auto'. This extracts colors, fonts, and logo from the website, escalates to deeper visual/site extraction for JS-rendered or weak-signal sites when Chrome is available, compiles DTCG tokens + brand runtime + interaction policy, generates design-synthesis.json + DESIGN.md, and generates a portable brand report — all in one call. brand_start also accepts guideline_pdf, figma_file_key, or brandcode_url to adopt from those sources. To connect to an existing hosted brand instead, run brand_brandcode_connect.",
          tool_profiles: "By default the server registers the Core profile (12 tools — the complete adopt → context → create → check loop). Authoring tools (sessions 2-4 interviews, deep extraction control, drift analytics) require the full profile: set BRANDSYSTEM_PROFILE=full or pass --profile=full in the MCP config args.",
          session_overview: {
            "Session 1 — Core Identity": "brand_start → extract → brand_compile → brand_report. Produces tokens, runtime, policy, DESIGN.md, report.",
            "Session 2 — Visual Identity": "brand_deepen_identity interview → visual-identity-manifest.md.",
            "Session 3 — Messaging": "brand_extract_messaging → brand_compile_messaging → messaging.yaml, brand-story.md.",
            "Session 4 — Content Strategy": "personas → journey → themes → matrix.",
          },
          // Tool-by-tool descriptions intentionally omitted: agents already
          // have them from listTools, and tool_sessions carries the taxonomy.
        },
      },
    });
  }

  const config = await brandDir.readConfig();
  const identity = await brandDir.readCoreIdentity();

  const allConfidences: Confidence[] = [
    ...identity.colors.map((c) => c.confidence),
    ...identity.typography.map((t) => t.confidence),
    ...identity.logo.map((l) => l.confidence),
    ...(identity.spacing ? [identity.spacing.confidence] : []),
  ];
  const confidenceDist = {
    confirmed: allConfidences.filter((c) => c === "confirmed").length,
    high: allConfidences.filter((c) => c === "high").length,
    medium: allConfidences.filter((c) => c === "medium").length,
    low: allConfidences.filter((c) => c === "low").length,
  };

  const lines: string[] = [
    `Brand System: ${config.client_name}`,
    `Session: ${config.session}`,
    `Schema: ${config.schema_version}`,
    "",
    "── Identity ──────────────────────────",
    `Colors:     ${identity.colors.length} entries${identity.colors.length === 0 ? " ⚠ empty" : ""}`,
  ];

  if (identity.colors.length > 0) {
    const primary = identity.colors.find((c) => c.role === "primary");
    lines.push(`  Primary:  ${primary ? `${primary.value} (${primary.confidence})` : "⚠ not identified"}`);
    const roles = [...new Set(identity.colors.map((c) => c.role))].join(", ");
    lines.push(`  Roles:    ${roles}`);
  }

  lines.push(`Typography: ${identity.typography.length} entries${identity.typography.length === 0 ? " ⚠ empty" : ""}`);
  if (identity.typography.length > 0) {
    const families = [...new Set(identity.typography.map((t) => t.family))].join(", ");
    lines.push(`  Families: ${families}`);
  }

  lines.push(`Logo:       ${identity.logo.length} assets${identity.logo.length === 0 ? " ⚠ none found" : ""}`);
  for (const logo of identity.logo) {
    lines.push(`  ${logo.type}: ${logo.variants.length} variant(s) (${logo.confidence})`);
  }

  lines.push(`Spacing:    ${identity.spacing ? `${identity.spacing.base_unit || "detected"} (${identity.spacing.confidence})` : "⚠ not detected"}`);

  lines.push("");
  lines.push("── Confidence ────────────────────────");
  lines.push(`  Confirmed: ${confidenceDist.confirmed}  High: ${confidenceDist.high}  Medium: ${confidenceDist.medium}  Low: ${confidenceDist.low}`);

  // Check Session 2 + 3 state
  const hasVisual = await brandDir.hasVisualIdentity();
  const hasMessaging = await brandDir.hasMessaging();
  const hasExtractionEvidence = await brandDir.hasExtractionEvidence();
  const hasDesignSynthesis = await brandDir.hasDesignSynthesis();
  const hasDesignMarkdown = await brandDir.hasDesignMarkdown();

  const s1Done = identity.colors.length > 0 && identity.typography.length > 0;
  const s1Status = s1Done ? "✓ Complete" : identity.colors.length > 0 || identity.typography.length > 0 ? "◐ In progress" : "○ Not started";
  const s2Status = hasVisual ? "✓ Complete" : s1Done ? "→ Ready" : "○ Needs Session 1";
  const s3Status = hasMessaging ? "✓ Complete" : hasVisual ? "→ Ready" : "○ Needs Session 2";
  const hasStrategy = await brandDir.hasStrategy();
  const s4Status = hasStrategy ? "✓ Complete" : hasMessaging ? "→ Ready" : "○ Needs Session 3";

  lines.push("");
  lines.push("── Sessions ──────────────────────────");
  lines.push(`Session 1: Core Identity        ${s1Status}`);
  lines.push(`Session 2: Full Visual Identity ${s2Status}`);
  lines.push(`Session 3: Core Messaging       ${s3Status}`);
  lines.push(`Session 4: Content Strategy     ${s4Status}`);
  if (hasStrategy && s1Done && hasVisual && hasMessaging) {
    lines.push("");
    lines.push("✓ Brand system complete. All 4 sessions finished.");
    lines.push("  Your brand-runtime.json has identity, visual rules, voice, and strategy.");
    lines.push("  Load it into any sub-agent's context for instant on-brand output.");
  }

  if (hasVisual) {
    const visual = await brandDir.readVisualIdentity();
    lines.push("");
    lines.push("── Visual Identity ───────────────────");
    lines.push(`Anti-patterns: ${visual.anti_patterns.length} rules`);
    lines.push(`Composition:   ${visual.composition ? "✓" : "○"}`);
    lines.push(`Patterns:      ${visual.patterns ? "✓" : "○"}`);
    lines.push(`Illustration:  ${visual.illustration ? "✓" : "○"}`);
    lines.push(`Signature:     ${visual.signature ? "✓" : "○"}`);
  }

  if (hasMessaging) {
    const messaging = await brandDir.readMessaging();
    lines.push("");
    lines.push("── Messaging ─────────────────────────");
    lines.push(`Perspective:   ${messaging.perspective ? "✓" : "○"}`);
    lines.push(`Voice Codex:   ${messaging.voice ? "✓" : "○"}`);
    lines.push(`Brand Story:   ${messaging.brand_story ? "✓" : "○"}`);
  }

  if (hasStrategy) {
    const strategy = await brandDir.readStrategy();
    lines.push("");
    lines.push("── Content Strategy ──────────────────");
    lines.push(`Personas:      ${strategy.personas.length} (${strategy.personas.filter((p) => p.status === "Active").length} active, ${strategy.personas.filter((p) => p.status === "Hypothesis").length} hypothesis)`);
    lines.push(`Journey:       ${strategy.journey_stages.length} stages`);
    lines.push(`Matrix:        ${strategy.messaging_matrix.length} variants (${strategy.messaging_matrix.filter((v) => v.status === "Active").length} active, ${strategy.messaging_matrix.filter((v) => v.status === "Draft").length} draft)`);
    lines.push(`Themes:        ${strategy.themes.length} (${strategy.themes.filter((t) => t.status === "Active").length} active)`);

    // Theme balance
    const heat = strategy.themes.filter((t) => t.content_intent === "Brand Heat").length;
    const momentum = strategy.themes.filter((t) => t.content_intent === "Momentum").length;
    const conversion = strategy.themes.filter((t) => t.content_intent === "Conversion").length;
    if (strategy.themes.length > 0) {
      lines.push(`  Balance:     Heat ${heat} / Momentum ${momentum} / Conversion ${conversion}`);
    }
  }

  // Check runtime artifacts
  const hasRuntime = await brandDir.hasRuntime();
  lines.push("");
  lines.push("── Runtime Artifacts ─────────────────");
  lines.push(`brand-runtime.json:       ${hasRuntime ? "✓ Compiled" : "○ Not compiled — run brand_compile"}`);
  try {
    await brandDir.readPolicy();
    lines.push(`interaction-policy.json:  ✓ Compiled`);
  } catch {
    lines.push(`interaction-policy.json:  ○ Not compiled — run brand_compile`);
  }
  lines.push(`extraction-evidence.json: ${hasExtractionEvidence ? "✓ Saved" : "○ Not saved"}`);
  lines.push(`design-synthesis.json:    ${hasDesignSynthesis ? "✓ Saved" : "○ Not generated"}`);
  lines.push(`DESIGN.md:                ${hasDesignMarkdown ? "✓ Generated" : "○ Not generated"}`);

  // Check Brandcode Studio connection
  const connectorConfig = await readConnectorConfig(cwd);
  lines.push("");
  lines.push("── Brandcode Studio ─────────────────");
  if (connectorConfig) {
    lines.push(`Connected:  ✓ ${connectorConfig.slug}`);
    lines.push(`Remote:     ${connectorConfig.brandUrl}`);
    if (connectorConfig.liveMode) {
      const ttl = connectorConfig.liveCacheTTLSeconds ?? 60;
      const sourceLabel =
        live.source === "local-fallback"
          ? `ON — fallback to local (${live.fallbackReason ?? "network"})`
          : live.source === "live"
            ? "ON — live refresh"
            : live.source === "live-no-change"
              ? "ON — live, no change"
              : "ON — cache";
      lines.push(`Live Mode:  ✓ ${sourceLabel} (cache ${ttl}s)`);
    } else {
      lines.push(`Live Mode:  ○ off — run brand_brandcode_live mode="on" to enable`);
    }
  } else {
    lines.push(`Connected:  ○ Not connected`);
    lines.push(`  Run brand_brandcode_connect to sync with a hosted brand on Brandcode Studio`);
  }

  // Recovery guidance — ranked actions by readiness impact
  const recovery = await generateRecoveryGuidance(brandDir);
  if (recovery && recovery.actions.length > 0) {
    lines.push("");
    lines.push("── Recovery Guidance ─────────────────");
    lines.push(recovery.formatted);
  }

  // Build next_steps: use recovery guidance (ranked by impact) when available,
  // fall back to linear session progression when recovery can't assess state
  const nextSteps: string[] = [];

  if (recovery && recovery.actions.length > 0) {
    // Recovery guidance takes precedence — top 3 actions as next_steps
    const topActions = recovery.actions.filter((a) => a.tier === "highest");
    for (const action of topActions) {
      const args = action.toolArgs ? ` ${action.toolArgs}` : "";
      nextSteps.push(`${action.description} (${action.tool}${args}) — unlocks ${action.unlocks[0]}, +${action.readinessPoints}pp readiness`);
    }
  } else if (!s1Done) {
    if (config.website_url) {
      nextSteps.push(`Run brand_extract_web with url "${config.website_url}", brand_extract_visual for a one-page rendered fallback, or brand_extract_site for a deeper multi-page pass`);
    } else {
      nextSteps.push("Run brand_extract_web with your website URL, brand_extract_visual for a one-page rendered fallback, or brand_extract_site for a deeper multi-page pass");
    }
  } else if (!hasVisual && !hasMessaging && !hasStrategy) {
    nextSteps.push("Brand system complete! Run brand_write to generate audience-targeted content using your full brand system");
    nextSteps.push("Run brand_audit to validate your .brand/ directory");
    nextSteps.push("Run brand_brandcode_connect to save your brand on Brandcode Studio and share with your team");
  }

  // Always show feedback prompt
  nextSteps.push("Found an issue or have feedback? Run brand_feedback — it goes directly to the Brandcode team");

  if (config.figma_file_key && identity.colors.every((c) => c.source !== "figma")) {
    nextSteps.push(`Run brand_extract_figma with figma_file_key "${config.figma_file_key}" for higher-accuracy data`);
  }

  const statusHeadline = liveIndicator
    ? `Brand system status retrieved (live mode ${live.source})`
    : "Brand system status retrieved";

  return buildResponse({
    what_happened: statusHeadline,
    next_steps: nextSteps.length > 0 ? nextSteps : ["Brand system is up to date"],
    data: {
      status: lines.join("\n"),
      // Budget discipline (0.11): tool_sessions ships on the getting-started
      // (no-.brand/) response where discovery happens; recurring status calls
      // answer "where am I, what next?" without re-sending the taxonomy.
      // The formatted guidance lives in `status` and the top actions in
      // next_steps — structured data carries readiness only.
      recovery: recovery ? { readiness: recovery.currentReadiness } : undefined,
      ...(liveIndicator ? { live: liveIndicator } : {}),
    },
  });
}

/** Per-tool output schema (0.12); covers both getting-started and status paths. */
export const STATUS_OUTPUT_SCHEMA = z
  .object({
    _metadata: z
      .object({ what_happened: z.string(), next_steps: z.array(z.string()) })
      .passthrough(),
    status: z.string().optional(),
    recovery: z.object({ readiness: z.number() }).passthrough().optional(),
    tool_sessions: z.array(z.object({ name: z.string(), tools: z.array(z.string()) })).optional(),
    getting_started: z.record(z.unknown()).optional(),
    error: z.string().optional(),
  })
  .passthrough();

export function register(server: McpServer) {
  server.tool(
    "brand_status",
    "Check brand system progress and get next steps. Shows what has been extracted (colors, fonts, logo), confidence levels, session completion status, and what to do next. Use when resuming a previous session, checking readiness, or when the user asks 'what's the state of my brand?' If no .brand/ exists, returns a full getting-started guide with all available tools. Returns structured status data.",
    { title: "Brand status", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async () => handler()
  );
}
