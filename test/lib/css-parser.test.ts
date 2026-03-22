import { describe, it, expect } from 'vitest';
import {
  extractFromCSS,
  promotePrimaryColor,
  inferColorRole,
  isChromatic,
  type ExtractedColor,
} from '../../src/lib/css-parser.js';

describe('extractFromCSS — color extraction', () => {
  it('extracts hex colors from CSS declarations', () => {
    const css = `
      body { color: #1a1a1a; background-color: #ffffff; }
      .btn { background-color: #ff6600; }
    `;
    const { colors } = extractFromCSS(css);
    const hexValues = colors.map((c) => c.value);
    expect(hexValues).toContain('#1a1a1a');
    expect(hexValues).toContain('#ffffff');
    expect(hexValues).toContain('#ff6600');
  });

  it('normalizes 3-char hex to 6-char', () => {
    const css = `p { color: #abc; }`;
    const { colors } = extractFromCSS(css);
    expect(colors[0].value).toBe('#aabbcc');
  });

  it('normalizes rgb() to hex', () => {
    const css = `div { color: rgb(255, 128, 0); }`;
    const { colors } = extractFromCSS(css);
    expect(colors[0].value).toBe('#ff8000');
  });

  it('extracts colors from CSS custom properties', () => {
    const css = `:root { --brand-primary: #e63946; }`;
    const { colors } = extractFromCSS(css);
    expect(colors).toHaveLength(1);
    expect(colors[0].value).toBe('#e63946');
    expect(colors[0].source_type).toBe('css-variable');
    expect(colors[0].property).toBe('--brand-primary');
  });

  it('assigns roles from CSS custom property names', () => {
    const css = `:root { --brand-primary: #e63946; --accent-color: #00bcd4; }`;
    const { colors } = extractFromCSS(css);
    const primary = colors.find((c) => c.property === '--brand-primary');
    const accent = colors.find((c) => c.property === '--accent-color');
    expect(inferColorRole(primary!)).toBe('primary');
    expect(inferColorRole(accent!)).toBe('accent');
  });

  it('increments frequency for duplicate hex values', () => {
    const css = `
      .a { color: #333333; }
      .b { color: #333333; }
      .c { background-color: #333333; }
    `;
    const { colors } = extractFromCSS(css);
    const match = colors.find((c) => c.value === '#333333');
    expect(match!.frequency).toBe(3);
  });

  it('returns empty arrays for invalid CSS', () => {
    const { colors, fonts } = extractFromCSS('not valid css {{{{');
    expect(colors).toEqual([]);
    expect(fonts).toEqual([]);
  });
});

describe('extractFromCSS — font extraction', () => {
  it('extracts font families from CSS', () => {
    const css = `body { font-family: "Inter", sans-serif; }`;
    const { fonts } = extractFromCSS(css);
    expect(fonts.some((f) => f.family === 'Inter')).toBe(true);
  });

  it('filters out system fonts', () => {
    const css = `
      body { font-family: "Inter", -apple-system, BlinkMacSystemFont, sans-serif; }
      code { font-family: SFMono-Regular, Menlo, monospace; }
    `;
    const { fonts } = extractFromCSS(css);
    const families = fonts.map((f) => f.family);
    expect(families).toContain('Inter');
    expect(families).not.toContain('-apple-system');
    expect(families).not.toContain('BlinkMacSystemFont');
    expect(families).not.toContain('SFMono-Regular');
    expect(families).not.toContain('Menlo');
    expect(families).not.toContain('sans-serif');
    expect(families).not.toContain('monospace');
  });

  it('strips quotes from font family names', () => {
    const css = `h1 { font-family: "Playfair Display", serif; }`;
    const { fonts } = extractFromCSS(css);
    expect(fonts[0].family).toBe('Playfair Display');
  });
});

describe('promotePrimaryColor', () => {
  it('promotes the most frequent chromatic color to primary when no explicit primary exists', () => {
    const colors: ExtractedColor[] = [
      { value: '#ffffff', property: 'background-color', frequency: 10, source_type: 'computed' },
      { value: '#e63946', property: 'color', frequency: 5, source_type: 'computed' },
      { value: '#1a1a1a', property: 'color', frequency: 8, source_type: 'computed' },
    ];
    const result = promotePrimaryColor(colors);
    // #e63946 is the most frequent chromatic color (red, not near-white/black/neutral)
    const promoted = result.find((c) => c.value === '#e63946') as ExtractedColor & { _promoted_role?: string };
    expect(promoted._promoted_role).toBe('primary');
    expect(inferColorRole(promoted)).toBe('primary');
  });

  it('does not promote when an explicit primary already exists', () => {
    const colors: ExtractedColor[] = [
      { value: '#e63946', property: '--brand-primary', frequency: 1, source_type: 'css-variable' },
      { value: '#00bcd4', property: 'color', frequency: 10, source_type: 'computed' },
    ];
    const result = promotePrimaryColor(colors);
    // Should return as-is; no _promoted_role added
    const cyan = result.find((c) => c.value === '#00bcd4') as ExtractedColor & { _promoted_role?: string };
    expect(cyan._promoted_role).toBeUndefined();
  });
});
