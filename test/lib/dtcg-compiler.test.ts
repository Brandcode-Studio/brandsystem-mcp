import { describe, it, expect } from 'vitest';
import { compileDTCG } from '../../src/lib/dtcg-compiler.js';
import type { CoreIdentityData } from '../../src/schemas/index.js';
import type { DesignSynthesisFile } from '../../src/lib/design-synthesis.js';

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
  const synthesis: DesignSynthesisFile = {
    schema_version: '0.4.0',
    generated_at: '2026-04-10T00:00:00.000Z',
    source: 'evidence',
    brand: { client_name: 'Acme', website_url: 'https://acme.test' },
    evidence: {
      pages_sampled: 1,
      screenshots_analyzed: 1,
      page_types: ['home'],
      viewports: ['desktop'],
      computed_elements: 3,
      css_custom_properties: 4,
    },
    colors: {
      brand: [],
      semantic: [],
      additional: [],
      mood: { temperature: 'cool', contrast: 'high', brightness: 'light' },
    },
    typography: {
      families: [],
      scale: [],
      character: [],
    },
    shape: {
      radius_scale: [{ token: 'radius-md', value: '12px', confidence: 'high', provenance: ['computed:borderRadius'] }],
      corner_style: 'rounded',
    },
    depth: {
      shadow_scale: [{ token: 'shadow-md', value: '0px 8px 24px rgba(0,0,0,0.12)', confidence: 'medium', provenance: ['computed:boxShadow'] }],
      elevation_style: 'subtle',
    },
    spacing: {
      base_unit: '8px',
      component_spacing: ['8px', '16px', '24px'],
      section_spacing: ['80px'],
      confidence: 'medium',
    },
    layout: {
      content_width: '1200px',
      density: 'balanced',
      grid_feel: 'structured product-marketing grid',
    },
    components: {
      button: { count: 1, dominant_fill: '#2665fd', dominant_text: '#ffffff', dominant_radius: '12px', dominant_shadow: null, notes: [] },
      card: { count: 1, dominant_fill: '#ffffff', dominant_text: '#111111', dominant_radius: '16px', dominant_shadow: null, notes: [] },
      input: { count: 0, dominant_fill: null, dominant_text: null, dominant_radius: null, dominant_shadow: null, notes: [] },
      navigation: { count: 0, dominant_fill: null, dominant_text: null, dominant_radius: null, dominant_shadow: null, notes: [] },
      badge: { count: 0, dominant_fill: null, dominant_text: null, dominant_radius: null, dominant_shadow: null, notes: [] },
    },
    motion: {
      tone: 'Keep motion quick and restrained.',
      duration_tokens: [{ token: 'duration-fast', value: '160ms', confidence: 'medium', provenance: ['css-var:duration-fast'] }],
      easing_tokens: [{ token: 'ease-standard', value: 'cubic-bezier(0.2, 0.8, 0.2, 1)', confidence: 'medium', provenance: ['css-var:ease-standard'] }],
    },
    personality: {
      adjectives: ['confident', 'calm', 'systematic'],
      tone: 'confident, calm, systematic',
      warmth: 'cool',
      precision: 'polished',
      positioning: 'product-led',
      rationale: [],
    },
    ambiguities: [],
  };

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

  it('includes synthesis-driven radius, shadow, layout, and motion groups when provided', () => {
    const result = compileDTCG(makeIdentity(), 'Acme', synthesis);
    const brand = result.brand as Record<string, Record<string, unknown>>;

    expect(brand.radius).toBeDefined();
    expect(brand.shadow).toBeDefined();
    expect(brand.layout).toBeDefined();
    expect(brand.motion).toBeDefined();

    const radius = brand.radius['radius-md'] as Record<string, unknown>;
    expect(radius.$value).toBe('12px');

    const contentWidth = (brand.layout as Record<string, Record<string, unknown>>).contentWidth;
    expect(contentWidth.$value).toBe('1200px');
  });
});
