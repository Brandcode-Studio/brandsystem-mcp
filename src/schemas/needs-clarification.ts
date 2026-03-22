import { z } from "zod";

export const ClarificationItemSchema = z.object({
  id: z.string(),
  field: z.string(),
  question: z.string(),
  source: z.string(),
  priority: z.enum(["high", "medium", "low"]),
});

export const NeedsClarificationSchema = z.object({
  schema_version: z.string().default("0.1.0"),
  items: z.array(ClarificationItemSchema).default([]),
});

export type NeedsClarificationData = z.infer<typeof NeedsClarificationSchema>;
