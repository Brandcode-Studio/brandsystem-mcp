import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BrandDir } from "../lib/brand-dir.js";
import { buildResponse, safeParseParams } from "../lib/response.js";
import { SCHEMA_VERSION } from "../schemas/index.js";
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

  return buildResponse({
    what_happened: existingStages.length > 0
      ? `Found ${existingStages.length} existing journey stage(s) for "${clientName}". Presenting defaults for review.`
      : `No journey stages defined yet for "${clientName}". Presenting the 4 default buyer journey stages.`,
    next_steps: [
      "Present the default stages table and ask the user to customize or accept them",
      "After the user responds, call brand_build_journey with mode='record' and the final stages as answers",
    ],
    data: {
      client_name: clientName,
      existing_stages: existingStages.length > 0 ? existingStages : null,
      default_stages: stageTable,
      defaults_full: defaults,
      conversation_guide: {
        instruction: [
          `Present the 4 default buyer journey stages as a table for "${clientName}":`,
          "",
          "| Stage | Buyer Mindset | Content Goal | Tone Shift |",
          "|-------|--------------|--------------|------------|",
          ...defaults.map(
            (s) =>
              `| **${s.name}** | ${s.buyer_mindset} | ${s.content_goal} | ${s.tone_shift} |`
          ),
          "",
          "Say: 'These are the standard buyer journey stages. They work for most B2B brands. Want to customize any of them, or do these work as-is?'",
          "",
          "If the user says they're fine, call brand_build_journey with mode='record' and no answers (writes defaults).",
          "If they want to customize, walk through each stage they want to change. Gather their edits, then call brand_build_journey with mode='record' and the customized stages as the answers parameter.",
          "",
          "Each stage has these fields that can be customized:",
          "  - name: display name",
          "  - buyer_mindset: the question in the buyer's head",
          "  - content_goal: what content should accomplish",
          "  - story_types: which story archetypes fit (Brand Narrative, Product/Service Story, Customer/Social Proof)",
          "  - narrative_elements: which narrative elements to emphasize (Problem, Hero, Guide, Journey, Victory, Proof Point)",
          "  - claims_policy: how claims are deployed (preferred_salience, max_per_piece, min_confidence)",
          "  - tone_shift: how tone adjusts at this stage",
        ].join("\n"),
      },
    },
  });
}

// --- Record mode ---

async function handleRecord(brandDir: BrandDir, answersRaw?: string) {
  // Parse answers if provided
  let stages: JourneyStage[];

  if (!answersRaw) {
    // No answers = write defaults
    stages = getDefaultStages();
  } else {
    let parsed: unknown;
    try {
      parsed = JSON.parse(answersRaw);
    } catch {
      return buildResponse({
        what_happened: "Failed to parse answers -- invalid JSON",
        next_steps: ["Provide answers as a valid JSON string (array of stage objects or a single stage object)"],
        data: { error: "invalid_json", raw: answersRaw },
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
        data: { error: "invalid_format" },
      });
    }
  }

  // Read or create strategy.yaml, merging journey_stages without overwriting other fields
  let strategy: ContentStrategy;
  if (await brandDir.hasStrategy()) {
    strategy = await brandDir.readStrategy();
    strategy.journey_stages = stages;
  } else {
    strategy = {
      schema_version: SCHEMA_VERSION,
      session: 4,
      personas: [],
      journey_stages: stages,
      messaging_matrix: [],
      themes: [],
    };
  }

  await brandDir.writeStrategy(strategy);

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
      data: { error: "no_strategy" },
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
      data: { error: "not_initialized" },
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
    "Define buyer journey stages for content strategy — the path from awareness to purchase. Ships with 4 proven defaults (First Touch, Context & Meaning, Validation & Proof, Decision Support) that can be customized per brand. Mode 'interview' presents defaults for review. Mode 'record' writes stages (omit answers to accept defaults). Mode 'view' shows current stages. Part of Session 4 (content strategy). Returns stage definitions with buyer mindset, content goals, and tone shifts.",
    paramsShape,
    async (args) => {
      const parsed = safeParseParams(ParamsSchema, args);
      if (!parsed.success) return parsed.response;
      return handler(parsed.data);
    }
  );
}
