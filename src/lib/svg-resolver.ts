/**
 * Strip dangerous elements and attributes from SVG to prevent XSS.
 * Removes scripts, event handlers, javascript: URLs, foreignObject, and external references.
 */
export function sanitizeSvg(svg: string): string {
  // Remove <script> tags
  let clean = svg.replace(/<script[\s\S]*?<\/script>/gi, "");
  // Remove event handlers (onclick, onload, onerror, etc.)
  clean = clean.replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, "");
  // Remove javascript: URLs
  clean = clean.replace(/href\s*=\s*["']javascript:[^"']*["']/gi, "");
  clean = clean.replace(/xlink:href\s*=\s*["']javascript:[^"']*["']/gi, "");
  // Remove <foreignObject> (can embed arbitrary HTML)
  clean = clean.replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "");
  // Remove <use> with external references (can fetch arbitrary URLs)
  clean = clean.replace(/<use[^>]*href\s*=\s*["']https?:[^"']*["'][^>]*\/?\s*>/gi, "");
  return clean;
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
