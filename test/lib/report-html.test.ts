import { describe, it, expect } from 'vitest';
import { generateBrandInstructions, generateReportHTML } from '../../src/lib/report-html.js';
import type { BrandConfig, CoreIdentity } from '../../src/types/index.js';

function makeConfig(overrides: Partial<BrandConfig> = {}): BrandConfig {
  return {
    schema_version: '0.1.0',
    session: 1,
    client_name: 'Acme Corp',
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeIdentity(overrides: Partial<CoreIdentity> = {}): CoreIdentity {
  return {
    schema_version: '0.1.0',
    colors: [],
    typography: [],
    logo: [],
    spacing: null,
    ...overrides,
  };
}

describe('generateBrandInstructions', () => {
  it('includes the client name in the output', () => {
    const result = generateBrandInstructions(makeConfig(), makeIdentity());
    expect(result).toContain('Acme Corp');
  });

  it('includes logo SVG when available', () => {
    const identity = makeIdentity({
      logo: [
        {
          type: 'wordmark',
          source: 'web',
          confidence: 'high',
          variants: [
            {
              name: 'default',
              inline_svg: '<svg><path d="M0 0h100v100H0z"/></svg>',
            },
          ],
        },
      ],
    });
    const result = generateBrandInstructions(makeConfig(), identity);
    expect(result).toContain('<svg>');
    expect(result).toContain('## Logo');
  });

  it('includes color table when colors are present', () => {
    const identity = makeIdentity({
      colors: [
        { name: 'Red', value: '#e63946', role: 'primary', source: 'web', confidence: 'high' },
        { name: 'Dark', value: '#1a1a1a', role: 'text', source: 'web', confidence: 'medium' },
      ],
    });
    const result = generateBrandInstructions(makeConfig(), identity);
    expect(result).toContain('## Colors');
    expect(result).toContain('| Role | Hex |');
    expect(result).toContain('#e63946');
    expect(result).toContain('primary');
  });

  it('omits color section when no colors are present', () => {
    const result = generateBrandInstructions(makeConfig(), makeIdentity());
    expect(result).not.toContain('## Colors');
  });
});

describe('generateReportHTML', () => {
  it('produces valid HTML with DOCTYPE and closing tag', () => {
    const html = generateReportHTML({
      config: makeConfig(),
      identity: makeIdentity(),
      clarifications: [],
      tokenCount: 0,
      auditSummary: { pass: 0, warn: 0, fail: 0 },
    });
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('</html>');
  });

  it('includes the client name in the HTML', () => {
    const html = generateReportHTML({
      config: makeConfig({ client_name: 'TestBrand' }),
      identity: makeIdentity(),
      clarifications: [],
      tokenCount: 5,
      auditSummary: { pass: 5, warn: 0, fail: 0 },
    });
    expect(html).toContain('TestBrand');
  });
});
