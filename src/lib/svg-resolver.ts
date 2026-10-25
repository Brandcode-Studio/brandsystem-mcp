import * as cheerio from "cheerio";
import { boundXmlMarkup } from "./markup-guard.js";

// perf: cheerio parse is ~1-5ms for typical logos

const ALLOWED_ELEMENTS = new Set([
  "svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
  "text", "tspan", "textpath", "defs", "clippath", "mask", "image",
  "lineargradient", "radialgradient", "stop", "pattern",
  "symbol", "use", "title", "desc", "metadata",
]);

const ALLOWED_ATTRIBUTES = new Set([
  // Presentation
  "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-opacity",
  "stroke-linecap", "stroke-linejoin", "stroke-dasharray", "stroke-dashoffset",
  "stroke-miterlimit", "opacity", "color", "display", "visibility", "overflow",
  "clip-path", "clip-rule", "mask", "filter", "transform", "transform-origin",
  // Geometry
  "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry",
  "width", "height", "d", "points", "viewbox", "xmlns", "xmlns:xlink",
  "preserveaspectratio", "patternunits", "patterncontentunits",
  "gradientunits", "gradienttransform", "spreadmethod",
  "offset", "stop-color", "stop-opacity", "fx", "fy",
  // Text
  "font-family", "font-size", "font-weight", "font-style",
  "text-anchor", "dominant-baseline", "alignment-baseline",
  "letter-spacing", "word-spacing", "text-decoration", "dx", "dy", "rotate",
  // Structural
  "id", "class", "data-name", "aria-label", "aria-hidden", "role",
]);

/**
 * Maximum element nesting depth kept by sanitizeSvg. Real logos nest a few
 * dozen levels at most; anything deeper is truncated (the subtree is
 * dropped) so neither this walker nor downstream recursive serializers can be
 * driven into a stack overflow by hostile input.
 */
export const MAX_SVG_DEPTH = 256;
/** Maximum number of elements kept by sanitizeSvg; the rest are dropped. */
export const MAX_SVG_ELEMENTS = 50_000;

const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";

/**
 * Escape text content for output that is embedded in HTML *and* parsed as
 * XML (data URIs). `<`, `>` and `&` can never form markup after this.
 */
function escapeSvgText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Escape a double-quoted attribute value for HTML and XML consumers alike. */
function escapeSvgAttr(value: string): string {
  return escapeSvgText(value).replace(/"/g, "&quot;");
}

/**
 * Decide whether an allowlisted attribute survives, returning the value to
 * emit or null to drop it.
 */
function filterAttribute(tagName: string, attrLower: string, value: string): string | null {
  // href / xlink:href — special handling
  if (attrLower === "href" || attrLower === "xlink:href") {
    if (tagName === "image") {
      // <image> allows only embedded raster/vector data URIs (images never
      // execute script, and CSP img-src data: lets them render in the report)
      return value.startsWith("data:image/") ? value : null;
    }
    // All other elements: only local references
    return value.startsWith("#") ? value : null;
  }

  // Drop any attribute not in the allowlist
  if (!ALLOWED_ATTRIBUTES.has(attrLower)) return null;

  // Namespace declarations may only declare the namespaces SVG needs; an
  // xmlns pointing at XHTML would turn data-URI content into HTML elements.
  if (attrLower === "xmlns") return value === SVG_NS ? value : null;
  if (attrLower === "xmlns:xlink") return value === XLINK_NS ? value : null;

  // url(...) values in allowlisted attributes (fill, filter, mask,
  // clip-path, stroke, ...) may reference ONLY local fragments.
  // An external url() survives into brand-report.html as live markup and
  // fires an outbound request when the report is opened — a tracking
  // beacon inside a "portable, self-contained" artifact.
  if (/url\s*\(/i.test(value)) {
    const external = /url\s*\(\s*['"]?\s*(?!#)[^)'"\s]/i.test(value);
    if (external) return null;
  }
  return value;
}

/**
 * Parse SVG/XML with cheerio after a linear pre-scan that truncates input
 * nested deeper than MAX_SVG_DEPTH or larger than MAX_SVG_ELEMENTS.
 * htmlparser2's open-element bookkeeping is O(depth) per tag, so unbounded
 * nesting would make the parse itself quadratic before any walk runs.
 */
function loadSvgBounded(svg: string): cheerio.CheerioAPI {
  const bounded = boundXmlMarkup(svg, { maxDepth: MAX_SVG_DEPTH, maxElements: MAX_SVG_ELEMENTS });
  return cheerio.load(bounded.markup, { xml: true });
}

type SvgNode = {
  type: string;
  name?: string;
  data?: string;
  attribs?: Record<string, string>;
  children?: SvgNode[];
};

function isElementNode(node: SvgNode): boolean {
  // domhandler types elements as "tag", or "script"/"style" by name.
  return node.type === "tag" || node.type === "script" || node.type === "style";
}

/**
 * Strip dangerous content from SVG using a strict allowlist and re-serialize
 * it with a purpose-built serializer whose output is safe to embed in HTML.
 *
 * Only allowlisted elements, allowlisted attributes, and text nodes survive.
 * Every other node type — comments, CDATA sections, processing instructions,
 * doctypes/directives — is dropped entirely: the output is embedded in HTML,
 * where `<title>`/`<desc>` are HTML integration points and a CDATA section
 * or a `--!>`-terminated comment re-parses as live markup. Text and attribute
 * values are re-escaped on output, so decoded entities cannot reassemble tags.
 *
 * The tree walk and serializer are iterative and depth-capped (MAX_SVG_DEPTH,
 * MAX_SVG_ELEMENTS): deeper or excess subtrees are truncated rather than
 * overflowing the stack.
 */
export function sanitizeSvg(svg: string): string {
  const $ = loadSvgBounded(svg);
  const root = $.root()[0] as unknown as SvgNode;

  type Frame = { node: SvgNode; depth: number } | { close: string };
  const out: string[] = [];
  const stack: Frame[] = [];
  const pushChildren = (children: SvgNode[] | undefined, depth: number) => {
    if (!children) return;
    for (let i = children.length - 1; i >= 0; i--) stack.push({ node: children[i], depth });
  };
  pushChildren(root.children, 0);

  let elementCount = 0;
  while (stack.length > 0) {
    const frame = stack.pop()!;
    if ("close" in frame) {
      out.push(`</${frame.close}>`);
      continue;
    }
    const { node, depth } = frame;

    if (node.type === "text") {
      // Text only matters inside an element; stray top-level text is dropped.
      if (depth > 0 && node.data) out.push(escapeSvgText(node.data));
      continue;
    }
    // Comments, CDATA, processing instructions, doctypes: dropped entirely.
    if (!isElementNode(node)) continue;

    const name = node.name ?? "";
    const tagName = name.toLowerCase();
    if (!ALLOWED_ELEMENTS.has(tagName)) continue;
    if (depth >= MAX_SVG_DEPTH || elementCount >= MAX_SVG_ELEMENTS) continue;

    const attribs = node.attribs ?? {};

    // For <use>: if href/xlink:href is not a local reference, remove the entire element
    if (tagName === "use") {
      const href = attribs["href"] ?? attribs["xlink:href"] ?? "";
      if (href && !href.startsWith("#")) continue;
    }

    elementCount++;
    let attrs = "";
    for (const attrName of Object.keys(attribs)) {
      const kept = filterAttribute(tagName, attrName.toLowerCase(), String(attribs[attrName] ?? ""));
      if (kept === null) continue;
      attrs += ` ${attrName}="${escapeSvgAttr(kept)}"`;
    }

    const children = node.children ?? [];
    if (children.length === 0) {
      out.push(`<${name}${attrs}/>`);
      continue;
    }
    out.push(`<${name}${attrs}>`);
    stack.push({ close: name });
    pushChildren(children, depth + 1);
  }

  return out.join("").trim();
}

/**
 * Convert SVG content to inline string + base64 data URI.
 * Used for embedding logos in core-identity.yaml so they work in Chat artifacts.
 */
/**
 * Check if an SVG has gradient stops without stop-color attributes.
 * These render as black rectangles. Returns true if the logo needs review.
 */
export function hasEmptyGradientStops(svgContent: string): boolean {
  const $ = loadSvgBounded(svgContent);
  let hasEmpty = false;
  $("lineargradient stop, radialgradient stop, linearGradient stop, radialGradient stop").each((_i, el) => {
    const stopColor = $(el).attr("stop-color");
    const style = $(el).attr("style") || "";
    // stop-color can be in attribute or inline style
    if (!stopColor && !style.includes("stop-color")) {
      hasEmpty = true;
      return false; // break
    }
  });
  return hasEmpty;
}

/**
 * Fill empty gradient stops with inferred colors.
 *
 * Strategy:
 * 1. If the gradient has some stops WITH colors, interpolate (first stop color
 *    for leading empties, last stop color for trailing empties).
 * 2. If ALL stops are empty, use provided brand colors (primary → secondary).
 * 3. If no brand colors, use black → transparent (visible but clearly wrong,
 *    prompts the user to fix it).
 *
 * Returns the repaired SVG and the number of stops filled.
 */
export function fillEmptyGradientStops(
  svgContent: string,
  brandColors?: { primary?: string; secondary?: string },
): { svg: string; filled: number } {
  const $ = loadSvgBounded(svgContent);
  let filled = 0;

  $("linearGradient, radialGradient, lineargradient, radialgradient").each((_gi, gradient) => {
    const stops = $(gradient).find("stop");
    if (stops.length === 0) return;

    // Collect existing stop colors
    const existing: (string | null)[] = [];
    stops.each((_si, stop) => {
      const color = $(stop).attr("stop-color") || null;
      const style = $(stop).attr("style") || "";
      const styleColor = style.match(/stop-color:\s*([^;]+)/)?.[1]?.trim() || null;
      existing.push(color || styleColor);
    });

    const hasAnyColor = existing.some((c) => c !== null);

    stops.each((si, stop) => {
      if (existing[si] !== null) return; // already has a color

      let inferredColor: string;
      if (hasAnyColor) {
        // Find nearest non-null sibling
        const before = existing.slice(0, si).reverse().find((c) => c !== null);
        const after = existing.slice(si + 1).find((c) => c !== null);
        inferredColor = before || after || "#000000";
      } else {
        // All empty — use brand colors
        const primary = brandColors?.primary || "#000000";
        const secondary = brandColors?.secondary || "transparent";
        inferredColor = si === 0 ? primary : secondary;
      }

      $(stop).attr("stop-color", inferredColor);
      filled++;
    });
  });

  return { svg: $.xml().trim(), filled };
}

export function resolveSvg(
  svgContent: string,
  options?: { brandColors?: { primary?: string; secondary?: string } },
): {
  inline_svg: string;
  data_uri: string;
  needs_review?: boolean;
  review_reason?: string;
  gradient_stops_filled?: number;
} {
  // Sanitize SVG to remove dangerous elements/attributes
  const sanitized = sanitizeSvg(svgContent);

  // Clean up the SVG: remove XML declaration and comments. Comment removal
  // loops to a fixed point so interleaved fragments (`<!<!---->--`) cannot
  // reassemble into a live `<!--` after a single pass (CodeQL
  // js/incomplete-multi-character-sanitization).
  let cleaned = sanitized.replace(/<\?xml[^?]*\?>/g, "");
  let prev: string;
  do {
    prev = cleaned;
    cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, "");
  } while (cleaned !== prev);
  cleaned = cleaned.trim();

  // Ensure it starts with <svg
  if (!cleaned.startsWith("<svg")) {
    const svgStart = cleaned.indexOf("<svg");
    if (svgStart >= 0) {
      cleaned = cleaned.substring(svgStart);
    }
  }

  // Fill empty gradient stops before encoding
  const { svg: repaired, filled } = fillEmptyGradientStops(cleaned, options?.brandColors);
  if (filled > 0) {
    cleaned = repaired;
  }

  const base64 = Buffer.from(cleaned, "utf-8").toString("base64");
  const data_uri = `data:image/svg+xml;base64,${base64}`;

  // Check if there are STILL empty gradient stops after repair (shouldn't happen, but safety check)
  const stillEmpty = hasEmptyGradientStops(cleaned);

  return {
    inline_svg: cleaned,
    data_uri,
    ...(filled > 0 && { gradient_stops_filled: filled }),
    ...(stillEmpty && {
      needs_review: true,
      review_reason: "SVG still has gradient stops without stop-color after auto-fill. Check the original source file.",
    }),
  };
}

/**
 * Convert a PNG/image buffer to a base64 data URI.
 */
export function resolveImage(
  content: Buffer,
  contentType: string
): { data_uri: string } {
  const base64 = content.toString("base64");
  const mimeType = contentType.split(";")[0].trim() || "image/png";
  return { data_uri: `data:${mimeType};base64,${base64}` };
}
