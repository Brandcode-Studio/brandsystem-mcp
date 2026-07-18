import { describe, it, expect } from 'vitest';
import {
  isTokenWorthy,
  needsClarification,
  sourceWins,
  confidenceRank,
  mergeColor,
  mergeColorWithPriority,
} from '../../src/lib/confidence.js';
import type { ColorEntry } from '../../src/types/index.js';

function makeColor(overrides: Partial<ColorEntry> = {}): ColorEntry {
  return {
    name: 'Test Color',
    value: '#123456',
    role: 'surface',
    source: 'web',
    confidence: 'high',
    ...overrides,
  };
}

describe('isTokenWorthy', () => {
  it('returns true for confirmed confidence', () => {
    expect(isTokenWorthy('confirmed')).toBe(true);
  });

  it('returns true for high confidence', () => {
    expect(isTokenWorthy('high')).toBe(true);
  });

  it('returns true for medium confidence', () => {
    expect(isTokenWorthy('medium')).toBe(true);
  });

  it('returns false for low confidence', () => {
    expect(isTokenWorthy('low')).toBe(false);
  });
});

describe('needsClarification', () => {
  it('returns true for low confidence', () => {
    expect(needsClarification('low')).toBe(true);
  });

  it('returns false for medium confidence', () => {
    expect(needsClarification('medium')).toBe(false);
  });

  it('returns false for high confidence', () => {
    expect(needsClarification('high')).toBe(false);
  });
});

describe('sourceWins', () => {
  it('ranks figma above manual', () => {
    expect(sourceWins('figma', 'manual')).toBe('figma');
  });

  it('ranks manual above web', () => {
    expect(sourceWins('manual', 'web')).toBe('manual');
  });

  it('ranks figma above web', () => {
    expect(sourceWins('figma', 'web')).toBe('figma');
  });

  it('returns the first source on tie', () => {
    expect(sourceWins('web', 'web')).toBe('web');
  });
});

describe('mergeColor — (role, theme) merge key (issue #35 gap 1)', () => {
  it('keeps both a light and a dark entry for the same role', () => {
    const light = makeColor({ name: 'Paper', value: '#ffffff', role: 'surface' });
    const dark = makeColor({ name: 'Midnight', value: '#0f0f1a', role: 'surface', theme: 'dark' });

    const merged = mergeColor([light], dark);

    expect(merged).toHaveLength(2);
    expect(merged.map((c) => c.value)).toEqual(['#ffffff', '#0f0f1a']);
  });

  it('a dark-theme entry does not evict the default entry regardless of source rank', () => {
    const webLight = makeColor({ value: '#ffffff', role: 'text', source: 'web' });
    const figmaDark = makeColor({ value: '#e2e8f0', role: 'text', theme: 'dark', source: 'figma' });

    const merged = mergeColor([webLight], figmaDark);

    expect(merged).toHaveLength(2);
    expect(merged[0].value).toBe('#ffffff');
  });

  it('still merges within the same (role, theme) slot by source precedence', () => {
    const webDark = makeColor({ value: '#111111', role: 'surface', theme: 'dark', source: 'web' });
    const figmaDark = makeColor({ value: '#0f0f1a', role: 'surface', theme: 'dark', source: 'figma' });

    const merged = mergeColor([webDark], figmaDark);

    expect(merged).toHaveLength(1);
    expect(merged[0].value).toBe('#0f0f1a');
    expect(merged[0].source).toBe('figma');
  });

  it('still merges within the same (role, theme) slot by confidence when sources tie', () => {
    const lowDark = makeColor({ value: '#111111', role: 'surface', theme: 'dark', confidence: 'low' });
    const highDark = makeColor({ value: '#0f0f1a', role: 'surface', theme: 'dark', confidence: 'high' });

    const merged = mergeColor([lowDark], highDark);

    expect(merged).toHaveLength(1);
    expect(merged[0].value).toBe('#0f0f1a');
  });

  it('treats explicit theme "light" and absent theme as the same merge slot', () => {
    const unthemed = makeColor({ value: '#fafafa', role: 'surface', source: 'web' });
    const explicitLight = makeColor({ value: '#ffffff', role: 'surface', theme: 'light', source: 'guidelines' });

    const merged = mergeColor([unthemed], explicitLight);

    expect(merged).toHaveLength(1);
    expect(merged[0].value).toBe('#ffffff');
    expect(merged[0].source).toBe('guidelines');
  });

  it('keeps unknown-role entries additive regardless of theme', () => {
    const a = makeColor({ value: '#111111', role: 'unknown' });
    const b = makeColor({ value: '#222222', role: 'unknown', theme: 'dark' });

    const merged = mergeColor([a], b);

    expect(merged).toHaveLength(2);
  });
});

describe('mergeColorWithPriority — (role, theme) merge key', () => {
  it('keeps both themes for the same role', () => {
    const light = makeColor({ value: '#ffffff', role: 'surface' });
    const dark = makeColor({ value: '#0f0f1a', role: 'surface', theme: 'dark' });

    const merged = mergeColorWithPriority([light], dark);

    expect(merged).toHaveLength(2);
  });

  it('resolves precedence within the same (role, theme) slot using the priority list', () => {
    const webDark = makeColor({ value: '#111111', role: 'surface', theme: 'dark', source: 'web' });
    const guidelinesDark = makeColor({ value: '#0f0f1a', role: 'surface', theme: 'dark', source: 'guidelines' });

    const merged = mergeColorWithPriority([webDark], guidelinesDark);

    expect(merged).toHaveLength(1);
    expect(merged[0].source).toBe('guidelines');
  });
});

describe('confidenceRank', () => {
  it('ranks confirmed highest', () => {
    expect(confidenceRank('confirmed')).toBeGreaterThan(confidenceRank('high'));
  });

  it('ranks high above medium', () => {
    expect(confidenceRank('high')).toBeGreaterThan(confidenceRank('medium'));
  });

  it('ranks medium above low', () => {
    expect(confidenceRank('medium')).toBeGreaterThan(confidenceRank('low'));
  });
});
