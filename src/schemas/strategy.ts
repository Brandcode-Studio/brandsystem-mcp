import { z } from "zod";

export const PersonaSchema = z.object({
  id: z.string(),
  name: z.string(),
  role_tag: z.string(),
  seniority: z.string(),
  company_stage: z.array(z.string()).optional(),
  decision_authority: z.string(),
  status: z.enum(["Active", "Hypothesis", "Retired"]),
  source: z.string().optional(),
  core_tension: z.string(),
  key_objections: z.array(z.string()),
  information_needs: z.object({
    first_touch: z.string(),
    context_and_meaning: z.string(),
    validation_and_proof: z.string(),
    decision_support: z.string(),
  }),
  narrative_emphasis: z.object({
    primary: z.string(),
    secondary: z.string().optional(),
    elements: z.array(z.string()).optional(),
  }),
  preferred_channels: z.array(z.string()),
});

export const JourneyStageSchema = z.object({
  id: z.string(),
  name: z.string(),
  buyer_mindset: z.string(),
  content_goal: z.string(),
  story_types: z.array(z.string()),
  narrative_elements: z.array(z.string()),
  claims_policy: z.object({
    preferred_salience: z.union([z.string(), z.array(z.string())]),
    max_per_piece: z.number().nullable(),
    min_confidence: z.number().optional(),
  }),
  tone_shift: z.string(),
});

export const MessagingVariantSchema = z.object({
  id: z.string(),
  persona: z.string(),
  journey_stage: z.string(),
  status: z.enum(["Active", "Draft", "Retired"]),
  core_message: z.string(),
  tone_shift: z.string(),
  proof_points: z.array(z.string()),
  supporting_claims: z.array(z.string()).optional(),
  source_element: z.string().optional(),
});

export const ContentThemeSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(["Active", "Planned", "Retired"]),
  quarter: z.string().optional(),
  content_intent: z.string(),
  strategic_priority: z.string(),
  narrative_route: z.string().optional(),
  target_personas: z.array(z.string()),
  key_claims: z.array(z.string()).optional(),
  success_criteria: z.string().optional(),
});

export const ContentStrategySchema = z.object({
  schema_version: z.string(),
  session: z.number(),
  personas: z.array(PersonaSchema),
  journey_stages: z.array(JourneyStageSchema),
  messaging_matrix: z.array(MessagingVariantSchema),
  themes: z.array(ContentThemeSchema),
});

export type ContentStrategyData = z.infer<typeof ContentStrategySchema>;
