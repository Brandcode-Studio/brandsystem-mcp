import * as cheerio from "cheerio";
import { getVersion } from "./version.js";
import { safeFetch } from "./url-validator.js";
import { loadHtmlBounded } from "./markup-guard.js";

const MAX_LOGO_BYTES = 500_000;

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

// ── Cost bounds (#45) ───────────────────────────────────────────
// isInLogoCloud does a subtree find() per parent level, so its cost is
// O(candidates × subtree). On hostile/huge pages that went superlinear
// (~7.3s at 50k elements). Candidates are capped per selector and globally
// (downstream only ever consumes the top few), and per-parent verdicts are
// cached so candidates sharing a header scan it once.
const MAX_CANDIDATES_PER_SELECTOR = 10;
const MAX_TOTAL_CANDIDATES = 15;
const MAX_HEADER_SVGS_SCANNED = 20;
const MAX_CLOUD_SCAN_NODES = 2000;

/**
 * Count descendant imgs with "logo" in src/data-src, visiting at most
 * MAX_CLOUD_SCAN_NODES nodes. Replaces a subtree find() that cheerio
 * evaluates in seconds on 50k-element bodies; real logo clouds are small
 * containers, so a bounded walk preserves the detection semantics.
 */
function countLogoImgsBounded(node: { children?: unknown[] }): number {
  let count = 0;
  let visited = 0;
  const stack: any[] = [...(node.children ?? [])];
  while (stack.length > 0 && visited < MAX_CLOUD_SCAN_NODES) {
    const cur = stack.pop();
    visited++;
    if (cur?.type !== "tag") continue;
    if (cur.name === "img") {
      const src = String(cur.attribs?.src ?? "");
      const dataSrc = String(cur.attribs?.["data-src"] ?? "");
      if (src.toLowerCase().includes("logo") || dataSrc.toLowerCase().includes("logo")) {
        count++;
        if (count >= 3) return count;
      }
    }
    if (cur.children) stack.push(...cur.children);
  }
  return count;
}

function isInLogoCloud($: cheerio.CheerioAPI, el: any, cache?: Map<unknown, boolean>): boolean {
  // Check parents up to 4 levels
  let current = $(el).parent();
  for (let i = 0; i < 4; i++) {
    if (!current.length) break;
    const node = current[0];
    const cached = cache?.get(node);
    if (cached !== undefined) {
      if (cached) return true;
      current = current.parent();
      continue;
    }
    const cls = current.attr("class") || "";
    const id = current.attr("id") || "";
    let verdict = LOGO_CLOUD_CLASSES.test(cls) || LOGO_CLOUD_CLASSES.test(id);

    // If this parent has 3+ img children with "logo" in src, it's a logo cloud.
    // Never apply this heuristic to body/html: a client-logo section anywhere
    // on the page would otherwise flag the whole document as a cloud and
    // reject the real header logo.
    const tagName = String((node as { name?: string }).name ?? "").toLowerCase();
    if (!verdict && tagName !== "body" && tagName !== "html") {
      verdict = countLogoImgsBounded(node as { children?: unknown[] }) >= 3;
    }
    cache?.set(node, verdict);
    if (verdict) return true;

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

// ── Linear descendant collection ────────────────────────────────
// Descendant selectors like `header svg` make css-select walk every
// candidate's ancestor chain (O(candidates × depth)), which went quadratic
// on deeply nested hostile pages, and each selector rescanned the whole
// document. Instead, ONE iterative document walk indexes the few container
// kinds we care about (header, nav, .logo, ...) plus <meta>/<link>; each rule
// then walks its containers' subtrees once, in document order. A container
// nested inside an already-walked one is skipped, so every element is
// visited at most once per rule.

type DomEl = {
  type: string;
  name?: string;
  attribs?: Record<string, string>;
  children?: DomEl[];
};

function isTagNode(node: DomEl): boolean {
  return node.type === "tag" || node.type === "script" || node.type === "style";
}

type ContainerKind =
  | "header" | "nav" | ".header" | ".navbar" | ".site-header"
  | 'a[href="/"]' | ".logo" | "#logo" | '[class*="site-logo"]';

const HEADER_NAV_KINDS: ContainerKind[] = ["header", "nav", ".header", ".navbar", ".site-header"];

function hasClassToken(el: DomEl, token: string): boolean {
  const cls = el.attribs?.class;
  if (!cls) return false;
  return cls.split(/\s+/).includes(token);
}

/** Every container kind this element matches (same semantics as the CSS selectors). */
function containerKinds(el: DomEl): ContainerKind[] {
  const kinds: ContainerKind[] = [];
  if (el.name === "header") kinds.push("header");
  if (el.name === "nav") kinds.push("nav");
  if (el.attribs?.class) {
    if (hasClassToken(el, "header")) kinds.push(".header");
    if (hasClassToken(el, "navbar")) kinds.push(".navbar");
    if (hasClassToken(el, "site-header")) kinds.push(".site-header");
    if (hasClassToken(el, "logo")) kinds.push(".logo");
    if (el.attribs.class.includes("site-logo")) kinds.push('[class*="site-logo"]');
  }
  if (el.name === "a" && el.attribs?.href === "/") kinds.push('a[href="/"]');
  if (el.attribs?.id === "logo") kinds.push("#logo");
  return kinds;
}

interface PageIndex {
  containers: Map<ContainerKind, DomEl[]>;
  /** Pre-order position of each indexed container. */
  order: Map<DomEl, number>;
  /** <meta> and <link> elements in document order. */
  metaLinks: DomEl[];
}

function indexPage(root: DomEl): PageIndex {
  const containers = new Map<ContainerKind, DomEl[]>();
  const order = new Map<DomEl, number>();
  const metaLinks: DomEl[] = [];
  const stack: DomEl[] = [root];
  let position = 0;
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (isTagNode(node)) {
      position++;
      if (node.name === "meta" || node.name === "link") metaLinks.push(node);
      const kinds = containerKinds(node);
      if (kinds.length > 0) order.set(node, position);
      for (const kind of kinds) {
        let list = containers.get(kind);
        if (!list) containers.set(kind, (list = []));
        list.push(node);
      }
    }
    const children = node.children ?? [];
    for (let k = children.length - 1; k >= 0; k--) stack.push(children[k]);
  }
  return { containers, order, metaLinks };
}

/** Union of several container kinds, deduplicated, in document order. */
function containersOf(index: PageIndex, kinds: ContainerKind[]): DomEl[] {
  if (kinds.length === 1) return index.containers.get(kinds[0]) ?? [];
  const unique = new Set<DomEl>();
  for (const kind of kinds) {
    for (const el of index.containers.get(kind) ?? []) unique.add(el);
  }
  return [...unique].sort((a, b) => index.order.get(a)! - index.order.get(b)!);
}

function collectDescendants(
  containers: DomEl[],
  predicate: (el: DomEl) => boolean,
  limit: number,
): DomEl[] {
  const results: DomEl[] = [];
  const visited = new Set<DomEl>();
  for (const container of containers) {
    if (visited.has(container)) continue;
    const stack: DomEl[] = [];
    const kids = container.children ?? [];
    for (let k = kids.length - 1; k >= 0; k--) stack.push(kids[k]);
    while (stack.length > 0) {
      const node = stack.pop()!;
      if (!isTagNode(node)) continue;
      visited.add(node);
      if (predicate(node)) {
        results.push(node);
        if (results.length >= limit) return results;
      }
      const children = node.children ?? [];
      for (let k = children.length - 1; k >= 0; k--) stack.push(children[k]);
    }
  }
  return results;
}

const attrIncludes = (el: DomEl, attr: string, needle: string, caseInsensitive = false): boolean => {
  const value = el.attribs?.[attr];
  if (value === undefined) return false;
  return caseInsensitive ? value.toLowerCase().includes(needle) : value.includes(needle);
};
const isImg = (el: DomEl) => el.name === "img";
const isSvg = (el: DomEl) => el.name === "svg";

/** Header/nav image candidates, in priority order (was a list of descendant selectors). */
const HEADER_IMG_RULES: Array<[ContainerKind, (el: DomEl) => boolean]> = [
  ["header", (el) => isImg(el) && attrIncludes(el, "src", "logo")],
  ["header", (el) => isImg(el) && attrIncludes(el, "data-src", "logo")],
  ["header", (el) => isImg(el) && attrIncludes(el, "alt", "logo", true)],
  ["nav", (el) => isImg(el) && attrIncludes(el, "src", "logo")],
  ["nav", (el) => isImg(el) && attrIncludes(el, "data-src", "logo")],
  [".header", (el) => isImg(el) && attrIncludes(el, "src", "logo")],
  [".header", (el) => isImg(el) && attrIncludes(el, "data-src", "logo")],
  ['a[href="/"]', isImg],
];

/** Logo-classed containers outside the header, in priority order. */
const LOGO_CLASS_RULES: Array<[ContainerKind, (el: DomEl) => boolean]> = [
  [".logo", isImg],
  ["#logo", isImg],
  ['[class*="site-logo"]', isImg],
  [".logo", isSvg],
  ["#logo", isSvg],
];

/** SVGs with more nodes than this are not plausible logos; skip before serializing. */
const MAX_LOGO_SVG_NODES = 10_000;

function subtreeExceeds(el: DomEl, maxNodes: number): boolean {
  let count = 0;
  const stack: DomEl[] = [el];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (++count > maxNodes) return true;
    const children = node.children ?? [];
    for (let k = 0; k < children.length; k++) stack.push(children[k]);
  }
  return false;
}

export interface LogoExtractionResult {
  logos: ExtractedLogo[];
  /** True when the page exceeded the nesting/element caps and only its prefix was scanned. */
  truncated: boolean;
  truncation_reason?: "depth" | "elements";
}

/**
 * Extract logo candidates from HTML.
 * Returns candidates sorted by confidence (best first).
 * Filters out icons, social media SVGs, and client logo clouds.
 */
export function extractLogos(html: string, baseUrl: string): ExtractedLogo[] {
  return extractLogosWithDiagnostics(html, baseUrl).logos;
}

/**
 * extractLogos plus a truncation report. Untrusted HTML is parsed under
 * nesting-depth and element-count caps (see markup-guard.ts); an over-cap
 * page is cut at the offending tag and its prefix is still scanned, so a
 * hostile page degrades to "fewer candidates" instead of blocking the event
 * loop or overflowing the stack.
 */
export function extractLogosWithDiagnostics(html: string, baseUrl: string): LogoExtractionResult {
  const bounded = loadHtmlBounded(html);
  const $ = bounded.$;
  const logos: ExtractedLogo[] = [];
  const finish = (): LogoExtractionResult => {
    // Deduplicate by URL
    const seen = new Set<string>();
    const unique = logos.filter((l) => {
      if (seen.has(l.url)) return false;
      seen.add(l.url);
      return true;
    });
    return bounded.truncated
      ? { logos: unique, truncated: true, truncation_reason: bounded.reason }
      : { logos: unique, truncated: false };
  };
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
  const cloudCache = new Map<unknown, boolean>();
  const index = indexPage($.root()[0] as unknown as DomEl);
  const metaLinks = $(index.metaLinks as never[]);
  const headerNavSvgs = collectDescendants(
    containersOf(index, HEADER_NAV_KINDS),
    isSvg,
    MAX_HEADER_SVGS_SCANNED,
  );
  for (const node of headerNavSvgs) {
    if (subtreeExceeds(node, MAX_LOGO_SVG_NODES)) continue;
    const el = node as any;
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
  metaLinks.filter('link[rel="icon"][type="image/svg+xml"]').each((_, el) => {
    const url = resolveUrl($(el).attr("href"));
    if (url) logos.push({ url, type: "svg-favicon", confidence: "high" });
  });

  // ── 3. IMG tags in header/nav with logo indicators ────────────
  for (const [container, predicate] of HEADER_IMG_RULES) {
    if (logos.length >= MAX_TOTAL_CANDIDATES) break;
    for (const node of collectDescendants(containersOf(index, [container]), predicate, MAX_CANDIDATES_PER_SELECTOR)) {
      if (logos.length >= MAX_TOTAL_CANDIDATES) break;
      const el = node as any;
      if (isInLogoCloud($, el, cloudCache)) continue;
      // Prefer data-src (lazy-loaded) over src
      const url = resolveUrl($(el).attr("data-src") || $(el).attr("src"));
      if (url) logos.push({ url, type: "selector-img", confidence: "high" });
    }
  }

  // ── 4. Logo-classed elements (outside header) ─────────────────
  for (const [container, predicate] of LOGO_CLASS_RULES) {
    if (logos.length >= MAX_TOTAL_CANDIDATES) break;
    for (const node of collectDescendants(containersOf(index, [container]), predicate, MAX_CANDIDATES_PER_SELECTOR)) {
      if (logos.length >= MAX_TOTAL_CANDIDATES) break;
      const el = node as any;
      if (isInLogoCloud($, el, cloudCache)) continue;

      if (node.name === "svg") {
        if (subtreeExceeds(node, MAX_LOGO_SVG_NODES)) continue;
        if (isIconSvg($, el)) continue;
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
    }
  }

  // ── 5. OG image ───────────────────────────────────────────────
  const ogImage = metaLinks.filter('meta[property="og:image"]').attr("content");
  if (ogImage) {
    const url = resolveUrl(ogImage);
    if (url) logos.push({ url, type: "og-image", confidence: "low" });
  }

  // ── 6. Apple touch icon ───────────────────────────────────────
  metaLinks.filter('link[rel="apple-touch-icon"]').each((_, el) => {
    const url = resolveUrl($(el).attr("href"));
    if (url) logos.push({ url, type: "apple-touch-icon", confidence: "low" });
  });

  // ── 7. Standard favicon ───────────────────────────────────────
  metaLinks.filter('link[rel="icon"], link[rel="shortcut icon"]').each((_, el) => {
    const url = resolveUrl($(el).attr("href"));
    if (url) logos.push({ url, type: "favicon", confidence: "low" });
  });

  return finish();
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
      maxResponseBytes: MAX_LOGO_BYTES,
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
      maxResponseBytes: MAX_LOGO_BYTES,
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
      maxResponseBytes: MAX_LOGO_BYTES,
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
      maxResponseBytes: MAX_LOGO_BYTES,
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
