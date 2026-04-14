import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { generateColorName } from "./color-namer.js";
import type { ColorEntry, Confidence, SpacingSpec, TypographyEntry } from "../types/index.js";

const require = createRequire(import.meta.url);

export interface PdfRuleExtraction {
  dos: string[];
  donts: string[];
  guidance: string[];
}

export interface PdfBrandExtraction {
  filePath: string;
  pages: string;
  pageCount: number;
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

export async function extractPdfBrandData(filePath: string, pages = "all"): Promise<PdfBrandExtraction> {
  const resolvedPath = resolve(filePath);
  const dataBuffer = await readFile(resolvedPath);
  const pdfParse = require("pdf-parse/lib/pdf-parse.js") as (
    data: Buffer,
    options?: {
      max?: number;
      pagerender?: (pageData: { getTextContent: (opts: { normalizeWhitespace: boolean; disableCombineTextItems: boolean }) => Promise<{ items: Array<{ str: string; transform: number[] }> }> }) => Promise<string>;
    },
  ) => Promise<{ numpages: number; text: string }>;

  const range = parsePageRange(pages);
  let pageNumber = 0;
  const result = await pdfParse(dataBuffer, {
    max: range.end ?? 0,
    pagerender: async (pageData) => {
      pageNumber += 1;
      const textContent = await pageData.getTextContent({
        normalizeWhitespace: false,
        disableCombineTextItems: false,
      });
      if (pageNumber < range.start) return "";
      const parts: string[] = [];
      let lastY = 0;
      for (const item of textContent.items) {
        if (!lastY || lastY === item.transform[5]) {
          parts.push(item.str);
        } else {
          parts.push(`\n${item.str}`);
        }
        lastY = item.transform[5];
      }
      return parts.join("");
    },
  });

  const text = result.text.replace(/\n{3,}/g, "\n\n").trim();
  return {
    filePath: resolvedPath,
    pages,
    pageCount: result.numpages,
    text,
    colors: extractColors(text),
    typography: extractTypography(text),
    spacing: extractSpacing(text),
    logos: extractLogoHints(text),
    rules: extractRules(text),
  };
}
