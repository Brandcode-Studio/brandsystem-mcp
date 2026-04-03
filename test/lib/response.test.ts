import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { safeParseParams } from '../../src/lib/response.js';

describe('safeParseParams', () => {
  const TestSchema = z.object({
    name: z.string(),
    count: z.number().optional(),
  });

  it('returns parsed data for valid input', () => {
    const result = safeParseParams(TestSchema, { name: 'test', count: 5 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ name: 'test', count: 5 });
    }
  });

  it('returns structured error for invalid input', () => {
    const result = safeParseParams(TestSchema, { name: 123 });
    expect(result.success).toBe(false);
    if (!result.success) {
      const text = result.response.content[0].text;
      const parsed = JSON.parse(text);
      expect(parsed._metadata.what_happened).toContain('Invalid input');
      expect(parsed.error).toBe('validation_failed');
      expect(parsed.issues).toBeInstanceOf(Array);
    }
  });

  it('returns structured error for missing required fields', () => {
    const result = safeParseParams(TestSchema, {});
    expect(result.success).toBe(false);
    if (!result.success) {
      const text = result.response.content[0].text;
      expect(text).toContain('name');
    }
  });

  it('applies defaults from schema', () => {
    const SchemaWithDefault = z.object({
      mode: z.enum(['a', 'b']).default('a'),
    });
    const result = safeParseParams(SchemaWithDefault, {});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mode).toBe('a');
    }
  });
});
