import { z } from "zod";

export const BrandConfigSchema = z.object({
  schema_version: z.string().default("0.1.0"),
  session: z.number().default(1),
  client_name: z.string(),
  industry: z.string().optional(),
  website_url: z.string().url().optional(),
  figma_file_key: z.string().optional(),
  created_at: z.string(),
});

export type BrandConfigData = z.infer<typeof BrandConfigSchema>;
