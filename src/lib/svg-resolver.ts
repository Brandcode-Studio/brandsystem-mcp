import * as cheerio from "cheerio";

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
 * Strip dangerous elements and attributes from SVG using a Cheerio-based
 * whitelist. Only explicitly allowed elements and attributes survive.
 * This is strictly more secure than the previous regex blocklist approach.
 */
export function sanitizeSvg(svg: string): string {
  const $ = cheerio.load(svg, { xml: true });

  // Walk every element in the tree
  $("*").each((_i, el) => {
    if (el.type !== "tag") return;

    const tagName = el.tagName.toLowerCase();

    // Remove elements not in the whitelist
    if (!ALLOWED_ELEMENTS.has(tagName)) {
      $(el).remove();
      return;
    }

    // For <use>: if href/xlink:href is not a local reference, remove the entire element
    if (tagName === "use") {
      const href = el.attribs["href"] ?? el.attribs["xlink:href"] ?? "";
      if (href && !href.startsWith("#")) {
        $(el).remove();
        return;
      }
    }

    // Filter attributes
    const attribs = el.attribs;
    for (const attrName of Object.keys(attribs)) {
      const attrLower = attrName.toLowerCase();
      const value = attribs[attrName];

      // href / xlink:href — special handling
      if (attrLower === "href" || attrLower === "xlink:href") {
        if (tagName === "image") {
          // <image> allows only embedded data URIs
          if (!value.startsWith("data:image/")) {
            delete attribs[attrName];
          }
        } else {
          // All other elements: only local references
          if (!value.startsWith("#")) {
            delete attribs[attrName];
          }
        }
        continue;
      }

      // Drop any attribute not in the whitelist
      if (!ALLOWED_ATTRIBUTES.has(attrLower)) {
        delete attribs[attrName];
        continue;
      }

      // url(...) values in allowlisted attributes (fill, filter, mask,
      // clip-path, stroke, style, ...) may reference ONLY local fragments.
      // An external url() survives into brand-report.html as live markup and
      // fires an outbound request when the report is opened — a tracking
      // beacon inside a "portable, self-contained" artifact.
      if (/url\s*\(/i.test(value)) {
        const external = /url\s*\(\s*['"]?\s*(?!#)[^)'"\s]/i.test(value);
        if (external) {
          delete attribs[attrName];
        }
      }
    }
  });

  // Extract the SVG element back out. Cheerio wraps in html/body for xml mode,
  // but with xml:true it should preserve the root. Use $.xml() to get full output.
  return $.xml().trim();
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
  const $ = cheerio.load(svgContent, { xml: true });
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
  const $ = cheerio.load(svgContent, { xml: true });
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

  // Clean up the SVG: remove XML declaration, normalize whitespace
  let cleaned = sanitized
    .replace(/<\?xml[^?]*\?>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .trim();

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
