import { describe, it, expect } from 'vitest';
import { compileDTCG } from '../../src/lib/dtcg-compiler.js';
import type { CoreIdentityData } from '../../src/schemas/index.js';

function makeIdentity(overrides: Partial<CoreIdentityData> = {}): CoreIdentityData {
  return {
    schema_version: '0.1.0',
    colors: [],
    typography: [],
    logo: [],
    spacing: null,
    ...overrides,
  };
}

describe('compileDTCG', () => {
  it('produces empty token groups for an empty identity', () => {
    const result = compileDTCG(makeIdentity(), 'Acme');
    expect(result.$name).toBe('Acme Design Tokens');
    const brand = result.brand as Record<string, Record<string, unknown>>;
    expect(brand.color).toEqual({});
    expect(brand.typography).toEqual({});
  });

  it('keys colors by role name when role is not "unknown"', () => {
    const result = compileDTCG(
      makeIdentity({
        colors: [
          { name: 'Brand Red', value: '#e63946', role: 'primary', source: 'web', confidence: 'high' },
        ],
      }),
      'Acme'
    );
    const brand = result.brand as Record<string, Record<string, unknown>>;
    expect(brand.color).toHaveProperty('primary');
    const token = brand.color.primary as Record<string, unknown>;
    expect(token.$value).toBe('#e63946');
    expect(token.$type).toBe('color');
  });

  it('keys colors by slugified name when role is "unknown"', () => {
    const result = compileDTCG(
      makeIdentity({
        colors: [
          { name: 'Warm Teal 400', value: '#2dd4bf', role: 'unknown', source: 'web', confidence: 'medium' },
        ],
      }),
      'Acme'
    );
    const brand = result.brand as Record<string, Record<string, unknown>>;
    expect(brand.color).toHaveProperty('warm-teal-400');
  });

  it('excludes low-confidence values', () => {
    const result = compileDTCG(
      makeIdentity({
        colors: [
          { name: 'Maybe Blue', value: '#0000ff', role: 'primary', source: 'web', confidence: 'low' },
        ],
        typography: [
          { name: 'Maybe Font', family: 'Comic Sans', source: 'web', confidence: 'low' },
        ],
      }),
      'Acme'
    );
    const brand = result.brand as Record<string, Record<string, unknown>>;
    expect(Object.keys(brand.color)).toHaveLength(0);
    expect(Object.keys(brand.typography)).toHaveLength(0);
  });

  it('produces fontFamily tokens from typography entries', () => {
    const result = compileDTCG(
      makeIdentity({
        typography: [
          { name: 'Heading', family: 'Inter', weight: 700, source: 'web', confidence: 'high' },
        ],
      }),
      'Acme'
    );
    const brand = result.brand as Record<string, Record<string, unknown>>;
    const heading = brand.typography.heading as Record<string, Record<string, unknown>>;
    expect(heading.family.$value).toBe('Inter');
    expect(heading.family.$type).toBe('fontFamily');
    expect(heading.weight.$value).toBe(700);
    expect(heading.weight.$type).toBe('fontWeight');
  });

  it('includes $extensions with brandsystem metadata', () => {
    const result = compileDTCG(
      makeIdentity({
        colors: [
          { name: 'Brand Red', value: '#e63946', role: 'primary', source: 'figma', confidence: 'confirmed', figma_variable_id: 'var:123' },
        ],
      }),
      'Acme'
    );
    const brand = result.brand as Record<string, Record<string, unknown>>;
    const token = brand.color.primary as Record<string, unknown>;
    const ext = token.$extensions as Record<string, Record<string, unknown>>;
    expect(ext['com.brandsystem'].source).toBe('figma');
    expect(ext['com.brandsystem'].confidence).toBe('confirmed');
    expect(ext['com.brandsystem'].figmaVariableId).toBe('var:123');
  });

  it('matches DTCG format ($value, $type, $extensions)', () => {
    const result = compileDTCG(
      makeIdentity({
        colors: [
          { name: 'Teal', value: '#00bcd4', role: 'accent', source: 'web', confidence: 'medium' },
        ],
      }),
      'Test'
    );
    const brand = result.brand as Record<string, Record<string, unknown>>;
    const token = brand.color.accent as Record<string, unknown>;
    expect(token).toHaveProperty('$value');
    expect(token).toHaveProperty('$type');
    expect(token).toHaveProperty('$description');
    expect(token).toHaveProperty('$extensions');
  });
});
