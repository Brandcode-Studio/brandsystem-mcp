import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BrandDir } from "../lib/brand-dir.js";
import { buildResponse, safeParseParams, parseAnswers } from "../lib/response.js";
import { SCHEMA_VERSION } from "../schemas/index.js";
import { ERROR_CODES } from "../types/index.js";
import type { JourneyStage, ContentStrategy } from "../types/index.js";

const paramsShape = {
  mode: z
    .enum(["interview", "record", "view"])
    .default("interview")
    .describe(
      "'interview' presents default journey stages for customization; 'record' writes stages to strategy.yaml; 'view' returns current stages"
    ),
  answers: z
    .string()
    .optional()
    .describe(
      "JSON string with journey stage customizations (for record mode). Array of stage objects, or a single stage object to update."
    ),
};

const ParamsSchema = z.object(paramsShape);
type Params = z.infer<typeof ParamsSchema>;

// --- Default journey stages ---

function getDefaultStages(): JourneyStage[] {
  return [
    {
      id: "first-touch",
      name: "First Touch",
      buyer_mindset: "What is this? Why should I care?",
      content_goal: "Spark interest. Lead with problem recognition.",
      story_types: ["Brand Narrative"],
      narrative_elements: ["Problem", "Hero"],
      claims_policy: {
        preferred_salience: "Lead",
        max_per_piece: 1,
      },
      tone_shift: "More provocative, less consultative",
    },
    {
      id: "context-and-meaning",
      name: "Context & Meaning",
      buyer_mindset: "Do I understand this? Is it for me?",
      content_goal: "Deepen context. Show unique POV.",
      story_types: ["Brand Narrative", "Product/Service Story"],
      narrative_elements: ["Problem", "Guide", "Journey"],
      claims_policy: {
        preferred_salience: ["Lead", "Support"],
        max_per_piece: 3,
      },
      tone_shift: "More educational, framework-oriented",
    },
    {
      id: "validation-and-proof",
      name: "Validation & Proof",
      buyer_mindset: "Is this legit? Do others trust this?",
      content_goal: "Offer credibility. Show outcomes.",
      story_types: ["Customer/Social Proof", "Product/Service Story"],
      narrative_elements: ["Victory", "Proof Point", "Journey"],
      claims_policy: {
        preferred_salience: ["Support", "Lead"],
        max_per_piece: null,
        min_confidence: 0.8,
      },
      tone_shift: "More concrete, metrics-forward",
    },
    {
      id: "decision-support",
      name: "Decision Support",
      buyer_mindset: "Am I ready? What happens next?",
      content_goal: "Remove friction. Provide clarity.",
      story_types: ["Product/Service Story"],
      narrative_elements: ["Guide", "Victory", "Hero"],
      claims_policy: {
        preferred_salience: "Lead",
        max_per_piece: 2,
      },
      tone_shift: "More direct, consultative, action-oriented",
    },
  ];
}

// --- Interview mode ---

async function handleInterview(brandDir: BrandDir) {
  let clientName = "this brand";
  try {
    const config = await brandDir.readConfig();
    clientName = config.client_name;
  } catch {
    // no config available
  }

  // Check if journey stages already exist
  let existingStages: JourneyStage[] = [];
  if (await brandDir.hasStrategy()) {
    const strategy = await brandDir.readStrategy();
    existingStages = strategy.journey_stages ?? [];
  }

  const defaults = getDefaultStages();

  const stageTable = defaults.map((s) => ({
    id: s.id,
    name: s.name,
    buyer_mindset: s.buyer_mindset,
    content_goal: s.content_goal,
    tone_shift: s.tone_shift,
  }));

  // Drop `defaults_full` — it duplicates `default_stages` plus the 4 extra
  // fields (story_types, narrative_elements, claims_policy) that the server
  // already applies automatically when record mode is called without answers.
  // The agent only needs the stage table for presentation; full field shape
  // is documented in the conversation_guide for customization.
  return buildResponse({
    what_happened: existingStages.length > 0
      ? `Found ${existingStages.length} existing journey stage(s) for "${clientName}". Presenting defaults for review.`
      : `No journey stages defined yet for "${clientName}". Presenting the 4 default buyer journey stages.`,
    next_steps: [
      "Present the default stages table and ask whether to accept or customize",
      "Then call brand_build_journey mode='record' (omit answers to accept defaults, or pass customized stages as JSON)",
    ],
    data: {
      client_name: clientName,
      existing_stages: existingStages.length > 0 ? existingStages : null,
      default_stages: stageTable,
      conversation_guide: {
        instruction: [
          `Present the 4 default buyer journey stages for "${clientName}" as a table (Stage / Buyer Mindset / Content Goal / Tone Shift — fields are in default_stages).`,
          "Ask: 'Want to customize any, or do these work as-is?'",
          "Accept-as-is: call brand_build_journey mode='record' with no answers (server writes defaults).",
          "Customize: gather edits, then call mode='record' with answers as JSON — array of stages or single stage object with id to update one.",
          "",
          "Customizable per stage: name, buyer_mindset, content_goal, story_types (Brand Narrative / Product-Service Story / Customer-Social Proof), narrative_elements (Problem / Hero / Guide / Journey / Victory / Proof Point), claims_policy (preferred_salience, max_per_piece, min_confidence), tone_shift.",
        ].join("\n"),
      },
    },
  });
}

// --- Record mode ---

async function handleRecord(brandDir: BrandDir, answersRaw?: string | Record<string, unknown>) {
  // Parse answers if provided
  let stages: JourneyStage[];

  if (!answersRaw) {
    // No answers = write defaults
    stages = getDefaultStages();
  } else {
    let parsed: unknown;
    try {
      parsed = parseAnswers(answersRaw);
    } catch {
      return buildResponse({
        what_happened: "Failed to parse answers -- provide a JSON object or JSON-encoded string",
        next_steps: ["Provide answers as a valid JSON string (array of stage objects or a single stage object)"],
        data: { error: ERROR_CODES.INVALID_JSON, raw: answersRaw },
      });
    }

    const defaults = getDefaultStages();

    if (Array.isArray(parsed)) {
      // Full array of stages -- validate each has at least an id
      stages = parsed.map((item: Record<string, unknown>) => {
        const defaultStage = defaults.find((d) => d.id === item.id);
        if (defaultStage) {
          // Merge customizations over defaults
          return {
            ...defaultStage,
            ...item,
            claims_policy: {
              ...defaultStage.claims_policy,
              ...((item.claims_policy as Record<string, unknown>) ?? {}),
            },
          } as JourneyStage;
        }
        // Fully custom stage
        return item as unknown as JourneyStage;
      });
    } else if (parsed && typeof parsed === "object" && "id" in (parsed as Record<string, unknown>)) {
      // Single stage update -- merge into defaults
      const single = parsed as Record<string, unknown>;
      stages = defaults.map((d) => {
        if (d.id === single.id) {
          return {
            ...d,
            ...single,
            claims_policy: {
              ...d.claims_policy,
              ...((single.claims_policy as Record<string, unknown>) ?? {}),
            },
          } as JourneyStage;
        }
        return d;
      });
      // If the single stage wasn't found in defaults, append it
      if (!defaults.some((d) => d.id === single.id)) {
        stages.push(single as unknown as JourneyStage);
      }
    } else {
      return buildResponse({
        what_happened: "Invalid answers format",
        next_steps: [
          "Provide answers as a JSON array of stage objects, or a single stage object with an 'id' field",
        ],
        data: { error: ERROR_CODES.INVALID_FORMAT },
      });
    }
  }

  // Read or create strategy.yaml, merging journey_stages without overwriting other fields
  let strategy: ContentStrategy;
  strategy = await brandDir.readOrCreateStrategy();
  strategy.journey_stages = stages;

  await brandDir.writeStrategy(strategy);

  try {
    const config = await brandDir.readConfig();
    if (config.session < 4) {
      config.session = 4;
      await brandDir.writeConfig(config);
    }
  } catch { /* non-fatal */ }

  const isDefaults = !answersRaw;
  const stageNames = stages.map((s) => s.name);

  return buildResponse({
    what_happened: `Recorded ${stages.length} buyer journey stage(s) to strategy.yaml${isDefaults ? " (defaults)" : ""}`,
    next_steps: [
      "Journey stages are set. Next, define personas with brand_build_personas",
      "Or view current stages with brand_build_journey mode='view'",
    ],
    data: {
      stages_recorded: stageNames,
      stage_count: stages.length,
      used_defaults: isDefaults,
      strategy_file: ".brand/strategy.yaml",
    },
  });
}

// --- View mode ---

async function handleView(brandDir: BrandDir) {
  let clientName = "this brand";
  try {
    const config = await brandDir.readConfig();
    clientName = config.client_name;
  } catch {
    // no config available
  }

  if (!(await brandDir.hasStrategy())) {
    return buildResponse({
      what_happened: `No strategy.yaml found for "${clientName}"`,
      next_steps: [
        "Run brand_build_journey with mode='interview' to define buyer journey stages",
      ],
      data: { error: ERROR_CODES.NO_STRATEGY },
    });
  }

  const strategy = await brandDir.readStrategy();
  const stages = strategy.journey_stages ?? [];

  if (stages.length === 0) {
    return buildResponse({
      what_happened: `Strategy exists for "${clientName}" but no journey stages are defined`,
      next_steps: [
        "Run brand_build_journey with mode='interview' to define buyer journey stages",
      ],
      data: { stage_count: 0 },
    });
  }

  return buildResponse({
    what_happened: `${stages.length} buyer journey stage(s) defined for "${clientName}"`,
    next_steps: [
      "Review the stages below. To update, call brand_build_journey mode='record' with customized stages",
      "If stages look good, proceed to brand_build_personas to define target personas",
    ],
    data: {
      client_name: clientName,
      stage_count: stages.length,
      stages,
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
      data: { error: ERROR_CODES.NOT_INITIALIZED },
    });
  }

  switch (input.mode) {
    case "interview":
      return handleInterview(brandDir);
    case "record":
      return handleRecord(brandDir, input.answers);
    case "view":
      return handleView(brandDir);
  }
}

export function register(server: McpServer) {
  server.tool(
    "brand_build_journey",
    "Define the buyer journey stages a content strategy targets — the path from first touch to decision. Ships with 4 defaults that work for most B2B brands (First Touch, Context & Meaning, Validation & Proof, Decision Support), each with buyer mindset, content goal, story types, narrative elements, claims policy, and tone shift. Mode 'interview' presents the defaults as a table and prompts for customization. Mode 'record' writes the final stages to .brand/strategy.yaml — pass `answers` as a JSON array of stage objects (or a single stage to update one), or omit to accept the defaults verbatim. Mode 'view' returns the current stages. Use during Session 4 (content strategy) after personas/themes are sketched. Returns stage definitions and writes strategy.yaml in record mode. After this, run brand_build_personas.",
    paramsShape,
    { title: "Map buyer journey", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async (args) => {
      const parsed = safeParseParams(ParamsSchema, args);
      if (!parsed.success) return parsed.response;
      return handler(parsed.data);
    }
  );
}
