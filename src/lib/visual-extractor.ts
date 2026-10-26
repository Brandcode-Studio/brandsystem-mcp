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
import type { Browser, Page } from "puppeteer-core";
import { safeFetch, readResponseWithLimit, MAX_HTML_BYTES, validateUrl, isBlockedIpAddress } from "./url-validator.js";
import {
  DEFAULT_EGRESS_ALLOWED_PORTS,
  EGRESS_PROXY_HOST,
  startEgressProxy,
  type EgressProxy,
  type EgressProxyOptions,
} from "./browser-egress-proxy.js";
import { getVersion } from "./version.js";
import { summarizeVisualTokens, type VisualTokenSummary } from "./visual-tokens.js";

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
  border?: string;
  borderRadius: string;
  boxShadow?: string;
  maxWidth?: string;
  paddingInline?: string;
  paddingBlock?: string;
  marginInline?: string;
  marginBlock?: string;
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
  visualTokens: VisualTokenSummary;
  /** Whether Chrome was found and extraction succeeded */
  success: true;
}

export interface VisualExtractionError {
  success: false;
  reason: string;
}

export type VisualExtractionResult = VisualExtraction | VisualExtractionError;

export function screenshotToBase64(screenshot: Buffer | Uint8Array): string {
  return Buffer.from(screenshot).toString("base64");
}

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
  visualTokens: VisualTokenSummary;
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

/**
 * Build Chromium arguments with the browser sandbox enabled by default.
 *
 * Some constrained containers cannot start Chromium's sandbox. They must make
 * the security downgrade explicit instead of silently exposing every local MCP
 * user to an unsandboxed browser process.
 */
export function chromeLaunchArgs(
  env: NodeJS.ProcessEnv = process.env,
  options: { includeWindowSize?: boolean } = {},
): string[] {
  const args = [
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--disable-extensions",
  ];

  if (options.includeWindowSize) {
    args.push("--window-size=1280,800");
  }

  if (env.BRANDSYSTEM_UNSAFE_DISABLE_CHROME_SANDBOX === "1") {
    args.unshift("--no-sandbox", "--disable-setuid-sandbox");
  }

  return args;
}

const LOCAL_BROWSER_PROTOCOLS = new Set(["about:", "blob:", "data:"]);

/**
 * Validate every browser navigation and subresource before Chromium can fetch
 * it. Redirect targets also pass through request interception, which prevents a
 * public page from pivoting the extractor into loopback, private-network, or
 * cloud-metadata services.
 */
export async function validateBrowserRequestUrl(url: string): Promise<void> {
  const protocol = new URL(url).protocol;
  if (LOCAL_BROWSER_PROTOCOLS.has(protocol)) return;
  await validateUrl(url);
}

type InterceptedRequest = {
  abort(errorCode?: string): Promise<void>;
  continue(): Promise<void>;
  resourceType(): string;
  url(): string;
};

async function handleBrowserRequest(req: InterceptedRequest): Promise<void> {
  const type = req.resourceType();
  if (type === "media" || type === "websocket") {
    await req.abort("blockedbyclient");
    return;
  }

  try {
    await validateBrowserRequestUrl(req.url());
    await req.continue();
  } catch {
    await req.abort("blockedbyclient");
  }
}

/**
 * Deny-all request policy for rendering local content: only in-document
 * schemes (about:, blob:, data:) load; every network or file: request is
 * aborted before Chromium fetches it. `onBlocked` sees each refused URL.
 * Pair with `denyAllEgress` so the egress proxy refuses everything too.
 */
export function installOfflineRequestPolicy(
  page: {
    on(event: "request", handler: (req: InterceptedRequest) => void): unknown;
    setRequestInterception(enabled: boolean): Promise<void>;
  },
  onBlocked?: (url: string) => void,
): Promise<void> {
  return page.setRequestInterception(true).then(() => {
    page.on("request", (req) => {
      let local = false;
      try {
        local = LOCAL_BROWSER_PROTOCOLS.has(new URL(req.url()).protocol);
      } catch {
        local = false;
      }
      if (!local) onBlocked?.(req.url());
      void (local ? req.continue() : req.abort("blockedbyclient")).catch(() => undefined);
    });
  });
}

export function installBrowserRequestPolicy(page: {
  on(event: "request", handler: (req: InterceptedRequest) => void): unknown;
  setRequestInterception(enabled: boolean): Promise<void>;
}): Promise<void> {
  return page.setRequestInterception(true).then(() => {
    page.on("request", (req) => {
      // Chromium may close a page while an intercepted request is resolving.
      // Treat that race as already handled rather than leaking a rejected task.
      void handleBrowserRequest(req).catch(() => undefined);
    });
  });
}

// ── Network egress lockdown ────────────────────────────────────────────────
//
// The request interceptor above only checks URLs: Chromium still resolves the
// hostname itself (DNS rebinding), and service workers, WebSockets, QUIC, and
// WebRTC never pass through it. The real boundary is the egress proxy
// (browser-egress-proxy.ts): Chromium is given the proxy as its only route,
// its own resolver is disabled, and every connection is resolved, validated,
// and IP-pinned in this process. The interceptor stays as an additive filter.

/**
 * Chromium flags that force ALL browser networking through the local egress
 * proxy and turn off every channel that could bypass it.
 */
export function egressLockdownArgs(proxyPort: number): string[] {
  if (!Number.isInteger(proxyPort) || proxyPort < 1 || proxyPort > 65535) {
    throw new Error(`Invalid egress proxy port: ${proxyPort}`);
  }
  return [
    `--proxy-server=http://${EGRESS_PROXY_HOST}:${proxyPort}`,
    // Remove Chromium's implicit "never proxy loopback" rule so localhost /
    // 127.0.0.1 targets also go to the proxy (which refuses them).
    "--proxy-bypass-list=<-loopback>",
    // Chromium may not resolve any hostname itself; only the proxy's IP
    // literal is reachable. Defeats DNS rebinding between check and use.
    `--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE ${EGRESS_PROXY_HOST}`,
    // QUIC/HTTP3 is UDP and would not traverse an HTTP proxy.
    "--disable-quic",
    // WebRTC may only use proxied TCP; no direct UDP/host candidates.
    "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
    // No speculative / background traffic.
    "--dns-prefetch-disable",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-domain-reliability",
    "--disable-sync",
    "--no-pings",
  ];
}

/** Full Chromium argument list for extraction: sandbox policy + egress lockdown. */
export function browserLaunchArgs(
  env: NodeJS.ProcessEnv,
  options: { egressProxyPort: number; includeWindowSize?: boolean },
): string[] {
  return [
    ...chromeLaunchArgs(env, { includeWindowSize: options.includeWindowSize }),
    ...egressLockdownArgs(options.egressProxyPort),
  ];
}

/**
 * Destination ports the egress proxy may reach for an extraction of `url`:
 * 80 and 443, plus the explicit port of the requested URL when it is
 * non-standard. The URL must already pass SSRF validation.
 */
export async function egressAllowedPortsFor(url: string): Promise<number[]> {
  await validateUrl(url);
  const ports = new Set<number>(DEFAULT_EGRESS_ALLOWED_PORTS);
  const explicit = new URL(url).port;
  if (explicit) ports.add(Number(explicit));
  return [...ports];
}

export class BrowserEgressViolationError extends Error {
  constructor(readonly violations: string[]) {
    super(
      `Blocked: the page received ${violations.length} response(s) from a private or reserved address ` +
        `(${violations.slice(0, 3).join("; ")}). Extraction result discarded.`,
    );
    this.name = "BrowserEgressViolationError";
  }
}

/**
 * Backstop for the proxy: inspects every response's remote address. With the
 * proxy in place Chromium reports the proxy itself (127.0.0.1:<proxyPort>),
 * which is expected. Any other private/reserved remote means traffic reached
 * an internal service, and the page result must be discarded.
 */
export function createRemoteAddressGuard(proxyPort: number) {
  const violations: string[] = [];
  return {
    inspect(url: string, remote: { ip?: string; port?: number } | undefined): void {
      const ip = remote?.ip?.replace(/^\[|\]$/g, "");
      if (!ip) return; // cache, data:, about:, service-worker-bypassed, etc.
      if (ip === EGRESS_PROXY_HOST && remote?.port === proxyPort) return;
      if (isBlockedIpAddress(ip)) {
        violations.push(`${url.slice(0, 200)} from ${ip}${remote?.port ? `:${remote.port}` : ""}`);
      }
    },
    get violations(): readonly string[] {
      return violations;
    },
    assertClean(): void {
      if (violations.length > 0) throw new BrowserEgressViolationError([...violations]);
    },
  };
}

export type RemoteAddressGuard = ReturnType<typeof createRemoteAddressGuard>;

/**
 * Per-page egress hardening that must run before the first navigation:
 * bypass service workers (puppeteer-core never sees their requests) and
 * attach the remote-address backstop.
 */
export async function installEgressGuards(
  page: Pick<Page, "setBypassServiceWorker" | "on">,
  guard: RemoteAddressGuard,
): Promise<void> {
  await page.setBypassServiceWorker(true);
  page.on("response", (response) => {
    guard.inspect(response.url(), response.remoteAddress());
  });
}

export interface LockedDownBrowserOptions {
  chromePath: string;
  /** Destination ports the proxy may reach (see egressAllowedPortsFor). */
  allowedPorts: readonly number[];
  /**
   * Refuse every proxied connection regardless of `allowedPorts` (the proxy
   * gets an empty port allowlist). For rendering local content that must
   * not fetch anything.
   */
  denyAllEgress?: boolean;
  includeWindowSize?: boolean;
  env?: NodeJS.ProcessEnv;
  /**
   * TEST ONLY hooks for local integration tests. Production callers must
   * never set this; a test asserts they do not.
   */
  testOnly?: {
    proxy?: Pick<EgressProxyOptions, "lookup" | "testOnlyAllowedTargets">;
    extraArgs?: readonly string[];
  };
}

/**
 * Start the egress proxy, launch Chromium locked to it, run `fn`, and always
 * tear down both (browser first, then proxy) — including when `fn` or the
 * launch throws.
 */
export async function withLockedDownBrowser<T>(
  options: LockedDownBrowserOptions,
  fn: (browser: Browser, proxy: EgressProxy) => Promise<T>,
): Promise<T> {
  const proxy = await startEgressProxy({
    allowedPorts: options.denyAllEgress ? [] : options.allowedPorts,
    ...options.testOnly?.proxy,
  });
  let browser: Browser | null = null;
  try {
    // Dynamic import to keep puppeteer-core optional at the module level
    const puppeteer = await import("puppeteer-core");
    browser = await puppeteer.default.launch({
      executablePath: options.chromePath,
      headless: true,
      args: [
        ...browserLaunchArgs(options.env ?? process.env, {
          egressProxyPort: proxy.port,
          includeWindowSize: options.includeWindowSize,
        }),
        ...(options.testOnly?.extraArgs ?? []),
      ],
      timeout: 20000,
    });
    return await fn(browser, proxy);
  } finally {
    if (browser) {
      try { await browser.close(); } catch { /* ignore close errors */ }
    }
    await proxy.close();
  }
}

/** Open a page with every egress guard installed, ready for navigation. */
async function openGuardedPage(browser: Browser, proxy: EgressProxy): Promise<{ page: Page; guard: RemoteAddressGuard }> {
  const page = await browser.newPage();
  const guard = createRemoteAddressGuard(proxy.port);
  await installEgressGuards(page, guard);
  // Block heavy resources and reject internal-network pivots before fetch.
  await installBrowserRequestPolicy(page);
  return { page, guard };
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
  { name: "badge", sel: "[class*=badge], [class*=chip], [class*=tag], [class*=pill]", max: 6 },
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
      maxResponseBytes: MAX_HTML_BYTES,
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
      maxResponseBytes: MAX_HTML_BYTES,
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
    border: string;
    borderRadius: string;
    boxShadow: string;
    maxWidth: string;
    paddingInline: string;
    paddingBlock: string;
    marginInline: string;
    marginBlock: string;
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
    border: string;
    borderRadius: string;
    boxShadow: string;
    maxWidth: string;
    paddingInline: string;
    paddingBlock: string;
    marginInline: string;
    marginBlock: string;
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
        border: cs.border,
        borderRadius: cs.borderRadius,
        boxShadow: cs.boxShadow,
        maxWidth: cs.maxWidth,
        paddingInline: cs.paddingInline,
        paddingBlock: cs.paddingBlock,
        marginInline: cs.marginInline,
        marginBlock: cs.marginBlock,
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

function normalizeComputedElements(
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
    border: string;
    borderRadius: string;
    boxShadow: string;
    maxWidth: string;
    paddingInline: string;
    paddingBlock: string;
    marginInline: string;
    marginBlock: string;
    textTransform: string;
    textSample?: string;
    domPath?: string;
  }>,
  meta?: { viewport?: "desktop" | "mobile"; pageUrl?: string; pageType?: string },
): {
  computedElements: ComputedElement[];
  uniqueColors: string[];
  uniqueFonts: string[];
  visualTokens: VisualTokenSummary;
} {
  const colorSet = new Set<string>();
  const fontSet = new Set<string>();

  const computedElements: ComputedElement[] = elements.map((el) => {
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
      border: el.border,
      borderRadius: el.borderRadius,
      boxShadow: el.boxShadow,
      maxWidth: el.maxWidth,
      paddingInline: el.paddingInline,
      paddingBlock: el.paddingBlock,
      marginInline: el.marginInline,
      marginBlock: el.marginBlock,
      textTransform: el.textTransform,
      textSample: el.textSample,
      domPath: el.domPath,
      viewport: meta?.viewport,
      pageUrl: meta?.pageUrl,
      pageType: meta?.pageType,
    };
  });

  return {
    computedElements,
    uniqueColors: [...colorSet],
    uniqueFonts: [...fontSet],
    visualTokens: summarizeVisualTokens(computedElements),
  };
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

  try {
    const allowedPorts = await egressAllowedPortsFor(url);
    const { screenshot, extracted } = await withLockedDownBrowser(
      { chromePath, allowedPorts, includeWindowSize: true },
      async (browser, proxy) => {
        const { page, guard } = await openGuardedPage(browser, proxy);
        // 2x DPR for sharp text — critical for vision model analysis
        await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 });

        await page.goto(url, {
          waitUntil: "networkidle2",
          timeout: 25000,
        });
        guard.assertClean();

        // Small delay for JS-rendered content to settle
        await new Promise((r) => setTimeout(r, 1500));

        // Take viewport screenshot at 2x DPR (2560x1600 actual pixels)
        const shot = await page.screenshot({
          type: "png",
          clip: { x: 0, y: 0, width: 1280, height: 800 },
        }) as Buffer;

        // Extract computed styles via in-page JS
        const result = await page.evaluate(
          extractionScript,
          [...ELEMENT_SELECTOR_DEFS],
        );

        // Discard everything if any response came from an internal address.
        guard.assertClean();
        return { screenshot: shot, extracted: result };
      },
    );

    const normalized = normalizeComputedElements(extracted.elements);

    // Keep all CSS custom properties for later synthesis, but only add
    // color-like values into the unique color set.
    const cssCustomProperties: Record<string, string> = { ...extracted.cssVars };
    for (const [prop, val] of Object.entries(extracted.cssVars)) {
      const hex = rgbToHex(val);
      if (hex) {
        normalized.uniqueColors.push(hex);
      } else if (/^#[0-9a-f]{3,8}$/i.test(val)) {
        normalized.uniqueColors.push(val.toLowerCase());
      }
    }

    return {
      success: true,
      screenshot,
      computedElements: normalized.computedElements,
      cssCustomProperties,
      pageTitle: extracted.title,
      uniqueColors: [...new Set(normalized.uniqueColors)],
      uniqueFonts: normalized.uniqueFonts,
      visualTokens: normalized.visualTokens,
    };
  } catch (err) {
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

  try {
    const allowedPorts = await egressAllowedPortsFor(sourceUrl);
    const selectedPages = await withLockedDownBrowser(
      { chromePath, allowedPorts },
      async (browser, proxy) => {
        const { page, guard } = await openGuardedPage(browser, proxy);

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
              guard.assertClean();
              await new Promise((resolve) => setTimeout(resolve, 1200));

              const screenshot = await page.screenshot({
                type: "png",
                clip: { x: 0, y: 0, width: viewport.width, height: viewport.height },
              }) as Buffer;

              const extracted = await page.evaluate(extractionScript, [...ELEMENT_SELECTOR_DEFS]);
              // Discard everything if any response came from an internal address.
              guard.assertClean();
              pageTitle = pageTitle || extracted.title;

              const normalized = normalizeComputedElements(extracted.elements, {
                viewport: viewportName,
                pageUrl: selectedPage.url,
                pageType: selectedPage.pageType,
              });

              const cssCustomProperties: Record<string, string> = { ...extracted.cssVars };
              for (const [prop, val] of Object.entries(extracted.cssVars)) {
                const hex = rgbToHex(val);
                if (hex) {
                  normalized.uniqueColors.push(hex);
                } else if (/^#[0-9a-f]{3,8}$/i.test(val)) {
                  normalized.uniqueColors.push(val.toLowerCase());
                }
              }

              extractedViewports.push({
                viewport: viewportName,
                screenshot,
                computedElements: normalized.computedElements,
                cssCustomProperties,
                uniqueColors: [...new Set(normalized.uniqueColors)],
                uniqueFonts: normalized.uniqueFonts,
                roleCandidates: inferRolesFromVisual(normalized.computedElements, cssCustomProperties),
                visualTokens: normalized.visualTokens,
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
          } catch (err) {
            // An egress violation taints the whole session: abort and discard
            // every page, not just this one.
            if (err instanceof BrowserEgressViolationError) throw err;
            // Skip pages that fail to render and keep the rest of the evidence bundle
          }
        }

        return selectedPages;
      },
    );

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
