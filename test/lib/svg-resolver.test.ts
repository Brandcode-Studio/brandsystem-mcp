import { describe, it, expect } from 'vitest';
import { sanitizeSvg, resolveSvg, resolveImage } from '../../src/lib/svg-resolver.js';

describe('sanitizeSvg', () => {
  // --- Passes through ---

  it('preserves clean SVG with path, rect, circle, text', () => {
    const input = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/><rect width="10" height="10" fill="red"/><circle cx="5" cy="5" r="3"/><text font-size="12">Hello</text></svg>';
    const result = sanitizeSvg(input);
    expect(result).toContain('<path');
    expect(result).toContain('<rect');
    expect(result).toContain('<circle');
    expect(result).toContain('<text');
    expect(result).toContain('Hello');
  });

  it('preserves SVG with gradients and defs', () => {
    const input = '<svg><defs><linearGradient id="g1"><stop offset="0%" stop-color="red"/><stop offset="100%" stop-color="blue"/></linearGradient></defs><rect fill="url(#g1)"/></svg>';
    const result = sanitizeSvg(input);
    expect(result).toContain('<defs');
    expect(result).toContain('linearGradient');
    expect(result).toContain('<stop');
    expect(result).toContain('stop-color');
  });

  it('preserves viewBox and preserveAspectRatio', () => {
    const input = '<svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet"><rect/></svg>';
    const result = sanitizeSvg(input);
    expect(result).toContain('viewBox');
    expect(result).toContain('preserveAspectRatio');
  });

  it('preserves class and id attributes', () => {
    const input = '<svg><rect id="logo-bg" class="primary-fill" width="10" height="10"/></svg>';
    const result = sanitizeSvg(input);
    expect(result).toContain('id="logo-bg"');
    expect(result).toContain('class="primary-fill"');
  });

  it('preserves local <use href="#symbol-id">', () => {
    const input = '<svg><defs><symbol id="logo"><rect/></symbol></defs><use href="#logo"/></svg>';
    const result = sanitizeSvg(input);
    expect(result).toContain('<use');
    expect(result).toContain('href="#logo"');
  });

  it('preserves embedded <image href="data:image/png;base64,...">', () => {
    const input = '<svg><image href="data:image/png;base64,iVBORw0KGgo=" width="100" height="100"/></svg>';
    const result = sanitizeSvg(input);
    expect(result).toContain('<image');
    expect(result).toContain('href="data:image/png;base64,');
  });

  it('preserves radialGradient, pattern, mask, clipPath', () => {
    const input = '<svg><defs><radialGradient id="rg"><stop offset="0%"/></radialGradient><pattern id="p" patternUnits="userSpaceOnUse"/><clipPath id="cp"><rect/></clipPath><mask id="m"><rect/></mask></defs></svg>';
    const result = sanitizeSvg(input);
    expect(result).toContain('radialGradient');
    expect(result).toContain('pattern');
    expect(result).toContain('clipPath');
    expect(result).toContain('mask');
  });

  it('preserves text attributes (font-family, text-anchor, etc.)', () => {
    const input = '<svg><text font-family="Inter" font-weight="bold" text-anchor="middle" dominant-baseline="central" letter-spacing="0.05em">AB</text></svg>';
    const result = sanitizeSvg(input);
    expect(result).toContain('font-family');
    expect(result).toContain('font-weight');
    expect(result).toContain('text-anchor');
    expect(result).toContain('dominant-baseline');
    expect(result).toContain('letter-spacing');
  });

  it('preserves data-name and aria attributes', () => {
    const input = '<svg><g data-name="Layer 1" aria-label="Logo" aria-hidden="true" role="img"><rect/></g></svg>';
    const result = sanitizeSvg(input);
    expect(result).toContain('data-name="Layer 1"');
    expect(result).toContain('aria-label="Logo"');
    expect(result).toContain('aria-hidden="true"');
    expect(result).toContain('role="img"');
  });

  // --- Strips dangerous content ---

  it('removes <script> tags (plain)', () => {
    const input = '<svg><script>alert(1)</script><path d="M0 0"/></svg>';
    const result = sanitizeSvg(input);
    expect(result).not.toContain('<script');
    expect(result).not.toContain('alert');
    expect(result).toContain('<path');
  });

  it('removes <script> tags (entity-encoded tag name)', () => {
    const input = '<svg><&#115;cript>alert(1)</&#115;cript><path d="M0 0"/></svg>';
    const result = sanitizeSvg(input);
    expect(result).not.toContain('alert');
  });

  it('removes onclick attribute (plain)', () => {
    const input = '<svg><path onclick="alert(1)" d="M0 0"/></svg>';
    const result = sanitizeSvg(input);
    expect(result).not.toContain('onclick');
    expect(result).toContain('d="M0 0"');
  });

  it('removes onclick attribute (entity-encoded: on&#99;lick)', () => {
    const input = '<svg><path on&#99;lick="alert(1)" d="M0 0"/></svg>';
    const result = sanitizeSvg(input);
    expect(result).not.toContain('onclick');
    expect(result).not.toContain('on&#99;lick');
    expect(result).toContain('d="M0 0"');
  });

  it('removes style attribute with expression()', () => {
    const input = '<svg><rect style="width:expression(alert(1))" fill="red"/></svg>';
    const result = sanitizeSvg(input);
    expect(result).not.toContain('style');
    expect(result).not.toContain('expression');
    expect(result).toContain('fill="red"');
  });

  it('removes style attribute with url()', () => {
    const input = '<svg><rect style="background:url(https://evil.com/track.gif)" fill="red"/></svg>';
    const result = sanitizeSvg(input);
    expect(result).not.toContain('style');
    expect(result).not.toContain('url(');
  });

  it('removes <style> element with @import', () => {
    const input = '<svg><style>@import url("https://evil.com/payload.css");</style><rect/></svg>';
    const result = sanitizeSvg(input);
    expect(result).not.toContain('<style');
    expect(result).not.toContain('@import');
    expect(result).toContain('<rect');
  });

  it('removes <style> element with any content', () => {
    const input = '<svg><style>.cls-1{fill:red}</style><rect class="cls-1"/></svg>';
    const result = sanitizeSvg(input);
    expect(result).not.toContain('<style');
    expect(result).not.toContain('.cls-1{fill:red}');
    expect(result).toContain('<rect');
  });

  it('removes <foreignObject> with embedded HTML', () => {
    const input = '<svg><foreignObject><div xmlns="http://www.w3.org/1999/xhtml"><script>alert(1)</script></div></foreignObject><rect/></svg>';
    const result = sanitizeSvg(input);
    expect(result).not.toContain('foreignObject');
    expect(result).not.toContain('<div');
    expect(result).not.toContain('script');
    expect(result).toContain('<rect');
  });

  it('removes <embed> elements', () => {
    const result = sanitizeSvg('<svg><embed src="evil.swf"/><rect/></svg>');
    expect(result).not.toContain('<embed');
    expect(result).toContain('<rect');
  });

  it('removes <iframe> elements', () => {
    const result = sanitizeSvg('<svg><iframe src="https://evil.com"></iframe><rect/></svg>');
    expect(result).not.toContain('<iframe');
    expect(result).toContain('<rect');
  });

  it('removes <object> elements', () => {
    const result = sanitizeSvg('<svg><object data="evil.swf"></object><rect/></svg>');
    expect(result).not.toContain('<object');
    expect(result).toContain('<rect');
  });

  it('removes href="javascript:alert(1)"', () => {
    const input = '<svg><path href="javascript:alert(1)" d="M0 0"/></svg>';
    const result = sanitizeSvg(input);
    expect(result).not.toContain('javascript:');
    expect(result).toContain('d="M0 0"');
  });

  it('removes xlink:href="javascript:..." on use', () => {
    const input = '<svg><use xlink:href="javascript:alert(1)"/></svg>';
    const result = sanitizeSvg(input);
    expect(result).not.toContain('javascript:');
  });

  it('removes entire <use> with external xlink:href', () => {
    const input = '<svg><use xlink:href="https://evil.com/payload.svg#y"/><rect/></svg>';
    const result = sanitizeSvg(input);
    expect(result).not.toContain('<use');
    expect(result).toContain('<rect');
  });

  it('removes entire <use> with external href', () => {
    const input = '<svg><use href="https://evil.com/x.svg#y"/><rect/></svg>';
    const result = sanitizeSvg(input);
    expect(result).not.toContain('<use');
  });

  it('removes <image> with external URL href', () => {
    const input = '<svg><image href="https://external.com/track.png" width="100" height="100"/></svg>';
    const result = sanitizeSvg(input);
    // The element stays but the external href is stripped
    expect(result).not.toContain('https://external.com');
  });

  it('removes <animate> with onbegin', () => {
    const input = '<svg><animate onbegin="alert(1)" attributeName="opacity"/><rect/></svg>';
    const result = sanitizeSvg(input);
    expect(result).not.toContain('<animate');
    expect(result).not.toContain('onbegin');
    expect(result).toContain('<rect');
  });

  it('removes <set> with onend', () => {
    const input = '<svg><set onend="alert(1)" attributeName="opacity"/><rect/></svg>';
    const result = sanitizeSvg(input);
    expect(result).not.toContain('<set');
    expect(result).not.toContain('onend');
    expect(result).toContain('<rect');
  });

  it('removes <base> element', () => {
    const result = sanitizeSvg('<svg><base href="https://evil.com"/><rect/></svg>');
    expect(result).not.toContain('<base');
    expect(result).toContain('<rect');
  });

  it('removes unknown/future elements not in whitelist', () => {
    const result = sanitizeSvg('<svg><customElement data-x="y">test</customElement><rect/></svg>');
    expect(result).not.toContain('customElement');
    expect(result).toContain('<rect');
  });

  it('removes all on* event handlers regardless of name', () => {
    const input = '<svg><rect onload="x" onerror="y" onmouseover="z" onfocus="w" fill="red"/></svg>';
    const result = sanitizeSvg(input);
    expect(result).not.toContain('onload');
    expect(result).not.toContain('onerror');
    expect(result).not.toContain('onmouseover');
    expect(result).not.toContain('onfocus');
    expect(result).toContain('fill="red"');
  });

  // --- Success criteria from the brief ---

  it('success: script removal preserves path', () => {
    const result = sanitizeSvg('<svg><script>alert(1)</script><path d="M0 0"/></svg>');
    expect(result).toContain('<path');
    expect(result).toContain('d="M0 0"');
    expect(result).not.toContain('script');
  });

  it('success: onclick removal preserves path', () => {
    const result = sanitizeSvg('<svg><path onclick="alert(1)" d="M0 0"/></svg>');
    expect(result).toContain('<path');
    expect(result).toContain('d="M0 0"');
    expect(result).not.toContain('onclick');
  });

  it('success: entity-encoded onclick removal preserves path', () => {
    const result = sanitizeSvg('<svg><path on&#99;lick="alert(1)" d="M0 0"/></svg>');
    expect(result).toContain('d="M0 0"');
    expect(result).not.toMatch(/on.*lick/i);
  });

  it('success: local use ref is preserved', () => {
    const result = sanitizeSvg('<svg><use href="#logo"/></svg>');
    expect(result).toContain('<use');
    expect(result).toContain('href="#logo"');
  });

  it('success: external use ref removes entire element', () => {
    const result = sanitizeSvg('<svg><use href="https://evil.com/x.svg#y"/></svg>');
    expect(result).not.toContain('<use');
  });
});

describe('resolveSvg', () => {
  it('returns inline_svg without XML declaration or comments', () => {
    const input = '<?xml version="1.0"?><!-- comment --><svg><rect/></svg>';
    const { inline_svg } = resolveSvg(input);
    expect(inline_svg).not.toContain('<?xml');
    expect(inline_svg).not.toContain('<!--');
    expect(inline_svg).toContain('<svg');
    expect(inline_svg).toContain('<rect');
  });

  it('returns data_uri as base64 data URI', () => {
    const input = '<svg><rect/></svg>';
    const { data_uri } = resolveSvg(input);
    expect(data_uri).toMatch(/^data:image\/svg\+xml;base64,/);
    const decoded = Buffer.from(data_uri.replace('data:image/svg+xml;base64,', ''), 'base64').toString('utf-8');
    expect(decoded).toContain('<svg');
    expect(decoded).toContain('<rect');
  });

  it('handles SVG with leading whitespace/XML declaration', () => {
    const input = '  <?xml version="1.0" encoding="UTF-8"?>\n  <svg viewBox="0 0 100 100"><circle r="50"/></svg>';
    const { inline_svg } = resolveSvg(input);
    expect(inline_svg).toMatch(/^<svg/);
    expect(inline_svg).toContain('<circle');
  });

  it('sanitizes dangerous content before producing output', () => {
    const input = '<svg><script>alert(1)</script><rect fill="red"/></svg>';
    const { inline_svg } = resolveSvg(input);
    expect(inline_svg).not.toContain('script');
    expect(inline_svg).toContain('<rect');
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
