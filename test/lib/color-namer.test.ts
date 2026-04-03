import { describe, it, expect } from 'vitest';
import { generateColorName, isCssArtifactName, cleanColorName } from '../../src/lib/color-namer.js';

describe('generateColorName', () => {
  it('returns capitalized role when role is not "unknown"', () => {
    expect(generateColorName('#ff0000', 'primary')).toBe('Primary');
    expect(generateColorName('#00ff00', 'accent')).toBe('Accent');
    expect(generateColorName('#333333', 'background')).toBe('Background');
  });

  it('returns color family from hex when role is "unknown"', () => {
    // Pure red at high saturation + mid-lightness hits the Coral refinement
    expect(generateColorName('#ff0000', 'unknown')).toBe('Coral');
    expect(generateColorName('#0066cc', 'unknown')).toBe('Blue');
    // Dark red avoids the Coral range (l < 25)
    expect(generateColorName('#550000', 'unknown')).toBe('Dark Red');
  });

  it('returns "Black" for very dark colors', () => {
    expect(generateColorName('#050505', 'unknown')).toBe('Black');
  });

  it('returns "White" for very light colors', () => {
    expect(generateColorName('#fafafa', 'unknown')).toBe('White');
  });

  it('returns "Gray" for desaturated mid-tones', () => {
    expect(generateColorName('#808080', 'unknown')).toBe('Gray');
  });

  it('returns "Dark Blue" for dark saturated blues', () => {
    expect(generateColorName('#0a1a3a', 'unknown')).toBe('Dark Blue');
  });
});

describe('isCssArtifactName', () => {
  it('returns true for CSS property names', () => {
    expect(isCssArtifactName('color', '#ff0000')).toBe(true);
    expect(isCssArtifactName('background-color', '#ff0000')).toBe(true);
  });

  it('returns true for Tailwind patterns', () => {
    expect(isCssArtifactName('--tw-shadow', '#000000')).toBe(true);
  });

  it('returns true when name contains the hex value', () => {
    expect(isCssArtifactName('my-color-#ff0000', '#ff0000')).toBe(true);
  });

  it('returns false for clean names', () => {
    expect(isCssArtifactName('Brand Blue', '#0000ff')).toBe(false);
    expect(isCssArtifactName('Coral', '#ff6b6b')).toBe(false);
  });
});

describe('cleanColorName', () => {
  it('replaces CSS artifact names with generated names', () => {
    const result = cleanColorName({ name: 'background-color', value: '#0066cc', role: 'unknown' });
    expect(result).toBe('Blue');
  });

  it('keeps clean names as-is', () => {
    const result = cleanColorName({ name: 'Brand Blue', value: '#0000ff', role: 'primary' });
    expect(result).toBe('Brand Blue');
  });
});
