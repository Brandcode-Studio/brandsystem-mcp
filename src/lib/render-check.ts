/**
 * Render Check — render agent-built HTML in the locked-down headless Chrome
 * and measure what actually paints: computed colors, backgrounds, borders,
 * the font face that wins for each text element, type scale, and logo
 * presence. Feeds rendered-compliance.ts.
 *
 * Network posture: the page under test may not fetch ANYTHING.
 *   - The egress proxy runs with an empty port allowlist (denyAllEgress), so
 *     every proxied connection is refused; Chromium has no other route.
 *   - The request interceptor aborts every request that is not about:,
 *     blob:, or data: (file: included) — see installOfflineRequestPolicy.
 *   - Service workers are bypassed and popups are closed on creation.
 * Local stylesheets, scripts, fonts, and images that live inside the working
 * directory (realpath-contained) are inlined into the document (CSS/JS as
 * text, binaries as data: URIs) BEFORE rendering, so the browser never needs
 * file: or network access to render a project's own files.
 */

import { readFile, stat } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { isRealPathWithinBase } from "./path-security.js";
import { loadHtmlBounded } from "./markup-guard.js";
import { flattenUntrusted } from "./untrusted-text.js";
import {
  createRemoteAddressGuard,
  findChrome,
  installEgressGuards,
  installOfflineRequestPolicy,
  withLockedDownBrowser,
} from "./visual-extractor.js";
import type { RenderMeasurement, RenderedElement } from "./rendered-compliance.js";

// ── Viewports ──────────────────────────────────────────────────────────────

export const RENDER_VIEWPORTS = {
  desktop: { width: 1280, height: 800 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 390, height: 844 },
} as const;

export type RenderViewportName = keyof typeof RENDER_VIEWPORTS;

/** Max HTML accepted for rendering (after inlining local resources). */
export const MAX_RENDER_HTML_BYTES = 16 * 1024 * 1024;
const MAX_RESOURCE_BYTES = 4 * 1024 * 1024;
const MAX_INLINE_TOTAL_BYTES = 12 * 1024 * 1024;
const MAX_CSS_IMPORT_DEPTH = 3;
const MAX_REPORTED_SAMPLES = 5;
const MAX_MEASURED_ELEMENTS = 2500;
const MAX_SCREENSHOT_HEIGHT = 4000;

export class BrowserUnavailableError extends Error {
  constructor() {
    super("No Chrome/Chromium installation found. Rendered checks require a Chromium-based browser.");
    this.name = "BrowserUnavailableError";
  }
}

// ── Local resource inlining ────────────────────────────────────────────────

const MIME_BY_EXT: Record<string, string> = {
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};
const CSS_EXTS = new Set([".css"]);
const SCRIPT_EXTS = new Set([".js", ".mjs"]);

export interface InlineReport {
  /** Local files inlined into the document. */
  inlined: number;
  /** Remote references left in place (they are blocked at render time). */
  remote: string[];
  /** Local references that could not be inlined (outside cwd, missing, too large, wrong type). */
  skipped: string[];
  /** The markup exceeded parser caps and was cut. */
  markup_truncated: boolean;
}

type Resolved =
  | { kind: "keep" }
  | { kind: "remote" }
  | { kind: "file"; path: string; buf: Buffer }
  | { kind: "skip"; reason: string };

class Inliner {
  private total = 0;
  readonly report: InlineReport = { inlined: 0, remote: [], skipped: [], markup_truncated: false };

  constructor(private readonly cwd: string, private readonly siteRoot: string) {}

  private note(list: "remote" | "skipped", value: string): void {
    const sample = flattenUntrusted(value, 100);
    const arr = this.report[list];
    if (arr.length < MAX_REPORTED_SAMPLES && !arr.includes(sample)) arr.push(sample);
  }

  async resolveRef(ref: string, fromDir: string, exts: ReadonlySet<string>): Promise<Resolved> {
    const raw = ref.trim();
    if (!raw || raw.startsWith("#")) return { kind: "keep" };
    if (/^(data|blob|about):/i.test(raw)) return { kind: "keep" };
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith("//")) {
      this.note("remote", raw);
      return { kind: "remote" };
    }
    let pathPart = raw.split(/[?#]/)[0];
    try {
      pathPart = decodeURIComponent(pathPart);
    } catch {
      /* keep raw */
    }
    const abs = pathPart.startsWith("/") ? resolve(this.siteRoot, `.${pathPart}`) : resolve(fromDir, pathPart);
    const skip = (reason: string): Resolved => {
      this.note("skipped", `${raw} (${reason})`);
      return { kind: "skip", reason };
    };
    if (!isRealPathWithinBase(abs, this.cwd)) return skip("outside working directory");
    if (!exts.has(extname(abs).toLowerCase())) return skip("unsupported type");
    let size: number;
    try {
      const st = await stat(abs);
      if (!st.isFile()) return skip("not a file");
      size = st.size;
    } catch {
      return skip("not found");
    }
    if (size > MAX_RESOURCE_BYTES) return skip("too large");
    if (this.total + size > MAX_INLINE_TOTAL_BYTES) return skip("inline budget exceeded");
    const buf = await readFile(abs);
    this.total += buf.length;
    this.report.inlined++;
    return { kind: "file", path: abs, buf };
  }

  async dataUri(ref: string, fromDir: string): Promise<string | null> {
    const r = await this.resolveRef(ref, fromDir, new Set(Object.keys(MIME_BY_EXT)));
    if (r.kind !== "file") return null;
    return `data:${MIME_BY_EXT[extname(r.path).toLowerCase()]};base64,${r.buf.toString("base64")}`;
  }

  /** Rewrite url(...) references and inline local @imports in CSS text. */
  async inlineCss(css: string, cssDir: string, depth = 0): Promise<string> {
    let out = "";
    const importRe = /@import\s+(?:url\(\s*)?(['"]?)([^'")\s;]+)\1\s*\)?([^;]*);/gi;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = importRe.exec(css)) !== null) {
      out += css.slice(last, m.index);
      last = importRe.lastIndex;
      if (depth >= MAX_CSS_IMPORT_DEPTH) continue;
      const r = await this.resolveRef(m[2], cssDir, CSS_EXTS);
      if (r.kind === "file") {
        const nested = await this.inlineCss(r.buf.toString("utf-8"), dirname(r.path), depth + 1);
        const media = m[3].trim();
        out += media ? `@media ${media}{${nested}}` : nested;
      } else if (r.kind === "keep") {
        out += m[0];
      }
      // remote/skipped imports are dropped (they could not load anyway)
    }
    out += css.slice(last);

    const urlRe = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;
    let result = "";
    last = 0;
    while ((m = urlRe.exec(out)) !== null) {
      result += out.slice(last, m.index);
      last = urlRe.lastIndex;
      const uri = await this.dataUri(m[2], cssDir);
      result += uri ? `url("${uri}")` : m[0];
    }
    return result + out.slice(last);
  }
}

const escapeClosing = (text: string, tag: "style" | "script") =>
  text.replace(new RegExp(`</${tag}`, "gi"), `<\\/${tag}`);

/**
 * Inline a document's local (working-directory-contained) stylesheets,
 * scripts, fonts, and images so it renders fully offline. Remote references
 * are left untouched — the offline request policy blocks them at render time.
 *
 * @param baseDir directory relative references resolve against (the HTML
 *   file's directory, or cwd for an HTML string). Root-relative ("/x.css")
 *   references resolve against it too.
 */
export async function inlineLocalResources(
  html: string,
  options: { baseDir: string; cwd: string },
): Promise<{ html: string; report: InlineReport }> {
  const inliner = new Inliner(options.cwd, options.baseDir);
  const { $, truncated } = loadHtmlBounded(html);
  inliner.report.markup_truncated = truncated;
  const baseDir = options.baseDir;

  for (const el of $('link[rel~="stylesheet" i][href]').toArray()) {
    const r = await inliner.resolveRef($(el).attr("href") ?? "", baseDir, CSS_EXTS);
    if (r.kind !== "file") continue;
    const css = await inliner.inlineCss(r.buf.toString("utf-8"), dirname(r.path));
    const media = $(el).attr("media");
    const style = $("<style></style>").text(escapeClosing(css, "style"));
    if (media) style.attr("media", media);
    $(el).replaceWith(style);
  }

  for (const el of $("style").toArray()) {
    const css = $(el).text();
    if (!/url\(|@import/i.test(css)) continue;
    $(el).text(escapeClosing(await inliner.inlineCss(css, baseDir), "style"));
  }

  for (const el of $("[style]").toArray()) {
    const style = $(el).attr("style") ?? "";
    if (!/url\(/i.test(style)) continue;
    $(el).attr("style", await inliner.inlineCss(style, baseDir));
  }

  for (const el of $("script[src]").toArray()) {
    const r = await inliner.resolveRef($(el).attr("src") ?? "", baseDir, SCRIPT_EXTS);
    if (r.kind !== "file") continue;
    $(el).removeAttr("src");
    $(el).text(escapeClosing(r.buf.toString("utf-8"), "script"));
  }

  for (const el of $("img[src], image[href], input[type=image][src]").toArray()) {
    const attr = el.tagName === "image" ? "href" : "src";
    const uri = await inliner.dataUri($(el).attr(attr) ?? "", baseDir);
    if (uri) {
      $(el).attr(attr, uri);
      $(el).removeAttr("srcset");
    }
  }

  return { html: $.html(), report: inliner.report };
}

// ── In-page measurement ────────────────────────────────────────────────────

interface PageMeasurement extends Omit<RenderMeasurement, "viewport"> {
  docHeight: number;
}

/**
 * Runs inside the page via page.evaluate(). Must be self-contained: no
 * references to module scope.
 */
function measurePage(opts: { maxElements: number; clientName: string }): PageMeasurement {
  const GENERIC = new Set([
    "serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui",
    "ui-serif", "ui-sans-serif", "ui-monospace", "ui-rounded", "math", "emoji",
    "fangsong", "-apple-system", "blinkmacsystemfont",
  ]);
  const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "HEAD", "META", "LINK", "TITLE", "BASE"]);

  // Normalize any computed color (oklch, lab, display-p3, ...) to rgba() via a 1px canvas.
  const pixel = document.createElement("canvas");
  pixel.width = 1;
  pixel.height = 1;
  const pctx = pixel.getContext("2d", { willReadFrequently: true });
  const colorCache = new Map<string, string>();
  const normColor = (value: string): string => {
    if (/^rgba?\(/i.test(value) || value === "transparent") return value;
    const hit = colorCache.get(value);
    if (hit) return hit;
    let out = value;
    if (pctx) {
      pctx.clearRect(0, 0, 1, 1);
      pctx.fillStyle = "rgba(0,0,0,0)";
      pctx.fillStyle = value;
      pctx.fillRect(0, 0, 1, 1);
      const d = pctx.getImageData(0, 0, 1, 1).data;
      out = `rgba(${d[0]}, ${d[1]}, ${d[2]}, ${Math.round((d[3] / 255) * 1000) / 1000})`;
    }
    colorCache.set(value, out);
    return out;
  };
  const alphaOf = (rgba: string): number => {
    if (rgba === "transparent") return 0;
    const m = /rgba?\(([^)]*)\)/i.exec(rgba);
    if (!m) return 1;
    const parts = m[1].split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 4) return 1;
    const a = parts[3].endsWith("%") ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
    return Number.isFinite(a) ? a : 1;
  };

  // Font availability: a loaded FontFace, or a canvas width probe that differs
  // from every generic baseline (an installed system face).
  const loadedFaces = new Set<string>();
  document.fonts.forEach((face) => {
    if (face.status === "loaded") loadedFaces.add(face.family.replace(/^['"]|['"]$/g, "").trim().toLowerCase());
  });
  const probe = document.createElement("canvas").getContext("2d");
  const SAMPLE = "mmmmmmmmmmlli1WWQ@#0Oo";
  const availCache = new Map<string, boolean>();
  const isAvailable = (family: string): boolean => {
    const key = family.toLowerCase();
    if (GENERIC.has(key) || loadedFaces.has(key)) return true;
    const cached = availCache.get(key);
    if (cached !== undefined) return cached;
    let ok = false;
    if (probe) {
      for (const base of ["monospace", "serif", "sans-serif"]) {
        probe.font = `72px ${base}`;
        const w0 = probe.measureText(SAMPLE).width;
        probe.font = `72px "${family.replace(/["\\]/g, "")}", ${base}`;
        const w1 = probe.measureText(SAMPLE).width;
        if (Math.abs(w0 - w1) > 0.5) {
          ok = true;
          break;
        }
      }
    }
    availCache.set(key, ok);
    return ok;
  };
  const parseStack = (value: string): string[] => {
    const out: string[] = [];
    let cur = "";
    let quote: string | null = null;
    for (const ch of value) {
      if (quote) {
        if (ch === quote) quote = null;
        else cur += ch;
      } else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === ",") {
        if (cur.trim()) out.push(cur.trim());
        cur = "";
      } else cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  };
  const renderedFamilyCache = new Map<string, string>();
  const renderedFamily = (stackValue: string): string => {
    const hit = renderedFamilyCache.get(stackValue);
    if (hit) return hit;
    const found = parseStack(stackValue).find((f) => isAvailable(f)) ?? "(browser default)";
    renderedFamilyCache.set(stackValue, found);
    return found;
  };

  const locatorPart = (el: Element): string => {
    const tag = el.tagName.toLowerCase();
    if (el.id) return `${tag}#${el.id.slice(0, 40)}`;
    const cls = (el.getAttribute("class") ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 2);
    let part = tag + (cls.length ? `.${cls.map((c) => c.slice(0, 30)).join(".")}` : "");
    const parent = el.parentElement;
    if (parent) {
      const same = [...parent.children].filter((c) => c.tagName === el.tagName);
      if (same.length > 1) part += `:nth-of-type(${same.indexOf(el) + 1})`;
    }
    return part;
  };
  const locator = (el: Element): string => {
    const parts: string[] = [];
    let cur: Element | null = el;
    while (cur && cur !== document.documentElement && parts.length < 4) {
      parts.unshift(locatorPart(cur));
      if (cur.id) break;
      cur = cur.parentElement;
    }
    return parts.join(" > ");
  };

  const opacityCache = new Map<Element, number>();
  const effectiveOpacity = (el: Element | null): number => {
    if (!el) return 1;
    const hit = opacityCache.get(el);
    if (hit !== undefined) return hit;
    const own = parseFloat(getComputedStyle(el).opacity);
    const value = (Number.isFinite(own) ? own : 1) * effectiveOpacity(el.parentElement);
    opacityCache.set(el, value);
    return value;
  };

  const elements: RenderedElement[] = [];
  let truncated = false;
  const body = document.body;
  const candidates: Element[] = body ? [body, ...body.querySelectorAll("*")] : [];

  for (const el of candidates) {
    if (SKIP.has(el.tagName) || el instanceof SVGElement) continue;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility !== "visible") continue;
    const rect = el.getBoundingClientRect();
    if (rect.width * rect.height < 4) continue;
    if (effectiveOpacity(el) < 0.1) continue;
    if (elements.length >= opts.maxElements) {
      truncated = true;
      break;
    }

    let ownText = "";
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) ownText += node.textContent ?? "";
    }
    ownText = ownText.replace(/\s+/g, " ").trim();

    const bgLayers: string[] = [];
    let bgImage = false;
    let cur: Element | null = el;
    while (cur && bgLayers.length < 40) {
      const ccs = cur === el ? cs : getComputedStyle(cur);
      const bg = normColor(ccs.backgroundColor);
      bgLayers.push(bg);
      if (ccs.backgroundImage && ccs.backgroundImage !== "none") bgImage = true;
      if (alphaOf(bg) >= 1) break;
      cur = cur.parentElement;
    }

    const borderColors: string[] = [];
    for (const side of ["Top", "Right", "Bottom", "Left"] as const) {
      const width = parseFloat(cs.getPropertyValue(`border-${side.toLowerCase()}-width`));
      const style = cs.getPropertyValue(`border-${side.toLowerCase()}-style`);
      if (width > 0 && style !== "none" && style !== "hidden") {
        const c = normColor(cs.getPropertyValue(`border-${side.toLowerCase()}-color`));
        if (!borderColors.includes(c)) borderColors.push(c);
      }
    }

    elements.push({
      locator: locator(el),
      tag: el.tagName.toLowerCase(),
      text: ownText ? ownText.slice(0, 60) : undefined,
      textLength: ownText.length,
      color: normColor(cs.color),
      bgLayers,
      bgImage,
      borderColors,
      fontFamily: cs.fontFamily,
      renderedFamily: ownText ? renderedFamily(cs.fontFamily) : "",
      fontSize: parseFloat(cs.fontSize) || 0,
      fontWeight: parseInt(cs.fontWeight, 10) || 400,
    });
  }

  // Logo presence
  const LOGO_RE = /logo|wordmark|logomark|brandmark/i;
  const name = opts.clientName.trim().toLowerCase();
  let detected = false;
  let evidence: string | undefined;
  let failedToLoad = 0;
  for (const el of document.querySelectorAll("svg, img, [role=img], object, image")) {
    if (el.tagName.toLowerCase() === "svg" && el.parentElement?.closest("svg")) continue;
    const titleText = el.querySelector(":scope > title")?.textContent ?? "";
    const src = el.getAttribute("src") ?? el.getAttribute("href") ?? el.getAttribute("data") ?? "";
    const srcName = src.startsWith("data:") ? "" : src.split(/[?#]/)[0].split("/").pop() ?? "";
    const label = [
      el.id,
      el.getAttribute("class") ?? "",
      el.getAttribute("alt") ?? "",
      el.getAttribute("aria-label") ?? "",
      el.getAttribute("title") ?? "",
      titleText,
      srcName,
    ].join(" ");
    const labelled = LOGO_RE.test(label) || (name.length > 0 && label.toLowerCase().includes(name));
    const homeLink = !!el.closest('a[href="/"], a[href="./"], a[href="index.html"], a[rel~="home"]');
    const inHeader = !!el.closest("header, nav, [role=banner]");
    if (!labelled && !homeLink && !(inHeader && el.tagName.toLowerCase() === "svg")) continue;
    if (el instanceof HTMLImageElement && (!el.complete || el.naturalWidth === 0)) {
      failedToLoad++;
      continue;
    }
    const ecs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    if (ecs.display === "none" || ecs.visibility !== "visible" || rect.width * rect.height < 64) continue;
    detected = true;
    evidence = `${el.tagName.toLowerCase()} ${labelled ? "labelled as logo/brand" : homeLink ? "inside home link" : "in header"}`;
    break;
  }

  const visibleText = (body?.innerText ?? "").toLowerCase();
  return {
    elements,
    truncated,
    logo: { detected, evidence, failedToLoad },
    brandNameVisible: name.length > 0 && visibleText.includes(name),
    docHeight: Math.max(document.documentElement.scrollHeight, body?.scrollHeight ?? 0),
  };
}

// ── Runner ─────────────────────────────────────────────────────────────────

export interface RenderOptions {
  viewport: { width: number; height: number };
  clientName: string;
  screenshot?: boolean;
  /** Overrides findChrome() (tests). */
  chromePath?: string;
  env?: NodeJS.ProcessEnv;
  /** Per-step deadline (setContent, font load, measurement, screenshot). */
  stepTimeoutMs?: number;
}

export interface RenderOutcome {
  measurement: RenderMeasurement;
  screenshot?: Buffer;
  /** Requests the page attempted that were refused (origins only, sampled). */
  blockedRequests: { count: number; samples: string[] };
}

function withDeadline<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      timer.unref();
    }),
  ]).finally(() => clearTimeout(timer));
}

function originOf(url: string): string {
  try {
    const u = new URL(url);
    return u.protocol === "file:" ? "file:" : `${u.protocol}//${u.host}`;
  } catch {
    return "(invalid url)";
  }
}

/**
 * Render `html` offline in the locked-down browser and measure it. Throws
 * BrowserUnavailableError when no Chrome is installed; any other failure
 * (timeout, crash) propagates as an Error.
 */
export async function renderAndMeasure(html: string, options: RenderOptions): Promise<RenderOutcome> {
  const chromePath = options.chromePath ?? findChrome();
  if (!chromePath) throw new BrowserUnavailableError();
  const stepMs = options.stepTimeoutMs ?? 15000;
  const { width, height } = options.viewport;

  const blocked: string[] = [];
  let blockedCount = 0;

  return withLockedDownBrowser(
    { chromePath, allowedPorts: [], denyAllEgress: true, env: options.env },
    async (browser, proxy) => {
      const page = await browser.newPage();
      // The page under test may not open other pages (they would escape the
      // per-page request policy; the proxy still refuses their traffic).
      browser.on("targetcreated", (target) => {
        if (target.type() !== "page") return;
        void target
          .page()
          .then((p) => (p && p !== page ? p.close() : undefined))
          .catch(() => undefined);
      });
      const guard = createRemoteAddressGuard(proxy.port);
      await installEgressGuards(page, guard);
      await installOfflineRequestPolicy(page, (url) => {
        blockedCount++;
        const origin = originOf(url);
        if (blocked.length < MAX_REPORTED_SAMPLES && !blocked.includes(origin)) blocked.push(origin);
      });
      page.on("dialog", (dialog) => void dialog.dismiss().catch(() => undefined));
      await page.setViewport({ width, height, deviceScaleFactor: 1 });

      await withDeadline(page.setContent(html, { waitUntil: "load", timeout: stepMs }), stepMs + 1000, "Rendering");
      await withDeadline(
        page.evaluate(() => document.fonts.ready.then(() => undefined)),
        Math.min(stepMs, 5000),
        "Font loading",
      ).catch(() => undefined);
      await new Promise((r) => setTimeout(r, 200));

      const measured = await withDeadline(
        page.evaluate(measurePage, { maxElements: MAX_MEASURED_ELEMENTS, clientName: options.clientName }),
        stepMs,
        "Measurement",
      );

      let screenshot: Buffer | undefined;
      if (options.screenshot) {
        const clipHeight = Math.min(Math.max(measured.docHeight, height), MAX_SCREENSHOT_HEIGHT);
        screenshot = Buffer.from(
          await withDeadline(
            page.screenshot({ type: "png", clip: { x: 0, y: 0, width, height: clipHeight }, captureBeyondViewport: true }),
            stepMs,
            "Screenshot",
          ),
        );
      }

      guard.assertClean();
      const { docHeight: _docHeight, ...rest } = measured;
      return {
        measurement: { viewport: { width, height }, ...rest },
        screenshot,
        blockedRequests: { count: blockedCount, samples: blocked.map((s) => flattenUntrusted(s, 100)) },
      };
    },
  );
}
