import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BrandDir } from "../lib/brand-dir.js";
import { buildResponse, safeParseParams } from "../lib/response.js";
import { SCHEMA_VERSION } from "../schemas/index.js";
import type { ContentTheme, ContentStrategy } from "../types/index.js";

const paramsShape = {
  mode: z
    .enum(["interview", "record", "list"])
    .default("interview")
    .describe(
      "'interview' returns questions for defining content themes; 'record' writes a theme to strategy.yaml; 'list' returns all current themes"
    ),
  theme_id: z
    .string()
    .optional()
    .describe("ID of theme to edit (for record mode, optional — omit to create new)"),
  answers: z
    .string()
    .optional()
    .describe("JSON string with theme data (required when mode='record')"),
};

const ParamsSchema = z.object(paramsShape);
type Params = z.infer<typeof ParamsSchema>;

// --- Interview questions ---

interface ThemeQuestion {
  number: number;
  question: string;
  maps_to: string;
  guidance?: string;
}

const THEME_QUESTIONS: ThemeQuestion[] = [
  {
    number: 1,
    question:
      "What's the most important idea you want the market to associate with you right now?",
    maps_to: "name + strategic_priority",
    guidance:
      "The name should be a short label (2-5 words). The strategic_priority is the explanation of why this idea matters right now.",
  },
  {
    number: 2,
    question:
      "What proof do you have for this? Which data points, case studies, or observations back it up?",
    maps_to: "key_claims",
    guidance:
      "These become the proof points attached to this theme. Can be existing claims from the brand system or new ones.",
  },
  {
    number: 3,
    question: "Which audiences care most about this theme?",
    maps_to: "target_personas",
    guidance:
      "Reference existing persona IDs (e.g. PER-001) if available, or describe the audience and we'll match them.",
  },
  {
    number: 4,
    question:
      "Is this about building awareness (Brand Heat), deepening engagement (Momentum), or driving action (Conversion)?",
    maps_to: "content_intent",
    guidance:
      "Pick one primary intent. Brand Heat = thought leadership + awareness. Momentum = engagement + trust. Conversion = pipeline + action.",
  },
  {
    number: 5,
    question:
      "Is this theme evergreen or time-bound? If time-bound, which quarter?",
    maps_to: "quarter + status",
    guidance:
      'Examples: "evergreen", "Q2 2026", "H2 2026". Time-bound themes get Active status; evergreen themes can be Active or Planned.',
  },
];

// --- Helpers ---

function getEmptyStrategy(): ContentStrategy {
  return {
    schema_version: SCHEMA_VERSION,
    session: 4,
    personas: [],
    journey_stages: [],
    messaging_matrix: [],
    themes: [],
  };
}

function generateThemeId(existingThemes: ContentTheme[]): string {
  const maxNum = existingThemes.reduce((max, t) => {
    const match = t.id.match(/^THM-(\d+)$/);
    return match ? Math.max(max, parseInt(match[1], 10)) : max;
  }, 0);
  return `THM-${String(maxNum + 1).padStart(3, "0")}`;
}

/** Parse content intent from natural language */
function parseContentIntent(raw: string): ContentTheme["content_intent"] {
  const lower = raw.toLowerCase().trim();
  if (
    lower.includes("brand heat") ||
    lower.includes("awareness") ||
    lower.includes("thought leadership")
  ) {
    return "Brand Heat";
  }
  if (
    lower.includes("momentum") ||
    lower.includes("engagement") ||
    lower.includes("education") ||
    lower.includes("trust")
  ) {
    return "Momentum";
  }
  if (
    lower.includes("conversion") ||
    lower.includes("sales") ||
    lower.includes("pipeline") ||
    lower.includes("action") ||
    lower.includes("driving action")
  ) {
    return "Conversion";
  }
  // If the raw value is already one of the canonical names, use it
  if (["Brand Heat", "Momentum", "Conversion"].includes(raw.trim())) {
    return raw.trim() as ContentTheme["content_intent"];
  }
  // Fallback — return as-is so the user can refine
  return raw.trim();
}

/** Parse freeform text into a string array */
function parseStringArray(val: unknown): string[] {
  if (Array.isArray(val)) {
    return val.map((v) => String(v).trim()).filter((v) => v.length > 0);
  }
  if (typeof val === "string" && val.trim()) {
    return val
      .split(/[,;\n]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  return [];
}

/** Match freeform persona references against existing persona names/IDs */
function resolvePersonaRefs(
  raw: unknown,
  existingPersonas: Array<{ id: string; name: string; role_tag: string }>
): string[] {
  const inputs = parseStringArray(raw);
  if (existingPersonas.length === 0) {
    // No personas to match against — return raw values
    return inputs;
  }

  return inputs.map((input) => {
    const lower = input.toLowerCase();
    // Direct ID match (e.g. "PER-001")
    const idMatch = existingPersonas.find(
      (p) => p.id.toLowerCase() === lower
    );
    if (idMatch) return idMatch.id;
    // Name match (e.g. "The Overwhelmed VP")
    const nameMatch = existingPersonas.find(
      (p) => p.name.toLowerCase() === lower
    );
    if (nameMatch) return nameMatch.id;
    // Partial name match
    const partialMatch = existingPersonas.find(
      (p) =>
        p.name.toLowerCase().includes(lower) ||
        lower.includes(p.name.toLowerCase()) ||
        p.role_tag.toLowerCase().includes(lower) ||
        lower.includes(p.role_tag.toLowerCase())
    );
    if (partialMatch) return partialMatch.id;
    // No match — return as-is
    return input;
  });
}

/** Determine status from quarter and explicit status */
function resolveStatus(
  quarter: string | undefined,
  explicitStatus: string | undefined
): ContentTheme["status"] {
  if (explicitStatus) {
    const lower = explicitStatus.toLowerCase();
    if (lower === "active") return "Active";
    if (lower === "planned") return "Planned";
    if (lower === "retired") return "Retired";
  }
  // Default: Active if quarter provided, Planned otherwise
  return quarter && quarter.trim() ? "Active" : "Planned";
}

/** Parse quarter from freeform text */
function parseQuarter(raw: unknown): string | undefined {
  if (!raw) return undefined;
  const str = String(raw).trim().toLowerCase();
  if (!str || str === "evergreen" || str === "none" || str === "n/a") {
    return undefined;
  }
  return String(raw).trim();
}

// --- Interview mode ---

async function handleInterview(brandDir: BrandDir) {
  let clientName = "this brand";
  try {
    const config = await brandDir.readConfig();
    clientName = config.client_name;
  } catch {
    // no config
  }

  // Check for existing strategy + personas
  let existingThemeCount = 0;
  let existingPersonas: Array<{ id: string; name: string }> = [];
  if (await brandDir.hasStrategy()) {
    const strategy = await brandDir.readStrategy();
    existingThemeCount = strategy.themes.length;
    existingPersonas = strategy.personas.map((p) => ({
      id: p.id,
      name: p.name,
    }));
  }

  const personaContext =
    existingPersonas.length > 0
      ? {
          available_personas: existingPersonas,
          note: "Reference these persona IDs when answering Q3.",
        }
      : {
          available_personas: [],
          note: "No personas defined yet. Describe audiences in plain language — they can be formalized later with brand_build_personas.",
        };

  return buildResponse({
    what_happened:
      existingThemeCount > 0
        ? `${existingThemeCount} theme(s) already exist for "${clientName}". Ready to add more.`
        : `No content themes defined yet for "${clientName}". Starting theme interview.`,
    next_steps: [
      "Present the questions below — work through one theme at a time",
      "After gathering answers, call brand_build_themes with mode='record', answers=<JSON>",
      "Repeat for each theme (most brands have 3-5 active themes)",
    ],
    data: {
      client_name: clientName,
      existing_themes: existingThemeCount,
      personas: personaContext,
      questions: THEME_QUESTIONS,
      intent_definitions: {
        "Brand Heat":
          "Provocative, POV-forward, conversation-starting. Goal: awareness + thought leadership. Makes people say 'I never thought about it that way.'",
        Momentum:
          "Deep, useful, framework-oriented. Goal: engagement + trust. Makes people say 'I need to save this.'",
        Conversion:
          "Direct, outcome-focused, proof-heavy. Goal: pipeline + action. Makes people say 'I need to talk to them.'",
      },
      conversation_guide: {
        instruction: [
          `You are defining editorial content themes for "${clientName}". These are the strategic pillars that organize what to write about.`,
          "",
          "HOW TO RUN THIS INTERVIEW:",
          "1. Work through ONE theme at a time. Ask all 5 questions for each theme.",
          "2. Ask conversationally — do NOT dump all questions at once.",
          "3. When you have answers for a theme, call brand_build_themes with mode='record' to save it.",
          "4. Then ask: 'Want to add another theme?'",
          "5. Most brands have 3-5 active themes. Suggest they balance across all three intents.",
          "",
          "EXPLAIN THE THREE INTENTS:",
          "Before question 4, explain the three content intents clearly:",
          "- **Brand Heat** — Provocative, POV-forward, conversation-starting. Goal: awareness + thought leadership.",
          "- **Momentum** — Deep, useful, framework-oriented. Goal: engagement + trust.",
          "- **Conversion** — Direct, outcome-focused, proof-heavy. Goal: pipeline + action.",
          "",
          "Suggest they aim for at least one theme in each intent category to cover the full funnel.",
          "",
          "AFTER ALL THEMES ARE RECORDED:",
          "Say: 'Your content strategy is taking shape. Run brand_build_matrix to generate message variants for each persona x journey stage, then brand_status --strategy to see the full coverage picture.'",
          "",
          "TONE: Collaborative strategist — curious, direct, non-judgmental.",
          "GOAL: Get specific, actionable themes — not vague categories.",
        ].join("\n"),
      },
    },
  });
}

// --- Record mode ---

async function handleRecord(
  brandDir: BrandDir,
  themeId: string | undefined,
  answersRaw: string
) {
  let answers: Record<string, unknown>;
  try {
    answers = JSON.parse(answersRaw);
  } catch {
    return buildResponse({
      what_happened: "Failed to parse answers — invalid JSON",
      next_steps: ["Provide answers as a valid JSON string"],
      data: { error: "invalid_json", raw: answersRaw },
    });
  }

  // Read or create strategy
  let strategy: ContentStrategy;
  if (await brandDir.hasStrategy()) {
    strategy = await brandDir.readStrategy();
  } else {
    strategy = getEmptyStrategy();
  }

  const isEdit = !!themeId;
  let targetId: string;
  let existingIndex = -1;

  if (isEdit) {
    existingIndex = strategy.themes.findIndex((t) => t.id === themeId);
    if (existingIndex === -1) {
      return buildResponse({
        what_happened: `Theme "${themeId}" not found`,
        next_steps: [
          "Check the theme ID with brand_build_themes mode='list'",
          "Or omit theme_id to create a new theme",
        ],
        data: { error: "theme_not_found", theme_id: themeId },
      });
    }
    targetId = themeId;
  } else {
    targetId = generateThemeId(strategy.themes);
  }

  // Parse the answers
  const name = String(answers.name ?? "").trim();
  if (!name) {
    return buildResponse({
      what_happened: "Missing required field: name",
      next_steps: [
        "Provide at least a 'name' field in the answers JSON",
      ],
      data: { error: "missing_name" },
    });
  }

  const rawIntent = String(answers.content_intent ?? answers.intent ?? "");
  const contentIntent = parseContentIntent(rawIntent);
  const quarter = parseQuarter(answers.quarter);
  const status = resolveStatus(
    quarter,
    answers.status as string | undefined
  );

  // Resolve persona references against existing personas
  const existingPersonas = strategy.personas.map((p) => ({
    id: p.id,
    name: p.name,
    role_tag: p.role_tag,
  }));
  const targetPersonas = resolvePersonaRefs(
    answers.target_personas ?? answers.personas ?? answers.audiences ?? [],
    existingPersonas
  );

  const keyClaims = parseStringArray(
    answers.key_claims ?? answers.proof ?? answers.claims ?? []
  );

  const theme: ContentTheme = {
    id: targetId,
    name,
    status,
    ...(quarter ? { quarter } : {}),
    content_intent: contentIntent,
    strategic_priority: String(
      answers.strategic_priority ?? answers.priority ?? ""
    ).trim(),
    ...(answers.narrative_route
      ? { narrative_route: String(answers.narrative_route) }
      : {}),
    target_personas: targetPersonas,
    ...(keyClaims.length > 0 ? { key_claims: keyClaims } : {}),
    ...(answers.success_criteria
      ? { success_criteria: String(answers.success_criteria) }
      : {}),
  };

  // Insert or update
  if (isEdit && existingIndex >= 0) {
    strategy.themes[existingIndex] = theme;
  } else {
    strategy.themes.push(theme);
  }

  await brandDir.writeStrategy(strategy);

  const changes: string[] = [
    isEdit
      ? `Updated theme ${targetId}: "${name}"`
      : `Created theme ${targetId}: "${name}"`,
    `Intent: ${contentIntent}`,
    `Status: ${status}${quarter ? ` (${quarter})` : ""}`,
    `Personas: ${targetPersonas.length > 0 ? targetPersonas.join(", ") : "none specified"}`,
    ...(keyClaims.length > 0
      ? [`Claims: ${keyClaims.length} proof point(s)`]
      : []),
  ];

  // Check intent distribution
  const intentCounts = { "Brand Heat": 0, Momentum: 0, Conversion: 0 };
  for (const t of strategy.themes) {
    if (t.content_intent in intentCounts) {
      intentCounts[t.content_intent as keyof typeof intentCounts]++;
    }
  }
  const missingIntents = Object.entries(intentCounts)
    .filter(([, count]) => count === 0)
    .map(([intent]) => intent);

  const nextSteps: string[] = [];
  nextSteps.push(
    `${strategy.themes.length} theme(s) total. Want to add another?`
  );

  if (missingIntents.length > 0) {
    nextSteps.push(
      `No themes yet for: ${missingIntents.join(", ")}. Consider adding coverage for a balanced strategy.`
    );
  }

  if (strategy.themes.length >= 3 && missingIntents.length === 0) {
    nextSteps.push(
      "Your content strategy is taking shape. Run brand_build_matrix to generate message variants for each persona x journey stage, then brand_status --strategy to see the full coverage picture."
    );
  }

  return buildResponse({
    what_happened: isEdit
      ? `Updated theme "${name}" (${targetId}) in strategy.yaml`
      : `Recorded new theme "${name}" (${targetId}) to strategy.yaml`,
    next_steps: nextSteps,
    data: {
      theme: theme,
      changes,
      total_themes: strategy.themes.length,
      intent_distribution: intentCounts,
      missing_intents: missingIntents,
    },
  });
}

// --- List mode ---

async function handleList(brandDir: BrandDir) {
  if (!(await brandDir.hasStrategy())) {
    return buildResponse({
      what_happened: "No strategy.yaml found — no themes defined yet",
      next_steps: [
        "Run brand_build_themes mode='interview' to start defining content themes",
      ],
      data: { themes: [] },
    });
  }

  const strategy = await brandDir.readStrategy();
  const themes = strategy.themes;

  if (themes.length === 0) {
    return buildResponse({
      what_happened: "Strategy exists but no themes defined yet",
      next_steps: [
        "Run brand_build_themes mode='interview' to start defining content themes",
      ],
      data: { themes: [] },
    });
  }

  // Build summary for each theme
  const themeSummaries = themes.map((t) => ({
    id: t.id,
    name: t.name,
    content_intent: t.content_intent,
    status: t.status,
    quarter: t.quarter ?? "evergreen",
    target_personas: t.target_personas,
    key_claims_count: t.key_claims?.length ?? 0,
  }));

  // Intent distribution
  const intentCounts = { "Brand Heat": 0, Momentum: 0, Conversion: 0 };
  for (const t of themes) {
    if (t.content_intent in intentCounts) {
      intentCounts[t.content_intent as keyof typeof intentCounts]++;
    }
  }
  const missingIntents = Object.entries(intentCounts)
    .filter(([, count]) => count === 0)
    .map(([intent]) => intent);

  const statusCounts = {
    Active: themes.filter((t) => t.status === "Active").length,
    Planned: themes.filter((t) => t.status === "Planned").length,
    Retired: themes.filter((t) => t.status === "Retired").length,
  };

  const nextSteps: string[] = [];
  if (missingIntents.length > 0) {
    nextSteps.push(
      `No themes for: ${missingIntents.join(", ")}. Consider adding coverage.`
    );
  }
  nextSteps.push(
    "Run brand_build_themes mode='record' to add or edit themes"
  );
  if (themes.length >= 3) {
    nextSteps.push(
      "Run brand_build_matrix to generate message variants for each persona x journey stage"
    );
  }

  return buildResponse({
    what_happened: `Found ${themes.length} content theme(s)`,
    next_steps: nextSteps,
    data: {
      themes: themeSummaries,
      intent_distribution: intentCounts,
      missing_intents: missingIntents,
      status_distribution: statusCounts,
    },
  });
}

// --- Main handler ---

async function handler(input: Params) {
  const brandDir = new BrandDir(process.cwd());

  if (!(await brandDir.exists())) {
    return buildResponse({
      what_happened: "No .brand/ directory found",
      next_steps: ["Run brand_start first to create a brand system"],
      data: { error: "not_initialized" },
    });
  }

  switch (input.mode) {
    case "interview":
      return handleInterview(brandDir);
    case "list":
      return handleList(brandDir);
    case "record": {
      if (!input.answers) {
        return buildResponse({
          what_happened: "Missing required parameter: answers",
          next_steps: [
            "Provide answers as a JSON string with at least: name, content_intent, strategic_priority, target_personas",
          ],
          data: { error: "missing_answers" },
        });
      }
      return handleRecord(brandDir, input.theme_id, input.answers);
    }
  }
}

export function register(server: McpServer) {
  server.tool(
    "brand_build_themes",
    "Define editorial content themes — the strategic pillars that organize what to write about. Each theme has a content intent (Brand Heat for awareness, Momentum for engagement, Conversion for pipeline), target personas, and proof points. Mode 'interview' guides through 5 questions per theme. Mode 'record' saves (auto-generates ID like THM-001). Mode 'list' shows all themes with intent distribution. Most brands need 3-5 themes balanced across all three intents. Returns theme data and balance analysis.",
    paramsShape,
    async (args) => {
      const parsed = safeParseParams(ParamsSchema, args);
      if (!parsed.success) return parsed.response;
      return handler(parsed.data);
    }
  );
}
