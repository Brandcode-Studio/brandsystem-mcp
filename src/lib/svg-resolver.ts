/**
 * Convert SVG content to inline string + base64 data URI.
 * Used for embedding logos in core-identity.yaml so they work in Chat artifacts.
 */
export function resolveSvg(svgContent: string): {
  inline_svg: string;
  data_uri: string;
} {
  // Clean up the SVG: remove XML declaration, normalize whitespace
  let cleaned = svgContent
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
