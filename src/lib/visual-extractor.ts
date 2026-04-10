/**
 * Visual Extractor — Headless Chrome screenshot + computed style extraction.
 *
 * Uses puppeteer-core with the system Chrome install (no bundled browser).
 * Returns a viewport screenshot (as PNG buffer) plus computed colors, fonts,
 * and CSS custom properties extracted via in-page JavaScript execution.
 *
 * The screenshot is returned to the calling agent as an MCP image content block,
 * enabling multimodal analysis — the agent can visually identify brand personality,
 * layout patterns, and color usage that CSS parsing alone can never capture.
 */

import * as cheerio from "cheerio";
import { existsSync } from "node:fs";
import { platform } from "node:os";
import { safeFetch, readResponseWithLimit, MAX_HTML_BYTES } from "./url-validator.js";
import { getVersion } from "./version.js";

// ── Types ──────────────────────────────────────────────────────────────────

export interface ComputedElement {
  selector: string;
  color: string;
  backgroundColor: string;
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
  lineHeight?: string;
  letterSpacing?: string;
  fontFeatureSettings?: string;
  borderColor: string;
  borderRadius: string;
  boxShadow?: string;
  maxWidth?: string;
  paddingInline?: string;
  paddingBlock?: string;
  textTransform?: string;
  textSample?: string;
  domPath?: string;
  viewport?: "desktop" | "mobile";
  pageUrl?: string;
  pageType?: string;
}

export interface VisualExtraction {
  screenshot: Buffer;
  computedElements: ComputedElement[];
  cssCustomProperties: Record<string, string>;
  pageTitle: string;
  /** Unique colors found across computed elements, as hex values */
  uniqueColors: string[];
  /** Unique font families found across computed elements */
  uniqueFonts: string[];
  /** Whether Chrome was found and extraction succeeded */
  success: true;
}

export interface VisualExtractionError {
  success: false;
  reason: string;
}

export type VisualExtractionResult = VisualExtraction | VisualExtractionError;

export interface SitePageCandidate {
  url: string;
  pageType: string;
  selectionReason: string;
  priority: number;
}

export interface SiteViewportExtraction {
  viewport: "desktop" | "mobile";
  screenshot: Buffer;
  computedElements: ComputedElement[];
  cssCustomProperties: Record<string, string>;
  uniqueColors: string[];
  uniqueFonts: string[];
  roleCandidates: VisualColorCandidate[];
}

export interface SitePageExtraction {
  url: string;
  pageType: string;
  selectionReason: string;
  priority: number;
  title: string;
  viewports: SiteViewportExtraction[];
}

export interface SiteExtractionResultSuccess {
  success: true;
  sourceUrl: string;
  discoveredPages: number;
  selectedPages: SitePageExtraction[];
}

export interface SiteExtractionResultError {
  success: false;
  reason: string;
}

export type SiteExtractionResult = SiteExtractionResultSuccess | SiteExtractionResultError;

// ── Chrome finder ──────────────────────────────────────────────────────────

const CHROME_PATHS: Record<string, string[]> = {
  darwin: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  ],
  linux: [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "/snap/bin/chromium",
  ],
  win32: [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    `${process.env.LOCALAPPDATA ?? ""}\\Google\\Chrome\\Application\\chrome.exe`,
  ],
};

export function findChrome(): string | null {
  const paths = CHROME_PATHS[platform()] ?? [];
  for (const p of paths) {
    if (p && existsSync(p)) return p;
  }
  return null;
}

/** Check if visual extraction is available on this system */
export function isVisualExtractionAvailable(): boolean {
  return findChrome() !== null;
}

const ELEMENT_SELECTOR_DEFS = [
  { name: "body", sel: "body", max: 1 },
  { name: "header", sel: "header, nav, [role=banner]", max: 2 },
  { name: "hero_heading", sel: "h1", max: 2 },
  { name: "hero_subheading", sel: "h2", max: 3 },
  { name: "hero_section", sel: "[class*=hero], main > section:first-child, main > div:first-child", max: 2 },
  { name: "primary_button", sel: "button, [class*=btn], [class*=cta], a[class*=button]", max: 5 },
  { name: "link", sel: "a:not([class*=btn]):not([class*=button])", max: 6 },
  { name: "paragraph", sel: "p", max: 6 },
  { name: "footer", sel: "footer, [role=contentinfo]", max: 1 },
  { name: "card", sel: "[class*=card], article", max: 10 },
  { name: "input", sel: "input, textarea, select", max: 5 },
  { name: "section_alt", sel: "main > section:nth-child(2), main > div:nth-child(2)", max: 2 },
  { name: "badge", sel: "[class*=badge], [class*=chip], [class*=tag]", max: 6 },
  { name: "code", sel: "pre, code", max: 4 },
  { name: "table", sel: "table", max: 2 },
] as const;

const VIEWPORTS = {
  desktop: { width: 1440, height: 960, deviceScaleFactor: 2 },
  mobile: { width: 390, height: 844, deviceScaleFactor: 3 },
} as const;

function normalizeSiteUrl(candidate: string, baseUrl: string): string | null {
  try {
    const url = new URL(candidate, baseUrl);
    const base = new URL(baseUrl);
    if (url.origin !== base.origin) return null;
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (/^(mailto|tel|javascript):/i.test(candidate)) return null;
    if (/\.(png|jpe?g|gif|svg|webp|ico|pdf|zip)$/i.test(url.pathname)) return null;
    url.hash = "";
    if (url.pathname !== "/" && url.pathname.endsWith("/")) {
      url.pathname = url.pathname.slice(0, -1);
    }
    return url.toString();
  } catch {
    return null;
  }
}

export function classifyPageType(url: string): string {
  const pathname = new URL(url).pathname.toLowerCase();
  if (pathname === "/" || pathname === "") return "home";
  if (/(pricing|plan|product|platform|feature|solution|customer|enterprise|demo)/.test(pathname)) return "marketing";
  if (/(docs|doc|blog|resource|guide|learn|help|support|developer)/.test(pathname)) return "content";
  if (/(about|company|team|career|contact)/.test(pathname)) return "company";
  if (/(login|log-in|signin|sign-in|app|dashboard|account|workspace|start)/.test(pathname)) return "app";
  if (/(legal|privacy|terms|security|status)/.test(pathname)) return "utility";
  return "generic";
}

function scorePage(url: string): number {
  const pathname = new URL(url).pathname.toLowerCase();
  if (pathname === "/" || pathname === "") return 100;
  if (/(pricing|plan|product|platform|feature|solution|customer|enterprise|demo)/.test(pathname)) return 90;
  if (/(docs|doc|blog|resource|guide|learn|help|support|developer)/.test(pathname)) return 80;
  if (/(about|company|team|career|contact)/.test(pathname)) return 70;
  if (/(login|log-in|signin|sign-in|app|dashboard|account|workspace|start)/.test(pathname)) return 60;
  if (pathname.split("/").filter(Boolean).length <= 1) return 40;
  return 20;
}

export function selectRepresentativePages(
  sourceUrl: string,
  discoveredUrls: string[],
  pageLimit = 5,
): SitePageCandidate[] {
  const normalizedBase = normalizeSiteUrl(sourceUrl, sourceUrl) ?? sourceUrl;
  const deduped = new Map<string, string>();
  deduped.set(normalizedBase, normalizedBase);
  for (const url of discoveredUrls) {
    const normalized = normalizeSiteUrl(url, sourceUrl);
    if (normalized) deduped.set(normalized, normalized);
  }

  const ranked = [...deduped.values()]
    .map((url) => ({
      url,
      pageType: classifyPageType(url),
      priority: scorePage(url),
    }))
    .sort((a, b) => b.priority - a.priority || a.url.length - b.url.length);

  const selected: SitePageCandidate[] = [];
  const selectedTypes = new Set<string>();

  const home = ranked.find((item) => item.pageType === "home") ?? ranked[0];
  if (home) {
    selected.push({
      url: home.url,
      pageType: home.pageType,
      selectionReason: "homepage baseline",
      priority: home.priority,
    });
    selectedTypes.add(home.pageType);
  }

  for (const preferredType of ["marketing", "content", "company", "app", "utility", "generic"]) {
    if (selected.length >= pageLimit) break;
    const candidate = ranked.find((item) => item.pageType === preferredType && !selected.some((page) => page.url === item.url));
    if (!candidate) continue;
    selected.push({
      url: candidate.url,
      pageType: candidate.pageType,
      selectionReason: `representative ${candidate.pageType} page`,
      priority: candidate.priority,
    });
    selectedTypes.add(candidate.pageType);
  }

  for (const candidate of ranked) {
    if (selected.length >= pageLimit) break;
    if (selected.some((page) => page.url === candidate.url)) continue;
    selected.push({
      url: candidate.url,
      pageType: candidate.pageType,
      selectionReason: `high-signal ${candidate.pageType} fallback`,
      priority: candidate.priority,
    });
  }

  return selected.slice(0, pageLimit);
}

async function discoverSitePages(sourceUrl: string, pageLimit = 5, discoveryLimit = 40): Promise<{
  discoveredUrls: string[];
  selectedPages: SitePageCandidate[];
}> {
  const discovered = new Set<string>();
  const normalizedBase = normalizeSiteUrl(sourceUrl, sourceUrl) ?? sourceUrl;
  discovered.add(normalizedBase);

  const collectFromHtml = async (url: string) => {
    const response = await safeFetch(url, {
      signal: AbortSignal.timeout(12000),
      headers: { "User-Agent": `brandsystem-mcp/${getVersion()}` },
    });
    if (!response.ok) return;
    const html = await readResponseWithLimit(response, MAX_HTML_BYTES);
    const $ = cheerio.load(html);
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href");
      if (!href || discovered.size >= discoveryLimit) return;
      const normalized = normalizeSiteUrl(href, url);
      if (normalized) discovered.add(normalized);
    });
  };

  try {
    await collectFromHtml(normalizedBase);
  } catch {
    // keep the base URL even if discovery fetch fails
  }

  try {
    const sitemapUrl = new URL("/sitemap.xml", normalizedBase).toString();
    const response = await safeFetch(sitemapUrl, {
      signal: AbortSignal.timeout(8000),
      headers: { "User-Agent": `brandsystem-mcp/${getVersion()}` },
    });
    if (response.ok) {
      const xml = await readResponseWithLimit(response, MAX_HTML_BYTES);
      const matches = xml.matchAll(/<loc>(.*?)<\/loc>/gi);
      for (const match of matches) {
        if (discovered.size >= discoveryLimit) break;
        const normalized = normalizeSiteUrl(match[1], normalizedBase);
        if (normalized) discovered.add(normalized);
      }
    }
  } catch {
    // sitemap discovery is optional
  }

  const discoveredUrls = [...discovered];
  return {
    discoveredUrls,
    selectedPages: selectRepresentativePages(normalizedBase, discoveredUrls, pageLimit),
  };
}

// ── In-page extraction script ──────────────────────────────────────────────

/**
 * This function runs inside the browser page context via page.evaluate().
 * It extracts computed styles from semantic elements and all CSS custom properties.
 */
function extractionScript(
  selectors: Array<{ name: string; sel: string; max: number }>,
): {
  elements: Array<{
    selector: string;
    color: string;
    backgroundColor: string;
    fontFamily: string;
    fontSize: string;
    fontWeight: string;
    lineHeight: string;
    letterSpacing: string;
    fontFeatureSettings: string;
    borderColor: string;
    borderRadius: string;
    boxShadow: string;
    maxWidth: string;
    paddingInline: string;
    paddingBlock: string;
    textTransform: string;
    textSample?: string;
    domPath?: string;
  }>;
  cssVars: Record<string, string>;
  title: string;
} {
  function buildDomPath(el: Element): string {
    const parts: string[] = [];
    let current: Element | null = el;
    while (current && parts.length < 4) {
      const tag = current.tagName.toLowerCase();
      const id = current.id ? `#${current.id}` : "";
      const classes = current.classList.length > 0
        ? `.${[...current.classList].slice(0, 2).join(".")}`
        : "";
      parts.unshift(`${tag}${id}${classes}`);
      current = current.parentElement;
    }
    return parts.join(" > ");
  }

  const elements: Array<{
    selector: string;
    color: string;
    backgroundColor: string;
    fontFamily: string;
    fontSize: string;
    fontWeight: string;
    lineHeight: string;
    letterSpacing: string;
    fontFeatureSettings: string;
    borderColor: string;
    borderRadius: string;
    boxShadow: string;
    maxWidth: string;
    paddingInline: string;
    paddingBlock: string;
    textTransform: string;
    textSample?: string;
    domPath?: string;
  }> = [];

  for (const { name, sel, max } of selectors) {
    const matches = [...document.querySelectorAll(sel)].slice(0, max);
    for (const el of matches) {
      const cs = getComputedStyle(el);
      const textSample = (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 80);
      elements.push({
        selector: name,
        color: cs.color,
        backgroundColor: cs.backgroundColor,
        fontFamily: cs.fontFamily,
        fontSize: cs.fontSize,
        fontWeight: cs.fontWeight,
        lineHeight: cs.lineHeight,
        letterSpacing: cs.letterSpacing,
        fontFeatureSettings: cs.fontFeatureSettings,
        borderColor: cs.borderColor,
        borderRadius: cs.borderRadius,
        boxShadow: cs.boxShadow,
        maxWidth: cs.maxWidth,
        paddingInline: cs.paddingInline,
        paddingBlock: cs.paddingBlock,
        textTransform: cs.textTransform,
        textSample: textSample || undefined,
        domPath: buildDomPath(el),
      });
    }
  }

  // Extract all CSS custom properties from :root
  const rootStyles = getComputedStyle(document.documentElement);
  const cssVars: Record<string, string> = {};
  for (let i = 0; i < rootStyles.length; i++) {
    const prop = rootStyles[i];
    if (prop.startsWith("--")) {
      const val = rootStyles.getPropertyValue(prop).trim();
      if (val) cssVars[prop] = val;
    }
  }

  return {
    elements,
    cssVars,
    title: document.title,
  };
}

// ── Color normalization ────────────────────────────────────────────────────

/** Convert computed rgb(r, g, b) values to hex */
function rgbToHex(rgb: string): string | null {
  const match = rgb.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (!match) return null;
  const r = parseInt(match[1], 10);
  const g = parseInt(match[2], 10);
  const b = parseInt(match[3], 10);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

/** Check if a color is transparent/empty */
function isTransparent(rgb: string): boolean {
  return rgb === "rgba(0, 0, 0, 0)" || rgb === "transparent";
}

/** Check if a color is near-white or near-black (low signal for brand extraction) */
function isNeutral(hex: string): boolean {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.93 || luminance < 0.07;
}

// ── Main extraction function ───────────────────────────────────────────────

export async function extractVisual(url: string): Promise<VisualExtractionResult> {
  const chromePath = findChrome();
  if (!chromePath) {
    return {
      success: false,
      reason: "No Chrome/Chromium installation found. Visual extraction requires a Chromium-based browser.",
    };
  }

  let browser;
  try {
    // Dynamic import to keep puppeteer-core optional at the module level
    const puppeteer = await import("puppeteer-core");
    browser = await puppeteer.default.launch({
      executablePath: chromePath,
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-extensions",
        "--window-size=1280,800",
      ],
      timeout: 20000,
    });

    const page = await browser.newPage();
    // 2x DPR for sharp text — critical for vision model analysis
    await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 });

    // Block heavy resources to speed up loading
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const type = req.resourceType();
      if (type === "media" || type === "websocket") {
        req.abort();
      } else {
        req.continue();
      }
    });

    await page.goto(url, {
      waitUntil: "networkidle2",
      timeout: 25000,
    });

    // Small delay for JS-rendered content to settle
    await new Promise((r) => setTimeout(r, 1500));

    // Take viewport screenshot at 2x DPR (2560x1600 actual pixels)
    const screenshot = await page.screenshot({
      type: "png",
      clip: { x: 0, y: 0, width: 1280, height: 800 },
    }) as Buffer;

    // Extract computed styles via in-page JS
    const extracted = await page.evaluate(
      extractionScript,
      ELEMENT_SELECTOR_DEFS.map((def) => ({ ...def, max: 1 })),
    );

    await browser.close();
    browser = null;

    // Process results
    const colorSet = new Set<string>();
    const fontSet = new Set<string>();

    const computedElements: ComputedElement[] = extracted.elements.map((el) => {
      // Collect unique colors
      if (!isTransparent(el.color)) {
        const hex = rgbToHex(el.color);
        if (hex) colorSet.add(hex);
      }
      if (!isTransparent(el.backgroundColor)) {
        const hex = rgbToHex(el.backgroundColor);
        if (hex) colorSet.add(hex);
      }

      // Collect unique fonts (clean up computed font-family strings)
      const primaryFont = el.fontFamily
        .split(",")[0]
        .trim()
        .replace(/^["']|["']$/g, "");
      if (primaryFont && primaryFont !== "serif" && primaryFont !== "sans-serif" && primaryFont !== "monospace") {
        fontSet.add(primaryFont);
      }

      return {
        selector: el.selector,
        color: rgbToHex(el.color) ?? el.color,
        backgroundColor: isTransparent(el.backgroundColor) ? "transparent" : (rgbToHex(el.backgroundColor) ?? el.backgroundColor),
        fontFamily: primaryFont,
        fontSize: el.fontSize,
        fontWeight: el.fontWeight,
        lineHeight: el.lineHeight,
        letterSpacing: el.letterSpacing,
        fontFeatureSettings: el.fontFeatureSettings,
        borderColor: isTransparent(el.borderColor) ? "transparent" : (rgbToHex(el.borderColor) ?? el.borderColor),
        borderRadius: el.borderRadius,
        boxShadow: el.boxShadow,
        maxWidth: el.maxWidth,
        paddingInline: el.paddingInline,
        paddingBlock: el.paddingBlock,
        textTransform: el.textTransform,
        textSample: el.textSample,
        domPath: el.domPath,
      };
    });

    // Keep all CSS custom properties for later synthesis, but only add
    // color-like values into the unique color set.
    const cssCustomProperties: Record<string, string> = { ...extracted.cssVars };
    for (const [prop, val] of Object.entries(extracted.cssVars)) {
      const hex = rgbToHex(val);
      if (hex) {
        colorSet.add(hex);
      } else if (/^#[0-9a-f]{3,8}$/i.test(val)) {
        colorSet.add(val.toLowerCase());
      }
    }

    return {
      success: true,
      screenshot,
      computedElements,
      cssCustomProperties,
      pageTitle: extracted.title,
      uniqueColors: [...colorSet],
      uniqueFonts: [...fontSet],
    };
  } catch (err) {
    if (browser) {
      try { await browser.close(); } catch { /* ignore close errors */ }
    }
    return {
      success: false,
      reason: `Visual extraction failed: ${(err as Error).message}`,
    };
  }
}

export async function extractSite(
  sourceUrl: string,
  options: {
    pageLimit?: number;
    viewports?: Array<"desktop" | "mobile">;
  } = {},
): Promise<SiteExtractionResult> {
  const chromePath = findChrome();
  if (!chromePath) {
    return {
      success: false,
      reason: "No Chrome/Chromium installation found. Site extraction requires a Chromium-based browser.",
    };
  }

  const pageLimit = Math.max(1, Math.min(options.pageLimit ?? 5, 5));
  const viewports: Array<keyof typeof VIEWPORTS> = options.viewports && options.viewports.length > 0
    ? options.viewports
    : ["desktop", "mobile"];

  const discovery = await discoverSitePages(sourceUrl, pageLimit);
  if (discovery.selectedPages.length === 0) {
    return {
      success: false,
      reason: "No crawlable pages were discovered for this site.",
    };
  }

  let browser;
  try {
    const puppeteer = await import("puppeteer-core");
    browser = await puppeteer.default.launch({
      executablePath: chromePath,
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-extensions",
      ],
      timeout: 20000,
    });

    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const type = req.resourceType();
      if (type === "media" || type === "websocket") req.abort();
      else req.continue();
    });

    const selectedPages: SitePageExtraction[] = [];

    for (const selectedPage of discovery.selectedPages) {
      try {
        const extractedViewports: SiteViewportExtraction[] = [];
        let pageTitle = "";

        for (const viewportName of viewports) {
          const viewport = VIEWPORTS[viewportName];
          await page.setViewport(viewport);
          await page.goto(selectedPage.url, {
            waitUntil: "networkidle2",
            timeout: 25000,
          });
          await new Promise((resolve) => setTimeout(resolve, 1200));

          const screenshot = await page.screenshot({
            type: "png",
            clip: { x: 0, y: 0, width: viewport.width, height: viewport.height },
          }) as Buffer;

          const extracted = await page.evaluate(extractionScript, [...ELEMENT_SELECTOR_DEFS]);
          pageTitle = pageTitle || extracted.title;

          const colorSet = new Set<string>();
          const fontSet = new Set<string>();

          const computedElements: ComputedElement[] = extracted.elements.map((el) => {
            if (!isTransparent(el.color)) {
              const hex = rgbToHex(el.color);
              if (hex) colorSet.add(hex);
            }
            if (!isTransparent(el.backgroundColor)) {
              const hex = rgbToHex(el.backgroundColor);
              if (hex) colorSet.add(hex);
            }

            const primaryFont = el.fontFamily
              .split(",")[0]
              .trim()
              .replace(/^["']|["']$/g, "");

            if (
              primaryFont &&
              primaryFont !== "serif" &&
              primaryFont !== "sans-serif" &&
              primaryFont !== "monospace"
            ) {
              fontSet.add(primaryFont);
            }

            return {
              selector: el.selector,
              color: rgbToHex(el.color) ?? el.color,
              backgroundColor: isTransparent(el.backgroundColor) ? "transparent" : (rgbToHex(el.backgroundColor) ?? el.backgroundColor),
              fontFamily: primaryFont,
              fontSize: el.fontSize,
              fontWeight: el.fontWeight,
              lineHeight: el.lineHeight,
              letterSpacing: el.letterSpacing,
              fontFeatureSettings: el.fontFeatureSettings,
              borderColor: isTransparent(el.borderColor) ? "transparent" : (rgbToHex(el.borderColor) ?? el.borderColor),
              borderRadius: el.borderRadius,
              boxShadow: el.boxShadow,
              maxWidth: el.maxWidth,
              paddingInline: el.paddingInline,
              paddingBlock: el.paddingBlock,
              textTransform: el.textTransform,
              textSample: el.textSample,
              domPath: el.domPath,
              viewport: viewportName,
              pageUrl: selectedPage.url,
              pageType: selectedPage.pageType,
            };
          });

          const cssCustomProperties: Record<string, string> = { ...extracted.cssVars };
          for (const [prop, val] of Object.entries(extracted.cssVars)) {
            const hex = rgbToHex(val);
            if (hex) {
              colorSet.add(hex);
            } else if (/^#[0-9a-f]{3,8}$/i.test(val)) {
              colorSet.add(val.toLowerCase());
            }
          }

          extractedViewports.push({
            viewport: viewportName,
            screenshot,
            computedElements,
            cssCustomProperties,
            uniqueColors: [...colorSet],
            uniqueFonts: [...fontSet],
            roleCandidates: inferRolesFromVisual(computedElements, cssCustomProperties),
          });
        }

        selectedPages.push({
          url: selectedPage.url,
          pageType: selectedPage.pageType,
          selectionReason: selectedPage.selectionReason,
          priority: selectedPage.priority,
          title: pageTitle,
          viewports: extractedViewports,
        });
      } catch {
        // Skip pages that fail to render and keep the rest of the evidence bundle
      }
    }

    await browser.close();
    browser = null;

    if (selectedPages.length === 0) {
      return {
        success: false,
        reason: "Site extraction could not render any representative pages.",
      };
    }

    return {
      success: true,
      sourceUrl,
      discoveredPages: discovery.discoveredUrls.length,
      selectedPages,
    };
  } catch (err) {
    if (browser) {
      try { await browser.close(); } catch { /* ignore close errors */ }
    }
    return {
      success: false,
      reason: `Site extraction failed: ${(err as Error).message}`,
    };
  }
}

// ── Color role inference from visual context ───────────────────────────────

export type VisualColorRole = "primary" | "secondary" | "accent" | "surface" | "text" | "unknown";

export interface VisualColorCandidate {
  hex: string;
  role: VisualColorRole;
  confidence: "high" | "medium" | "low";
  source_context: string;
}

/**
 * Infer color roles from computed element context AND CSS custom properties.
 *
 * Element-based inference:
 * - button/CTA background → primary candidate
 * - body background → surface
 * - body text color → text
 * - link color → accent/secondary
 *
 * CSS custom property inference:
 * - `--color-primary`, `--brand-*` → primary
 * - `--color-highlight`, `--color-accent` → accent
 * - Named hues (`--color-blue`, `--color-purple`) → unknown (but included)
 */
export function inferRolesFromVisual(
  elements: ComputedElement[],
  cssCustomProperties?: Record<string, string>,
): VisualColorCandidate[] {
  const candidates: VisualColorCandidate[] = [];
  const seen = new Set<string>();

  function add(hex: string, role: VisualColorRole, confidence: "high" | "medium" | "low", context: string, forceAdd = false) {
    const key = `${hex}:${role}`;
    if (seen.has(key) || hex === "transparent") return;
    if (!forceAdd && isNeutral(hex) && role !== "surface" && role !== "text") return;
    seen.add(key);
    candidates.push({ hex, role, confidence, source_context: context });
  }

  // Detect body surface to understand light/dark context
  const bodyBg = elements.find((e) => e.selector === "body")?.backgroundColor;
  const isDarkSurface = bodyBg ? isNeutral(bodyBg) && getLuminance(bodyBg) < 0.5 : false;

  for (const el of elements) {
    switch (el.selector) {
      case "body":
        if (el.backgroundColor !== "transparent") {
          add(el.backgroundColor, "surface", "high", "body background-color");
        }
        add(el.color, "text", "high", "body text color");
        break;

      case "primary_button":
        if (el.backgroundColor !== "transparent") {
          // On light sites, a dark button IS the primary even though it's "neutral"
          // On dark sites, a light button IS the primary even though it's "neutral"
          const btnIsChromatic = !isNeutral(el.backgroundColor);
          const btnContrastsSurface = bodyBg && el.backgroundColor !== bodyBg;
          if (btnIsChromatic) {
            add(el.backgroundColor, "primary", "high", "button/CTA background");
          } else if (btnContrastsSurface) {
            // Dark button on light bg or light button on dark bg — still primary
            // forceAdd=true: neutral colors that contrast surface ARE intentional brand choices
            add(el.backgroundColor, "primary", "medium", "button/CTA background (contrasts surface)", true);
          }
          // Also check button text color for chromatic accent
          if (!isNeutral(el.color) && el.color !== "transparent") {
            add(el.color, "accent", "low", "button/CTA text color");
          }
        } else if (el.color !== "transparent" && !isNeutral(el.color)) {
          add(el.color, "primary", "medium", "button/CTA text color");
        }
        break;

      case "link":
        if (!isNeutral(el.color)) {
          add(el.color, "accent", "medium", "link text color");
        }
        break;

      case "header":
        if (el.backgroundColor !== "transparent") {
          if (isNeutral(el.backgroundColor)) {
            add(el.backgroundColor, "surface", "medium", "header background");
          } else {
            add(el.backgroundColor, "primary", "medium", "header background (chromatic)");
          }
        }
        break;

      case "hero_heading":
        add(el.color, "text", "medium", "h1 text color");
        break;

      case "hero_section":
        if (el.backgroundColor !== "transparent" && !isNeutral(el.backgroundColor)) {
          add(el.backgroundColor, "accent", "low", "hero section background");
        }
        break;

      case "footer":
        if (el.backgroundColor !== "transparent") {
          add(el.backgroundColor, "surface", "low", "footer background");
        }
        break;

      case "card":
        if (el.backgroundColor !== "transparent") {
          add(el.backgroundColor, "surface", "low", "card background");
        }
        break;

      case "section_alt":
        if (el.backgroundColor !== "transparent" && !isNeutral(el.backgroundColor)) {
          add(el.backgroundColor, "secondary", "low", "alternate section background");
        }
        break;
    }
  }

  // Infer roles from CSS custom property names
  if (cssCustomProperties) {
    const PRIMARY_PATTERNS = /primary|brand|main/i;
    const ACCENT_PATTERNS = /accent|highlight|focus|active/i;
    const SECONDARY_PATTERNS = /secondary/i;
    const SKIP_PATTERNS = /shadow|border-shadow|box-shadow|play|letter|radius|size|spacing|width|height|duration/i;

    for (const [prop, hex] of Object.entries(cssCustomProperties)) {
      if (SKIP_PATTERNS.test(prop)) continue;
      if (isNeutral(hex)) continue;
      // Only consider hex-like values
      if (!/^#[0-9a-f]{6}$/i.test(hex)) continue;

      if (PRIMARY_PATTERNS.test(prop)) {
        add(hex, "primary", "medium", `css var ${prop}`);
      } else if (ACCENT_PATTERNS.test(prop)) {
        add(hex, "accent", "medium", `css var ${prop}`);
      } else if (SECONDARY_PATTERNS.test(prop)) {
        add(hex, "secondary", "medium", `css var ${prop}`);
      } else if (/^--color-/.test(prop)) {
        // Named color variables (--color-blue, --color-purple) are brand-relevant
        add(hex, "unknown", "low", `css var ${prop}`);
      }
    }
  }

  return candidates;
}

/** Get luminance from hex (0-1 range) */
function getLuminance(hex: string): number {
  if (!hex.startsWith("#") || hex.length < 7) return 0.5;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}
