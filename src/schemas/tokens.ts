import { z } from "zod";

/** DTCG Design Token Community Group format */
export const DTCGTokenSchema = z.object({
  $value: z.union([z.string(), z.number()]),
  $type: z.string(),
  $description: z.string().optional(),
  $extensions: z.record(z.unknown()).optional(),
});

/** Top-level tokens.json structure */
export const TokensFileSchema = z.object({
  $name: z.string(),
  $description: z.string().optional(),
  brand: z.record(z.unknown()), // nested DTCG groups
});

export type DTCGTokenData = z.infer<typeof DTCGTokenSchema>;
export type TokensFileData = z.infer<typeof TokensFileSchema>;
