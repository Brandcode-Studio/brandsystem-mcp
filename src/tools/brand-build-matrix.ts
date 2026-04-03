import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BrandDir } from "../lib/brand-dir.js";
import { buildResponse, safeParseParams } from "../lib/response.js";
import type { ContentStrategyData } from "../schemas/index.js";
import type { MessagingData } from "../schemas/messaging.js";
import type { MessagingVariant, Persona, JourneyStage } from "../types/index.js";

// ---------------------------------------------------------------------------
// Params
// ---------------------------------------------------------------------------

const paramsShape = {
  mode: z
    .enum(["generate", "view", "edit"])
    .default("generate")
    .describe(
      "'generate' creates messaging variants for every persona × stage; 'view' returns the matrix as a grid; 'edit' updates a specific variant by ID"
    ),
  variant_id: z
    .string()
    .optional()
    .describe("ID of the variant to edit (required for mode='edit', e.g. MV-001)"),
  answers: z
    .string()
    .optional()
    .describe(
      "JSON string with variant fields to update: core_message, tone_shift, proof_points, status (for mode='edit')"
    ),
};

const ParamsSchema = z.object(paramsShape);
type Params = z.infer<typeof ParamsSchema>;

// ---------------------------------------------------------------------------
// Variant ID generator
// ---------------------------------------------------------------------------

function variantId(n: number): string {
  return `MV-${String(n).padStart(3, "0")}`;
}

// ---------------------------------------------------------------------------
// Message synthesis — the core intelligence of this tool
// ---------------------------------------------------------------------------

/**
 * Synthesize a meaningful, adapted core_message for a specific persona × stage.
 *
 * This is NOT template fill-in. The function uses:
 * - persona.core_tension to frame the message around the person's pain
 * - stage.buyer_mindset to set the cognitive angle
 * - stage.content_goal to orient the call-to-action weight
 * - persona.narrative_emphasis to weight which brand story elements surface
 * - perspective.worldview (if available) to ground the argument
 */
function synthesizeCoreMessage(
  persona: Persona,
  stage: JourneyStage,
  perspective: { worldview: string; tension: string; resolution: string; positioning: string } | null
): string {
  const personaLabel = persona.name || persona.role_tag;
  const tensionPhrase = persona.core_tension;
  const mindset = stage.buyer_mindset;
  const goal = stage.content_goal;
  const narrativeAngle = persona.narrative_emphasis.primary;

  // Build the adapted message — branch on stage.id for reliable matching
  const parts: string[] = [];

  if (stage.id === "first-touch") {
    // Provocative, tension-as-hook — earn the click, interrupt the scroll
    parts.push(
      `${personaLabel} feels this acutely: ${tensionPhrase}.`
    );
    if (perspective) {
      parts.push(
        `The angle here is ${perspective.worldview} — reframed for someone whose mindset is: ${mindset}.`
      );
    } else {
      parts.push(
        `At this stage, their mindset is: ${mindset}.`
      );
    }
    parts.push(
      `Content goal: ${goal}. Lead with ${narrativeAngle} to earn attention.`
    );
  } else if (stage.id === "context-and-meaning") {
    // Educational, framework-oriented — give them a lens, not a pitch
    parts.push(
      `${personaLabel} is past awareness and looking for a framework. Their tension: ${tensionPhrase}.`
    );
    if (perspective) {
      parts.push(
        `Introduce ${perspective.worldview} as the lens — help them see the problem differently. Their mindset: ${mindset}.`
      );
    } else {
      parts.push(
        `Help them reframe the problem. Their mindset: ${mindset}.`
      );
    }
    parts.push(
      `Content goal: ${goal}. Build depth through ${narrativeAngle} — teach, don't sell.`
    );
  } else if (stage.id === "validation-and-proof") {
    // Evidence-heavy, concrete outcomes, social proof
    parts.push(
      `For ${personaLabel}, the core tension is: ${tensionPhrase}.`
    );
    if (perspective) {
      parts.push(
        `At this stage they need proof that ${perspective.resolution}. Their mindset: ${mindset}.`
      );
    } else {
      parts.push(
        `At this stage they need proof. Their mindset: ${mindset}.`
      );
    }
    parts.push(
      `Content goal: ${goal}. Emphasize ${narrativeAngle} with evidence.`
    );
  } else if (stage.id === "decision-support") {
    // Direct, action-oriented — remove friction, arm the champion
    parts.push(
      `${personaLabel} is ready to decide. Their original tension — ${tensionPhrase} — needs a resolution they can defend to stakeholders.`
    );
    if (perspective) {
      parts.push(
        `Position: ${perspective.positioning}. Their mindset: ${mindset}.`
      );
    } else {
      parts.push(
        `Their mindset: ${mindset}.`
      );
    }
    parts.push(
      `Content goal: ${goal}. Use ${narrativeAngle} to close the loop.`
    );
  } else {
    // Generic fallback for custom stages
    parts.push(
      `For ${personaLabel} (${persona.seniority}), the driving tension is: ${tensionPhrase}.`
    );
    if (perspective) {
      parts.push(
        `Ground the message in: ${perspective.worldview}. Their mindset at this stage: ${mindset}.`
      );
    } else {
      parts.push(
        `Their mindset at this stage: ${mindset}.`
      );
    }
    parts.push(
      `Content goal: ${goal}. Narrative emphasis: ${narrativeAngle}.`
    );
  }

  return parts.join(" ");
}

/**
 * Derive tone_shift for a variant from stage + persona context.
 */
function deriveToneShift(persona: Persona, stage: JourneyStage): string {
  const baseTone = stage.tone_shift;
  const seniority = persona.seniority;

  // Modulate tone based on seniority
  if (seniority === "C-Suite" || seniority === "VP") {
    return `${baseTone} — calibrated for executive audience: concise, strategic, ROI-forward`;
  }
  if (seniority === "Director" || seniority === "Manager") {
    return `${baseTone} — calibrated for operational leadership: practical, outcome-oriented`;
  }
  if (seniority === "IC") {
    return `${baseTone} — calibrated for practitioner audience: specific, technique-oriented`;
  }
  return baseTone;
}

/**
 * Extract proof_points guidance from claims_policy.
 */
function deriveProofPoints(stage: JourneyStage): string[] {
  const points: string[] = [];
  const policy = stage.claims_policy;

  if (policy.preferred_salience) {
    const salience = Array.isArray(policy.preferred_salience)
      ? policy.preferred_salience.join(", ")
      : policy.preferred_salience;
    points.push(`Preferred claim salience: ${salience}`);
  }
  if (policy.max_per_piece !== null && policy.max_per_piece !== undefined) {
    points.push(`Max claims per piece: ${policy.max_per_piece}`);
  }
  if (policy.min_confidence !== undefined) {
    points.push(`Min confidence threshold: ${policy.min_confidence}`);
  }
  if (points.length === 0) {
    points.push("Follow stage-appropriate proof density");
  }
  return points;
}

// ---------------------------------------------------------------------------
// Generate mode
// ---------------------------------------------------------------------------

async function handleGenerate(brandDir: BrandDir) {
  // Read strategy.yaml — required
  let strategy: ContentStrategyData;
  try {
    strategy = await brandDir.readStrategy();
  } catch {
    return buildResponse({
      what_happened: "No strategy.yaml found",
      next_steps: [
        "Run brand_build_strategy first to create personas and journey stages",
        "The messaging matrix requires both personas and journey_stages to exist",
      ],
      data: { error: "no_strategy" },
    });
  }

  // Validate required data
  if (!strategy.personas || strategy.personas.length === 0) {
    return buildResponse({
      what_happened: "strategy.yaml has no personas",
      next_steps: [
        "Run brand_build_strategy to define personas first",
        "The messaging matrix generates one variant per persona × journey stage",
      ],
      data: { error: "no_personas" },
    });
  }

  if (!strategy.journey_stages || strategy.journey_stages.length === 0) {
    return buildResponse({
      what_happened: "strategy.yaml has no journey_stages",
      next_steps: [
        "Run brand_build_strategy to define journey stages first",
        "The messaging matrix generates one variant per persona × journey stage",
      ],
      data: { error: "no_journey_stages" },
    });
  }

  // Read messaging.yaml — optional (degrades gracefully)
  let perspective: { worldview: string; tension: string; resolution: string; positioning: string } | null = null;
  let voiceContext: string | null = null;
  if (await brandDir.hasMessaging()) {
    try {
      const messaging: MessagingData = await brandDir.readMessaging();
      if (messaging.perspective) {
        perspective = {
          worldview: messaging.perspective.worldview,
          tension: messaging.perspective.tension,
          resolution: messaging.perspective.resolution,
          positioning: messaging.perspective.positioning,
        };
      }
      if (messaging.voice) {
        voiceContext = messaging.voice.tone.descriptors.join(", ");
      }
    } catch {
      // Degrade gracefully — messages will still be persona/stage adapted
    }
  }

  // Generate variants
  const personas = strategy.personas.filter((p) => p.status === "Active" || p.status === "Hypothesis");
  const stages = strategy.journey_stages;
  const variants: MessagingVariant[] = [];
  let counter = 1;

  for (const persona of personas) {
    for (const stage of stages) {
      const id = variantId(counter++);
      const core_message = synthesizeCoreMessage(persona, stage, perspective);
      const tone_shift = deriveToneShift(persona, stage);
      const proof_points = deriveProofPoints(stage);
      const source_element = perspective
        ? `perspective.worldview: "${perspective.worldview}"`
        : "No perspective available — message derived from persona + stage only";

      variants.push({
        id,
        persona: persona.id,
        journey_stage: stage.id,
        status: "Draft",
        core_message,
        tone_shift,
        proof_points,
        source_element,
      });
    }
  }

  // Write to strategy.yaml
  strategy.messaging_matrix = variants;
  await brandDir.writeStrategy(strategy);

  // Build summary grid for the response
  const grid: Record<string, Record<string, string>> = {};
  for (const v of variants) {
    if (!grid[v.journey_stage]) grid[v.journey_stage] = {};
    grid[v.journey_stage][v.persona] = v.id;
  }

  const personaCount = personas.length;
  const stageCount = stages.length;
  const variantCount = variants.length;

  const warnings: string[] = [];
  if (!perspective) {
    warnings.push(
      "No messaging.yaml perspective found — messages are adapted by persona + stage but not grounded in brand worldview. Complete Session 3 (brand_compile_messaging) for deeper message coherence."
    );
  }

  return buildResponse({
    what_happened: `Generated ${variantCount} messaging variants (${personaCount} personas × ${stageCount} stages) and saved to strategy.yaml messaging_matrix`,
    next_steps: [
      `I've generated ${variantCount} message variants — one for each persona at each journey stage. These are drafts. Want to review and refine any of them?`,
      "Use mode='view' to see the full matrix as a grid",
      "Use mode='edit' with a variant_id to refine individual messages",
      "Change variant status from 'Draft' to 'Active' when approved",
    ],
    data: {
      personas_used: personas.map((p) => ({ id: p.id, name: p.name })),
      stages_used: stages.map((s) => ({ id: s.id, name: s.name })),
      variants_generated: variantCount,
      matrix_grid: grid,
      voice_grounded: !!perspective,
      ...(warnings.length > 0 ? { warnings } : {}),
      conversation_guide: `Present the generated matrix as a grid. Say: 'I've generated ${variantCount} message variants — one for each persona at each journey stage. These are drafts. Want to review and refine any of them?' If they say yes, show variants one at a time and let them edit.`,
    },
  });
}

// ---------------------------------------------------------------------------
// View mode
// ---------------------------------------------------------------------------

async function handleView(brandDir: BrandDir) {
  let strategy: ContentStrategyData;
  try {
    strategy = await brandDir.readStrategy();
  } catch {
    return buildResponse({
      what_happened: "No strategy.yaml found",
      next_steps: ["Run brand_build_matrix mode='generate' to create the matrix first"],
      data: { error: "no_strategy" },
    });
  }

  if (!strategy.messaging_matrix || strategy.messaging_matrix.length === 0) {
    return buildResponse({
      what_happened: "Messaging matrix is empty",
      next_steps: ["Run brand_build_matrix mode='generate' to populate it"],
      data: { error: "empty_matrix" },
    });
  }

  // Build lookups for display names
  const personaNames: Record<string, string> = {};
  for (const p of strategy.personas) {
    personaNames[p.id] = p.name;
  }
  const stageNames: Record<string, string> = {};
  for (const s of strategy.journey_stages) {
    stageNames[s.id] = s.name;
  }

  // Organize into a grid: stages (rows) × personas (columns)
  const stageIds = strategy.journey_stages.map((s) => s.id);
  const personaIds = strategy.personas.map((p) => p.id);

  // Build variant lookup
  const variantLookup: Record<string, MessagingVariant> = {};
  for (const v of strategy.messaging_matrix) {
    const key = `${v.journey_stage}::${v.persona}`;
    variantLookup[key] = v;
  }

  // Build grid data
  const gridRows: Array<Record<string, unknown>> = [];
  for (const stageId of stageIds) {
    const row: Record<string, unknown> = {
      stage: stageNames[stageId] || stageId,
      stage_id: stageId,
    };
    const cells: Record<string, unknown> = {};
    for (const personaId of personaIds) {
      const key = `${stageId}::${personaId}`;
      const v = variantLookup[key];
      if (v) {
        cells[personaNames[personaId] || personaId] = {
          id: v.id,
          status: v.status,
          core_message_preview: v.core_message.length > 120
            ? v.core_message.substring(0, 120) + "..."
            : v.core_message,
          tone_shift: v.tone_shift,
        };
      } else {
        cells[personaNames[personaId] || personaId] = null;
      }
    }
    row.personas = cells;
    gridRows.push(row);
  }

  // Status summary
  const statusCounts: Record<string, number> = { Draft: 0, Active: 0, Retired: 0 };
  for (const v of strategy.messaging_matrix) {
    statusCounts[v.status] = (statusCounts[v.status] || 0) + 1;
  }

  return buildResponse({
    what_happened: `Messaging matrix: ${strategy.messaging_matrix.length} variants across ${stageIds.length} stages × ${personaIds.length} personas`,
    next_steps: [
      "Review each cell — variants in Draft status need approval",
      "Use mode='edit' with variant_id to refine a specific message",
      "Change status to 'Active' when a variant is approved",
    ],
    data: {
      total_variants: strategy.messaging_matrix.length,
      status_summary: statusCounts,
      persona_columns: personaIds.map((id) => ({ id, name: personaNames[id] || id })),
      stage_rows: stageIds.map((id) => ({ id, name: stageNames[id] || id })),
      grid: gridRows,
    },
  });
}

// ---------------------------------------------------------------------------
// Edit mode
// ---------------------------------------------------------------------------

async function handleEdit(brandDir: BrandDir, variantId: string, answersRaw: string) {
  let answers: Record<string, unknown>;
  try {
    answers = JSON.parse(answersRaw);
  } catch {
    return buildResponse({
      what_happened: "Failed to parse answers — invalid JSON",
      next_steps: ["Provide answers as a valid JSON string with keys: core_message, tone_shift, proof_points, status"],
      data: { error: "invalid_json" },
    });
  }

  let strategy: ContentStrategyData;
  try {
    strategy = await brandDir.readStrategy();
  } catch {
    return buildResponse({
      what_happened: "No strategy.yaml found",
      next_steps: ["Run brand_build_matrix mode='generate' first"],
      data: { error: "no_strategy" },
    });
  }

  // Find the variant
  const idx = strategy.messaging_matrix.findIndex((v) => v.id === variantId);
  if (idx === -1) {
    const availableIds = strategy.messaging_matrix.map((v) => v.id);
    return buildResponse({
      what_happened: `Variant "${variantId}" not found in messaging_matrix`,
      next_steps: [
        "Check the variant ID and try again",
        `Available IDs: ${availableIds.join(", ")}`,
      ],
      data: { error: "variant_not_found", available_ids: availableIds },
    });
  }

  const variant = strategy.messaging_matrix[idx];
  const changes: string[] = [];

  // Apply updates
  if (answers.core_message !== undefined) {
    variant.core_message = String(answers.core_message);
    changes.push("Updated core_message");
  }
  if (answers.tone_shift !== undefined) {
    variant.tone_shift = String(answers.tone_shift);
    changes.push("Updated tone_shift");
  }
  if (answers.proof_points !== undefined) {
    if (Array.isArray(answers.proof_points)) {
      variant.proof_points = answers.proof_points.map((p) => String(p));
    } else if (typeof answers.proof_points === "string") {
      variant.proof_points = answers.proof_points
        .split(/[;\n]+/)
        .map((s: string) => s.trim())
        .filter((s: string) => s.length > 0);
    }
    changes.push("Updated proof_points");
  }
  if (answers.supporting_claims !== undefined) {
    if (Array.isArray(answers.supporting_claims)) {
      variant.supporting_claims = answers.supporting_claims.map((c) => String(c));
    }
    changes.push("Updated supporting_claims");
  }
  if (answers.status !== undefined) {
    const newStatus = String(answers.status);
    if (newStatus === "Active" || newStatus === "Draft" || newStatus === "Retired") {
      const oldStatus = variant.status;
      variant.status = newStatus;
      changes.push(`Status changed: ${oldStatus} → ${newStatus}`);
    }
  }

  if (changes.length === 0) {
    return buildResponse({
      what_happened: `No recognized fields to update for ${variantId}`,
      next_steps: [
        "Provide at least one of: core_message, tone_shift, proof_points, supporting_claims, status",
      ],
      data: { error: "no_changes", variant_id: variantId },
    });
  }

  // Write back
  strategy.messaging_matrix[idx] = variant;
  await brandDir.writeStrategy(strategy);

  // Get persona/stage names for context
  const personaName = strategy.personas.find((p) => p.id === variant.persona)?.name || variant.persona;
  const stageName = strategy.journey_stages.find((s) => s.id === variant.journey_stage)?.name || variant.journey_stage;

  return buildResponse({
    what_happened: `Updated variant ${variantId} (${personaName} × ${stageName})`,
    next_steps: [
      "Use mode='view' to see the updated matrix",
      variant.status === "Active"
        ? "This variant is now Active — it will be used in content generation"
        : "Set status to 'Active' when you're satisfied with this variant",
    ],
    data: {
      variant_id: variantId,
      persona: variant.persona,
      persona_name: personaName,
      journey_stage: variant.journey_stage,
      stage_name: stageName,
      changes,
      current_state: {
        status: variant.status,
        core_message: variant.core_message,
        tone_shift: variant.tone_shift,
        proof_points: variant.proof_points,
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

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
    case "generate":
      return handleGenerate(brandDir);

    case "view":
      return handleView(brandDir);

    case "edit": {
      if (!input.variant_id) {
        return buildResponse({
          what_happened: "Missing required parameter: variant_id",
          next_steps: ["Provide variant_id (e.g. MV-001) to identify which variant to edit"],
          data: { error: "missing_variant_id" },
        });
      }
      if (!input.answers) {
        return buildResponse({
          what_happened: "Missing required parameter: answers",
          next_steps: [
            "Provide answers as a JSON string with fields to update: core_message, tone_shift, proof_points, status",
          ],
          data: { error: "missing_answers" },
        });
      }
      return handleEdit(brandDir, input.variant_id, input.answers);
    }
  }
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function register(server: McpServer) {
  server.tool(
    "brand_build_matrix",
    "Generate persona x journey stage messaging variants — adapted core messages for every audience at every buying stage. Mode 'generate' creates variants using persona tensions, stage mindsets, and brand perspective. Mode 'view' shows the matrix as a grid. Mode 'edit' refines a specific variant by ID. Requires personas and journey stages in strategy.yaml. Returns variant grid with status tracking (Draft/Active/Retired).",
    paramsShape,
    async (args) => {
      const parsed = safeParseParams(ParamsSchema, args);
      if (!parsed.success) return parsed.response;
      return handler(parsed.data);
    }
  );
}
