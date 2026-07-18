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

describe('extractFromCSS — dark-theme scope tagging (issue #35 gap 1)', () => {
  it('tags colors found only under [data-theme="dark"] with theme "dark"', () => {
    const css = `
      :root { --color-bg: #ffffff; }
      [data-theme="dark"] { --color-bg: #0f0f1a; }
    `;
    const { colors } = extractFromCSS(css);
    const light = colors.find((c) => c.value === '#ffffff');
    const dark = colors.find((c) => c.value === '#0f0f1a');
    expect(light?.theme).toBeUndefined();
    expect(dark?.theme).toBe('dark');
  });

  it('tags colors found only under a .dark class scope', () => {
    const css = `
      body { background-color: #ffffff; }
      .dark body { background-color: #111827; }
    `;
    const { colors } = extractFromCSS(css);
    expect(colors.find((c) => c.value === '#111827')?.theme).toBe('dark');
    expect(colors.find((c) => c.value === '#ffffff')?.theme).toBeUndefined();
  });

  it('does not treat .dark-prefixed class names as a dark scope', () => {
    const css = `.darkroom-gallery { background-color: #202020; }`;
    const { colors } = extractFromCSS(css);
    expect(colors.find((c) => c.value === '#202020')?.theme).toBeUndefined();
  });

  it('tags colors inside a prefers-color-scheme: dark media block', () => {
    const css = `
      :root { --surface: #ffffff; }
      @media (prefers-color-scheme: dark) {
        :root { --surface: #16161d; }
      }
    `;
    const { colors } = extractFromCSS(css);
    expect(colors.find((c) => c.value === '#16161d')?.theme).toBe('dark');
    expect(colors.find((c) => c.value === '#ffffff')?.theme).toBeUndefined();
  });

  it('does not tag colors after leaving a dark media block', () => {
    const css = `
      @media (prefers-color-scheme: dark) {
        body { background-color: #16161d; }
      }
      .footer { background-color: #333344; }
    `;
    const { colors } = extractFromCSS(css);
    expect(colors.find((c) => c.value === '#16161d')?.theme).toBe('dark');
    expect(colors.find((c) => c.value === '#333344')?.theme).toBeUndefined();
  });

  it('clears the dark tag when the same color also appears outside dark scope', () => {
    const css = `
      [data-theme="dark"] { --brand-primary: #7c3aed; }
      a { color: #7c3aed; }
    `;
    const { colors } = extractFromCSS(css);
    expect(colors.find((c) => c.value === '#7c3aed')?.theme).toBeUndefined();
  });

  it('keeps a shared hex theme-agnostic regardless of sighting order', () => {
    const css = `
      a { color: #7c3aed; }
      [data-theme="dark"] { --brand-primary: #7c3aed; }
    `;
    const { colors } = extractFromCSS(css);
    expect(colors.find((c) => c.value === '#7c3aed')?.theme).toBeUndefined();
  });

  it('never guesses dark theme from color values alone', () => {
    const css = `body { background-color: #000000; color: #0f0f1a; }`;
    const { colors } = extractFromCSS(css);
    for (const c of colors) {
      expect(c.theme).toBeUndefined();
    }
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

  it('drops generic web-safe fallbacks behind a distinctive first-choice font', () => {
    const css = `body { font-family: "Work Sans", Arial, Helvetica, sans-serif; }`;
    const { fonts } = extractFromCSS(css);
    const families = fonts.map((f) => f.family);
    expect(families).toContain('Work Sans');
    expect(families).not.toContain('Arial');
    expect(families).not.toContain('Helvetica');
  });

  it('drops the full generic web-safe set when used as fallbacks', () => {
    const css = `
      body { font-family: "Inter", Verdana, Tahoma, sans-serif; }
      h1 { font-family: "Fraunces", Georgia, "Times New Roman", serif; }
      h2 { font-family: "Barlow", "Trebuchet MS", "Helvetica Neue", sans-serif; }
    `;
    const { fonts } = extractFromCSS(css);
    const families = fonts.map((f) => f.family);
    expect(families).toEqual(expect.arrayContaining(['Inter', 'Fraunces', 'Barlow']));
    for (const generic of ['Verdana', 'Tahoma', 'Georgia', 'Times New Roman', 'Trebuchet MS', 'Helvetica Neue']) {
      expect(families).not.toContain(generic);
    }
  });

  it('keeps Arial when it is the first-choice font (Arial-only brand)', () => {
    const css = `body { font-family: Arial, sans-serif; }`;
    const { fonts } = extractFromCSS(css);
    expect(fonts.map((f) => f.family)).toContain('Arial');
  });

  it('keeps a generic first choice but drops generic fallbacks behind it', () => {
    const css = `body { font-family: Georgia, "Times New Roman", serif; }`;
    const { fonts } = extractFromCSS(css);
    const families = fonts.map((f) => f.family);
    expect(families).toContain('Georgia');
    expect(families).not.toContain('Times New Roman');
  });

  it('counts a generic font used as a first choice elsewhere even if it is a fallback in another stack', () => {
    const css = `
      body { font-family: "Inter", Georgia, serif; }
      blockquote { font-family: Georgia, serif; }
    `;
    const { fonts } = extractFromCSS(css);
    const georgia = fonts.find((f) => f.family === 'Georgia');
    expect(georgia).toBeDefined();
    expect(georgia!.frequency).toBe(1); // only the first-choice usage counts
  });
});

describe('isChromatic', () => {
  it('treats dark brand colors as chromatic (saturation-based, not luminance)', () => {
    expect(isChromatic('#1d3557')).toBe(true); // dark navy
    expect(isChromatic('#14532d')).toBe(true); // forest green
    expect(isChromatic('#800020')).toBe(true); // burgundy
    expect(isChromatic('#4a0e1e')).toBe(true); // deep maroon
  });

  it('treats bright saturated colors as chromatic', () => {
    expect(isChromatic('#e63946')).toBe(true);
    expect(isChromatic('#0f62fe')).toBe(true);
    expect(isChromatic('#ff7f11')).toBe(true);
  });

  it('rejects true near-blacks', () => {
    expect(isChromatic('#000000')).toBe(false);
    expect(isChromatic('#111111')).toBe(false);
  });

  it('rejects near-whites', () => {
    expect(isChromatic('#fefefe')).toBe(false);
    expect(isChromatic('#ffffff')).toBe(false);
  });

  it('rejects grays and low-saturation neutrals', () => {
    expect(isChromatic('#888888')).toBe(false);
    expect(isChromatic('#212529')).toBe(false); // desaturated near-black text color
    expect(isChromatic('#57534e')).toBe(false); // warm gray
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

  it('promotes a dark chromatic color (navy) when it is the most frequent chromatic', () => {
    const colors: ExtractedColor[] = [
      { value: '#ffffff', property: 'background-color', frequency: 10, source_type: 'computed' },
      { value: '#1d3557', property: 'color', frequency: 6, source_type: 'computed' },
      { value: '#111111', property: 'color', frequency: 8, source_type: 'computed' },
    ];
    const result = promotePrimaryColor(colors);
    const promoted = result.find((c) => c.value === '#1d3557') as ExtractedColor & { _promoted_role?: string };
    expect(promoted._promoted_role).toBe('primary');
  });

  it('frequency still decides between a bright and a dark chromatic candidate', () => {
    const colors: ExtractedColor[] = [
      { value: '#d90429', property: 'color', frequency: 5, source_type: 'computed' },
      { value: '#1d3557', property: 'color', frequency: 3, source_type: 'computed' },
    ];
    const result = promotePrimaryColor(colors);
    const bright = result.find((c) => c.value === '#d90429') as ExtractedColor & { _promoted_role?: string };
    const dark = result.find((c) => c.value === '#1d3557') as ExtractedColor & { _promoted_role?: string };
    expect(bright._promoted_role).toBe('primary');
    expect(dark._promoted_role).toBeUndefined();
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

describe("alpha-hex normalization (#42.3)", () => {
  it("drops mostly-transparent hex colors from extraction", () => {
    const css = ":root { --a: #0000; --b: #ffffff33; --c: #ff0000; }";
    const result = extractFromCSS(css);
    const values = result.colors.map((c) => c.value);
    expect(values).not.toContain("#0000");
    expect(values).not.toContain("#ffffff33");
    expect(values).toContain("#ff0000");
  });

  it("strips alpha from opaque-enough short hex so naming sees real RGB", () => {
    const css = ".x { color: #fff6; }";
    const result = extractFromCSS(css);
    const values = result.colors.map((c) => c.value);
    expect(values).not.toContain("#fff6");
    // white at ~40% alpha survives as white, not a malformed token
    if (values.length > 0) {
      expect(values).toContain("#ffffff");
    }
  });
});
