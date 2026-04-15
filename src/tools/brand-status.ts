import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BrandDir } from "../lib/brand-dir.js";
import { buildResponse } from "../lib/response.js";
import { ERROR_CODES, type Confidence } from "../types/index.js";
import { readConnectorConfig } from "../connectors/brandcode/persistence.js";
import { generateRecoveryGuidance } from "../lib/recovery-guidance.js";

async function handler() {
  const brandDir = new BrandDir(process.cwd());

  if (!(await brandDir.exists())) {
    return buildResponse({
      what_happened: "No .brand/ directory found in this project. Run brand_start to create one.",
      next_steps: [
        "Run brand_start with a client_name and website_url to create a brand system in under 60 seconds",
      ],
      data: {
        error: ERROR_CODES.NOT_FOUND,
        getting_started: {
          what_is_brandsystem: "brandsystem extracts and manages brand identity (logo, colors, fonts, voice, visual rules) so AI tools produce on-brand output. It creates a .brand/ directory with structured YAML, DTCG tokens, and a portable HTML report.",
          quickstart: "Run brand_start with client_name='Your Brand' and website_url='https://yourbrand.com' and mode='auto'. This extracts colors, fonts, and logo from the website, escalates to deeper visual/site extraction for JS-rendered or weak-signal sites when Chrome is available, compiles DTCG tokens + brand runtime + interaction policy, generates design-synthesis.json + DESIGN.md, and generates a portable brand report — all in one call. To connect to an existing hosted brand instead, run brand_brandcode_connect.",
          session_overview: {
            "Session 1 — Core Identity": "brand_start → brand_extract_web or brand_extract_visual or brand_extract_site → brand_generate_designmd → brand_compile → brand_report. Extracts colors, fonts, logo from static CSS, a rendered page, or a deeper multi-page rendered crawl. Produces tokens.json, brand-runtime.json, interaction-policy.json, design-synthesis.json, DESIGN.md, brand-report.html, and optional extraction-evidence.json.",
            "Session 2 — Visual Identity": "brand_deepen_identity (interview). Captures composition rules, patterns, illustration style, anti-patterns. Produces visual-identity-manifest.md.",
            "Session 3 — Messaging": "brand_extract_messaging → brand_compile_messaging (interview). Defines perspective, voice codex, brand story. Produces messaging.yaml and brand-story.md.",
            "Session 4 — Content Strategy": "brand_build_personas → brand_build_journey → brand_build_themes → brand_build_matrix. Creates audience personas, journey stages, editorial themes, and a messaging matrix.",
          },
          available_tools: [
            "brand_start — Entry point. Creates brand system from a website URL",
            "brand_status — Shows current progress (you are here)",
            "brand_extract_web — Extract colors, fonts, logo from any website",
            "brand_extract_visual — Screenshot the rendered page and extract computed colors/fonts for JS-heavy sites",
            "brand_extract_site — Discover representative pages, sample multiple viewports/components, and persist extraction-evidence.json",
            "brand_generate_designmd — Generate design-synthesis.json and DESIGN.md from extracted evidence or current brand state",
            "brand_extract_figma — Extract from Figma files (higher accuracy)",
            "brand_compile — Generate DTCG tokens and VIM from extracted data",
            "brand_report — Generate portable HTML brand report",
            "brand_clarify — Resolve ambiguous brand data interactively",
            "brand_audit — Validate .brand/ directory against schema",
            "brand_set_logo — Add/replace logo via SVG, URL, or data URI",
            "brand_deepen_identity — Session 2: visual identity interview",
            "brand_ingest_assets — Catalog brand assets with manifests",
            "brand_preflight — Check HTML/CSS against brand compliance rules",
            "brand_extract_messaging — Audit existing website voice",
            "brand_compile_messaging — Session 3: perspective + voice interview",
            "brand_write — Load full brand context for content generation",
            "brand_export — Generate portable brand files for any environment",
            "brand_build_personas — Define buyer personas",
            "brand_build_journey — Define buyer journey stages",
            "brand_build_themes — Define editorial content themes",
            "brand_build_matrix — Generate persona x stage messaging variants",
            "brand_feedback — Report bugs, friction, or feature ideas",
            "brand_brandcode_connect — Connect to a hosted brand on Brandcode Studio",
            "brand_brandcode_sync — Sync local .brand/ with hosted brand",
            "brand_brandcode_status — Check Brandcode Studio connection status",
          ],
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
    lines.push("  For governance (claims, evidence, application rules) and content operations,");
    lines.push("  connect to Brandcode Studio: run brand_brandcode_connect.");
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
  const connectorConfig = await readConnectorConfig(process.cwd());
  lines.push("");
  lines.push("── Brandcode Studio ─────────────────");
  if (connectorConfig) {
    lines.push(`Connected:  ✓ ${connectorConfig.slug}`);
    lines.push(`Remote:     ${connectorConfig.brandUrl}`);
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

  return buildResponse({
    what_happened: "Brand system status retrieved",
    next_steps: nextSteps.length > 0 ? nextSteps : ["Brand system is up to date"],
    data: {
      status: lines.join("\n"),
      recovery: recovery ? {
        readiness: recovery.currentReadiness,
        actions: recovery.actions,
      } : undefined,
    },
  });
}

export function register(server: McpServer) {
  server.tool(
    "brand_status",
    "Check brand system progress and get next steps. Shows what has been extracted (colors, fonts, logo), confidence levels, session completion status, and what to do next. Use when resuming a previous session, checking readiness, or when the user asks 'what's the state of my brand?' If no .brand/ exists, returns a full getting-started guide with all available tools. Returns structured status data.",
    async () => handler()
  );
}
