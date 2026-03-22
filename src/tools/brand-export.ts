import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { BrandDir } from "../lib/brand-dir.js";
import { buildResponse } from "../lib/response.js";
import type {
  CoreIdentityData,
  VisualIdentityData,
  MessagingData,
} from "../schemas/index.js";
import type { BrandConfig } from "../types/index.js";
import { cleanColorName } from "../lib/color-namer.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ExportTarget = "chat" | "code" | "team" | "email";

interface ExportParams {
  target: ExportTarget;
  include_logo: boolean;
}

// ---------------------------------------------------------------------------
// Data loading — graceful degradation for all layers
// ---------------------------------------------------------------------------

interface BrandData {
  config: BrandConfig;
  identity: CoreIdentityData;
  visual: VisualIdentityData | null;
  messaging: MessagingData | null;
}

async function loadBrandData(brandDir: BrandDir): Promise<BrandData> {
  const config = await brandDir.readConfig();

  let identity: CoreIdentityData;
  try {
    identity = await brandDir.readCoreIdentity();
  } catch {
    identity = { schema_version: "0.1.0", colors: [], typography: [], logo: [], spacing: null };
  }

  let visual: VisualIdentityData | null = null;
  if (await brandDir.hasVisualIdentity()) {
    try {
      visual = await brandDir.readVisualIdentity();
    } catch {
      // Degrade gracefully
    }
  }

  let messaging: MessagingData | null = null;
  if (await brandDir.hasMessaging()) {
    try {
      messaging = await brandDir.readMessaging();
    } catch {
      // Degrade gracefully
    }
  }

  return { config, identity, visual, messaging };
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function colorTable(colors: CoreIdentityData["colors"]): string {
  if (colors.length === 0) return "*No colors extracted yet.*\n";
  const lines: string[] = [];
  lines.push("| Name | Hex | Role |");
  lines.push("|------|-----|------|");
  for (const c of colors) {
    lines.push(`| ${cleanColorName(c)} | \`${c.value}\` | ${c.role} |`);
  }
  return lines.join("\n") + "\n";
}

function typographyList(typo: CoreIdentityData["typography"]): string {
  if (typo.length === 0) return "*No typography extracted yet.*\n";
  return typo
    .map((t) => {
      const parts = [`**${t.name}**: \`${t.family}\``];
      if (t.weight) parts.push(`weight ${t.weight}`);
      if (t.size) parts.push(`size ${t.size}`);
      return `- ${parts.join(", ")}`;
    })
    .join("\n") + "\n";
}

function logoBlock(identity: CoreIdentityData, includeLogo: boolean): string {
  if (!includeLogo || identity.logo.length === 0) return "";
  const lines: string[] = ["## Logo\n"];
  for (const logo of identity.logo) {
    lines.push(`**Type**: ${logo.type}\n`);
    for (const v of logo.variants) {
      if (v.inline_svg) {
        lines.push(`### ${v.name} variant\n`);
        lines.push("```svg");
        lines.push(v.inline_svg.trim());
        lines.push("```\n");
      }
      if (v.data_uri) {
        lines.push("Data URI for `<img>` tags:\n");
        lines.push("```");
        lines.push(v.data_uri);
        lines.push("```\n");
      }
    }
  }
  return lines.join("\n") + "\n";
}

function antiPatternsSection(
  visual: VisualIdentityData | null,
  style: "hard-rules" | "plain"
): string {
  if (!visual || visual.anti_patterns.length === 0) return "";
  const lines: string[] = [];
  if (style === "hard-rules") {
    lines.push("## HARD RULES (Anti-Patterns)\n");
    lines.push("These are absolute constraints. Never violate them.\n");
    for (const ap of visual.anti_patterns) {
      const severity = ap.severity === "hard" ? "NEVER" : "AVOID";
      lines.push(`- **${severity}**: ${ap.rule}`);
    }
  } else {
    lines.push("## What NOT To Do\n");
    for (const ap of visual.anti_patterns) {
      const prefix = ap.severity === "hard" ? "Never" : "Try to avoid";
      lines.push(`- ${prefix}: ${ap.rule}`);
    }
  }
  return lines.join("\n") + "\n";
}

function compositionSection(visual: VisualIdentityData | null): string {
  if (!visual?.composition) return "";
  const c = visual.composition;
  const lines = [
    "## Composition Rules\n",
    `- **Energy**: ${c.energy}`,
    `- **Negative Space**: ${c.negative_space}`,
    `- **Grid**: ${c.grid}`,
    `- **Layout Preference**: ${c.layout_preference}`,
  ];
  return lines.join("\n") + "\n";
}

function signatureSection(visual: VisualIdentityData | null): string {
  if (!visual?.signature) return "";
  const s = visual.signature;
  const lines = [
    "## Signature Moves\n",
    s.description + "\n",
    ...s.elements.map((e) => `- ${e}`),
  ];
  return lines.join("\n") + "\n";
}

function voiceSection(messaging: MessagingData | null): string {
  if (!messaging?.voice) return "";
  const v = messaging.voice;
  const lines: string[] = ["## Voice\n"];

  // Tone
  lines.push(`**Tone**: ${v.tone.descriptors.join(", ")}`);
  lines.push(`**Register**: ${v.tone.register}`);
  lines.push(`**Never sounds like**: ${v.tone.never_sounds_like}\n`);

  // Anchor vocabulary
  if (v.vocabulary.anchor.length > 0) {
    lines.push("### Anchor Vocabulary\n");
    lines.push("| Use | Instead of | Why |");
    lines.push("|-----|-----------|-----|");
    for (const a of v.vocabulary.anchor) {
      lines.push(`| ${a.use} | ${a.not} | ${a.reason} |`);
    }
    lines.push("");
  }

  // Never-say
  if (v.vocabulary.never_say.length > 0) {
    lines.push("### Never Say\n");
    for (const ns of v.vocabulary.never_say) {
      lines.push(`- **${ns.word}** — ${ns.reason}`);
    }
    lines.push("");
  }

  return lines.join("\n") + "\n";
}

function aiIsmSection(messaging: MessagingData | null): string {
  if (!messaging?.voice?.ai_ism_detection) return "";
  const ai = messaging.voice.ai_ism_detection;
  const lines = [
    "## AI-ism Detection\n",
    ai.instruction + "\n",
    "Patterns to avoid:\n",
    ...ai.patterns.map((p) => `- ${p}`),
  ];
  return lines.join("\n") + "\n";
}

function perspectiveSection(messaging: MessagingData | null): string {
  if (!messaging?.perspective) return "";
  const p = messaging.perspective;
  const lines = [
    "## Perspective\n",
    `**One-liner**: ${p.one_liner}\n`,
    `- **Worldview**: ${p.worldview}`,
    `- **Tension**: ${p.tension}`,
    `- **Resolution**: ${p.resolution}`,
    `- **Audience**: ${p.audience}`,
    `- **Positioning**: ${p.positioning}`,
  ];
  return lines.join("\n") + "\n";
}

function brandStorySection(messaging: MessagingData | null): string {
  if (!messaging?.brand_story) return "";
  const s = messaging.brand_story;
  const lines = [
    "## Brand Story\n",
    `**Tagline**: ${s.tagline}\n`,
    `- **Origin**: ${s.origin}`,
    `- **Tension**: ${s.tension}`,
    `- **Resolution**: ${s.resolution}`,
    `- **Vision**: ${s.vision}`,
  ];
  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Target generators
// ---------------------------------------------------------------------------

// Exported for testing
export { type BrandData };

export function generateChat(data: BrandData, includeLogo: boolean): string {
  const { config, identity, visual, messaging } = data;
  const lines: string[] = [];

  lines.push(`# ${config.client_name} — Brand System`);
  lines.push("");
  lines.push(
    "> **Portability notice:** This file is your complete brand system. Upload it to any AI conversation (Claude, ChatGPT, Gemini, etc.) and the AI will produce on-brand output."
  );
  if (config.industry) {
    lines.push(`>\n> **Industry**: ${config.industry}`);
  }
  lines.push("");

  // Logo
  lines.push(logoBlock(identity, includeLogo));

  // Colors
  lines.push("## Colors\n");
  lines.push(colorTable(identity.colors));

  // Typography
  lines.push("## Typography\n");
  lines.push(typographyList(identity.typography));

  // Anti-patterns as HARD RULES
  lines.push(antiPatternsSection(visual, "hard-rules"));

  // Composition rules
  lines.push(compositionSection(visual));

  // Signature moves
  lines.push(signatureSection(visual));

  // Voice (Session 3)
  lines.push(voiceSection(messaging));

  // AI-ism detection
  lines.push(aiIsmSection(messaging));

  // Perspective
  lines.push(perspectiveSection(messaging));

  // Brand story tagline
  if (messaging?.brand_story?.tagline) {
    lines.push(`## Brand Tagline\n`);
    lines.push(`> ${messaging.brand_story.tagline}\n`);
  }

  // Strip excessive blank lines
  return lines
    .join("\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim() + "\n";
}

export function generateCode(data: BrandData): string {
  const { config } = data;
  const lines: string[] = [];

  lines.push(`# ${config.client_name} — Brand System (Code Integration)`);
  lines.push("");
  lines.push(
    "Two things to set up: (1) MCP server config so your AI coding tool can call brand tools, and (2) an instruction snippet for your project."
  );
  lines.push("");

  // MCP config
  lines.push("## 1. MCP Server Config (`.mcp.json`)\n");
  lines.push("Add this to your project's `.mcp.json` (Claude Code) or equivalent:\n");
  lines.push("```json");
  lines.push(
    JSON.stringify(
      {
        mcpServers: {
          brandsystem: {
            command: "npx",
            args: ["-y", "@brandsystem/mcp"],
          },
        },
      },
      null,
      2
    )
  );
  lines.push("```\n");

  // Instruction snippet
  lines.push("## 2. Project Instructions (`CLAUDE.md` / `.cursorrules`)\n");
  lines.push("Paste this into your CLAUDE.md, .cursorrules, or project instructions:\n");
  lines.push("```markdown");
  lines.push(`# Brand System: ${config.client_name}`);
  lines.push("");
  lines.push("This project uses a machine-readable brand system in `.brand/`.");
  lines.push("");
  lines.push("## Before creating any visual output:");
  lines.push("1. Run `brand_write` with the content type to load the full brand brief");
  lines.push("2. Apply ALL rules from the creation brief (colors, typography, logo, anti-patterns)");
  lines.push("3. Run `brand_preflight` on the output to validate compliance");
  lines.push("");
  lines.push("## Key files:");
  lines.push("- `.brand/core-identity.yaml` — colors, fonts, logo");
  lines.push("- `.brand/visual-identity.yaml` — composition, patterns, anti-patterns");
  lines.push("- `.brand/messaging.yaml` — voice, vocabulary, perspective");
  lines.push("- `.brand/tokens.json` — DTCG design tokens");
  lines.push("- `.brand/visual-identity-manifest.md` — full visual spec (human-readable)");
  lines.push("- `.brand/system-integration.md` — detailed integration guide");
  lines.push("");
  lines.push("## Hard rules:");
  lines.push("- Use ONLY hex values from core-identity.yaml — no off-brand colors");
  lines.push("- Embed the logo using inline SVG — never approximate with text");
  lines.push("- Check anti-patterns in visual-identity.yaml — these are absolute constraints");
  lines.push("```\n");

  // Workflow
  lines.push("## Workflow Reference\n");
  lines.push("```");
  lines.push("brand_status   → check what's been extracted");
  lines.push("brand_write    → load brand context for content creation");
  lines.push("brand_preflight → validate output against brand rules");
  lines.push("brand_audit    → run a full brand compliance audit");
  lines.push("brand_export   → generate shareable bundles (chat, code, team, email)");
  lines.push("```\n");

  return lines.join("\n").replace(/\n{4,}/g, "\n\n\n").trim() + "\n";
}

export function generateTeam(data: BrandData, includeLogo: boolean): string {
  const { config, identity, visual, messaging } = data;
  const lines: string[] = [];

  lines.push(`# ${config.client_name} — Brand Guidelines`);
  lines.push("");
  if (config.industry) {
    lines.push(`**Industry**: ${config.industry}`);
    lines.push("");
  }
  lines.push(
    "This document summarizes the brand identity system. Share it with designers, writers, and marketers to keep all creative work on-brand."
  );
  lines.push("");

  // Logo
  if (includeLogo && identity.logo.length > 0) {
    lines.push("## Logo\n");
    for (const logo of identity.logo) {
      lines.push(`**Type**: ${logo.type}`);
      for (const v of logo.variants) {
        lines.push(`- **${v.name}** variant available`);
      }
    }
    lines.push("");
    lines.push("*Logo files are stored in `.brand/assets/logo/`. Use the provided SVG files for all placements.*\n");
  }

  // Colors
  lines.push("## Color Palette\n");
  if (identity.colors.length === 0) {
    lines.push("*No colors extracted yet.*\n");
  } else {
    for (const c of identity.colors) {
      const roleLabel = c.role !== "unknown" ? ` (${c.role})` : "";
      lines.push(`- **${cleanColorName(c)}**: \`${c.value}\`${roleLabel}`);
    }
    lines.push("");
  }

  // Typography
  lines.push("## Typography\n");
  lines.push(typographyList(identity.typography));

  // Logo usage rules
  if (identity.logo.length > 0) {
    lines.push("## Logo Usage Rules\n");
    lines.push("- Always use the provided logo files — never recreate the logo in a font");
    lines.push("- Maintain clear space around the logo");
    lines.push("- Do not stretch, rotate, or recolor the logo beyond approved variants");
    lines.push("");
  }

  // Voice summary
  if (messaging?.voice) {
    lines.push("## Voice & Tone\n");
    const v = messaging.voice;
    lines.push(`**Tone**: ${v.tone.descriptors.join(", ")}`);
    lines.push(`**Register**: ${v.tone.register}`);
    lines.push(`**Never sounds like**: ${v.tone.never_sounds_like}\n`);

    if (v.vocabulary.anchor.length > 0) {
      lines.push("### Preferred Terms\n");
      for (const a of v.vocabulary.anchor) {
        lines.push(`- Say "${a.use}" instead of "${a.not}"`);
      }
      lines.push("");
    }

    if (v.vocabulary.never_say.length > 0) {
      lines.push("### Words to Avoid\n");
      for (const ns of v.vocabulary.never_say) {
        lines.push(`- "${ns.word}" — ${ns.reason}`);
      }
      lines.push("");
    }
  }

  // Composition philosophy
  lines.push(compositionSection(visual));

  // Anti-patterns in plain language
  lines.push(antiPatternsSection(visual, "plain"));

  // Brand story
  if (messaging?.brand_story) {
    const s = messaging.brand_story;
    lines.push("## Brand Story\n");
    if (s.tagline) lines.push(`**Tagline**: ${s.tagline}\n`);
    lines.push(s.origin);
    lines.push("");
    lines.push(`**Vision**: ${s.vision}`);
    lines.push("");
  }

  lines.push("---\n");
  lines.push("*Generated by [brandsystem.app](https://brandsystem.app)*\n");

  return lines.join("\n").replace(/\n{4,}/g, "\n\n\n").trim() + "\n";
}

export function generateEmail(data: BrandData): string {
  const { config, identity, visual, messaging } = data;
  const lines: string[] = [];

  lines.push(`# ${config.client_name} — Brand System Summary`);
  lines.push("");
  lines.push(
    "Here's our brand system for AI tools. Key rules:"
  );
  lines.push("");

  // Top 5 colors
  const topColors = identity.colors.slice(0, 5);
  if (topColors.length > 0) {
    lines.push("**Colors:**");
    for (const c of topColors) {
      const roleLabel = c.role !== "unknown" ? ` (${c.role})` : "";
      lines.push(`- ${cleanColorName(c)}: \`${c.value}\`${roleLabel}`);
    }
    lines.push("");
  }

  // Font names
  const fontFamilies = [...new Set(identity.typography.map((t) => t.family))];
  if (fontFamilies.length > 0) {
    lines.push(`**Fonts:** ${fontFamilies.join(", ")}`);
    lines.push("");
  }

  // 3 most important anti-patterns (hard severity first)
  if (visual && visual.anti_patterns.length > 0) {
    const sorted = [...visual.anti_patterns].sort((a, b) =>
      a.severity === "hard" && b.severity !== "hard" ? -1 : b.severity === "hard" && a.severity !== "hard" ? 1 : 0
    );
    const top3 = sorted.slice(0, 3);
    lines.push("**Top rules:**");
    for (const ap of top3) {
      lines.push(`- ${ap.rule}`);
    }
    lines.push("");
  }

  // Voice in one sentence
  if (messaging?.voice) {
    const descriptors = messaging.voice.tone.descriptors.join(", ");
    lines.push(
      `**Voice:** ${descriptors}. ${messaging.voice.tone.register}`
    );
    lines.push("");
  }

  lines.push(
    "Full brand system: [brandsystem.app](https://brandsystem.app)"
  );
  lines.push("");

  return lines.join("\n").replace(/\n{4,}/g, "\n\n\n").trim() + "\n";
}

// ---------------------------------------------------------------------------
// Filenames per target
// ---------------------------------------------------------------------------

const TARGET_FILES: Record<ExportTarget, string> = {
  chat: "exports/brand-system-chat.md",
  code: "exports/brand-system-code.md",
  team: "exports/brand-guidelines.md",
  email: "exports/brand-summary.md",
};

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

async function handler(input: ExportParams) {
  const brandDir = new BrandDir(process.cwd());

  if (!(await brandDir.exists())) {
    return buildResponse({
      what_happened: "No .brand/ directory found",
      next_steps: ["Run brand_start to create a brand system first"],
      data: { error: "not_initialized" },
    });
  }

  let data: BrandData;
  try {
    data = await loadBrandData(brandDir);
  } catch {
    return buildResponse({
      what_happened: "Could not read brand data",
      next_steps: ["Run brand_extract_web to populate core identity first"],
      data: { error: "no_brand_data" },
    });
  }

  // Ensure exports/ directory exists
  await mkdir(join(brandDir.brandPath, "exports"), { recursive: true });

  const { target, include_logo: includeLogo } = input;

  let content: string;
  switch (target) {
    case "chat":
      content = generateChat(data, includeLogo);
      break;
    case "code":
      content = generateCode(data);
      break;
    case "team":
      content = generateTeam(data, includeLogo);
      break;
    case "email":
      content = generateEmail(data);
      break;
  }

  const filename = TARGET_FILES[target];
  await brandDir.writeMarkdown(filename, content);

  const layers: string[] = ["core_identity"];
  if (data.visual) layers.push("visual_identity");
  if (data.messaging) layers.push("messaging");

  return buildResponse({
    what_happened: `Generated "${target}" export for "${data.config.client_name}" → .brand/${filename}`,
    next_steps: [
      target === "chat"
        ? "Upload .brand/exports/brand-system-chat.md to any AI conversation"
        : target === "code"
          ? "Follow the setup instructions in .brand/exports/brand-system-code.md"
          : target === "team"
            ? "Share .brand/exports/brand-guidelines.md with your team"
            : "Copy the summary from .brand/exports/brand-summary.md into an email or Slack",
    ],
    data: {
      file: `.brand/${filename}`,
      target,
      brand_layers_included: layers,
      file_size: `${Math.round(content.length / 1024)}KB`,
      content,
    },
  });
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

const paramsShape = {
  target: z
    .enum(["chat", "code", "team", "email"])
    .describe(
      'Export target. "chat" = self-contained markdown for AI Chat uploads. "code" = MCP config + CLAUDE.md snippet. "team" = human-readable brand guidelines. "email" = ultra-concise 500-word summary.'
    ),
  include_logo: z
    .boolean()
    .default(true)
    .describe("Whether to embed the logo SVG/data URI in the export (default: true)"),
};

export function register(server: McpServer) {
  server.tool(
    "brand_export",
    "Generate purpose-specific bundles of the brand system for sharing. Targets: \"chat\" (self-contained markdown for any AI chat), \"code\" (MCP config + CLAUDE.md snippet for coding tools), \"team\" (clean brand guidelines for designers/writers), \"email\" (500-word summary for Slack/email). Writes to .brand/exports/ and returns the content.",
    paramsShape,
    async (args) => handler(args as ExportParams)
  );
}
