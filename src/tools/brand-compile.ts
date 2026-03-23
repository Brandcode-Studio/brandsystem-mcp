import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BrandDir } from "../lib/brand-dir.js";
import { buildResponse } from "../lib/response.js";
import { compileDTCG } from "../lib/dtcg-compiler.js";
import { needsClarification } from "../lib/confidence.js";
import { generateVIM, generateSystemIntegration } from "../lib/vim-generator.js";
import type { ClarificationItem } from "../types/index.js";
import { SCHEMA_VERSION } from "../schemas/index.js";

async function handler() {
  const brandDir = new BrandDir(process.cwd());

  if (!(await brandDir.exists())) {
    return buildResponse({
      what_happened: "No .brand/ directory found",
      next_steps: [
        "Run brand_init first to create the .brand/ directory",
        "If this keeps happening, run brand_feedback to report the issue.",
      ],
      data: { error: "not_initialized" },
    });
  }

  const config = await brandDir.readConfig();
  const identity = await brandDir.readCoreIdentity();

  const tokens = compileDTCG(identity, config.client_name);
  await brandDir.writeTokens(tokens);

  const clarifications: ClarificationItem[] = [];
  let itemId = 0;

  if (!identity.colors.some((c) => c.role === "primary")) {
    clarifications.push({
      id: `clarify-${++itemId}`,
      field: "colors.primary",
      question: "No primary brand color identified. Which color is your primary brand color?",
      source: "compilation",
      priority: "high",
    });
  }

  for (const color of identity.colors) {
    if (needsClarification(color.confidence)) {
      clarifications.push({
        id: `clarify-${++itemId}`,
        field: `colors.${color.role}`,
        question: `Color ${color.value} (${color.name}) has low confidence. Is this correct and what role does it play?`,
        source: color.source,
        priority: "medium",
      });
    }
  }

  if (identity.typography.length === 0) {
    clarifications.push({
      id: `clarify-${++itemId}`,
      field: "typography",
      question: "No fonts detected. What font family does your brand use?",
      source: "compilation",
      priority: "high",
    });
  }

  for (const typo of identity.typography) {
    if (needsClarification(typo.confidence)) {
      clarifications.push({
        id: `clarify-${++itemId}`,
        field: `typography.${typo.family}`,
        question: `Font "${typo.family}" has low confidence. Is this your brand font?`,
        source: typo.source,
        priority: "medium",
      });
    }
  }

  if (identity.logo.length === 0) {
    clarifications.push({
      id: `clarify-${++itemId}`,
      field: "logo",
      question: "No logo detected. Provide your logo as SVG for best results.",
      source: "compilation",
      priority: "high",
    });
  }

  const unknownColors = identity.colors.filter((c) => c.role === "unknown");
  if (unknownColors.length > 0) {
    clarifications.push({
      id: `clarify-${++itemId}`,
      field: "colors.roles",
      question: `${unknownColors.length} color(s) have no assigned role: ${unknownColors.map((c) => c.value).join(", ")}. What role does each play?`,
      source: "compilation",
      priority: "medium",
    });
  }

  await brandDir.writeClarifications({ schema_version: SCHEMA_VERSION, items: clarifications });

  const brandTokens = tokens.brand as Record<string, unknown>;
  const colorTokenCount = Object.keys((brandTokens.color as Record<string, unknown>) || {}).length;
  const typoTokenCount = Object.keys((brandTokens.typography as Record<string, unknown>) || {}).length;

  const filesWritten: string[] = ["tokens.json", "needs-clarification.yaml"];
  const nextSteps: string[] = [];

  if (clarifications.length > 0) {
    nextSteps.push(`${clarifications.length} item(s) need clarification — walk the user through brand_clarify for each one`);
  } else {
    nextSteps.push("No clarification items — system is clean");
    nextSteps.push("Run brand_report to generate the portable brand identity report");
  }

  // --- Session 2: VIM generation if visual-identity.yaml exists ---
  const hasVisual = await brandDir.hasVisualIdentity();

  if (hasVisual) {
    const visual = await brandDir.readVisualIdentity();

    const vimMarkdown = generateVIM(config, identity, visual);
    await brandDir.writeMarkdown("visual-identity-manifest.md", vimMarkdown);
    filesWritten.push("visual-identity-manifest.md");

    // Include messaging data if available for self-contained output
    const hasMessaging = await brandDir.hasMessaging();
    const messaging = hasMessaging ? await brandDir.readMessaging() : null;

    const integrationMarkdown = generateSystemIntegration(config, identity, visual, messaging);
    await brandDir.writeMarkdown("system-integration.md", integrationMarkdown);
    filesWritten.push("system-integration.md");

    // Bump session to 2 if not already there
    if (config.session < 2) {
      config.session = 2;
      await brandDir.writeConfig(config);
    }

    nextSteps.push(
      "Visual Identity Manifest written — share visual-identity-manifest.md with your team",
      "System Integration Guide written — paste the quick-setup block into CLAUDE.md or .cursorrules"
    );

    // Check if Session 3 is needed
    if (!hasMessaging) {
      nextSteps.push("Ready for Session 3: run brand_extract_messaging to audit your voice, then brand_compile_messaging to define perspective + voice + brand story");
    }
  }

  // Session transition guidance
  const conversationGuide: Record<string, string> = {};
  if (hasVisual && !(await brandDir.hasMessaging())) {
    conversationGuide.session_3_transition = [
      "Session 2 (Visual Identity) is complete. Now transition to Session 3.",
      "Tell the user: 'Your visual identity is locked in — composition, patterns, signature moves, and anti-patterns. Now let's capture how your brand *sounds*. This is where output goes from color-correct to distinctively yours.'",
      "Suggest: 'I can start by auditing what your brand currently sounds like on your website. Want me to run that analysis?'",
      "If yes: run brand_extract_messaging. If they want to skip the audit: run brand_compile_messaging directly.",
    ].join("\n");
  } else if (!hasVisual && clarifications.length === 0) {
    conversationGuide.session_2_transition = [
      "Session 1 (Core Identity) is complete. Now transition to Session 2.",
      "Tell the user: 'Your core identity is set — colors, fonts, logo, and tokens are ready. Now let's go deeper into your visual identity. This captures what makes your brand *recognizable* beyond just the correct colors — composition rules, patterns, illustration style, and anti-patterns.'",
      "Then immediately run brand_deepen_identity to start the visual identity interview.",
      "Do NOT wait for the user to ask — this is the natural next step.",
    ].join("\n");
  } else if (!hasVisual && clarifications.length > 0) {
    conversationGuide.after_clarify = "After resolving all clarification items, recompile (brand_compile), then generate the report (brand_report). Once the report is done, transition to Session 2 by running brand_deepen_identity.";
  }

  return buildResponse({
    what_happened: hasVisual
      ? `Compiled brand system + Visual Identity Manifest for "${config.client_name}"`
      : `Compiled brand system for "${config.client_name}"`,
    next_steps: nextSteps,
    data: {
      files_written: filesWritten,
      tokens: { colors: colorTokenCount, typography: typoTokenCount, total: colorTokenCount + typoTokenCount },
      clarifications: {
        total: clarifications.length,
        high_priority: clarifications.filter((c) => c.priority === "high").length,
        items: clarifications.map((c) => `[${c.priority}] ${c.question}`),
      },
      ...(hasVisual && { vim_generated: true }),
      ...(Object.keys(conversationGuide).length > 0 && { conversation_guide: conversationGuide }),
    },
  });
}

export function register(server: McpServer) {
  server.tool(
    "brand_compile",
    "Generate DTCG design tokens and a Visual Identity Manifest from extracted brand data. Transforms core-identity.yaml into standards-compliant tokens.json (colors, typography, spacing). Surfaces ambiguous values in needs-clarification.yaml for human review. When Session 2 data exists, also generates visual-identity-manifest.md and system-integration.md (CLAUDE.md/.cursorrules setup guide). Use after brand_extract_web or brand_extract_figma. Returns token counts, clarification items, and file list.",
    async () => handler()
  );
}
