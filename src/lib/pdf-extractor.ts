import { open, realpath } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { isPathWithinBase, isRealPathWithinBase } from "./path-security.js";
import { generateColorName } from "./color-namer.js";
import type { ColorEntry, Confidence, SpacingSpec, TypographyEntry } from "../types/index.js";

export interface PdfRuleExtraction {
  dos: string[];
  donts: string[];
  guidance: string[];
}

export interface PdfBrandExtraction {
  filePath: string;
  pages: string;
  pageCount: number;
  /** Pages actually parsed (capped at MAX_PDF_PAGES). */
  pagesProcessed: number;
  /** True when the requested range was cut short by the page cap. */
  truncated: boolean;
  /** First unparsed page when truncated. */
  nextPage?: number;
  text: string;
  colors: ColorEntry[];
  typography: TypographyEntry[];
  spacing: SpacingSpec | null;
  logos: Array<{ hint: string }>;
  rules: PdfRuleExtraction;
}

function parsePageRange(pages: string): { start: number; end?: number } {
  const trimmed = pages.trim().toLowerCase();
  if (trimmed === "all") return { start: 1 };
  const match = trimmed.match(/^(\d+)(?:-(\d+))?$/);
  if (!match) {
    throw new Error(`Invalid pages value "${pages}". Use "all", "3", or "1-5".`);
  }
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : start;
  if (start <= 0 || end <= 0 || end < start) {
    throw new Error(`Invalid page range "${pages}".`);
  }
  return { start, end };
}

function inferRoleFromLine(line: string): ColorEntry["role"] {
  const lower = line.toLowerCase();
  if (/(primary|brand)/.test(lower)) return "primary";
  if (/secondary/.test(lower)) return "secondary";
  if (/(accent|highlight)/.test(lower)) return "accent";
  if (/(action|cta|button)/.test(lower)) return "action";
  if (/(surface|background|canvas)/.test(lower)) return "surface";
  if (/(text|ink|foreground)/.test(lower)) return "text";
  if (/(border|stroke|outline)/.test(lower)) return "border";
  if (/(neutral|gray|grey)/.test(lower)) return "neutral";
  return "unknown";
}

function inferConfidence(line: string): Confidence {
  return /(primary|secondary|accent|heading|body|base unit|spacing)/i.test(line) ? "high" : "medium";
}

function titleCase(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function extractColors(text: string): ColorEntry[] {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const seen = new Set<string>();
  const colors: ColorEntry[] = [];

  for (const line of lines) {
    const matches = [...line.matchAll(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g)];
    for (const match of matches) {
      const value = `#${match[1].toLowerCase()}`;
      const role = inferRoleFromLine(line);
      const key = `${role}:${value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const lineWithoutHex = line.replace(match[0], "").replace(/[:|-]+/g, " ").trim();
      colors.push({
        name: lineWithoutHex ? titleCase(lineWithoutHex.slice(0, 60)) : generateColorName(value, role),
        value,
        role,
        source: "guidelines",
        confidence: inferConfidence(line),
      });
    }
  }

  return colors;
}

const WEIGHT_BY_NAME: Record<string, number> = {
  thin: 100,
  extralight: 200,
  light: 300,
  regular: 400,
  book: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
  extrabold: 800,
  black: 900,
};

function normalizeWeight(value: string): number | undefined {
  const lower = value.toLowerCase().replace(/[^a-z]/g, "");
  return WEIGHT_BY_NAME[lower];
}

function extractTypography(text: string): TypographyEntry[] {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const typography: TypographyEntry[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    if (!/(font|typeface|typography|heading|body|display|ui)/i.test(line)) continue;
    const familyMatch = line.match(/(?:font|typeface|heading|body|display|ui)[^A-Za-z0-9]*([A-Z][A-Za-z0-9]*(?:\s+[A-Z][A-Za-z0-9]*){0,3})/);
    if (!familyMatch) continue;
    const family = familyMatch[1]
      .split(/\s+/)
      .filter((token) => !normalizeWeight(token) && !/\d/.test(token))
      .join(" ")
      .trim();
    if (!family) continue;
    const sizeMatch = line.match(/(\d{1,3})(?:\s)?(?:px|pt)\b/i);
    const weightMatch = line.match(/\b(thin|extralight|light|regular|book|medium|semibold|bold|extrabold|black)\b/i);
    const nameMatch = line.match(/\b(heading|body|display|ui|caption|label)\b/i);
    const name = nameMatch ? titleCase(nameMatch[1]) : family;
    const key = `${name}:${family}`;
    if (seen.has(key)) continue;
    seen.add(key);

    typography.push({
      name,
      family,
      size: sizeMatch ? `${sizeMatch[1]}px` : undefined,
      weight: weightMatch ? normalizeWeight(weightMatch[1]) : undefined,
      source: "guidelines",
      confidence: inferConfidence(line),
    });
  }

  return typography;
}

function inferSpacingBase(values: number[]): number | null {
  const filtered = values.filter((value) => value > 0 && value <= 16);
  if (filtered.length === 0) return null;
  const divisibleBy8 = filtered.filter((value) => value % 8 === 0).length;
  const divisibleBy4 = filtered.filter((value) => value % 4 === 0).length;
  if (divisibleBy8 >= Math.max(2, Math.ceil(filtered.length / 2))) return 8;
  if (divisibleBy4 >= Math.max(2, Math.ceil(filtered.length / 2))) return 4;
  return Math.min(...filtered);
}

function extractSpacing(text: string): SpacingSpec | null {
  const spacingLines = text.split(/\r?\n/).filter((line) => /(spacing|space|padding|margin|gutter|grid)/i.test(line));
  const values = [...text.matchAll(/\b(\d{1,3})(?:\s)?(?:px|pt)\b/gi)]
    .map((match) => Number(match[1]))
    .filter((value) => value > 0 && value <= 160);
  const scale = [...new Set(values)].sort((a, b) => a - b);
  const baseMatch = spacingLines.join(" ").match(/base unit[^0-9]{0,10}(\d{1,2})(?:\s)?(?:px|pt)\b/i);
  const baseUnit = baseMatch ? `${baseMatch[1]}px` : (inferSpacingBase(scale) ? `${inferSpacingBase(scale)}px` : undefined);

  if (!baseUnit && scale.length === 0) return null;

  return {
    base_unit: baseUnit,
    scale,
    source: "guidelines",
    confidence: spacingLines.length > 0 ? "high" : "medium",
  };
}

function extractRules(text: string): PdfRuleExtraction {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const dos = lines.filter((line) => /^(do|always)\b/i.test(line)).slice(0, 6);
  const donts = lines.filter((line) => /^(don'?t|avoid|never)\b/i.test(line)).slice(0, 6);
  const guidance = lines.filter((line) => /(guideline|usage|clear space|minimum size|logo)/i.test(line)).slice(0, 8);
  return { dos, donts, guidance };
}

function extractLogoHints(text: string): Array<{ hint: string }> {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /logo|wordmark|logomark/i.test(line))
    .slice(0, 4)
    .map((line) => ({ hint: line }));
}

/** Hard cap on the PDF file size read from disk. */
export const MAX_PDF_BYTES = 50 * 1024 * 1024;
/** Hard cap on pages parsed per call. */
export const MAX_PDF_PAGES = 200;
/** Wall-clock budget for parsing; the parser worker is killed when exceeded. */
export const PDF_PARSE_TIMEOUT_MS = 60_000;
/** Heap ceiling for the parser worker so a hostile PDF cannot OOM the server. */
const PDF_WORKER_HEAP_MB = 512;

/** Single message for "missing", "outside cwd", and "unreadable" — no oracle. */
const NOT_FOUND_MESSAGE = "PDF not found or outside the working directory";

export interface PdfExtractOptions {
  /** Directory the file must resolve inside (symlinks resolved). Default: process.cwd(). */
  baseDir?: string;
  maxBytes?: number;
  maxPages?: number;
  timeoutMs?: number;
}

export class PdfInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdfInputError";
  }
}

/**
 * Open a PDF for reading only if it resolves (symlinks included) inside
 * `baseDir`, is a regular file, and is within the size cap. Uses
 * O_NONBLOCK so a FIFO cannot hang the open, and fstat on the opened handle
 * so the checks apply to exactly what is read.
 */
async function readContainedPdf(
  filePath: string,
  baseDir: string,
  maxBytes: number,
): Promise<{ realPath: string; data: Uint8Array }> {
  const candidate = resolve(baseDir, filePath);
  if (!isRealPathWithinBase(candidate, baseDir)) {
    throw new PdfInputError(NOT_FOUND_MESSAGE);
  }
  let realPath: string;
  try {
    realPath = await realpath(candidate);
  } catch {
    throw new PdfInputError(NOT_FOUND_MESSAGE);
  }
  if (!isPathWithinBase(realPath, await realpath(baseDir).catch(() => resolve(baseDir)))) {
    throw new PdfInputError(NOT_FOUND_MESSAGE);
  }

  const flags =
    fsConstants.O_RDONLY |
    (fsConstants.O_NONBLOCK ?? 0) |
    (fsConstants.O_NOFOLLOW ?? 0);
  let handle;
  try {
    handle = await open(realPath, flags);
  } catch {
    throw new PdfInputError(NOT_FOUND_MESSAGE);
  }
  try {
    const st = await handle.stat();
    if (!st.isFile()) {
      throw new PdfInputError("Path is not a regular file — provide a PDF file");
    }
    if (st.size > maxBytes) {
      throw new PdfInputError(
        `PDF is ${(st.size / 1024 / 1024).toFixed(1)} MB, exceeding the ${Math.round(maxBytes / 1024 / 1024)} MB limit`,
      );
    }
    const buf = await handle.readFile();
    if (buf.byteLength > maxBytes) {
      throw new PdfInputError(`PDF exceeds the ${Math.round(maxBytes / 1024 / 1024)} MB limit`);
    }
    // Copy into a standalone buffer so it can be transferred to the worker.
    return { realPath, data: new Uint8Array(buf) };
  } finally {
    await handle.close().catch(() => {});
  }
}

/**
 * Parser worker: runs pdfjs in a worker_thread so a pathological PDF can be
 * hard-killed on timeout and is heap-limited away from the server.
 * Module-format agnostic (only dynamic imports); pdfjs is loaded from an
 * absolute file URL resolved by the parent, so it works from any cwd.
 */
const PDF_WORKER_SOURCE = `
(async () => {
  // Dynamic import works whether the eval worker runs as CommonJS or ESM.
  const { parentPort, workerData } = await import("node:worker_threads");
  let task;
  try {
    const pdfjs = await import(workerData.pdfjsUrl);
    task = pdfjs.getDocument({
      data: workerData.data,
      useSystemFonts: true,
      isEvalSupported: false,
      verbosity: 0,
    });
    const doc = await task.promise;
    const numPages = doc.numPages;
    const start = workerData.start;
    const requestedEnd = workerData.end == null ? numPages : workerData.end;
    const last = Math.min(requestedEnd, numPages, start + workerData.maxPages - 1);
    const pageTexts = [];
    for (let i = start; i <= last; i++) {
      const page = await doc.getPage(i);
      const textContent = await page.getTextContent({ includeMarkedContent: false });
      const parts = [];
      let lastY = 0;
      for (const item of textContent.items) {
        if (item && typeof item.str === "string") {
          const y = item.transform[5];
          parts.push(lastY && y !== lastY ? "\\n" + item.str : item.str);
          lastY = y;
        }
      }
      pageTexts.push(parts.join(""));
      page.cleanup();
    }
    parentPort.postMessage({
      ok: true,
      numPages,
      pagesProcessed: Math.max(0, last - start + 1),
      truncated: Math.min(requestedEnd, numPages) > last,
      pageTexts,
    });
  } catch (err) {
    parentPort.postMessage({ ok: false, message: String((err && err.message) || err).slice(0, 300) });
  } finally {
    // Best-effort cleanup; never throw after the result was posted.
    try {
      if (task && typeof task.destroy === "function") await task.destroy();
    } catch {}
  }
})();
`;

interface WorkerResult {
  numPages: number;
  pagesProcessed: number;
  truncated: boolean;
  pageTexts: string[];
}

function resolvePdfjsUrl(): string {
  const req = createRequire(import.meta.url);
  return pathToFileURL(req.resolve("pdfjs-dist/legacy/build/pdf.mjs")).href;
}

function parseInWorker(
  data: Uint8Array,
  range: { start: number; end?: number },
  maxPages: number,
  timeoutMs: number,
): Promise<WorkerResult> {
  return new Promise<WorkerResult>((resolvePromise, reject) => {
    const worker = new Worker(PDF_WORKER_SOURCE, {
      eval: true,
      workerData: {
        pdfjsUrl: resolvePdfjsUrl(),
        data,
        start: range.start,
        end: range.end ?? null,
        maxPages,
      },
      transferList: [data.buffer as ArrayBuffer],
      resourceLimits: { maxOldGenerationSizeMb: PDF_WORKER_HEAP_MB },
      // Keep pdfjs console output off the MCP stdio channel.
      stdout: true,
      stderr: true,
    });
    worker.stdout.resume();
    worker.stderr.resume();

    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
      void worker.terminate();
    };

    const timer = setTimeout(() => {
      finish(() =>
        reject(new PdfInputError(`PDF parsing timed out after ${Math.round(timeoutMs / 1000)}s`)),
      );
    }, timeoutMs);

    worker.once("message", (msg: { ok: boolean; message?: string } & Partial<WorkerResult>) => {
      finish(() => {
        if (msg.ok) {
          resolvePromise({
            numPages: msg.numPages ?? 0,
            pagesProcessed: msg.pagesProcessed ?? 0,
            truncated: Boolean(msg.truncated),
            pageTexts: Array.isArray(msg.pageTexts) ? msg.pageTexts : [],
          });
        } else {
          reject(new Error(`PDF could not be parsed: ${msg.message ?? "unknown error"}`));
        }
      });
    });
    worker.once("error", (err) => {
      finish(() => reject(new Error(`PDF parser failed: ${err.message.slice(0, 300)}`)));
    });
    worker.once("exit", (code) => {
      finish(() => reject(new Error(`PDF parser exited unexpectedly (code ${code})`)));
    });
  });
}

export async function extractPdfBrandData(
  filePath: string,
  pages = "all",
  options: PdfExtractOptions = {},
): Promise<PdfBrandExtraction> {
  const baseDir = options.baseDir ?? process.cwd();
  const maxBytes = options.maxBytes ?? MAX_PDF_BYTES;
  const maxPages = Math.max(1, Math.min(options.maxPages ?? MAX_PDF_PAGES, MAX_PDF_PAGES));
  const timeoutMs = options.timeoutMs ?? PDF_PARSE_TIMEOUT_MS;

  // Validate the page range before touching the file.
  const range = parsePageRange(pages);
  const { realPath, data } = await readContainedPdf(filePath, baseDir, maxBytes);
  const parsed = await parseInWorker(data, range, maxPages, timeoutMs);

  const text = parsed.pageTexts.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();

  return {
    filePath: realPath,
    pages,
    pageCount: parsed.numPages,
    pagesProcessed: parsed.pagesProcessed,
    truncated: parsed.truncated,
    nextPage: parsed.truncated ? range.start + parsed.pagesProcessed : undefined,
    text,
    colors: extractColors(text),
    typography: extractTypography(text),
    spacing: extractSpacing(text),
    logos: extractLogoHints(text),
    rules: extractRules(text),
  };
}
