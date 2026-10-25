/**
 * Stored-XSS regression suite for brand-report.html.
 *
 * Logo SVG is attacker-controlled (scraped from a site, uploaded, or pulled
 * from Figma), stored in core-identity.yaml, and re-embedded as live markup
 * in the report. The sanitizer works in XML mode but its output is parsed by
 * an HTML parser, where <title>/<desc> are HTML integration points — so
 * CDATA sections, `--!>` comments, and decoded entities used to re-parse as
 * live HTML. These tests drive hostile SVG through sanitizeSvg/resolveSvg and
 * through the full report, then parse the final report with parse5 (cheerio's
 * HTML mode, the same algorithm browsers use) and assert on the DOM a
 * browser would build — not on substrings.
 */
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import { sanitizeSvg, resolveSvg, MAX_SVG_DEPTH } from "../../src/lib/svg-resolver.js";
import {
  generateReportHTML,
  REPORT_SCRIPT,
  REPORT_SCRIPT_CSP_HASH,
} from "../../src/lib/report-html.js";
import type { BrandConfig, CoreIdentity } from "../../src/types/index.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const HTML_NS = "http://www.w3.org/1999/xhtml";

const PAYLOADS: Record<string, string> = {
  cdataInTitle: '<svg><title><![CDATA[</title><img src=x onerror=alert(2)>]]></title></svg>',
  commentBangClose: '<svg><title><!-- --!><img src=x onerror=alert(1)> --></title><path d="M0 0"/></svg>',
  nestedCdata: '<svg><title><![CDATA[<![CDATA[]]><img src=x onerror=alert(3)>]]></title></svg>',
  cdataInDesc: '<svg><desc><![CDATA[</desc><script>alert(4)</script>]]></desc></svg>',
  entityEncodedTag: '<svg><desc>&lt;img src=x onerror=alert(5)&gt;</desc><title>&amp;lt;script&amp;gt;alert(6)&amp;lt;/script&amp;gt;</title></svg>',
  numericEntityTag: '<svg><title>&#60;img src=x onerror=alert(7)&#62;</title></svg>',
  dtdEntity:
    '<!DOCTYPE svg [<!ENTITY x "<img src=x onerror=alert(8)>">]><svg><title>&x;</title></svg>',
  processingInstruction:
    '<?xml-stylesheet href="https://evil.example/x.xsl"?><svg><?php echo 1; ?><rect width="1"/></svg>',
  foreignObject:
    '<svg><foreignObject width="10" height="10"><body xmlns="http://www.w3.org/1999/xhtml"><img src=x onerror=alert(9)><script>alert(10)</script></body></foreignObject><rect width="1"/></svg>',
  xlinkJavascript:
    '<svg xmlns:xlink="http://www.w3.org/1999/xlink"><use xlink:href="javascript:alert(11)"/><a xlink:href="javascript:alert(12)"><text>x</text></a><image xlink:href="javascript:alert(13)"/></svg>',
  styleImport:
    '<svg><style>@import url(https://evil.example/x.css); rect{fill:url(javascript:alert(14))}</style><rect fill="url(javascript:alert(15))" style="fill:url(javascript:alert(16))" width="1"/></svg>',
  mixedCaseHandlers:
    '<svg OnLoad="alert(17)"><rect OnClick="alert(18)" oNmOuSeOvEr="alert(19)" ONFOCUS="alert(20)" width="1"/></svg>',
  animateHref:
    '<svg><a><animate attributeName="href" to="javascript:alert(21)"/><text>x</text></a><animate attributeName="xlink:href" values="javascript:alert(22)"/></svg>',
  setHandler:
    '<svg><rect width="1"><set attributeName="onmouseover" to="alert(23)"/><set attributeName="href" to="javascript:alert(24)"/></rect></svg>',
  xhtmlNamespace: '<svg xmlns="http://www.w3.org/1999/xhtml"><rect width="1"/></svg>',
  attrBreakout: '<svg><rect id="a&quot; onload=&quot;alert(25)" class="x\'><img src=x onerror=alert(26)>" width="1"/></svg>',
  textBreakout: '<svg><text>&lt;/text&gt;&lt;/svg&gt;&lt;img src=x onerror=alert(27)&gt;</text></svg>',
};

function makeConfig(): BrandConfig {
  return {
    schema_version: "0.1.0",
    session: 1,
    client_name: "Acme",
    created_at: "2026-01-01T00:00:00Z",
  };
}

function makeIdentity(inlineSvg: string, dataUri?: string): CoreIdentity {
  return {
    schema_version: "0.1.0",
    colors: [{ name: "Red", value: "#e63946", role: "primary", source: "web", confidence: "high" }],
    typography: [{ name: "Inter", family: "Inter", source: "web", confidence: "high" }],
    logo: [
      {
        type: "wordmark",
        source: "web",
        confidence: "high",
        variants: [{ name: "default", inline_svg: inlineSvg, ...(dataUri ? { data_uri: dataUri } : {}) }],
      },
    ],
    spacing: null,
  };
}

function report(inlineSvg: string, dataUri?: string): string {
  return generateReportHTML({
    config: makeConfig(),
    identity: makeIdentity(inlineSvg, dataUri),
    clarifications: [],
    tokenCount: 1,
    auditSummary: { pass: 1, warn: 0, fail: 0 },
  });
}

type Node = {
  type: string;
  name?: string;
  namespace?: string;
  attribs?: Record<string, string>;
  children?: Node[];
  data?: string;
};

function isElement(n: Node): boolean {
  return n.type === "tag" || n.type === "script" || n.type === "style";
}

/** Iteratively visit every element with a flag for "has an SVG ancestor". */
function walk(root: Node, visit: (el: Node, insideSvg: boolean) => void): void {
  const stack: Array<[Node, boolean]> = [[root, false]];
  while (stack.length > 0) {
    const [node, insideSvg] = stack.pop()!;
    if (isElement(node)) visit(node, insideSvg);
    const childInside = insideSvg || (isElement(node) && node.namespace === SVG_NS);
    for (const child of node.children ?? []) stack.push([child, childInside]);
  }
}

const JS_URL = /^[\s\u0000-\u001f]*j[\s\u0000-\u001f]*a[\s\u0000-\u001f]*v[\s\u0000-\u001f]*a[\s\u0000-\u001f]*s[\s\u0000-\u001f]*c[\s\u0000-\u001f]*r[\s\u0000-\u001f]*i[\s\u0000-\u001f]*p[\s\u0000-\u001f]*t[\s\u0000-\u001f]*:/i;

/** Assert the browser-equivalent DOM of a report is free of script vectors. */
function assertReportDomIsInert(html: string): void {
  const $ = cheerio.load(html); // parse5: the HTML spec tree builder
  const root = $.root()[0] as unknown as Node;
  const scripts: Node[] = [];
  let svgCount = 0;

  walk(root, (el, insideSvg) => {
    if (el.name === "svg") svgCount++;
    if (el.name === "script") scripts.push(el);

    // Nothing inside an <svg> may be an HTML-namespace element: that is
    // exactly how integration-point breakouts surface (title(svg) > img).
    if (insideSvg) {
      expect(el.namespace, `HTML element <${el.name}> inside SVG`).toBe(SVG_NS);
    }
    // Inside SVG only allowlisted tags survive.
    if (insideSvg || el.namespace === SVG_NS) {
      expect(["foreignObject", "animate", "set", "script", "style", "a", "iframe"]).not.toContain(el.name);
      if (el.name === "image") {
        for (const attr of ["href", "xlink:href"]) {
          const href = el.attribs?.[attr];
          if (href !== undefined) expect(href.startsWith("data:image/")).toBe(true);
        }
      }
    }
    for (const [name, value] of Object.entries(el.attribs ?? {})) {
      expect(/^on/i.test(name), `event-handler attribute ${name} on <${el.name}>`).toBe(false);
      expect(JS_URL.test(value), `javascript: URL in ${name} on <${el.name}>`).toBe(false);
      if (/url\s*\(/i.test(value)) {
        expect(/url\s*\(\s*['"]?\s*#/i.test(value), `external url() in ${name}`).toBe(true);
      }
    }
  });

  // Exactly one script: the report's own, byte-identical to REPORT_SCRIPT.
  expect(scripts).toHaveLength(1);
  const scriptText = (scripts[0].children ?? []).map((c) => c.data ?? "").join("");
  expect(scriptText).toBe(REPORT_SCRIPT);
  expect(svgCount).toBeGreaterThan(0);
}

describe("sanitizeSvg drops non-element nodes and escapes output", () => {
  it("keeps the CDATA-in-title payload out of the output entirely", () => {
    const out = resolveSvg(PAYLOADS.cdataInTitle).inline_svg;
    expect(out).not.toContain("CDATA");
    expect(out).not.toContain("onerror");
    expect(out).not.toContain("<img");
  });

  it("keeps the --!> comment payload out of the output entirely", () => {
    const out = sanitizeSvg(PAYLOADS.commentBangClose);
    expect(out).not.toContain("<!--");
    expect(out).not.toContain("onerror");
    expect(out).toContain('<path d="M0 0"/>');
  });

  it("drops processing instructions and doctypes", () => {
    const out = sanitizeSvg(PAYLOADS.processingInstruction);
    expect(out).not.toContain("<?");
    expect(out).not.toContain("evil.example");
    expect(out).toContain("<rect");
    expect(sanitizeSvg(PAYLOADS.dtdEntity)).not.toContain("<!DOCTYPE");
  });

  it("re-escapes decoded entities so text can never become markup", () => {
    const out = sanitizeSvg(PAYLOADS.entityEncodedTag);
    expect(out).not.toMatch(/<img|<script/i);
    expect(out).toContain("&lt;img src=x onerror=alert(5)&gt;");
    expect(sanitizeSvg(PAYLOADS.numericEntityTag)).not.toContain("<img");
    expect(sanitizeSvg(PAYLOADS.textBreakout)).toBe(
      "<svg><text>&lt;/text&gt;&lt;/svg&gt;&lt;img src=x onerror=alert(27)&gt;</text></svg>",
    );
  });

  it("escapes quotes and angle brackets in attribute values", () => {
    const out = sanitizeSvg(PAYLOADS.attrBreakout);
    expect(out).not.toMatch(/<img/);
    expect(out).toContain('id="a&quot; onload=&quot;alert(25)"');
  });

  it("only allows the SVG and XLink namespace declarations", () => {
    expect(sanitizeSvg(PAYLOADS.xhtmlNamespace)).not.toContain("xhtml");
    expect(sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg"/>')).toContain(SVG_NS);
  });

  it("strips animate/set, javascript: hrefs, style, and foreignObject", () => {
    for (const key of ["animateHref", "setHandler", "xlinkJavascript", "styleImport", "foreignObject"]) {
      const out = sanitizeSvg(PAYLOADS[key]);
      expect(out, key).not.toMatch(/<animate|<set|<style|foreignObject|javascript:|@import|<script|<body/i);
    }
  });

  it("removes event handlers regardless of case", () => {
    const out = sanitizeSvg(PAYLOADS.mixedCaseHandlers);
    expect(out).not.toMatch(/\son[a-z]+=/i);
    expect(out).toContain("<rect");
  });

  it("survives deep nesting without a stack overflow and caps output depth", () => {
    // Before: 5k levels threw RangeError; 200k levels spent ~108s parsing
    // first (htmlparser2's O(depth) stack bookkeeping). Now a linear pre-scan
    // truncates past MAX_SVG_DEPTH before parsing.
    for (const depth of [5_000, 50_000, 200_000]) {
      const svg = `<svg>${"<g>".repeat(depth)}<path d="M0 0"/>${"</g>".repeat(depth)}</svg>`;
      const started = performance.now();
      const out = resolveSvg(svg).inline_svg;
      expect(performance.now() - started).toBeLessThan(2_000);
      const kept = (out.match(/<g>/g) ?? []).length;
      expect(kept).toBeLessThan(MAX_SVG_DEPTH);
      expect(out.startsWith("<svg>")).toBe(true);
      // Output stays balanced: every opened <g> is closed.
      expect((out.match(/<\/g>/g) ?? []).length).toBe(kept);
    }
  }, 10_000);
});

describe("brand-report.html is inert for hostile stored SVG (parse5 DOM check)", () => {
  for (const [name, payload] of Object.entries(PAYLOADS)) {
    it(`payload: ${name}`, () => {
      // Store the RAW payload, as an older/compromised core-identity.yaml
      // might; the report must re-sanitize at render time.
      assertReportDomIsInert(report(payload));
      // ...and the resolveSvg-processed form, as current extraction stores.
      assertReportDomIsInert(report(resolveSvg(payload).inline_svg || "<svg/>"));
    });
  }

  it("hostile data URIs only ever appear as escaped text", () => {
    const html = report('<svg><rect width="1"/></svg>', 'javascript:alert(1)//"><img src=x onerror=alert(2)>');
    assertReportDomIsInert(html);
  });
});

describe("report CSP pins the single inline script by hash", () => {
  const html = report('<svg><rect width="1"/></svg>');
  const $ = cheerio.load(html);
  const csp = $('meta[http-equiv="Content-Security-Policy"]').attr("content") ?? "";

  it("does not allow 'unsafe-inline' scripts", () => {
    const scriptSrc = csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("script-src")) ?? "";
    expect(scriptSrc).not.toContain("unsafe-inline");
    expect(scriptSrc).not.toContain("unsafe-hashes");
    expect(scriptSrc).toBe(`script-src ${REPORT_SCRIPT_CSP_HASH}`);
    expect(csp).toContain("default-src 'none'");
  });

  it("the hash matches the script text actually embedded in the report", () => {
    const embedded = $("script").first().text();
    const digest = createHash("sha256").update(embedded, "utf8").digest("base64");
    expect(csp).toContain(`'sha256-${digest}'`);
    expect(embedded).toBe(REPORT_SCRIPT);
  });

  it("copy buttons work without inline handlers (delegated listener)", () => {
    expect(html).not.toMatch(/\son[a-z]+\s*=/i);
    expect($(".copy-btn").length).toBeGreaterThan(5);
    // Every copy button sits inside a .copy-wrap with a <code> to copy.
    $(".copy-btn").each((_, btn) => {
      const wrap = $(btn).closest(".copy-wrap");
      expect(wrap.length).toBe(1);
      expect(wrap.find("code").length).toBeGreaterThan(0);
    });
    expect(REPORT_SCRIPT).toContain("closest('.copy-btn')");
    expect(REPORT_SCRIPT).toContain("navigator.clipboard.writeText");
  });
});

describe("parse5 sanity: the DOM check would catch the original breakout", () => {
  it("flags title(svg) > img(html) when markup is NOT sanitized", () => {
    // The pre-fix serializer output for the CDATA payload.
    const vulnerable = `<!DOCTYPE html><html><body><svg><title><![CDATA[</title><img src=x onerror=alert(2)>]]></title></svg></body></html>`;
    const $ = cheerio.load(vulnerable);
    const img = $("img")[0] as unknown as Node;
    expect(img).toBeDefined();
    expect(img.namespace).toBe(HTML_NS);
    expect($("svg title img").length).toBe(1);
  });
});
