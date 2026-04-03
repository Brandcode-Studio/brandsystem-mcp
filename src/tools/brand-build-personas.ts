import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BrandDir } from "../lib/brand-dir.js";
import { buildResponse, safeParseParams } from "../lib/response.js";
import { SCHEMA_VERSION } from "../schemas/index.js";
import type { ContentStrategyData } from "../schemas/index.js";
import type { Persona } from "../types/index.js";

// ─── Parameters ──────────────────────────────────────────────────────────────

const paramsShape = {
  mode: z
    .enum(["interview", "record", "list"])
    .default("interview")
    .describe(
      "'interview' returns questions for building a new persona; 'record' writes persona data to strategy.yaml; 'list' shows all existing personas"
    ),
  persona_id: z
    .string()
    .optional()
    .describe("ID of persona to update (for record mode, e.g. 'PER-001'). Omit to create a new persona."),
  answers: z
    .string()
    .optional()
    .describe("JSON string with persona fields (for record mode)"),
};

const ParamsSchema = z.object(paramsShape);
type Params = z.infer<typeof ParamsSchema>;

// ─── Interview questions ─────────────────────────────────────────────────────

interface InterviewQuestion {
  number: number;
  key: string;
  question: string;
  maps_to: string;
}

const PERSONA_QUESTIONS: InterviewQuestion[] = [
  {
    number: 1,
    key: "role",
    question: "Who is this person? Title and day-to-day responsibility?",
    maps_to: "role_tag, seniority",
  },
  {
    number: 2,
    key: "core_tension",
    question:
      "What's their core tension — the internal conflict that makes them a buyer?",
    maps_to: "core_tension",
  },
  {
    number: 3,
    key: "objections",
    question:
      "Top 2-3 objections to working with someone like you?",
    maps_to: "key_objections",
  },
  {
    number: 4,
    key: "information_needs",
    question:
      "What do they need to believe at each stage to move forward?",
    maps_to:
      "information_needs (first_touch, context_and_meaning, validation_and_proof, decision_support)",
  },
  {
    number: 5,
    key: "narrative_emphasis",
    question:
      "Which of your brand's messages resonate most with this person?",
    maps_to: "narrative_emphasis",
  },
  {
    number: 6,
    key: "preferred_channels",
    question: "Where does this person pay attention?",
    maps_to: "preferred_channels",
  },
  {
    number: 7,
    key: "decision_authority",
    question: "What's their role in the buying decision?",
    maps_to: "decision_authority",
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getEmptyStrategy(): ContentStrategyData {
  return {
    schema_version: SCHEMA_VERSION,
    session: 4,
    personas: [],
    journey_stages: [],
    messaging_matrix: [],
    themes: [],
  };
}

function nextPersonaId(existing: Persona[]): string {
  if (existing.length === 0) return "PER-001";
  // Find the highest numeric suffix
  let max = 0;
  for (const p of existing) {
    const match = p.id.match(/PER-(\d+)/);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > max) max = num;
    }
  }
  return `PER-${String(max + 1).padStart(3, "0")}`;
}

/**
 * Split freeform text into an array on newlines, periods, semicolons, or "and" boundaries.
 */
function splitFreeform(text: string, splitOn: "objections" | "channels"): string[] {
  if (!text || !text.trim()) return [];
  const separator =
    splitOn === "channels"
      ? /[,;\n]+/
      : /[\n.;]+/;
  return text
    .split(separator)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function generateNameFromRole(roleTag: string): string {
  // "VP Marketing" → "The VP of Marketing"
  const cleaned = roleTag.trim();
  if (cleaned.toLowerCase().startsWith("the ")) return cleaned;
  return `The ${cleaned}`;
}

// ─── Interview mode ──────────────────────────────────────────────────────────

async function handleInterview(brandDir: BrandDir) {
  let clientName = "this brand";
  try {
    const config = await brandDir.readConfig();
    clientName = config.client_name;
  } catch {
    // no config
  }

  // Read existing strategy for context
  let existingPersonas: Persona[] = [];
  let hasStrategy = false;
  if (await brandDir.hasStrategy()) {
    hasStrategy = true;
    const strategy = await brandDir.readStrategy();
    existingPersonas = strategy.personas ?? [];
  }

  // Read messaging for narrative context (if available)
  let perspectiveContext: string | null = null;
  try {
    if (await brandDir.hasMessaging()) {
      const messaging = await brandDir.readMessaging();
      if (messaging.perspective) {
        perspectiveContext = messaging.perspective.one_liner ?? null;
      }
    }
  } catch {
    // no messaging
  }

  return buildResponse({
    what_happened: hasStrategy
      ? `Strategy file exists with ${existingPersonas.length} persona(s). Ready to build another.`
      : `No strategy.yaml yet. Starting fresh persona building for "${clientName}".`,
    next_steps: [
      "Present the interview questions below — work through one persona at a time",
      "After gathering answers, call brand_build_personas with mode='record' and answers=<JSON>",
      "Most brands have 3-5 personas",
    ],
    data: {
      client_name: clientName,
      existing_personas: existingPersonas.map((p) => ({
        id: p.id,
        name: p.name,
        role: p.role_tag,
        status: p.status,
      })),
      interview: {
        questions: PERSONA_QUESTIONS,
      },
      ...(perspectiveContext
        ? { brand_context: { one_liner: perspectiveContext } }
        : {}),
      conversation_guide: [
        `You are building buyer personas for "${clientName}".`,
        "",
        "HOW TO RUN THIS INTERVIEW:",
        "1. Work through ONE persona at a time.",
        "2. Ask for a name/nickname first ('Let's give this persona a name — something memorable like The Overwhelmed VP').",
        "3. Then walk through each question conversationally — do NOT dump all 7 at once.",
        "4. Listen for answers, probe for specificity, then move to the next question.",
        "5. After gathering all answers for one persona, call brand_build_personas with mode='record' to save.",
        "6. After recording, ask 'Want to add another persona? Most brands have 3-5.'",
        "7. Suggest marking personas as 'Hypothesis' if unvalidated.",
        "",
        "TONE: Strategic advisor — curious, pushing for actionable specificity.",
        "GOAL: Get personas that are specific enough to drive content decisions, not vague demographics.",
        "",
        "KEY INSIGHT FOR Q2 (core_tension):",
        "The best personas have a tension that's emotional, not just functional.",
        "'Needs better reporting' is functional. 'Terrified of presenting numbers they can't defend' is a tension.",
        "",
        "KEY INSIGHT FOR Q4 (information_needs):",
        "Walk through the four stages: first_touch (what catches attention), context_and_meaning (what builds understanding),",
        "validation_and_proof (what builds confidence), decision_support (what closes the deal).",
      ].join("\n"),
    },
  });
}

// ─── Record mode ─────────────────────────────────────────────────────────────

async function handleRecord(
  brandDir: BrandDir,
  personaId: string | undefined,
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
  let strategy: ContentStrategyData;
  if (await brandDir.hasStrategy()) {
    strategy = await brandDir.readStrategy();
  } else {
    strategy = getEmptyStrategy();
  }

  // Ensure personas array exists
  if (!strategy.personas) {
    strategy.personas = [];
  }

  const isUpdate = !!personaId;
  let existingIdx = -1;

  if (isUpdate) {
    existingIdx = strategy.personas.findIndex((p) => p.id === personaId);
    if (existingIdx === -1) {
      return buildResponse({
        what_happened: `Persona "${personaId}" not found`,
        next_steps: [
          "Check the persona ID — use brand_build_personas mode='list' to see existing personas",
        ],
        data: {
          error: "persona_not_found",
          valid_ids: strategy.personas.map((p) => p.id),
        },
      });
    }
  }

  // Parse fields from answers
  const roleTag = (answers.role_tag as string) ?? (answers.role as string) ?? "";
  const seniority = (answers.seniority as string) ?? "";
  const name =
    (answers.name as string) ||
    (roleTag ? generateNameFromRole(roleTag) : "Unnamed Persona");

  // Parse key_objections: accept array or freeform string
  let keyObjections: string[] = [];
  if (Array.isArray(answers.key_objections)) {
    keyObjections = (answers.key_objections as string[]).filter(
      (s) => typeof s === "string" && s.trim()
    );
  } else if (typeof answers.key_objections === "string") {
    keyObjections = splitFreeform(answers.key_objections as string, "objections");
  } else if (typeof answers.objections === "string") {
    keyObjections = splitFreeform(answers.objections as string, "objections");
  } else if (Array.isArray(answers.objections)) {
    keyObjections = (answers.objections as string[]).filter(
      (s) => typeof s === "string" && s.trim()
    );
  }

  // Parse preferred_channels: accept array or comma-separated string
  let preferredChannels: string[] = [];
  if (Array.isArray(answers.preferred_channels)) {
    preferredChannels = (answers.preferred_channels as string[]).filter(
      (s) => typeof s === "string" && s.trim()
    );
  } else if (typeof answers.preferred_channels === "string") {
    preferredChannels = splitFreeform(
      answers.preferred_channels as string,
      "channels"
    );
  } else if (typeof answers.channels === "string") {
    preferredChannels = splitFreeform(answers.channels as string, "channels");
  } else if (Array.isArray(answers.channels)) {
    preferredChannels = (answers.channels as string[]).filter(
      (s) => typeof s === "string" && s.trim()
    );
  }

  // Parse information_needs
  const infoNeeds =
    (answers.information_needs as Record<string, string>) ?? {};
  const informationNeeds = {
    first_touch: (infoNeeds.first_touch as string) ?? "",
    context_and_meaning: (infoNeeds.context_and_meaning as string) ?? "",
    validation_and_proof: (infoNeeds.validation_and_proof as string) ?? "",
    decision_support: (infoNeeds.decision_support as string) ?? "",
  };

  // Parse narrative_emphasis
  const narrativeRaw =
    (answers.narrative_emphasis as Record<string, unknown>) ?? {};
  const narrativeEmphasis = {
    primary: (narrativeRaw.primary as string) ?? "",
    ...(narrativeRaw.secondary
      ? { secondary: narrativeRaw.secondary as string }
      : {}),
    ...(narrativeRaw.elements
      ? { elements: narrativeRaw.elements as string[] }
      : {}),
  };

  // Build the persona
  const id = isUpdate ? personaId! : nextPersonaId(strategy.personas);
  const status =
    (answers.status as "Active" | "Hypothesis" | "Retired") ?? "Hypothesis";

  const persona: Persona = {
    id,
    name,
    role_tag: roleTag,
    seniority,
    decision_authority: (answers.decision_authority as string) ?? "",
    status,
    core_tension: (answers.core_tension as string) ?? "",
    key_objections: keyObjections,
    information_needs: informationNeeds,
    narrative_emphasis: narrativeEmphasis,
    preferred_channels: preferredChannels,
    ...(answers.company_stage
      ? {
          company_stage: Array.isArray(answers.company_stage)
            ? (answers.company_stage as string[])
            : [answers.company_stage as string],
        }
      : {}),
    ...(answers.source ? { source: answers.source as string } : {}),
  };

  // Insert or update
  const changes: string[] = [];
  if (isUpdate) {
    strategy.personas[existingIdx] = persona;
    changes.push(`Updated persona ${id} ("${name}")`);
  } else {
    strategy.personas.push(persona);
    changes.push(`Added persona ${id} ("${name}")`);
  }

  // Write back
  await brandDir.writeStrategy(strategy);

  const totalPersonas = strategy.personas.length;

  return buildResponse({
    what_happened: isUpdate
      ? `Updated persona ${id} ("${name}") in strategy.yaml`
      : `Recorded new persona ${id} ("${name}") to strategy.yaml`,
    next_steps:
      totalPersonas < 3
        ? [
            `${totalPersonas} persona(s) so far. Most brands need 3-5.`,
            "Ask if the user wants to add another persona",
            "Run brand_build_personas mode='interview' to start the next one",
          ]
        : [
            `${totalPersonas} persona(s) recorded. Good coverage for most brands.`,
            "Ask if any more personas are needed, or move on to journey stages",
          ],
    data: {
      persona_id: id,
      persona_name: name,
      changes,
      total_personas: totalPersonas,
      all_personas: strategy.personas.map((p) => ({
        id: p.id,
        name: p.name,
        role: p.role_tag,
        status: p.status,
      })),
      conversation_guide: isUpdate
        ? `Persona "${name}" updated. Ask if any other personas need changes, or if they want to add a new one.`
        : `Persona "${name}" recorded. Ask: "Want to add another persona? Most brands have 3-5." Suggest marking unvalidated personas as 'Hypothesis'.`,
    },
  });
}

// ─── List mode ───────────────────────────────────────────────────────────────

async function handleList(brandDir: BrandDir) {
  if (!(await brandDir.hasStrategy())) {
    return buildResponse({
      what_happened: "No strategy.yaml found — no personas exist yet",
      next_steps: [
        "Run brand_build_personas mode='interview' to start building personas",
      ],
      data: { personas: [], total: 0 },
    });
  }

  const strategy = await brandDir.readStrategy();
  const personas = strategy.personas ?? [];

  if (personas.length === 0) {
    return buildResponse({
      what_happened: "Strategy file exists but contains no personas",
      next_steps: [
        "Run brand_build_personas mode='interview' to start building personas",
      ],
      data: { personas: [], total: 0 },
    });
  }

  return buildResponse({
    what_happened: `Found ${personas.length} persona(s) in strategy.yaml`,
    next_steps: [
      "Review personas with the user",
      "Use mode='record' with persona_id to update any persona",
      "Use mode='interview' to add a new persona",
    ],
    data: {
      personas: personas.map((p) => ({
        id: p.id,
        name: p.name,
        role_tag: p.role_tag,
        status: p.status,
        core_tension: p.core_tension,
        key_objections: p.key_objections,
        decision_authority: p.decision_authority,
        preferred_channels: p.preferred_channels,
      })),
      total: personas.length,
    },
  });
}

// ─── Main handler ────────────────────────────────────────────────────────────

async function handler(input: Params) {
  const brandDir = new BrandDir(process.cwd());

  if (!(await brandDir.exists())) {
    return buildResponse({
      what_happened: "No .brand/ directory found",
      next_steps: ["Run brand_start first to create a brand system"],
      data: { error: "not_initialized" },
    });
  }

  if (input.mode === "interview") {
    return handleInterview(brandDir);
  }

  if (input.mode === "list") {
    return handleList(brandDir);
  }

  // Record mode — validate required params
  if (!input.answers) {
    return buildResponse({
      what_happened: "Missing required parameter: answers",
      next_steps: [
        "Provide answers as a JSON string with persona fields (role_tag, core_tension, key_objections, etc.)",
      ],
      data: { error: "missing_answers" },
    });
  }

  return handleRecord(brandDir, input.persona_id, input.answers);
}

// ─── Registration ────────────────────────────────────────────────────────────

export function register(server: McpServer) {
  server.tool(
    "brand_build_personas",
    "Build buyer personas through a guided 7-question interview — role, core tension, objections, information needs per journey stage, narrative emphasis, preferred channels, and decision authority. Mode 'interview' returns questions. Mode 'record' saves a persona (auto-generates ID like PER-001, parses freeform text). Mode 'list' shows all personas. Most brands need 3-5 personas. Part of Session 4. Returns persona data and total count.",
    paramsShape,
    async (args) => {
      const parsed = safeParseParams(ParamsSchema, args);
      if (!parsed.success) return parsed.response;
      return handler(parsed.data);
    }
  );
}
