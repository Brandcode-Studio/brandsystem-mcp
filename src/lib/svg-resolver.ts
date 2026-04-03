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
export function resolveSvg(svgContent: string): {
  inline_svg: string;
  data_uri: string;
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

  const base64 = Buffer.from(cleaned, "utf-8").toString("base64");
  const data_uri = `data:image/svg+xml;base64,${base64}`;

  return { inline_svg: cleaned, data_uri };
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
