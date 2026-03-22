import { describe, it, expect } from 'vitest';
import {
  isTokenWorthy,
  needsClarification,
  sourceWins,
  confidenceRank,
} from '../../src/lib/confidence.js';

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
