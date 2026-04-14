import { z } from "zod";

const ConfidenceEnum = z.enum(["confirmed", "high", "medium", "low"]);
const SourceEnum = z.enum(["web", "visual", "figma", "guidelines", "manual"]);

export const ColorEntrySchema = z.object({
  name: z.string(),
  value: z.string().regex(/^#[0-9a-fA-F]{3,8}$/, "Must be a valid hex color"),
  role: z.enum([
    "primary", "secondary", "accent", "neutral",
    "surface", "text", "action",
    "tint", "overlay", "border", "gradient", "highlight",
    "unknown",
  ]),
  source: SourceEnum,
  confidence: ConfidenceEnum,
  figma_variable_id: z.string().optional(),
  css_property: z.string().optional(),
});

export const TypographyEntrySchema = z.object({
  name: z.string(),
  family: z.string(),
  size: z.string().optional(),
  weight: z.number().optional(),
  line_height: z.string().optional(),
  source: SourceEnum,
  confidence: ConfidenceEnum,
  figma_style_id: z.string().optional(),
});

const LogoVariantSchema = z.object({
  name: z.string(),
  file: z.string().optional(),
  inline_svg: z.string().optional(),
  data_uri: z.string().optional(),
});

export const LogoSpecSchema = z.object({
  type: z.enum(["wordmark", "logomark"]),
  source: SourceEnum,
  confidence: ConfidenceEnum,
  variants: z.array(LogoVariantSchema),
});

export const SpacingSpecSchema = z.object({
  base_unit: z.string().optional(),
  scale: z.array(z.number()).optional(),
  source: SourceEnum,
  confidence: ConfidenceEnum,
});

export const CoreIdentitySchema = z.object({
  schema_version: z.string().default("0.1.0"),
  colors: z.array(ColorEntrySchema).default([]),
  typography: z.array(TypographyEntrySchema).default([]),
  logo: z.array(LogoSpecSchema).default([]),
  spacing: SpacingSpecSchema.nullable().default(null),
});

export type CoreIdentityData = z.infer<typeof CoreIdentitySchema>;
