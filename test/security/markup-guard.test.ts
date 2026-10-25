/**
 * Resource-exhaustion regression suite for untrusted markup.
 *
 * extractLogos used to cost ~0.1s at 5k nested elements, ~2.6s at 20k and
 * ~8s+ at 40k (parse5 scope checks, ancestor-walking descendant selectors,
 * recursive serialization) while the 5 MB fetch cap admits ~1.7M levels —
 * enough to block the stdio event loop for minutes. The guard bounds parse5's
 * real open-element stack and element count and prunes the tree, so hostile
 * nesting degrades to a truncated prefix in milliseconds.
 *
 * Timing bounds are deliberately generous (the fixed code runs these in
 * single-digit milliseconds; the old code took seconds) so they cannot flake
 * on slow CI runners while still catching a return to superlinear behavior.
 */
import { describe, it, expect } from "vitest";
import {
  loadHtmlBounded,
  boundXmlMarkup,
  MAX_HTML_DEPTH,
  MAX_HTML_ELEMENTS,
} from "../../src/lib/markup-guard.js";
import { extractLogos, extractLogosWithDiagnostics } from "../../src/lib/logo-extractor.js";

const BASE = "https://example.com";

type Node = { type: string; children?: Node[] };

function treeDepth(root: Node): number {
  let max = 0;
  const stack: Array<[Node, number]> = [[root, 0]];
  while (stack.length > 0) {
    const [node, depth] = stack.pop()!;
    const isEl = node.type === "tag" || node.type === "script" || node.type === "style";
    const d = isEl ? depth + 1 : depth;
    if (d > max) max = d;
    for (const child of node.children ?? []) stack.push([child, d]);
  }
  return max;
}

function timed<T>(fn: () => T): { value: T; ms: number } {
  const started = performance.now();
  const value = fn();
  return { value, ms: performance.now() - started };
}

describe("loadHtmlBounded", () => {
  it("leaves normal documents untouched", () => {
    const html = `<html><head><title>x</title></head><body><header><img src="/logo.png"></header><main><p>Hi</p></main></body></html>`;
    const { $, truncated } = loadHtmlBounded(html);
    expect(truncated).toBe(false);
    expect($("header img").attr("src")).toBe("/logo.png");
  });

  it("truncates 40k-deep nesting at the depth cap, quickly", () => {
    const html = `<html><body><header><img src="/logo.png" alt="logo"></header>${"<div>".repeat(40_000)}x${"</div>".repeat(40_000)}</body></html>`;
    const { value, ms } = timed(() => loadHtmlBounded(html));
    expect(value.truncated).toBe(true);
    expect(value.reason).toBe("depth");
    expect(treeDepth(value.$.root()[0] as unknown as Node)).toBeLessThanOrEqual(MAX_HTML_DEPTH);
    // The prefix (with the header logo) is still parsed.
    expect(value.$("header img").attr("src")).toBe("/logo.png");
    expect(ms).toBeLessThan(1_000);
  });

  it("bounds tree depth even where parse5's stack under-reports it (</form> removal)", () => {
    // </form> removes the form from the stack but leaves its children open,
    // so the tree nests deeper than the stack; the post-parse prune catches it.
    const html = '<div x="1"></form><form>'.repeat(20_000);
    const { value, ms } = timed(() => loadHtmlBounded(html));
    expect(treeDepth(value.$.root()[0] as unknown as Node)).toBeLessThanOrEqual(MAX_HTML_DEPTH);
    expect(value.truncated).toBe(true);
    expect(ms).toBeLessThan(1_000);
  });

  it("bounds adoption-agency and formatting-reconstruction nesting", () => {
    for (const unit of ["<b><div></b>", "<em></a><a>", "<svg><span></svg>", "<p><font x=1><menu><desc x=1>"]) {
      const { value, ms } = timed(() => loadHtmlBounded(unit.repeat(20_000)));
      expect(treeDepth(value.$.root()[0] as unknown as Node), unit).toBeLessThanOrEqual(MAX_HTML_DEPTH);
      expect(ms, unit).toBeLessThan(1_000);
    }
  });

  it("caps element count", () => {
    const html = `<header><img src="/logo.png"></header>${"<i></i>".repeat(MAX_HTML_ELEMENTS + 1_000)}`;
    const { value } = timed(() => loadHtmlBounded(html));
    expect(value.truncated).toBe(true);
    expect(value.reason).toBe("elements");
    expect(value.$("*").length).toBeLessThanOrEqual(MAX_HTML_ELEMENTS);
    expect(value.$("header img").length).toBe(1);
  }, 10_000);

  it("never throws for over-cap input", () => {
    expect(() => loadHtmlBounded("<div>".repeat(1_000_000))).not.toThrow();
  }, 10_000);
});

describe("boundXmlMarkup", () => {
  it("passes shallow SVG through unchanged", () => {
    const svg = '<svg><g><path d="M0 0"/></g><!-- c --><![CDATA[x]]></svg>';
    const r = boundXmlMarkup(svg, { maxDepth: 10, maxElements: 100 });
    expect(r.truncated).toBe(false);
    expect(r.markup).toBe(svg);
    expect(r.maxDepthSeen).toBe(2);
  });

  it("cuts before the first start tag past the depth cap", () => {
    const svg = `<svg>${"<g>".repeat(50)}</svg>`;
    const r = boundXmlMarkup(svg, { maxDepth: 10, maxElements: 1_000 });
    expect(r.truncated).toBe(true);
    expect(r.reason).toBe("depth");
    expect(r.markup).toBe(`<svg>${"<g>".repeat(9)}`);
  });

  it("ignores tag-like text inside comments, CDATA, and quoted attributes", () => {
    const svg = `<svg><!-- ${"<g>".repeat(50)} --><![CDATA[${"<g>".repeat(50)}]]><rect data-x="${"<g>".repeat(50)}"/></svg>`;
    const r = boundXmlMarkup(svg, { maxDepth: 5, maxElements: 1_000 });
    expect(r.truncated).toBe(false);
  });

  it("is linear: 1M-deep input is cut in well under a second", () => {
    const svg = `<svg>${"<g>".repeat(1_000_000)}`;
    const { value, ms } = timed(() => boundXmlMarkup(svg, { maxDepth: 256, maxElements: 50_000 }));
    expect(value.truncated).toBe(true);
    expect(ms).toBeLessThan(1_000);
  });
});

describe("extractLogos stays fast on hostile nesting (regression)", () => {
  // Before the fix (dev hardware): nested <g> in a header SVG threw a stack
  // overflow; 40k nested <svg> took ~14s; 40k nested <div> before an SVG ~17s.
  const shapes: Record<string, (d: number) => string> = {
    nestedGInHeaderSvg: (d) => `<html><body><header><svg width="200" viewBox="0 0 200 50">${"<g>".repeat(d)}<path d="M0 0"/>${"</g>".repeat(d)}</svg></header></body></html>`,
    nestedSvg: (d) => `<html><body><header>${'<svg width="200">'.repeat(d)}${"</svg>".repeat(d)}</header></body></html>`,
    nestedDivThenSvg: (d) => `<html><body><header>${"<div>".repeat(d)}<svg width="200"><path d="M0 0 L 10 10 L 20 20 L 30 30 Z"/></svg>${"</div>".repeat(d)}</header></body></html>`,
    nestedGInLogoClass: (d) => `<html><body><div class="logo"><svg width="200">${"<g>".repeat(d)}${"</g>".repeat(d)}</svg></div></body></html>`,
  };

  for (const [name, build] of Object.entries(shapes)) {
    it(`${name} at 40k levels finishes < 1s without throwing`, () => {
      const html = build(40_000);
      const { value, ms } = timed(() => extractLogosWithDiagnostics(html, BASE));
      expect(Array.isArray(value.logos)).toBe(true);
      expect(value.truncated).toBe(true);
      expect(ms).toBeLessThan(1_000);
    });
  }

  it("the header logo before a hostile deep tail is still found", () => {
    const html = `<html><body><header><a href="/"><img src="/logo.png" alt="logo"></a></header>${"<div>".repeat(100_000)}</body></html>`;
    const { value, ms } = timed(() => extractLogos(html, BASE));
    expect(value.some((l) => l.url === `${BASE}/logo.png`)).toBe(true);
    expect(ms).toBeLessThan(1_000);
  });

  it("wide documents at the depth cap stay bounded", () => {
    const html = `<header><img src="/logo.png"></header>${"<div>".repeat(MAX_HTML_DEPTH - 10)}${'<nav><svg width="200"></svg></nav>'.repeat(50_000)}`;
    const { value, ms } = timed(() => extractLogosWithDiagnostics(html, BASE));
    expect(Array.isArray(value.logos)).toBe(true);
    expect(ms).toBeLessThan(3_000);
  }, 10_000);

  it("keeps selector semantics for ordinary pages", () => {
    const html = `<html><head>
      <link rel="icon" type="image/svg+xml" href="/favicon.svg">
      <link rel="apple-touch-icon" href="/apple.png">
      <meta property="og:image" content="/og.png">
    </head><body>
      <nav class="navbar"><a href="/"><svg class="site-logo" width="120" viewBox="0 0 120 40"><path d="M0 0 L120 0 L120 40 Z"/><path d="M10 10 L20 20"/></svg></a></nav>
      <header><img src="/img/logo-dark.png" alt="Acme"></header>
      <div class="logo"><img src="/footer-logo.png"></div>
    </body></html>`;
    const types = extractLogos(html, BASE).map((l) => `${l.type}:${l.url.startsWith("inline:") ? "inline" : l.url}`);
    expect(types).toEqual([
      "selector-svg:inline",
      `svg-favicon:${BASE}/favicon.svg`,
      `selector-img:${BASE}/img/logo-dark.png`,
      `selector-img:${BASE}/footer-logo.png`,
      `og-image:${BASE}/og.png`,
      `apple-touch-icon:${BASE}/apple.png`,
    ]);
  });
});
