import { z } from "zod";

/**
 * Advertise a tool's input as a closed object (`additionalProperties: false`).
 *
 * zod 3's JSON Schema converter emitted this for every z.object; zod 4's
 * converter omits it for default (strip) objects. `.meta()` restores the
 * advertised contract without switching parsing to strict, so unknown
 * arguments keep their existing handling (local: safeParseParams'
 * did-you-mean guidance) instead of becoming a generic SDK validation error.
 *
 * Accepts a raw zod shape; anything else (an existing schema, undefined) is
 * returned unchanged.
 */
export function strictInputSchema(shape: unknown): unknown {
  if (!shape || typeof shape !== "object" || shape instanceof z.ZodType) return shape;
  return z.object(shape as z.ZodRawShape).meta({ additionalProperties: false });
}
