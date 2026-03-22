import * as cheerio from "cheerio";
import { getVersion } from "./version.js";

export interface ExtractedLogo {
  url: string;
  type: "og-image" | "svg-favicon" | "selector-img" | "selector-svg" | "apple-touch-icon" | "favicon";
  confidence: "high" | "medium" | "low";
  /** Full SVG markup for inline SVGs (selector-svg type) */
  inline_svg?: string;
}

/**
 * Extract logo candidates from HTML.
 * Returns candidates sorted by confidence (best first).
 */
export function extractLogos(html: string, baseUrl: string): ExtractedLogo[] {
  const $ = cheerio.load(html);
  const logos: ExtractedLogo[] = [];
  const base = baseUrl.replace(/\/$/, "");

  function resolveUrl(href: string | undefined): string | null {
    if (!href) return null;
    if (href.startsWith("data:")) return null; // skip data URIs for now
    if (href.startsWith("http")) return href;
    if (href.startsWith("//")) return `https:${href}`;
    if (href.startsWith("/")) return `${base}${href}`;
    return `${base}/${href}`;
  }

  // 1. SVG favicon (best for logomark — inline SVG, crisp at any size)
  $('link[rel="icon"][type="image/svg+xml"]').each((_, el) => {
    const url = resolveUrl($(el).attr("href"));
    if (url) logos.push({ url, type: "svg-favicon", confidence: "high" });
  });

  // 2. Common logo selectors — img tags
  const logoSelectors = [
    'header img[src*="logo"]',
    'header img[alt*="logo" i]',
    '.logo img',
    '#logo img',
    '[class*="logo"] img',
    'a[href="/"] img',
    'nav img:first-of-type',
  ];
  for (const sel of logoSelectors) {
    $(sel).each((_, el) => {
      const url = resolveUrl($(el).attr("src"));
      if (url) logos.push({ url, type: "selector-img", confidence: "medium" });
    });
  }

  // 3. Common logo selectors — inline SVGs
  const svgSelectors = [
    'header svg',
    '.logo svg',
    '#logo svg',
    '[class*="logo"] svg',
    'a[href="/"] svg',
    'nav a svg',
  ];
  for (const sel of svgSelectors) {
    $(sel).each((_, el) => {
      const svgHtml = $.html(el);
      if (svgHtml && svgHtml.length > 50 && svgHtml.length < 100_000) {
        logos.push({
          url: `inline:svg:${Buffer.from(svgHtml).toString("base64").substring(0, 40)}`,
          type: "selector-svg",
          confidence: "medium",
          inline_svg: svgHtml,
        });
      }
    });
  }

  // 4. og:image (often the logo or a branded graphic)
  const ogImage = $('meta[property="og:image"]').attr("content");
  if (ogImage) {
    const url = resolveUrl(ogImage);
    if (url) logos.push({ url, type: "og-image", confidence: "low" });
  }

  // 5. Apple touch icon
  $('link[rel="apple-touch-icon"]').each((_, el) => {
    const url = resolveUrl($(el).attr("href"));
    if (url) logos.push({ url, type: "apple-touch-icon", confidence: "low" });
  });

  // 6. Standard favicon
  $('link[rel="icon"], link[rel="shortcut icon"]').each((_, el) => {
    const url = resolveUrl($(el).attr("href"));
    if (url) logos.push({ url, type: "favicon", confidence: "low" });
  });

  // Deduplicate by URL
  const seen = new Set<string>();
  return logos.filter((l) => {
    if (seen.has(l.url)) return false;
    seen.add(l.url);
    return true;
  });
}

/**
 * Fetch a logo URL and return its content.
 * Returns null if fetch fails or content is too large (>500KB).
 */
export async function fetchLogo(
  url: string
): Promise<{ content: Buffer; contentType: string } | null> {
  if (url.startsWith("inline:")) return null;

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      headers: { "User-Agent": `brandsystem-mcp/${getVersion()}` },
    });

    if (!response.ok) return null;

    const contentType = response.headers.get("content-type") || "";
    const buffer = Buffer.from(await response.arrayBuffer());

    if (buffer.length > 500_000) return null; // too large

    return { content: buffer, contentType };
  } catch {
    return null;
  }
}
