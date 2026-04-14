import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BrandDir } from "../lib/brand-dir.js";
import { buildResponse } from "../lib/response.js";
import { compileDTCG } from "../lib/dtcg-compiler.js";
import { needsClarification } from "../lib/confidence.js";
import { generateVIM, generateSystemIntegration } from "../lib/vim-generator.js";
import { compileRuntime } from "../lib/runtime-compiler.js";
import { compileInteractionPolicy } from "../lib/interaction-policy-compiler.js";
import { generateAndPersistDesignArtifacts } from "../lib/design-synthesis.js";
import { ERROR_CODES, type ClarificationItem } from "../types/index.js";
import { SCHEMA_VERSION } from "../schemas/index.js";

async function handler(server: McpServer) {
  const brandDir = new BrandDir(process.cwd());

  if (!(await brandDir.exists())) {
    return buildResponse({
      what_happened: "No .brand/ directory found",
      next_steps: [
        "Run brand_init first to create the .brand/ directory",
        "If this keeps happening, run brand_feedback to report the issue.",
      ],
      data: { error: ERROR_CODES.NOT_INITIALIZED },
    });
  }

  const config = await brandDir.readConfig();
  const identity = await brandDir.readCoreIdentity();

  const designArtifacts = await generateAndPersistDesignArtifacts(brandDir, { overwrite: true });

  const tokens = compileDTCG(identity, config.client_name, designArtifacts.synthesis);
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

  const filesWritten: string[] = ["tokens.json", "needs-clarification.yaml", ...designArtifacts.files_written];
  const nextSteps: string[] = [];

  if (clarifications.length > 0) {
    nextSteps.push(`${clarifications.length} item(s) need clarification — walk the user through brand_clarify for each one`);
  } else {
    nextSteps.push("No clarification items — system is clean");
    nextSteps.push("Run brand_report to generate the portable brand identity report");
  }
  nextSteps.push("DESIGN.md and design-synthesis.json are refreshed — use them as the agent-facing design brief and structured synthesis layer");

  // --- Read optional session data ---
  const hasVisual = await brandDir.hasVisualIdentity();
  const hasMessaging = await brandDir.hasMessaging();
  const hasStrategy = await brandDir.hasStrategy();
  const visual = hasVisual ? await brandDir.readVisualIdentity() : null;
  const messaging = hasMessaging ? await brandDir.readMessaging() : null;
  const strategy = hasStrategy ? await brandDir.readStrategy() : null;

  // --- Session 2: VIM generation if visual-identity.yaml exists ---
  if (visual) {
    const vimMarkdown = generateVIM(config, identity, visual);
    await brandDir.writeMarkdown("visual-identity-manifest.md", vimMarkdown);
    filesWritten.push("visual-identity-manifest.md");

    const integrationMarkdown = generateSystemIntegration(config, identity, visual, messaging);
    await brandDir.writeMarkdown("system-integration.md", integrationMarkdown);
    filesWritten.push("system-integration.md");

    if (config.session < 2) {
      config.session = 2;
      await brandDir.writeConfig(config);
    }

    nextSteps.push(
      "Visual Identity Manifest written — share visual-identity-manifest.md with your team",
      "System Integration Guide written — paste the quick-setup block into CLAUDE.md or .cursorrules"
    );

    if (!messaging) {
      nextSteps.push("Ready for Session 3: run brand_extract_messaging to audit your voice, then brand_compile_messaging to define perspective + voice + brand story");
    }
  }

  // --- Runtime + Interaction Policy compilation ---
  const runtime = compileRuntime(config, identity, visual, messaging, strategy);
  await brandDir.writeRuntime(runtime);
  filesWritten.push("brand-runtime.json");

  const policy = compileInteractionPolicy(config.schema_version, visual, messaging, strategy);
  await brandDir.writePolicy(policy);
  filesWritten.push("interaction-policy.json");

  // Notify subscribed resource clients that runtime + policy have changed
  server.sendResourceListChanged();

  // Session transition guidance
  let conversationGuide: { instruction: string; conditionals?: Record<string, string> } | null = null;
  if (hasVisual && !hasMessaging) {
    conversationGuide = {
      instruction: [
        "Session 2 (Visual Identity) is complete. Now transition to Session 3.",
        "Tell the user: 'Your visual identity is locked in — composition, patterns, signature moves, and anti-patterns. Now let's capture how your brand *sounds*. This is where output goes from color-correct to distinctively yours.'",
        "Suggest: 'I can start by auditing what your brand currently sounds like on your website. Want me to run that analysis?'",
        "If yes: run brand_extract_messaging. If they want to skip the audit: run brand_compile_messaging directly.",
      ].join("\n"),
    };
  } else if (!hasVisual && clarifications.length === 0) {
    conversationGuide = {
      instruction: [
        "Session 1 is complete. Your brand-runtime.json is compiled and ready to use — any agent you give it to will produce on-brand content with the right colors, fonts, and logo.",
        "",
        "Before moving on, mention what Session 2 unlocks:",
        "'Right now your brand runtime has identity (colors, fonts, logo). Session 2 adds *visual rules* — composition guidelines, anti-patterns your agents will reject, illustration direction, and signature moves. It makes your brand-runtime dramatically more useful because agents won't just use the right colors, they'll use them *the right way*.'",
        "",
        "Then ask: 'Want to go deeper, or is this enough for now?'",
        "If yes: run brand_deepen_identity.",
        "If no: that's fine. The Session 1 runtime is already valuable.",
      ].join("\n"),
    };
  } else if (!hasVisual && clarifications.length > 0) {
    conversationGuide = {
      instruction: [
        "Session 1 compiled successfully but some values need confirmation.",
        `There are ${clarifications.length} clarification items (${clarifications.filter((c) => c.priority === "high").length} high priority).`,
        "",
        "Present the high-priority items to the user for quick confirmation. Use brand_clarify to resolve each one.",
        "After clarifications are resolved, recompile with brand_compile to update the runtime.",
        "",
        "Meanwhile, mention what Session 2 adds to the runtime:",
        "'Session 2 captures visual rules — composition, anti-patterns, illustration style. Your sub-agents will know not just *what* colors to use, but *how* to use them. Want to do that after we confirm these values?'",
      ].join("\n"),
    };
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
      runtime_compiled: true,
      design_synthesis_generated: true,
      design_synthesis_source: designArtifacts.source_used,
      agent_tip: "Load .brand/brand-runtime.json into any sub-agent's context. It replaces 200-400 tokens of per-prompt brand boilerplate with a single file. First output will be on-brand.",
      ...(hasVisual && { vim_generated: true }),
      ...(conversationGuide && { conversation_guide: conversationGuide }),
    },
  });
}

export function register(server: McpServer) {
  server.tool(
    "brand_compile",
    "Generate DTCG design tokens, design-synthesis.json, DESIGN.md, brand runtime, and interaction policy from extracted brand data. Transforms core-identity.yaml into tokens.json, brand-runtime.json (single-document brand contract for AI agents), and interaction-policy.json (enforceable rules). When Session 2+ data exists, also generates visual-identity-manifest.md and system-integration.md. Use after brand_extract_web, brand_extract_site, brand_extract_visual, or brand_extract_figma. Returns token counts, clarification items, and file list.",
    async () => handler(server)
  );
}
