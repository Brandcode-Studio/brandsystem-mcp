import { z } from "zod";

export const SourcePrioritySchema = z.enum([
  "guidelines",  // Brand guidelines PDF/document (highest authority)
  "figma",       // Figma design file
  "web",         // Live website extraction
  "visual",      // Headless browser / screenshot extraction
  "manual",      // Human-entered values
]).default("web");

export const BrandConfigSchema = z.object({
  schema_version: z.string().default("0.1.0"),
  session: z.number().default(1),
  client_name: z.string(),
  industry: z.string().optional(),
  website_url: z.string().url().optional(),
  figma_file_key: z.string().optional(),
  created_at: z.string(),
  /** Source priority for conflict resolution. When two sources disagree
   *  on a value (e.g., website says #00749a, guidelines say #00A3E0),
   *  the higher-priority source wins. Default order:
   *  guidelines > figma > visual > web > manual */
  source_priority: z.array(SourcePrioritySchema).optional(),
});

export type BrandConfigData = z.infer<typeof BrandConfigSchema>;
