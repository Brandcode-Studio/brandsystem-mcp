import * as cheerio from "cheerio";
import { getVersion } from "./version.js";
import { safeFetch } from "./url-validator.js";

export interface ExtractedLogo {
  url: string;
  type: "og-image" | "svg-favicon" | "selector-img" | "selector-svg" | "apple-touch-icon" | "favicon" | "clearbit" | "common-path";
  confidence: "high" | "medium" | "low";
  /** Full SVG markup for inline SVGs (selector-svg type) */
  inline_svg?: string;
  /** Data URI for raster images (PNG/JPG) */
  data_uri?: string;
}

// ── Icon filtering ──────────────────────────────────────────────
// SVGs that are clearly NOT logos

const ICON_CLASSES = /chevron|arrow|close|hamburger|caret|toggle|spinner|loader|decoration|ornament|pattern/i;
// Separate patterns that are too broad as substrings — require word boundary or standalone class
const ICON_STANDALONE = /\b(icon|menu|search|play|pause)\b/i;
const ICON_DATA_ATTRS = /data-prefix="fa|data-icon|svg-inline--fa/;
const SOCIAL_ICONS = /twitter|instagram|facebook|linkedin|youtube|dribbble|github|tiktok|pinterest|reddit|discord|slack|whatsapp/i;

function isIconSvg($: cheerio.CheerioAPI, el: any): boolean {
  // Override: if this SVG or its parent is explicitly labeled as a logo, it's NOT an icon
  const ariaLabel = $(el).attr("aria-label") || "";
  const parentClass = $(el).parent()?.attr("class") || "";
  const parentHref = $(el).parent()?.attr("href") || "";
  if (/logo|brand|wordmark/i.test(ariaLabel)) return false;
  if (/logo|brand|wordmark/i.test(parentClass) && /home|\/$/i.test(parentHref)) return false;

  const html = $.html(el);
  const outerHtml = html || "";

  // Social media icons (Font Awesome, etc.)
  if (ICON_DATA_ATTRS.test(outerHtml)) return true;
  if (SOCIAL_ICONS.test(outerHtml)) return true;

  // Tiny utility icons (< 24px)
  const width = parseInt($(el).attr("width") || "0", 10);
  const height = parseInt($(el).attr("height") || "0", 10);
  if (width > 0 && width < 24 && height > 0 && height < 24) return true;

  // Icon-named classes (exact patterns that don't substring-match in logo contexts)
  const className = $(el).attr("class") || "";
  if (ICON_CLASSES.test(className)) return true;

  // Check parent class with standalone patterns (avoid "menu" matching "navigation-menu-home-link")
  // Split parent class into individual classes and check each
  const parentClasses = parentClass.split(/\s+/);
  for (const cls of parentClasses) {
    if (ICON_CLASSES.test(cls)) return true;
    // Standalone check: only match if the class IS the word (e.g., "menu" but not "menu-home-link")
    if (ICON_STANDALONE.test(cls) && cls.length < 20) return true;
  }

  return false;
}

// ── Client logo cloud detection ─────────────────────────────────
// Detect when an img is inside a logo cloud/carousel (client logos, not the company logo)

const LOGO_CLOUD_CLASSES = /logo-cloud|logos|clients|partners|carousel|slider|marquee|trust|social-proof|logo-wall|logo-grid|logo-bar|logo-strip|companies|brands|featured-in|as-seen/i;

function isInLogoCloud($: cheerio.CheerioAPI, el: any): boolean {
  // Check parents up to 4 levels
  let current = $(el).parent();
  for (let i = 0; i < 4; i++) {
    if (!current.length) break;
    const cls = current.attr("class") || "";
    const id = current.attr("id") || "";
    if (LOGO_CLOUD_CLASSES.test(cls) || LOGO_CLOUD_CLASSES.test(id)) return true;

    // If this parent has 3+ img children with "logo" in src, it's a logo cloud
    const logoImgs = current.find('img[src*="logo"], img[data-src*="logo"]');
    if (logoImgs.length >= 3) return true;

    current = current.parent();
  }
  return false;
}

// ── Size scoring ────────────────────────────────────────────────

function getSvgWidthScore(el: any, $: cheerio.CheerioAPI): number {
  const width = parseInt($(el).attr("width") || "0", 10);
  const viewBox = $(el).attr("viewBox");
  let vbWidth = 0;
  if (viewBox) {
    const parts = viewBox.split(/\s+/);
    if (parts.length === 4) vbWidth = parseFloat(parts[2]);
  }
  const effectiveWidth = width || vbWidth;
  if (effectiveWidth >= 80) return 3; // Likely a meaningful logo
  if (effectiveWidth >= 50) return 1; // Possible
  return -1; // Too small, probably an icon
}

/**
 * Extract logo candidates from HTML.
 * Returns candidates sorted by confidence (best first).
 * Filters out icons, social media SVGs, and client logo clouds.
 */
export function extractLogos(html: string, baseUrl: string): ExtractedLogo[] {
  const $ = cheerio.load(html);
  const logos: ExtractedLogo[] = [];
  const base = baseUrl.replace(/\/$/, "");

  function resolveUrl(href: string | undefined): string | null {
    if (!href) return null;
    if (href.startsWith("data:")) return null;
    if (href.startsWith("http")) return href;
    if (href.startsWith("//")) return `https:${href}`;
    if (href.startsWith("/")) return `${base}${href}`;
    return `${base}/${href}`;
  }

  // ── 1. Inline SVGs in header/nav (HIGHEST priority) ──────────
  // The first meaningful SVG in header or nav is almost always the company logo
  const headerNavSvgs = $("header svg, nav svg, .header svg, .navbar svg, .site-header svg");
  for (let i = 0; i < headerNavSvgs.length; i++) {
    const el = headerNavSvgs[i];
    if (isIconSvg($, el)) continue;

    const sizeScore = getSvgWidthScore(el, $);
    if (sizeScore < 0) continue; // Too small

    const svgHtml = $.html(el);
    if (!svgHtml || svgHtml.length < 50 || svgHtml.length > 100_000) continue;

    // Check for logo-related class/id on the SVG or its parent
    const cls = $(el).attr("class") || "";
    const parentCls = $(el).parent()?.attr("class") || "";
    const parentId = $(el).parent()?.attr("id") || "";
    const isLogoClassed = /logo|brand|wordmark|site-logo/i.test(cls + parentCls + parentId);

    logos.push({
      url: `inline:svg:${Buffer.from(svgHtml).toString("base64").substring(0, 40)}`,
      type: "selector-svg",
      confidence: isLogoClassed || sizeScore >= 3 ? "high" : "medium",
      inline_svg: svgHtml,
    });

    // Only take the first good header SVG — it's almost always the logo
    break;
  }

  // ── 2. SVG favicon (clean logomark) ───────────────────────────
  $('link[rel="icon"][type="image/svg+xml"]').each((_, el) => {
    const url = resolveUrl($(el).attr("href"));
    if (url) logos.push({ url, type: "svg-favicon", confidence: "high" });
  });

  // ── 3. IMG tags in header/nav with logo indicators ────────────
  const headerImgSelectors = [
    'header img[src*="logo"]',
    'header img[data-src*="logo"]',
    'header img[alt*="logo" i]',
    'nav img[src*="logo"]',
    'nav img[data-src*="logo"]',
    '.header img[src*="logo"]',
    '.header img[data-src*="logo"]',
    'a[href="/"] img',
  ];
  for (const sel of headerImgSelectors) {
    $(sel).each((_, el) => {
      if (isInLogoCloud($, el)) return;
      // Prefer data-src (lazy-loaded) over src
      const url = resolveUrl($(el).attr("data-src") || $(el).attr("src"));
      if (url) logos.push({ url, type: "selector-img", confidence: "high" });
    });
  }

  // ── 4. Logo-classed elements (outside header) ─────────────────
  const logoClassSelectors = [
    '.logo img',
    '#logo img',
    '[class*="site-logo"] img',
    '.logo svg',
    '#logo svg',
  ];
  for (const sel of logoClassSelectors) {
    $(sel).each((_, el) => {
      if (isInLogoCloud($, el)) return;
      const tagName = (el as any).tagName?.toLowerCase();

      if (tagName === "svg") {
        if (isIconSvg($, el)) return;
        const svgHtml = $.html(el);
        if (svgHtml && svgHtml.length > 50 && svgHtml.length < 100_000) {
          logos.push({
            url: `inline:svg:${Buffer.from(svgHtml).toString("base64").substring(0, 40)}`,
            type: "selector-svg",
            confidence: "medium",
            inline_svg: svgHtml,
          });
        }
      } else {
        const url = resolveUrl($(el).attr("data-src") || $(el).attr("src"));
        if (url) logos.push({ url, type: "selector-img", confidence: "medium" });
      }
    });
  }

  // ── 5. OG image ───────────────────────────────────────────────
  const ogImage = $('meta[property="og:image"]').attr("content");
  if (ogImage) {
    const url = resolveUrl(ogImage);
    if (url) logos.push({ url, type: "og-image", confidence: "low" });
  }

  // ── 6. Apple touch icon ───────────────────────────────────────
  $('link[rel="apple-touch-icon"]').each((_, el) => {
    const url = resolveUrl($(el).attr("href"));
    if (url) logos.push({ url, type: "apple-touch-icon", confidence: "low" });
  });

  // ── 7. Standard favicon ───────────────────────────────────────
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
 * Try to find a logo via Clearbit's free Logo API.
 * Returns a high-quality company logo PNG for most domains.
 */
export async function fetchClearbitLogo(domain: string): Promise<ExtractedLogo | null> {
  const cleanDomain = domain.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
  const url = `https://logo.clearbit.com/${cleanDomain}`;

  try {
    const response = await safeFetch(url, {
      signal: AbortSignal.timeout(5000),
      headers: { "User-Agent": `brandsystem-mcp/${getVersion()}` },
    });

    if (!response.ok) return null;

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("image")) return null;

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length < 100) return null; // Too small, probably an error

    // Convert to data URI
    const base64 = buffer.toString("base64");
    const mimeType = contentType.split(";")[0].trim();
    const data_uri = `data:${mimeType};base64,${base64}`;

    return {
      url,
      type: "clearbit",
      confidence: "medium",
      data_uri,
    };
  } catch {
    return null;
  }
}

/**
 * Try common logo file paths on a domain.
 * Many sites have predictable logo locations.
 */
export async function probeCommonLogoPaths(baseUrl: string): Promise<ExtractedLogo | null> {
  const base = baseUrl.replace(/\/$/, "");
  const paths = [
    "/logo.svg",
    "/logo.png",
    "/images/logo.svg",
    "/images/logo.png",
    "/assets/logo.svg",
    "/assets/images/logo.svg",
    "/img/logo.svg",
    "/img/logo.png",
    "/static/logo.svg",
    "/static/logo.png",
  ];

  for (const path of paths) {
    try {
      const url = `${base}${path}`;
      const response = await safeFetch(url, {
        signal: AbortSignal.timeout(3000),
        method: "HEAD",
        headers: { "User-Agent": `brandsystem-mcp/${getVersion()}` },
      });

      if (response.ok) {
        const contentType = response.headers.get("content-type") || "";
        if (contentType.includes("svg") || contentType.includes("image")) {
          return {
            url,
            type: "common-path",
            confidence: "medium",
          };
        }
      }
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * Google's favicon service — GUARANTEED to return something for any domain.
 * Returns a 256x256 favicon. This is the floor — we always get at least this.
 */
export async function fetchGoogleFavicon(domain: string): Promise<ExtractedLogo | null> {
  const cleanDomain = domain.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
  const url = `https://www.google.com/s2/favicons?domain=${cleanDomain}&sz=256`;

  try {
    const response = await safeFetch(url, {
      signal: AbortSignal.timeout(5000),
      headers: { "User-Agent": `brandsystem-mcp/${getVersion()}` },
    });

    if (!response.ok) return null;

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length < 100) return null;

    const contentType = response.headers.get("content-type") || "image/png";
    const base64 = buffer.toString("base64");
    const mimeType = contentType.split(";")[0].trim();

    return {
      url,
      type: "favicon",
      confidence: "low",
      data_uri: `data:${mimeType};base64,${base64}`,
    };
  } catch {
    return null;
  }
}

/**
 * Fetch any logo candidate URL and convert to a data URI.
 * Works for SVG, PNG, JPG, ICO — anything fetchable.
 * Returns both the raw content (for file writing) and a data_uri (for embedding).
 */
export async function fetchAndEncodeLogo(
  url: string
): Promise<{ content: Buffer; contentType: string; data_uri: string } | null> {
  if (url.startsWith("inline:")) return null;

  try {
    const response = await safeFetch(url, {
      signal: AbortSignal.timeout(10000),
      headers: { "User-Agent": `brandsystem-mcp/${getVersion()}` },
    });

    if (!response.ok) return null;

    const contentType = response.headers.get("content-type") || "";
    const buffer = Buffer.from(await response.arrayBuffer());

    if (buffer.length > 500_000) return null;

    const base64 = buffer.toString("base64");
    const mimeType = contentType.split(";")[0].trim() || "image/png";
    const data_uri = `data:${mimeType};base64,${base64}`;

    return { content: buffer, contentType, data_uri };
  } catch {
    return null;
  }
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
    const response = await safeFetch(url, {
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
