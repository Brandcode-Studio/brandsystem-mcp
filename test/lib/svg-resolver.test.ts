import { describe, it, expect } from 'vitest';
import { sanitizeSvg, resolveSvg, resolveImage } from '../../src/lib/svg-resolver.js';

describe('sanitizeSvg', () => {
  it('removes script tags', () => {
    const input = '<svg><script>alert("xss")</script><rect/></svg>';
    const result = sanitizeSvg(input);
    expect(result).not.toContain('<script');
    expect(result).toContain('<rect/>');
  });

  it('removes event handlers (onclick, onload)', () => {
    const input = '<svg><rect onclick="alert(1)" onload="evil()"/></svg>';
    const result = sanitizeSvg(input);
    expect(result).not.toContain('onclick');
    expect(result).not.toContain('onload');
  });

  it('removes javascript: URLs', () => {
    const input = '<svg><a href="javascript:alert(1)"><rect/></a></svg>';
    const result = sanitizeSvg(input);
    expect(result).not.toContain('javascript:');
  });

  it('removes foreignObject elements', () => {
    const input = '<svg><foreignObject><div>html</div></foreignObject><rect/></svg>';
    const result = sanitizeSvg(input);
    expect(result).not.toContain('foreignObject');
    expect(result).toContain('<rect/>');
  });

  it('leaves clean SVG intact', () => {
    const input = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10" fill="red"/></svg>';
    const result = sanitizeSvg(input);
    expect(result).toBe(input);
  });
});

describe('resolveSvg', () => {
  it('returns inline_svg without XML declaration or comments', () => {
    const input = '<?xml version="1.0"?><!-- comment --><svg><rect/></svg>';
    const { inline_svg } = resolveSvg(input);
    expect(inline_svg).not.toContain('<?xml');
    expect(inline_svg).not.toContain('<!--');
    expect(inline_svg).toBe('<svg><rect/></svg>');
  });

  it('returns data_uri as base64 data URI', () => {
    const input = '<svg><rect/></svg>';
    const { data_uri } = resolveSvg(input);
    expect(data_uri).toMatch(/^data:image\/svg\+xml;base64,/);
    const decoded = Buffer.from(data_uri.replace('data:image/svg+xml;base64,', ''), 'base64').toString('utf-8');
    expect(decoded).toBe('<svg><rect/></svg>');
  });

  it('handles SVG with leading whitespace/XML declaration', () => {
    const input = '  <?xml version="1.0" encoding="UTF-8"?>\n  <svg viewBox="0 0 100 100"><circle r="50"/></svg>';
    const { inline_svg } = resolveSvg(input);
    expect(inline_svg).toMatch(/^<svg/);
    expect(inline_svg).toContain('<circle r="50"/>');
  });
});

describe('resolveImage', () => {
  it('returns base64 data URI with correct MIME type', () => {
    const content = Buffer.from('fake-png-data');
    const { data_uri } = resolveImage(content, 'image/png');
    expect(data_uri).toMatch(/^data:image\/png;base64,/);
    const decoded = Buffer.from(data_uri.replace('data:image/png;base64,', ''), 'base64').toString('utf-8');
    expect(decoded).toBe('fake-png-data');
  });
});
