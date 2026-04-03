import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { BrandDir } from "../lib/brand-dir.js";
import { buildResponse, safeParseParams } from "../lib/response.js";
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

type ExportTarget = "chat" | "code" | "team" | "email" | "claude-skill";

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
      lines.push(`**Type**: ${logo.type}\n`);
      for (const v of logo.variants) {
        if (v.inline_svg) {
          lines.push(`### ${v.name} variant\n`);
          lines.push("```svg");
          lines.push(v.inline_svg.trim());
          lines.push("```\n");
        } else {
          lines.push(`- **${v.name}** variant available`);
        }
      }
    }
    lines.push("");
    lines.push("*See the Logo section in the full brand system for all variants and usage rules.*\n");
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
    `Here's the brand system for ${config.client_name}, built for AI tools and creative workflows. When generating content, visuals, or code for this brand, follow these guidelines to stay on-brand.`
  );
  lines.push("");

  // Brand positioning one-liner
  if (messaging?.perspective?.one_liner) {
    lines.push(`**Brand positioning:** ${messaging.perspective.one_liner}`);
    lines.push("");
  }

  // All assigned colors with names
  if (identity.colors.length > 0) {
    lines.push("## Colors\n");
    for (const c of identity.colors) {
      const roleLabel = c.role !== "unknown" ? ` — ${c.role}` : "";
      lines.push(`- **${cleanColorName(c)}**: \`${c.value}\`${roleLabel}`);
    }
    lines.push("");
    lines.push("Use only these hex values. Do not introduce off-palette colors.\n");
  }

  // Typography with usage hints
  if (identity.typography.length > 0) {
    lines.push("## Typography\n");
    for (const t of identity.typography) {
      const parts = [`**${t.name}**: \`${t.family}\``];
      if (t.weight) parts.push(`weight ${t.weight}`);
      if (t.size) parts.push(`size ${t.size}`);
      // Infer usage hint from name or weight
      const nameLower = t.name.toLowerCase();
      if (nameLower.includes("heading") || nameLower.includes("display") || (t.weight && t.weight >= 600)) {
        parts.push("(headings)");
      } else if (nameLower.includes("body") || nameLower.includes("text")) {
        parts.push("(body text)");
      } else if (nameLower.includes("code") || nameLower.includes("mono")) {
        parts.push("(code / monospace)");
      }
      lines.push(`- ${parts.join(", ")}`);
    }
    lines.push("");
  }

  // Top 5 anti-patterns (hard severity first)
  if (visual && visual.anti_patterns.length > 0) {
    const sorted = [...visual.anti_patterns].sort((a, b) =>
      a.severity === "hard" && b.severity !== "hard" ? -1 : b.severity === "hard" && a.severity !== "hard" ? 1 : 0
    );
    const top5 = sorted.slice(0, 5);
    lines.push("## Anti-Patterns (Do NOT Do These)\n");
    for (const ap of top5) {
      const severity = ap.severity === "hard" ? "NEVER" : "Avoid";
      lines.push(`- **${severity}**: ${ap.rule}`);
    }
    lines.push("");
  }

  // Voice summary (2-3 sentences)
  if (messaging?.voice) {
    const v = messaging.voice;
    const descriptors = v.tone.descriptors.join(", ");
    lines.push("## Voice\n");
    lines.push(
      `Our tone is ${descriptors}. Think of the register as: ${v.tone.register}. We never sound like ${v.tone.never_sounds_like}.`
    );
    if (v.vocabulary.anchor.length > 0) {
      const anchorExamples = v.vocabulary.anchor
        .slice(0, 3)
        .map((a) => `"${a.use}" (not "${a.not}")`)
        .join(", ");
      lines.push(`\nKey vocabulary: ${anchorExamples}.`);
    }
    lines.push("");
  }

  // Brand story tagline
  if (messaging?.brand_story?.tagline) {
    lines.push(`**Tagline:** ${messaging.brand_story.tagline}`);
    lines.push("");
  }

  lines.push("---\n");
  lines.push(
    `For the full guidelines — including logo files, composition rules, and detailed voice specs — visit [brandsystem.app](https://brandsystem.app).`
  );
  lines.push("");

  return lines.join("\n").replace(/\n{4,}/g, "\n\n\n").trim() + "\n";
}

// ---------------------------------------------------------------------------
// Claude Skill export — persistent brand identity across all Claude artifacts
// ---------------------------------------------------------------------------

export function generateClaudeSkill(data: BrandData, includeLogo: boolean): string {
  const { config, identity, visual, messaging } = data;
  const brandName = config.client_name;
  const lines: string[] = [];

  lines.push(`# ${brandName} Brand Identity Skill`);
  lines.push("");
  lines.push("## When to Use");
  lines.push(`Use this skill whenever creating a visual artifact (HTML, React/JSX, SVG) for ${brandName}. This includes: dashboards, landing pages, social graphics, reports, interactive tools, presentations rendered as HTML, or any UI prototype.`);
  lines.push("");
  lines.push("Read this file BEFORE writing any artifact code.");
  lines.push("");

  // Logo section — the critical part
  lines.push("## Logo Asset");
  lines.push("");
  if (identity.logo.length > 0 && includeLogo) {
    for (const logo of identity.logo) {
      for (const v of logo.variants) {
        if (v.inline_svg) {
          lines.push(`### Primary Logo (SVG — ${logo.type})`);
          lines.push("");
          lines.push("```svg");
          lines.push(v.inline_svg.trim());
          lines.push("```");
          lines.push("");
        }
        if (v.data_uri) {
          lines.push("### Base64 Data URI (for `<img>` tags)");
          lines.push("");
          lines.push("```");
          lines.push(v.data_uri);
          lines.push("```");
          lines.push("");
        }
      }
    }
  } else {
    lines.push("*No logo extracted yet. Run `brand_set_logo` or `brand_extract_web` with a `logo_url` to add one.*");
    lines.push("");
  }

  // Embedding rules
  lines.push("## Embedding Rules");
  lines.push("");
  lines.push("1. **Always inline the logo** — never use an external URL `src`. Claude artifacts block external images via CSP.");
  lines.push("2. **For SVG logos:** Paste the `<svg>` markup directly into the JSX/HTML. Wrap in a container with explicit width (e.g., `width: 120px`) and `height: auto`.");
  lines.push("3. **For base64 logos:** Use `<img src=\"data:image/png;base64,...\" alt=\"" + brandName + " logo\" />`.");
  lines.push("4. **Placement defaults** (override per request): top-left for dashboards, centered for landing pages.");
  lines.push(`5. **Always include** \`alt="${brandName} logo"\` on all logo image tags.`);
  lines.push("6. **Do not distort.** Always preserve aspect ratio. Use `object-fit: contain` or `preserveAspectRatio=\"xMidYMid meet\"`.");
  lines.push("");

  // Colors as CSS variables
  lines.push("## Brand Colors");
  lines.push("");
  lines.push("Use ONLY these colors. Do not introduce off-palette colors.");
  lines.push("");
  lines.push("```css");
  lines.push(":root {");
  for (const c of identity.colors) {
    const name = cleanColorName(c);
    const role = c.role !== "unknown" ? c.role : name.toLowerCase().replace(/\s+/g, "-");
    lines.push(`  --brand-${role}: ${c.value};  /* ${name} */`);
  }
  lines.push("}");
  lines.push("```");
  lines.push("");

  // Quick reference table
  lines.push("| Role | Hex | Name |");
  lines.push("|------|-----|------|");
  for (const c of identity.colors) {
    lines.push(`| ${c.role} | \`${c.value}\` | ${cleanColorName(c)} |`);
  }
  lines.push("");

  // Typography
  if (identity.typography.length > 0) {
    lines.push("## Typography");
    lines.push("");
    for (const t of identity.typography) {
      lines.push(`- **${t.family}**${t.weight ? ` (weight: ${t.weight})` : ""}`);
    }
    lines.push("");
    lines.push("Use these font families in `font-family` declarations. If the font is not available in the artifact sandbox, fall back to `system-ui, -apple-system, sans-serif`.");
    lines.push("");
  }

  // Anti-patterns as HARD RULES
  if (visual?.anti_patterns && visual.anti_patterns.length > 0) {
    lines.push("## Anti-Patterns (NEVER DO)");
    lines.push("");
    for (const ap of visual.anti_patterns) {
      const rule = typeof ap === "string" ? ap : ap.rule;
      lines.push(`- ❌ ${rule}`);
    }
    lines.push("");
  }

  // Voice quick reference
  if (messaging?.voice?.tone?.descriptors) {
    lines.push("## Voice (Quick Reference)");
    lines.push("");
    lines.push(`**Tone:** ${messaging.voice.tone.descriptors.join(", ")}`);
    if (messaging.voice.tone.register) {
      lines.push(`**Register:** ${messaging.voice.tone.register}`);
    }
    if (messaging.voice.vocabulary?.anchor?.length) {
      lines.push("");
      lines.push("**Vocabulary:**");
      for (const a of messaging.voice.vocabulary.anchor) {
        lines.push(`- Use "${a.use}" not "${a.not}"`);
      }
    }
    lines.push("");
  }

  // Deployment instructions
  lines.push("---");
  lines.push("");
  lines.push("## How to Deploy This Skill");
  lines.push("");
  lines.push("### Option 1: Personal Skill (Claude Pro, Team, or Enterprise)");
  lines.push("");
  lines.push(`1. Save this file as \`SKILL.md\` inside \`~/.claude/skills/${brandName.toLowerCase().replace(/\s+/g, "-")}-brand/\``);
  lines.push("2. Claude will read it automatically before creating any visual artifact");
  lines.push("3. The logo is embedded — no uploads needed, no external URLs, works every time");
  lines.push("");
  lines.push("### Option 2: Organization Skill (Claude Teams/Enterprise)");
  lines.push("");
  lines.push("1. Ask your admin to add this as an org-level skill");
  lines.push("2. Every team member gets the brand applied automatically");
  lines.push("");
  lines.push("### Option 3: Project Instructions (Claude Pro+)");
  lines.push("");
  lines.push("1. Create a Claude Project for this brand");
  lines.push("2. Paste this file into the Project Instructions");
  lines.push("3. Works for all conversations in that project");
  lines.push("");
  lines.push("### Option 4: Per-Conversation (any plan)");
  lines.push("");
  lines.push("1. Upload this file at the start of a conversation");
  lines.push(`2. Say: "Use this brand system for all visual artifacts this session"`);
  lines.push("");
  lines.push("**Why skills are best:** Skills re-read on every turn where triggered. Project knowledge loads once and can drift out of context in long conversations. For mission-critical brand consistency, skills > project knowledge > per-session upload.");
  lines.push("");
  lines.push(`---\n*Generated by [@brandsystem/mcp](https://brandsystem.app)*`);

  return lines
    .join("\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim() + "\n";
}

// ---------------------------------------------------------------------------
// Filenames per target
// ---------------------------------------------------------------------------

const TARGET_FILES: Record<ExportTarget, string> = {
  chat: "exports/brand-system-chat.md",
  code: "exports/brand-system-code.md",
  team: "exports/brand-guidelines.md",
  email: "exports/brand-summary.md",
  "claude-skill": "exports/brand-skill.md",
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
    case "claude-skill":
      content = generateClaudeSkill(data, includeLogo);
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
            : target === "claude-skill"
              ? "Save .brand/exports/brand-skill.md as SKILL.md in your Claude skills folder. See deployment instructions at the bottom of the file."
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
    .enum(["chat", "code", "team", "email", "claude-skill"])
    .describe(
      "Where this export will be used. 'chat': upload to AI conversation (Claude/ChatGPT/Gemini). 'code': paste into CLAUDE.md or .cursorrules. 'team': share with designers/writers. 'email': send via Slack or email. 'claude-skill': persistent Claude skill file with embedded logo + brand rules — the gold standard for automatic brand application in every artifact."
    ),
  include_logo: z
    .boolean()
    .default(true)
    .describe("Embed logo SVG/data URI in the export. Set false to reduce file size. Default: true."),
};

const ParamsSchema = z.object(paramsShape);
type ExportParams = z.infer<typeof ParamsSchema>;

export function register(server: McpServer) {
  server.tool(
    "brand_export",
    "Generate portable brand files for any environment — Chat, Code, team sharing, or email. Target 'chat': self-contained markdown to upload to any AI conversation (Claude, ChatGPT, Gemini). Target 'code': MCP config + CLAUDE.md/.cursorrules snippet. Target 'team': clean brand guidelines for designers and writers. Target 'email': concise 500-word summary for Slack or email. Writes to .brand/exports/ and returns the full content. Use when the user wants to share their brand system or set up a new tool.",
    paramsShape,
    async (args) => {
      const parsed = safeParseParams(ParamsSchema, args);
      if (!parsed.success) return parsed.response;
      return handler(parsed.data);
    }
  );
}
