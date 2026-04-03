import { describe, it, expect } from 'vitest';
import { getVersion } from '../../src/lib/version.js';

describe('getVersion', () => {
  it('returns a version string', () => {
    expect(typeof getVersion()).toBe('string');
  });

  it('returns a semver-like string', () => {
    expect(getVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
});
