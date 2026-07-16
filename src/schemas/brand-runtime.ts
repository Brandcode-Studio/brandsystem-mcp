import { z } from "zod";

const RuntimeIdentitySchema = z.object({
  colors: z.record(z.string()),
  typography: z.record(z.string()),
  logo: z.object({
    type: z.string(),
    has_svg: z.boolean(),
  }).nullable(),
});

const RuntimeVisualSchema = z.object({
  composition: z.object({
    energy: z.string(),
    grid: z.string(),
    layout: z.string(),
  }).nullable(),
  signature: z.object({
    description: z.string(),
    elements: z.array(z.string()),
  }).nullable(),
  anti_patterns: z.array(z.string()),
});

const RuntimeVoiceSchema = z.object({
  tone_descriptors: z.array(z.string()),
  register: z.string(),
  never_sounds_like: z.string(),
  anchor_terms: z.record(z.string()),
  never_say: z.array(z.string()),
  jargon_policy: z.string(),
  ai_ism_patterns: z.array(z.string()),
  conventions: z.object({
    person: z.string(),
    reader_address: z.string(),
    oxford_comma: z.boolean(),
    sentence_length: z.number(),
  }),
});

const RuntimeStrategySchema = z.object({
  persona_count: z.number(),
  persona_names: z.array(z.string()),
  journey_stages: z.array(z.string()),
  theme_count: z.number(),
  matrix_size: z.number(),
});

export const BrandRuntimeSchema = z.object({
  version: z.string(),
  client_name: z.string(),
  compiled_at: z.string(),
  sessions_completed: z.number(),
  // Optional for runtimes compiled before 0.9.6; every new compile emits them.
  approval: z
    .enum(["provisional_extracted", "human_confirmed_local", "production_approved"])
    .optional(),
  provenance: z
    .object({
      sources: z.array(z.string()),
      note: z.string(),
    })
    .optional(),
  identity: RuntimeIdentitySchema,
  visual: RuntimeVisualSchema.nullable(),
  voice: RuntimeVoiceSchema.nullable(),
  strategy: RuntimeStrategySchema.nullable(),
});

export type BrandRuntimeData = z.infer<typeof BrandRuntimeSchema>;
