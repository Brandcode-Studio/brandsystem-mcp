/**
 * Issue #93 — same-theme color collapse, fixed with role variants.
 *
 * When two legitimate same-role colors share a theme, the base (role, theme)
 * slot keeps its pre-#93 winner and the runner-up is promoted to the role's
 * single variant slot (surface-alt, text-secondary, ...) if it clears the
 * evidence threshold. These tests pin promotion, the noise guards, the
 * one-variant cap, theme independence, and the compiled output shapes.
 */
import { describe, it, expect } from 'vitest';
import {
  mergeColor,
  mergeColorWithPriority,
  VARIANT_MIN_CONFIDENCE,
  VARIANT_MIN_DELTA_E,
} from '../../src/lib/confidence.js';
import {
  COLOR_ROLES,
  COLOR_ROLE_VARIANTS,
  baseRoleOf,
  colorDeltaE,
  isVariantRole,
  variantRoleFor,
} from '../../src/lib/color-roles.js';
import { compileDTCG } from '../../src/lib/dtcg-compiler.js';
import { compileRuntime } from '../../src/lib/runtime-compiler.js';
import { buildDesignSynthesis } from '../../src/lib/design-synthesis.js';
import { ColorEntrySchema, CoreIdentitySchema } from '../../src/schemas/index.js';
import { BrandRuntimeSchema as RuntimeSchema } from '../../src/schemas/brand-runtime.js';
import type { ColorEntry } from '../../src/types/index.js';
import type { BrandConfigData, CoreIdentityData } from '../../src/schemas/index.js';

function color(overrides: Partial<ColorEntry> = {}): ColorEntry {
  return {
    name: 'Test Color',
    value: '#123456',
    role: 'surface',
    source: 'web',
    confidence: 'high',
    ...overrides,
  };
}

function mergeAll(entries: ColorEntry[]): ColorEntry[] {
  return entries.reduce<ColorEntry[]>((acc, e) => mergeColor(acc, e), []);
}

function identity(colors: ColorEntry[]): CoreIdentityData {
  return { schema_version: '0.1.0', colors, typography: [], logo: [], spacing: null };
}

describe('color-role vocabulary', () => {
  it('maps each variant-eligible base role to exactly one variant and back', () => {
    for (const [base, variant] of Object.entries(COLOR_ROLE_VARIANTS)) {
      expect(variantRoleFor(base as ColorEntry['role'])).toBe(variant);
      expect(isVariantRole(variant)).toBe(true);
      expect(baseRoleOf(variant)).toBe(base);
      expect(COLOR_ROLES).toContain(variant);
    }
  });

  it('gives primary, secondary, tint and unknown no variant', () => {
    for (const role of ['primary', 'secondary', 'tint', 'unknown'] as const) {
      expect(variantRoleFor(role)).toBeNull();
    }
  });

  it('core-identity schema accepts variant roles', () => {
    expect(ColorEntrySchema.safeParse(color({ role: 'surface-alt' })).success).toBe(true);
    expect(ColorEntrySchema.safeParse(color({ role: 'text-secondary' })).success).toBe(true);
    expect(ColorEntrySchema.safeParse({ ...color(), role: 'surface-muted' }).success).toBe(false);
  });

  it('measures perceptual distance (ΔE) sanely', () => {
    expect(colorDeltaE('#ffffff', '#ffffff')).toBe(0);
    expect(colorDeltaE('#ffffff', '#fefefe')).toBeLessThan(VARIANT_MIN_DELTA_E);
    expect(colorDeltaE('#ffffff', '#f4f4f4')).toBeGreaterThanOrEqual(VARIANT_MIN_DELTA_E);
    expect(colorDeltaE('#fff', '#ffffff')).toBe(0);
    expect(colorDeltaE('not-a-color', '#ffffff')).toBe(Infinity);
  });
});

describe('mergeColor — variant promotion (issue #93)', () => {
  it('promotes a second same-role, same-theme color to the variant role', () => {
    const merged = mergeAll([
      color({ name: 'surface muted', value: '#f4f4f4', role: 'surface' }),
      color({ name: 'body bg', value: '#ffffff', role: 'surface' }),
    ]);

    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({ value: '#f4f4f4', role: 'surface' });
    expect(merged[1]).toMatchObject({ value: '#ffffff', role: 'surface-alt', confidence: 'high', source: 'web' });
  });

  it('keeps base-slot selection unchanged: the higher-confidence color still takes the base role', () => {
    const merged = mergeAll([
      color({ value: '#222222', role: 'text', confidence: 'medium' }),
      color({ value: '#ffffff', role: 'text', confidence: 'high' }),
    ]);

    // Pre-#93 the base slot went to #ffffff and #222222 vanished; now it
    // survives as the variant instead.
    expect(merged.find((c) => c.role === 'text')?.value).toBe('#ffffff');
    expect(merged.find((c) => c.role === 'text-secondary')?.value).toBe('#222222');
  });

  it('works for each variant-eligible base role', () => {
    for (const [base, variant] of Object.entries(COLOR_ROLE_VARIANTS)) {
      const merged = mergeAll([
        color({ value: '#336699', role: base as ColorEntry['role'] }),
        color({ value: '#993366', role: base as ColorEntry['role'] }),
      ]);
      expect(merged.map((c) => c.role)).toEqual([base, variant]);
    }
  });

  it('does not create variants for primary (primary ambiguity goes to clarification)', () => {
    const merged = mergeAll([
      color({ value: '#0f62fe', role: 'primary' }),
      color({ value: '#d90429', role: 'primary' }),
    ]);
    expect(merged).toHaveLength(1);
  });

  it('is idempotent when the same extraction is merged again', () => {
    const run = [
      color({ value: '#f4f4f4', role: 'surface' }),
      color({ value: '#ffffff', role: 'surface' }),
    ];
    const once = mergeAll(run);
    const twice = run.reduce((acc, e) => mergeColor(acc, e), once);
    expect(twice).toEqual(once);
  });
});

describe('mergeColor — evidence threshold blocks noise (issue #93)', () => {
  it(`requires at least ${VARIANT_MIN_CONFIDENCE} confidence: a low-confidence runner-up is dropped`, () => {
    const merged = mergeAll([
      color({ value: '#212529', role: 'text', confidence: 'medium' }),
      color({ value: '#1d3557', role: 'text', confidence: 'low' }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].value).toBe('#212529');
  });

  it('rejects near-duplicates below the ΔE floor', () => {
    const merged = mergeAll([
      color({ value: '#ffffff', role: 'surface' }),
      color({ value: '#fefefe', role: 'surface' }),
    ]);
    expect(merged).toHaveLength(1);
  });

  it('rejects a value already present in the same theme under another role', () => {
    const merged = mergeAll([
      color({ value: '#ffffff', role: 'text' }),
      color({ value: '#fdf6ec', role: 'surface' }),
      color({ value: '#ffffff', role: 'surface' }),
    ]);
    expect(merged.map((c) => c.role)).toEqual(['text', 'surface']);
  });

  it('a lower-precedence source never adds a variant to an authoritative palette', () => {
    const merged = mergeAll([
      color({ value: '#fafafa', role: 'surface', source: 'figma' }),
      color({ value: '#ffffff', role: 'surface', source: 'web' }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].source).toBe('figma');
  });

  it('a displaced lower-precedence incumbent is not demoted to a variant either', () => {
    const merged = mergeAll([
      color({ value: '#ffffff', role: 'surface', source: 'web' }),
      color({ value: '#fafafa', role: 'surface', source: 'guidelines' }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ value: '#fafafa', source: 'guidelines', role: 'surface' });
  });

  it('a displaced same-tier incumbent with enough evidence survives as the variant', () => {
    const merged = mergeAll([
      color({ value: '#222222', role: 'text', confidence: 'medium' }),
      color({ value: '#ffffff', role: 'text', confidence: 'high' }),
    ]);
    expect(merged).toEqual([
      expect.objectContaining({ value: '#ffffff', role: 'text' }),
      expect.objectContaining({ value: '#222222', role: 'text-secondary' }),
    ]);
  });
});

describe('mergeColor — one variant per base role (issue #93)', () => {
  it('caps at one variant: a third same-role color does not create another slot', () => {
    const merged = mergeAll([
      color({ value: '#ffffff', role: 'surface', confidence: 'high' }),
      color({ value: '#f4f4f4', role: 'surface', confidence: 'medium' }),
      color({ value: '#e0e0e0', role: 'surface', confidence: 'medium' }),
    ]);
    expect(merged).toHaveLength(2);
    expect(merged.filter((c) => c.role === 'surface-alt')).toHaveLength(1);
    expect(merged.find((c) => c.role === 'surface-alt')?.value).toBe('#f4f4f4');
  });

  it('a stronger third color takes the variant slot by the usual confidence rule', () => {
    const merged = mergeAll([
      color({ value: '#ffffff', role: 'surface', confidence: 'high' }),
      color({ value: '#f4f4f4', role: 'surface', confidence: 'medium' }),
      color({ value: '#e0e0e0', role: 'surface', confidence: 'high' }),
    ]);
    expect(merged).toHaveLength(2);
    expect(merged.find((c) => c.role === 'surface')?.value).toBe('#ffffff');
    expect(merged.find((c) => c.role === 'surface-alt')?.value).toBe('#e0e0e0');
  });
});

describe('mergeColor — dark-theme variants are independent of light (issue #93)', () => {
  it('fills light and dark variant slots separately', () => {
    const merged = mergeAll([
      color({ value: '#ffffff', role: 'surface' }),
      color({ value: '#f4f4f4', role: 'surface' }),
      color({ value: '#0f0f1a', role: 'surface', theme: 'dark' }),
      color({ value: '#1c1c2e', role: 'surface', theme: 'dark' }),
    ]);
    expect(merged).toHaveLength(4);
    expect(merged.filter((c) => c.role === 'surface-alt').map((c) => [c.value, c.theme])).toEqual([
      ['#f4f4f4', undefined],
      ['#1c1c2e', 'dark'],
    ]);
  });

  it('a dark variant does not consume the light variant slot (or vice versa)', () => {
    const merged = mergeAll([
      color({ value: '#0f0f1a', role: 'surface', theme: 'dark' }),
      color({ value: '#1c1c2e', role: 'surface', theme: 'dark' }),
      color({ value: '#ffffff', role: 'surface' }),
      color({ value: '#f4f4f4', role: 'surface' }),
    ]);
    const light = merged.filter((c) => c.theme !== 'dark').map((c) => c.role);
    const dark = merged.filter((c) => c.theme === 'dark').map((c) => c.role);
    expect(light).toEqual(['surface', 'surface-alt']);
    expect(dark).toEqual(['surface', 'surface-alt']);
  });

  it('allows the same hex as a variant in a different theme', () => {
    const merged = mergeAll([
      color({ value: '#ffffff', role: 'text', theme: 'dark' }),
      color({ value: '#111111', role: 'text' }),
      color({ value: '#ffffff', role: 'text' }),
    ]);
    // #ffffff is already the dark text, but the duplicate-value guard is
    // per theme, so it can still be the light-theme text variant.
    expect(merged).toHaveLength(3);
    expect(merged[2]).toMatchObject({ value: '#ffffff', role: 'text-secondary' });
    expect(merged[2].theme).toBeUndefined();
  });
});

describe('mergeColorWithPriority — variants follow the priority list', () => {
  it('promotes a same-tier runner-up to the variant role', () => {
    const merged = [
      color({ value: '#ffffff', role: 'surface', source: 'visual' }),
      color({ value: '#f4f4f4', role: 'surface', source: 'visual', confidence: 'medium' }),
    ].reduce<ColorEntry[]>((acc, e) => mergeColorWithPriority(acc, e), []);
    expect(merged.map((c) => c.role)).toEqual(['surface', 'surface-alt']);
  });

  it('blocks variants from a lower-priority source', () => {
    const merged = [
      color({ value: '#ffffff', role: 'surface', source: 'guidelines' }),
      color({ value: '#f4f4f4', role: 'surface', source: 'visual' }),
    ].reduce<ColorEntry[]>((acc, e) => mergeColorWithPriority(acc, e), []);
    expect(merged).toHaveLength(1);
  });
});

describe('compiled output shape for variant roles (issue #93)', () => {
  const colors: ColorEntry[] = mergeAll([
    color({ name: 'Paper', value: '#ffffff', role: 'surface' }),
    color({ name: 'Panel', value: '#f4f4f4', role: 'surface' }),
    color({ name: 'Ink', value: '#161616', role: 'text' }),
    color({ name: 'Ink Soft', value: '#525252', role: 'text', confidence: 'medium' }),
    color({ name: 'Midnight', value: '#0f0f1a', role: 'surface', theme: 'dark' }),
    color({ name: 'Midnight Raised', value: '#1c1c2e', role: 'surface', theme: 'dark' }),
  ]);

  it('round-trips through the core-identity schema', () => {
    expect(CoreIdentitySchema.safeParse(identity(colors)).success).toBe(true);
  });

  it('DTCG: variants compile to flat sibling tokens with a variantOf extension', () => {
    const tokens = compileDTCG(identity(colors), 'Acme') as {
      brand: { color: Record<string, Record<string, unknown>> };
    };
    const group = tokens.brand.color;

    expect(Object.keys(group)).toEqual(['surface', 'surface-alt', 'text', 'text-secondary', 'dark']);
    expect(group.surface).toMatchObject({ $value: '#ffffff', $type: 'color' });
    expect(group['surface-alt']).toMatchObject({
      $value: '#f4f4f4',
      $type: 'color',
      $extensions: { 'com.brandsystem': { source: 'web', confidence: 'high', variantOf: 'surface' } },
    });
    expect(group['text-secondary']).toMatchObject({
      $value: '#525252',
      $extensions: { 'com.brandsystem': { variantOf: 'text', confidence: 'medium' } },
    });
    // Base tokens stay plain tokens (no nested group, no variantOf).
    expect(group.surface).not.toHaveProperty('alt');
    expect((group.surface.$extensions as Record<string, Record<string, unknown>>)['com.brandsystem']).not.toHaveProperty('variantOf');

    const dark = group.dark as Record<string, Record<string, unknown>>;
    expect(Object.keys(dark)).toEqual(['surface', 'surface-alt']);
    expect(dark['surface-alt']).toMatchObject({
      $value: '#1c1c2e',
      $extensions: { 'com.brandsystem': { theme: 'dark', variantOf: 'surface' } },
    });
  });

  it('design-synthesis: variants group and sort with their base role', () => {
    const config: BrandConfigData = {
      schema_version: '0.1.0',
      session: 1,
      client_name: 'Acme',
      created_at: '2026-01-01T00:00:00.000Z',
    };
    const synthesis = buildDesignSynthesis(
      config,
      identity([color({ value: '#ff7f11', role: 'accent' }), color({ value: '#ffb000', role: 'accent' })]
        .reduce((acc, e) => mergeColor(acc, e), colors)),
      { source: 'current-brand' },
    );
    expect(synthesis.colors.semantic.map((c) => c.role)).toEqual(['surface', 'surface-alt', 'text', 'text-secondary']);
    expect(synthesis.colors.brand.map((c) => c.role)).toEqual(['accent', 'accent-alt']);
    expect(synthesis.colors.additional).toEqual([]);
  });

  it('brand-runtime.json: variants appear as keys in colors and colors_dark', () => {
    const config: BrandConfigData = {
      schema_version: '0.1.0',
      session: 1,
      client_name: 'Acme',
      created_at: '2026-01-01T00:00:00.000Z',
    };
    const runtime = compileRuntime(config, identity(colors), null, null, null);
    expect(runtime.identity.colors).toEqual({
      surface: '#ffffff',
      'surface-alt': '#f4f4f4',
      text: '#161616',
      'text-secondary': '#525252',
    });
    expect(runtime.identity.colors_dark).toEqual({ surface: '#0f0f1a', 'surface-alt': '#1c1c2e' });
    expect(RuntimeSchema.safeParse(runtime).success).toBe(true);
  });
});
