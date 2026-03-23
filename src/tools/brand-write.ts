import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BrandDir } from "../lib/brand-dir.js";
import { buildResponse } from "../lib/response.js";
import type { CoreIdentityData, ContentStrategyData } from "../schemas/index.js";
import type { VisualIdentityData, MessagingData } from "../schemas/index.js";

// ---------------------------------------------------------------------------
// Content type classification
// ---------------------------------------------------------------------------

type ContentType =
  | "social-graphic"
  | "web-page"
  | "blog-post"
  | "email"
  | "landing-page"
  | "case-study"
  | "presentation"
  | "data-viz"
  | "general";

const VISUAL_TYPES: ContentType[] = [
  "social-graphic",
  "web-page",
  "data-viz",
];

const WRITTEN_TYPES: ContentType[] = [
  "blog-post",
  "email",
  "case-study",
];

const MIXED_TYPES: ContentType[] = [
  "landing-page",
  "presentation",
  "general",
];

function needsVisual(ct: ContentType): boolean {
  return VISUAL_TYPES.includes(ct) || MIXED_TYPES.includes(ct);
}

function needsVoice(ct: ContentType): boolean {
  return WRITTEN_TYPES.includes(ct) || MIXED_TYPES.includes(ct);
}

// ---------------------------------------------------------------------------
// Brief builders
// ---------------------------------------------------------------------------

interface VisualBrief {
  colors: Array<{ name: string; hex: string; role: string }>;
  typography: Array<{
    name: string;
    family: string;
    weight?: number;
    usage: string;
  }>;
  logo: Array<{
    type: string;
    variants: Array<{
      name: string;
      inline_svg?: string;
      data_uri?: string;
    }>;
  }>;
  spacing: { base_unit?: string; scale?: number[] } | null;
  composition: Record<string, string> | null;
  signature: { description: string; elements: string[] } | null;
  anti_patterns: Array<{ rule: string; severity: string }>;
  theme: string;
}

function buildVisualBrief(
  identity: CoreIdentityData,
  visual: VisualIdentityData | null,
  tokens: Record<string, unknown> | null,
  theme: string
): VisualBrief {
  // Colors with roles
  const colors = identity.colors.map((c) => ({
    name: c.name,
    hex: c.value,
    role: c.role,
  }));

  // Typography with usage hints
  const typography = identity.typography.map((t) => ({
    name: t.name,
    family: t.family,
    weight: t.weight,
    usage: t.name.toLowerCase().includes("head")
      ? "headings"
      : t.name.toLowerCase().includes("body")
        ? "body text"
        : t.name.toLowerCase().includes("mono") ||
            t.name.toLowerCase().includes("code")
          ? "code / monospace"
          : "general",
  }));

  // Logo — include inline_svg and data_uri for direct embedding
  const logo = identity.logo.map((l) => ({
    type: l.type,
    variants: l.variants.map((v) => ({
      name: v.name,
      inline_svg: v.inline_svg,
      data_uri: v.data_uri,
    })),
  }));

  // Spacing
  const spacing = identity.spacing
    ? { base_unit: identity.spacing.base_unit, scale: identity.spacing.scale }
    : null;

  // Session 2 data (graceful degrade)
  const composition = visual?.composition
    ? {
        energy: visual.composition.energy,
        negative_space: visual.composition.negative_space,
        grid: visual.composition.grid,
        layout_preference: visual.composition.layout_preference,
      }
    : null;

  const signature = visual?.signature
    ? {
        description: visual.signature.description,
        elements: visual.signature.elements,
      }
    : null;

  // Anti-patterns as hard rules
  const anti_patterns = (visual?.anti_patterns || []).map((ap) => ({
    rule: ap.rule,
    severity: ap.severity,
  }));

  return {
    colors,
    typography,
    logo,
    spacing,
    composition,
    signature,
    anti_patterns,
    theme,
  };
}

interface VoiceBrief {
  tone: {
    descriptors: string[];
    register: string;
    never_sounds_like: string;
    sentence_patterns: { prefer: string[]; avoid: string[] };
    conventions: Record<string, unknown>;
  } | null;
  vocabulary: {
    anchor: Array<{ use: string; not: string; reason: string }>;
    never_say: Array<{ word: string; reason: string }>;
    jargon_policy: string;
    placeholder_defaults: Record<string, string>;
  } | null;
  ai_ism_detection: {
    patterns: string[];
    instruction: string;
  } | null;
  perspective: {
    worldview: string;
    tension: string;
    resolution: string;
    audience: string;
    positioning: string;
    one_liner: string;
  } | null;
  brand_story: {
    origin: string;
    tension: string;
    resolution: string;
    vision: string;
    tagline: string;
  } | null;
}

function buildVoiceBrief(messaging: MessagingData | null): VoiceBrief {
  if (!messaging) {
    return {
      tone: null,
      vocabulary: null,
      ai_ism_detection: null,
      perspective: null,
      brand_story: null,
    };
  }

  const tone = messaging.voice
    ? {
        descriptors: messaging.voice.tone.descriptors,
        register: messaging.voice.tone.register,
        never_sounds_like: messaging.voice.tone.never_sounds_like,
        sentence_patterns: messaging.voice.tone.sentence_patterns,
        conventions: messaging.voice.tone.conventions as Record<
          string,
          unknown
        >,
      }
    : null;

  const vocabulary = messaging.voice
    ? {
        anchor: messaging.voice.vocabulary.anchor,
        never_say: messaging.voice.vocabulary.never_say,
        jargon_policy: messaging.voice.vocabulary.jargon_policy,
        placeholder_defaults:
          messaging.voice.vocabulary.placeholder_defaults as Record<
            string,
            string
          >,
      }
    : null;

  const ai_ism_detection = messaging.voice
    ? {
        patterns: messaging.voice.ai_ism_detection.patterns,
        instruction: messaging.voice.ai_ism_detection.instruction,
      }
    : null;

  const perspective = messaging.perspective
    ? { ...messaging.perspective }
    : null;

  const brand_story = messaging.brand_story
    ? { ...messaging.brand_story }
    : null;

  return { tone, vocabulary, ai_ism_detection, perspective, brand_story };
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

interface WriteParams {
  content_type: ContentType;
  topic?: string;
  channel?: string;
  theme?: "dark" | "light";
  persona?: string;
  stage?: string;
}

async function handler(input: WriteParams) {
  const brandDir = new BrandDir(process.cwd());

  if (!(await brandDir.exists())) {
    return buildResponse({
      what_happened: "No .brand/ directory found",
      next_steps: ["Run brand_start to create a brand system first"],
      data: { error: "not_initialized" },
    });
  }

  // ── Read all available brand layers ──

  let identity: CoreIdentityData;
  try {
    identity = await brandDir.readCoreIdentity();
  } catch {
    return buildResponse({
      what_happened: "Could not read core-identity.yaml",
      next_steps: [
        "Run brand_extract_web to populate core identity first",
      ],
      data: { error: "no_core_identity" },
    });
  }

  let config: { client_name: string; session: number } = {
    client_name: "",
    session: 1,
  };
  try {
    const raw = await brandDir.readConfig();
    config = { client_name: raw.client_name, session: raw.session };
  } catch {
    // Non-critical — proceed without config
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

  let tokens: Record<string, unknown> | null = null;
  try {
    tokens = await brandDir.readTokens();
  } catch {
    // Tokens are optional
  }

  let strategy: ContentStrategyData | null = null;
  if (await brandDir.hasStrategy()) {
    try {
      strategy = await brandDir.readStrategy();
    } catch {
      // Degrade gracefully
    }
  }

  // ── Determine available layers ──

  const layersAvailable: string[] = ["core_identity"];
  if (visual) layersAvailable.push("visual_identity");
  if (messaging) layersAvailable.push("messaging");
  if (tokens) layersAvailable.push("tokens");
  if (strategy) layersAvailable.push("content_strategy");

  // ── Build creation brief ──

  const ct = input.content_type;
  const theme = input.theme || "dark";
  const topic = input.topic || null;
  const channel = input.channel || null;

  const brief: Record<string, unknown> = {};

  if (needsVisual(ct)) {
    brief.visual = buildVisualBrief(identity, visual, tokens, theme);
  }

  if (needsVoice(ct)) {
    brief.voice = buildVoiceBrief(messaging);
  }

  // For mixed types, include both
  if (MIXED_TYPES.includes(ct)) {
    if (!brief.visual) {
      brief.visual = buildVisualBrief(identity, visual, tokens, theme);
    }
    if (!brief.voice) {
      brief.voice = buildVoiceBrief(messaging);
    }
  }

  // Include strategy context if Session 4 data exists
  if (strategy) {
    const strategyBrief: Record<string, unknown> = {};

    // Find target persona
    if (input.persona) {
      const persona = strategy.personas.find(
        (p) =>
          p.id.toLowerCase() === input.persona!.toLowerCase() ||
          p.name.toLowerCase() === input.persona!.toLowerCase() ||
          p.role_tag.toLowerCase() === input.persona!.toLowerCase()
      );
      if (persona) {
        strategyBrief.persona = {
          id: persona.id,
          name: persona.name,
          role: persona.role_tag,
          core_tension: persona.core_tension,
          key_objections: persona.key_objections,
          narrative_emphasis: persona.narrative_emphasis,
          preferred_channels: persona.preferred_channels,
        };
      }
    }

    // Find journey stage
    if (input.stage) {
      const stage = strategy.journey_stages.find(
        (s) =>
          s.id.toLowerCase() === input.stage!.toLowerCase() ||
          s.name.toLowerCase() === input.stage!.toLowerCase()
      );
      if (stage) {
        strategyBrief.journey_stage = {
          id: stage.id,
          name: stage.name,
          buyer_mindset: stage.buyer_mindset,
          content_goal: stage.content_goal,
          tone_shift: stage.tone_shift,
        };
      }
    }

    // Find matching messaging variant
    if (input.persona && input.stage) {
      const personaMatch = strategy.personas.find(
        (p) =>
          p.id.toLowerCase() === input.persona!.toLowerCase() ||
          p.name.toLowerCase() === input.persona!.toLowerCase() ||
          p.role_tag.toLowerCase() === input.persona!.toLowerCase()
      );
      const stageMatch = strategy.journey_stages.find(
        (s) =>
          s.id.toLowerCase() === input.stage!.toLowerCase() ||
          s.name.toLowerCase() === input.stage!.toLowerCase()
      );
      if (personaMatch && stageMatch) {
        const variant = strategy.messaging_matrix.find(
          (v) => v.persona === personaMatch.id && v.journey_stage === stageMatch.id
        );
        if (variant) {
          strategyBrief.messaging_variant = {
            core_message: variant.core_message,
            tone_shift: variant.tone_shift,
            proof_points: variant.proof_points,
          };
        }
      }
    }

    // Include active themes for context
    const activeThemes = strategy.themes.filter((t) => t.status === "Active");
    if (activeThemes.length > 0) {
      strategyBrief.active_themes = activeThemes.map((t) => ({
        name: t.name,
        intent: t.content_intent,
        priority: t.strategic_priority,
      }));
    }

    // If no persona/stage specified, list available options
    if (!input.persona && strategy.personas.length > 0) {
      strategyBrief.available_personas = strategy.personas
        .filter((p) => p.status !== "Retired")
        .map((p) => `${p.id}: ${p.name} (${p.role_tag})`);
    }
    if (!input.stage && strategy.journey_stages.length > 0) {
      strategyBrief.available_stages = strategy.journey_stages.map(
        (s) => `${s.id}: ${s.name}`
      );
    }

    brief.strategy = strategyBrief;
  }

  // Include tokens if available (theme-specific section if present)
  if (tokens) {
    const themeKey = theme === "light" ? "light" : "dark";
    const themeTokens =
      (tokens as Record<string, unknown>)[themeKey] || null;
    if (themeTokens) {
      brief.theme_tokens = themeTokens;
    }
  }

  // ── Build conversation guide ──

  const contentLabel = ct.replace(/-/g, " ");
  const topicClause = topic ? ` about "${topic}"` : "";
  const channelClause = channel ? ` for ${channel}` : "";
  const themeClause = ` using ${theme} theme`;

  const instructions: string[] = [
    `Generate a ${contentLabel}${topicClause}${channelClause}${themeClause}.`,
    "Apply ALL brand rules from the creation brief below.",
  ];

  // Visual-specific instructions
  if (brief.visual) {
    instructions.push(
      "Use ONLY the colors listed in the palette — no off-brand colors."
    );
    instructions.push(
      "Use the specified font families for headings and body text."
    );
    if (
      (brief.visual as VisualBrief).logo.length > 0 &&
      (brief.visual as VisualBrief).logo.some((l) =>
        l.variants.some((v) => v.inline_svg || v.data_uri)
      )
    ) {
      instructions.push(
        "Embed the logo using the provided inline SVG or data URI — never approximate with styled text."
      );
    }
    if ((brief.visual as VisualBrief).anti_patterns.length > 0) {
      instructions.push(
        "HARD RULES — the anti_patterns list contains things you must NEVER do."
      );
    }
  }

  // Voice-specific instructions
  if (brief.voice) {
    const vb = brief.voice as VoiceBrief;
    if (vb.tone) {
      instructions.push(
        `Write in a tone that is: ${vb.tone.descriptors.join(", ")}.`
      );
    }
    if (vb.vocabulary) {
      instructions.push(
        "Use anchor vocabulary (the 'use' column) instead of the 'not' alternatives."
      );
      instructions.push(
        "Never use words from the never_say list."
      );
    }
    if (vb.ai_ism_detection) {
      instructions.push(
        "HARD RULE: Avoid ALL patterns in ai_ism_detection. " +
          vb.ai_ism_detection.instruction
      );
    }
  }

  instructions.push(
    "After generating, immediately run brand_preflight to validate the output."
  );

  // ── Degradation warnings ──

  const warnings: string[] = [];
  if (!visual && needsVisual(ct)) {
    warnings.push(
      "No visual identity data (Session 2) — composition rules, signature moves, and anti-patterns are unavailable. Run brand_deepen_identity to add them."
    );
  }
  if (!messaging && needsVoice(ct)) {
    warnings.push(
      "No messaging data (Session 3) — voice codex, vocabulary, and perspective are unavailable. Complete Session 3 to add them."
    );
  }
  if (identity.colors.length === 0) {
    warnings.push(
      "No colors in core identity — run brand_extract_web first."
    );
  }
  if (identity.typography.length === 0) {
    warnings.push(
      "No typography in core identity — run brand_extract_web first."
    );
  }

  // ── Assemble response ──

  const nextSteps = [
    `Generate the ${contentLabel} using the creation brief below`,
    "Run brand_preflight on the output to check compliance",
  ];

  if (warnings.length > 0) {
    nextSteps.push(
      ...warnings.map((w) => `NOTE: ${w}`)
    );
  }

  return buildResponse({
    what_happened: `Loaded brand context for ${contentLabel} (${layersAvailable.join(", ")})`,
    next_steps: nextSteps,
    data: {
      content_type: ct,
      client_name: config.client_name,
      brand_layers_available: layersAvailable,
      creation_brief: brief,
      conversation_guide: {
        instruction: instructions.join(" "),
      },
    } as unknown as Record<string, unknown>,
  });
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

const paramsShape = {
  content_type: z
    .enum([
      "social-graphic",
      "web-page",
      "blog-post",
      "email",
      "landing-page",
      "case-study",
      "presentation",
      "data-viz",
      "general",
    ])
    .describe(
      "What type of content to create. Determines which brand layers are loaded (visual, voice, or both)."
    ),
  topic: z
    .string()
    .optional()
    .describe("What the content is about"),
  channel: z
    .string()
    .optional()
    .describe(
      'Where it will be published (e.g., "linkedin", "twitter", "website", "email")'
    ),
  theme: z
    .enum(["dark", "light"])
    .default("dark")
    .describe('Color theme to use — "dark" or "light" (defaults to "dark")'),
  persona: z
    .string()
    .optional()
    .describe("Target persona ID or name (e.g. 'PER-001' or 'VP Marketing'). If Session 4 data exists, adapts messaging for this audience."),
  stage: z
    .string()
    .optional()
    .describe("Buyer journey stage (e.g. 'first-touch', 'validation-and-proof'). Adapts tone and depth."),
};

export function register(server: McpServer) {
  server.tool(
    "brand_write",
    "Load the full brand context for content creation — colors, typography, logo (inline SVG/data URI), composition rules, anti-patterns, voice codex, vocabulary rules, and content strategy. Use before generating any branded content: social graphics, web pages, blog posts, emails, presentations, or data viz. Specify content_type to get the right mix of visual and voice rules. Does NOT generate content — it provides the creation brief so you can generate on-brand. Always run brand_preflight on the output afterward. Returns a structured creation brief with all brand layers.",
    paramsShape,
    async (args) => handler(args as WriteParams)
  );
}
