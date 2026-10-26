/**
 * Native-format exports: the brand in the file format a host tool already
 * reads (AGENTS.md, Cursor rules, CSS custom properties, Tailwind v4 @theme,
 * shadcn/ui theme variables).
 *
 * Every target is derived from the canonical DTCG compiler output
 * (compileDTCG) — this module never re-derives tokens from raw extraction.
 * It only *serializes* compiled tokens into other formats, and treats every
 * brand-derived string as untrusted:
 *
 *   - CSS targets: identifiers are reduced to [a-z0-9-], colors must be hex,
 *     dimensions/weights/shadows must match strict shapes, font families must
 *     pass isPlausibleFontName and are always double-quoted. A value that
 *     fails validation is dropped (and counted), never escaped-and-emitted.
 *   - Instruction targets (AGENTS.md, .mdc): carry the provenance notice;
 *     brand values live only inside a YAML data block fenced with
 *     markdownFenceFor, so no value can close the fence or become prose.
 */

import { stringify as stringifyYaml } from "yaml";
import { compileDTCG } from "./dtcg-compiler.js";
import type { DesignSynthesisFile } from "./design-synthesis.js";
import {
  PROVISIONAL_ARTIFACT_NOTICE,
  flattenUntrusted,
  inlineUntrusted,
  isPlausibleFontName,
  markdownFenceFor,
} from "./untrusted-text.js";
import { ColorEntrySchema } from "../schemas/index.js";
import type { CoreIdentityData, MessagingData, VisualIdentityData } from "../schemas/index.js";

export interface NativeExportInput {
  clientName: string;
  identity: CoreIdentityData;
  visual?: VisualIdentityData | null;
  messaging?: MessagingData | null;
  synthesis?: DesignSynthesisFile | null;
}

interface NamedValue {
  key: string;
  value: string;
}

interface FontToken {
  key: string;
  family: string;
  stack: string;
  weight?: number;
  size?: string;
  lineHeight?: string;
}

export interface NativeTokenModel {
  colors: NamedValue[];
  darkColors: NamedValue[];
  fonts: FontToken[];
  spacing: NamedValue[];
  radius: NamedValue[];
  shadow: NamedValue[];
  /** Number of compiled token values dropped because they failed validation. */
  rejected: number;
}

// ---------------------------------------------------------------------------
// Validation + sanitization primitives
// ---------------------------------------------------------------------------

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const DIMENSION = /^(?:0|-?(?:\d+|\d*\.\d+)(?:px|rem|em|%|vh|vw|ch|ex|pt))$/;
const LINE_HEIGHT = /^(?:\d+|\d*\.\d+)(?:px|rem|em|%)?$/;
// Shadows: numbers, units, hex/rgb()/hsl() colors, commas, spaces. No quotes,
// semicolons, braces, slashes, colons, or backslashes — nothing that can end
// a declaration or open a comment/string.
const SHADOW = /^[a-zA-Z0-9#(),.%\s-]+$/;

const COLOR_ROLES: ReadonlySet<string> = new Set(
  ColorEntrySchema.shape.role.options.filter((r: string) => r !== "unknown"),
);

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_COLOR.test(value);
}

export function isCssDimension(value: unknown): value is string {
  return typeof value === "string" && DIMENSION.test(value.trim());
}

function isShadow(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const v = value.trim();
  if (v.length === 0 || v.length > 200) return false;
  if (!SHADOW.test(v)) return false;
  if (/url\s*\(|expression\s*\(/i.test(v)) return false;
  return true;
}

/** Reduce any token key to a safe CSS identifier fragment. */
export function cssIdent(raw: string): string {
  const ident = String(raw ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
  return ident || "token";
}

/** Text safe inside a CSS comment (and inside an HTML <style> block). */
function cssCommentText(value: string, maxLen = 80): string {
  return flattenUntrusted(value, maxLen).replace(/[*/<>\\]/g, "");
}

/** Text safe inside a markdown heading or YAML-free prose line. */
function headingText(value: string, maxLen = 60): string {
  return inlineUntrusted(value, maxLen).replace(/[<>#[\]]/g, "").trim() || "Brand";
}

function uniqueKey(base: string, seen: Set<string>): string {
  let key = base;
  let n = 2;
  while (seen.has(key)) key = `${base}-${n++}`;
  seen.add(key);
  return key;
}

function quoteFont(family: string): string {
  // isPlausibleFontName() admits no double quote or backslash, so wrapping in
  // double quotes cannot be escaped out of.
  return `"${family.trim()}"`;
}

function genericFallback(key: string, family: string): string {
  const k = `${key} ${family}`.toLowerCase();
  if (/mono|code/.test(k)) return "ui-monospace, SFMono-Regular, Menlo, monospace";
  if (/serif/.test(k) && !/sans/.test(k)) return "ui-serif, Georgia, serif";
  return "ui-sans-serif, system-ui, sans-serif";
}

// ---------------------------------------------------------------------------
// Token model (from the canonical DTCG compiler)
// ---------------------------------------------------------------------------

type TokenGroup = Record<string, unknown>;

function asGroup(value: unknown): TokenGroup {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as TokenGroup) : {};
}

function tokenValue(value: unknown): unknown {
  return asGroup(value).$value;
}

export function buildTokenModel(input: NativeExportInput): NativeTokenModel {
  const compiled = compileDTCG(input.identity, input.clientName, input.synthesis ?? null);
  const brand = asGroup(compiled.brand);
  let rejected = 0;

  const readColors = (group: TokenGroup): NamedValue[] => {
    const out: NamedValue[] = [];
    const seen = new Set<string>();
    for (const [rawKey, token] of Object.entries(group)) {
      if (rawKey === "dark") continue;
      const value = tokenValue(token);
      if (!isHexColor(value)) {
        rejected++;
        continue;
      }
      out.push({ key: uniqueKey(cssIdent(rawKey), seen), value: value.toLowerCase() });
    }
    return out;
  };

  const colorGroup = asGroup(brand.color);
  const colors = readColors(colorGroup);
  const darkColors = readColors(asGroup(colorGroup.dark));

  const fonts: FontToken[] = [];
  const fontSeen = new Set<string>();
  for (const [rawKey, entry] of Object.entries(asGroup(brand.typography))) {
    const group = asGroup(entry);
    const family = tokenValue(group.family);
    if (!isPlausibleFontName(family)) {
      rejected++;
      continue;
    }
    const key = uniqueKey(cssIdent(rawKey), fontSeen);
    const font: FontToken = {
      key,
      family: (family as string).trim(),
      stack: `${quoteFont(family as string)}, ${genericFallback(key, family as string)}`,
    };
    const weight = tokenValue(group.weight);
    if (typeof weight === "number" && Number.isInteger(weight) && weight >= 1 && weight <= 1000) {
      font.weight = weight;
    } else if (weight !== undefined) rejected++;
    const size = tokenValue(group.size);
    if (isCssDimension(size)) font.size = (size as string).trim();
    else if (size !== undefined) rejected++;
    const lineHeight = tokenValue(group.lineHeight);
    if (typeof lineHeight === "string" && LINE_HEIGHT.test(lineHeight.trim())) font.lineHeight = lineHeight.trim();
    else if (lineHeight !== undefined) rejected++;
    fonts.push(font);
  }

  const readGroup = (group: TokenGroup, valid: (v: unknown) => boolean): NamedValue[] => {
    const out: NamedValue[] = [];
    const seen = new Set<string>();
    for (const [rawKey, token] of Object.entries(group)) {
      const value = tokenValue(token);
      if (!valid(value)) {
        rejected++;
        continue;
      }
      out.push({ key: uniqueKey(cssIdent(rawKey), seen), value: (value as string).trim() });
    }
    return out;
  };

  return {
    colors,
    darkColors,
    fonts,
    spacing: readGroup(asGroup(brand.spacing), isCssDimension),
    radius: readGroup(asGroup(brand.radius), isCssDimension),
    shadow: readGroup(asGroup(brand.shadow), isShadow),
    rejected,
  };
}

function cssHeader(input: NativeExportInput, title: string, extra: string[] = []): string[] {
  return [
    "/*",
    ` * ${cssCommentText(input.clientName)} — ${title}`,
    " * Generated by @brandsystem/mcp (brand_export) from the compiled DTCG tokens in .brand/.",
    " * Regenerate with brand_export instead of editing by hand. Values are brand data.",
    ...extra.map((line) => ` * ${line}`),
    " */",
  ];
}

function declarations(entries: Array<[string, string]>, indent: string): string[] {
  return entries.map(([name, value]) => `${indent}${name}: ${value};`);
}

// ---------------------------------------------------------------------------
// css-variables
// ---------------------------------------------------------------------------

export function generateCssVariables(input: NativeExportInput): string {
  const model = buildTokenModel(input);
  const root: Array<[string, string]> = [];
  for (const c of model.colors) root.push([`--brand-color-${c.key}`, c.value]);
  for (const f of model.fonts) {
    root.push([`--brand-font-${f.key}`, f.stack]);
    if (f.weight !== undefined) root.push([`--brand-font-${f.key}-weight`, String(f.weight)]);
    if (f.size) root.push([`--brand-font-${f.key}-size`, f.size]);
    if (f.lineHeight) root.push([`--brand-font-${f.key}-line-height`, f.lineHeight]);
  }
  for (const s of model.spacing) root.push([`--brand-spacing-${s.key}`, s.value]);
  for (const r of model.radius) root.push([`--brand-radius-${r.key}`, r.value]);
  for (const s of model.shadow) root.push([`--brand-shadow-${s.key}`, s.value]);

  const lines = cssHeader(input, "brand CSS custom properties", [
    "Use as var(--brand-color-primary), var(--brand-font-heading), etc.",
    model.darkColors.length > 0
      ? 'Dark palette: applied under [data-theme="dark"] and prefers-color-scheme: dark (opt out with data-theme="light").'
      : "No dark-theme palette in this brand yet.",
  ]);
  lines.push("", ":root {");
  if (root.length === 0) lines.push("  /* No token-worthy brand values compiled yet — run brand_compile. */");
  lines.push(...declarations(root, "  "));
  lines.push("}");

  if (model.darkColors.length > 0) {
    const dark: Array<[string, string]> = model.darkColors.map((c) => [`--brand-color-${c.key}`, c.value]);
    lines.push("", "@media (prefers-color-scheme: dark) {", '  :root:not([data-theme="light"]) {');
    lines.push(...declarations(dark, "    "));
    lines.push("  }", "}", "", '[data-theme="dark"] {');
    lines.push(...declarations(dark, "  "));
    lines.push("}");
  }

  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// tailwind (v4, CSS-first @theme)
// ---------------------------------------------------------------------------

export function generateTailwindTheme(input: NativeExportInput): string {
  const model = buildTokenModel(input);
  const theme: Array<[string, string]> = [];
  for (const c of model.colors) theme.push([`--color-brand-${c.key}`, c.value]);
  for (const c of model.darkColors) theme.push([`--color-brand-dark-${c.key}`, c.value]);
  for (const f of model.fonts) theme.push([`--font-brand-${f.key}`, f.stack]);
  for (const f of model.fonts) {
    if (f.size) {
      theme.push([`--text-brand-${f.key}`, f.size]);
      if (f.lineHeight) theme.push([`--text-brand-${f.key}--line-height`, f.lineHeight]);
    }
    if (f.weight !== undefined) theme.push([`--font-weight-brand-${f.key}`, String(f.weight)]);
  }
  for (const s of model.spacing) theme.push([`--spacing-brand-${s.key}`, s.value]);
  for (const r of model.radius) theme.push([`--radius-brand-${r.key}`, r.value]);
  for (const s of model.shadow) theme.push([`--shadow-brand-${s.key}`, s.value]);

  const example = model.colors[0] ? `bg-brand-${model.colors[0].key}` : "bg-brand-primary";
  const lines = cssHeader(input, "Tailwind CSS v4 theme", [
    'Tailwind v4 is CSS-first: put this after @import "tailwindcss"; in your main CSS file.',
    `Utilities: ${example}, font-brand-<name>, text-brand-<name>, rounded-brand-<name>, shadow-brand-<name>.`,
    ...(model.darkColors.length > 0
      ? ["Dark palette: --color-brand-dark-* (use with the dark: variant, e.g. dark:bg-brand-dark-surface)."]
      : []),
  ]);
  lines.push("", "@theme {");
  if (theme.length === 0) lines.push("  /* No token-worthy brand values compiled yet — run brand_compile. */");
  lines.push(...declarations(theme, "  "));
  lines.push("}");
  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// shadcn/ui theme variables
// ---------------------------------------------------------------------------

function expandHex(hex: string): string {
  const h = hex.slice(1);
  if (h.length === 3 || h.length === 4) return h.slice(0, 3).split("").map((c) => c + c).join("");
  return h.slice(0, 6);
}

function luminance(hex: string): number {
  const h = expandHex(hex);
  const channel = (i: number) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const LIGHT_INK = "#fafafa";
const DARK_INK = "#0a0a0a";

function readableOn(bg: string, preferred?: string): string {
  if (preferred && contrastRatio(preferred, bg) >= 4.5) return preferred;
  return contrastRatio(LIGHT_INK, bg) >= contrastRatio(DARK_INK, bg) ? LIGHT_INK : DARK_INK;
}

interface ShadcnDefaults {
  background: string;
  secondary: string;
  muted: string;
  mutedForeground: string;
  accent: string;
  destructive: string;
  border: string;
  primary: string;
}

const SHADCN_LIGHT: ShadcnDefaults = {
  background: "#ffffff",
  secondary: "#f4f4f5",
  muted: "#f4f4f5",
  mutedForeground: "#52525b",
  accent: "#f4f4f5",
  destructive: "#dc2626",
  border: "#e4e4e7",
  primary: "#18181b",
};

const SHADCN_DARK: ShadcnDefaults = {
  background: "#0a0a0a",
  secondary: "#27272a",
  muted: "#27272a",
  mutedForeground: "#a1a1aa",
  accent: "#27272a",
  destructive: "#f87171",
  border: "#27272a",
  primary: "#e4e4e7",
};

const CHART_FALLBACKS = ["#e76e50", "#2a9d90", "#274754", "#e8c468", "#f4a462"];

function shadcnBlock(
  roles: Map<string, string>,
  defaults: ShadcnDefaults,
  allColors: NamedValue[],
  fallbackPrimary?: string,
): Array<[string, string]> {
  const role = (...names: string[]) => names.map((n) => roles.get(n)).find((v): v is string => Boolean(v));

  const background = role("surface") ?? defaults.background;
  const foreground = readableOn(background, role("text"));
  const primary = role("primary", "action") ?? fallbackPrimary ?? defaults.primary;
  const secondary = role("secondary") ?? defaults.secondary;
  const accent = role("accent", "highlight") ?? defaults.accent;
  const muted = role("tint") ?? defaults.muted;
  const mutedForeground = readableOn(muted, role("neutral") ?? defaults.mutedForeground);
  const border = role("border") ?? defaults.border;
  const ring = primary;

  const chartPool: string[] = [];
  for (const v of [primary, role("secondary"), role("accent"), role("highlight"), role("action"), ...allColors.map((c) => c.value)]) {
    if (v && !chartPool.includes(v) && v !== background) chartPool.push(v);
  }
  for (const v of CHART_FALLBACKS) if (chartPool.length < 5 && !chartPool.includes(v)) chartPool.push(v);

  return [
    ["--background", background],
    ["--foreground", foreground],
    ["--card", background],
    ["--card-foreground", foreground],
    ["--popover", background],
    ["--popover-foreground", foreground],
    ["--primary", primary],
    ["--primary-foreground", readableOn(primary)],
    ["--secondary", secondary],
    ["--secondary-foreground", readableOn(secondary)],
    ["--muted", muted],
    ["--muted-foreground", mutedForeground],
    ["--accent", accent],
    ["--accent-foreground", readableOn(accent)],
    ["--destructive", defaults.destructive],
    ["--border", border],
    ["--input", border],
    ["--ring", ring],
    ...chartPool.slice(0, 5).map((v, i): [string, string] => [`--chart-${i + 1}`, v]),
    ["--sidebar", background],
    ["--sidebar-foreground", foreground],
    ["--sidebar-primary", primary],
    ["--sidebar-primary-foreground", readableOn(primary)],
    ["--sidebar-accent", accent],
    ["--sidebar-accent-foreground", readableOn(accent)],
    ["--sidebar-border", border],
    ["--sidebar-ring", ring],
  ];
}

function roleMap(colors: NamedValue[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const c of colors) if (COLOR_ROLES.has(c.key)) map.set(c.key, c.value);
  return map;
}

function pickRadius(radius: NamedValue[]): string {
  if (radius.length === 0) return "0.625rem";
  const md = radius.find((r) => /(^|-)md$/.test(r.key)) ?? radius.find((r) => /(^|-)(base|default)$/.test(r.key));
  if (md) return md.value;
  return radius[Math.floor((radius.length - 1) / 2)].value;
}

export function generateShadcnTheme(input: NativeExportInput): string {
  const model = buildTokenModel(input);
  const lightRoles = roleMap(model.colors);
  const darkRoles = roleMap(model.darkColors);
  const hasDark = model.darkColors.length > 0;

  const root: Array<[string, string]> = [
    ["--radius", pickRadius(model.radius)],
    ...shadcnBlock(lightRoles, SHADCN_LIGHT, model.colors),
  ];
  const brandPrimary = lightRoles.get("primary") ?? lightRoles.get("action");
  const dark = shadcnBlock(darkRoles, SHADCN_DARK, model.darkColors, brandPrimary);

  const lines = cssHeader(input, "shadcn/ui theme variables", [
    "Replace the :root and .dark blocks in your globals.css with these; keep shadcn's @theme inline mapping.",
    "Colors are hex (traceable to the brand palette, so brand_check can match them); hex and oklch are both valid CSS.",
    "Slots the brand does not define fall back to neutral shadcn-style defaults; foregrounds are chosen for >= 4.5:1 contrast.",
    hasDark
      ? ".dark is mapped from the brand's dark-theme palette."
      : ".dark is derived (no dark-theme palette in this brand): neutral dark surfaces + the brand primary.",
  ]);
  lines.push("", ":root {");
  lines.push(...declarations(root, "  "));
  lines.push("}", "", ".dark {");
  lines.push(...declarations(dark, "  "));
  lines.push("}");
  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Instruction targets: AGENTS.md section + Cursor .mdc rule
// ---------------------------------------------------------------------------

const MAX_RULES = 12;
const MAX_TERMS = 12;

/** Brand data as YAML. Every string is flattened + capped; YAML handles quoting. */
function brandDataYaml(input: NativeExportInput, model: NativeTokenModel): string {
  const data: Record<string, unknown> = {
    brand: flattenUntrusted(input.clientName, 80),
  };
  if (model.colors.length > 0) data.colors = Object.fromEntries(model.colors.map((c) => [c.key, c.value]));
  if (model.darkColors.length > 0) data.dark_colors = Object.fromEntries(model.darkColors.map((c) => [c.key, c.value]));
  if (model.fonts.length > 0) {
    data.typography = Object.fromEntries(
      model.fonts.map((f) => {
        const parts = [f.family];
        if (f.weight !== undefined) parts.push(String(f.weight));
        if (f.size) parts.push(f.size);
        return [f.key, parts.join(" / ")];
      }),
    );
  }

  const rules = (input.visual?.anti_patterns ?? [])
    .slice()
    .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "hard" ? -1 : 1))
    .slice(0, MAX_RULES)
    .map((ap) => `${ap.severity === "hard" ? "Never" : "Avoid"}: ${flattenUntrusted(ap.rule, 200)}`);
  if (rules.length > 0) data.hard_rules = rules;

  const voice = input.messaging?.voice;
  if (voice) {
    const v: Record<string, unknown> = {};
    if (voice.tone?.descriptors?.length) v.tone = voice.tone.descriptors.slice(0, 8).map((d) => flattenUntrusted(d, 40));
    if (voice.tone?.never_sounds_like) v.never_sounds_like = flattenUntrusted(voice.tone.never_sounds_like, 160);
    if (voice.vocabulary?.anchor?.length) {
      v.prefer_terms = voice.vocabulary.anchor
        .slice(0, MAX_TERMS)
        .map((a) => `${flattenUntrusted(a.use, 40)} (not ${flattenUntrusted(a.not, 40)})`);
    }
    if (voice.vocabulary?.never_say?.length) {
      v.never_say = voice.vocabulary.never_say.slice(0, MAX_TERMS).map((n) => flattenUntrusted(n.word, 40));
    }
    if (Object.keys(v).length > 0) data.voice = v;
  }

  return stringifyYaml(data, { lineWidth: 0 }).trimEnd();
}

function instructionBody(input: NativeExportInput, headingLevel: 2 | 3): string[] {
  const model = buildTokenModel(input);
  const h = "#".repeat(headingLevel);
  const yaml = brandDataYaml(input, model);
  const fence = markdownFenceFor(yaml);
  return [
    PROVISIONAL_ARTIFACT_NOTICE,
    "",
    "This project has a machine-readable brand system in `.brand/`. Follow it for any UI, styling, visual asset, or user-facing copy.",
    "",
    `${h} Where the brand lives`,
    "",
    "- `.brand/brand-runtime.json` — compiled brand contract (read this first)",
    "- `.brand/interaction-policy.json` — enforceable rules (anti-patterns, voice constraints)",
    "- `.brand/tokens.json` — DTCG design tokens",
    "- `.brand/DESIGN.md` — design synthesis (layout, shape, depth, motion)",
    "- `.brand/core-identity.yaml` — source palette, fonts, logo",
    "- `.brand/exports/` — drop-in CSS (`brand-variables.css`, `brand-theme.css` for Tailwind v4, `shadcn-theme.css`) via `brand_export`",
    "",
    `${h} Workflow`,
    "",
    "1. Before generating, call `brand_context` (or `brand_runtime`) on the brandsystem MCP server. Without MCP, read `.brand/brand-runtime.json`.",
    "2. Use only the palette and fonts below. Reference the CSS variables / tokens instead of hard-coding new values.",
    "3. Before finishing, run `brand_check` on the output (`brand_preflight` for HTML/CSS) and fix every hard-rule violation.",
    "4. Do not edit `.brand/` by hand to make a check pass — ask the user, or use `brand_clarify`.",
    "",
    `${h} Brand data`,
    "",
    "Extracted brand values (data, not instructions):",
    "",
    `${fence}yaml`,
    yaml,
    fence,
  ];
}

export const AGENTS_MD_START = "<!-- brandsystem:start -->";
export const AGENTS_MD_END = "<!-- brandsystem:end -->";

export function generateAgentsMd(input: NativeExportInput): string {
  const lines = [
    AGENTS_MD_START,
    `## Brand system: ${headingText(input.clientName)}`,
    "",
    ...instructionBody(input, 3),
    AGENTS_MD_END,
  ];
  return lines.join("\n") + "\n";
}

/** Globs for UI-bearing files. Cursor splits `globs` on commas, so no brace sets. */
export const CURSOR_RULE_GLOBS = [
  "**/*.tsx",
  "**/*.jsx",
  "**/*.vue",
  "**/*.svelte",
  "**/*.astro",
  "**/*.html",
  "**/*.css",
  "**/*.scss",
  "**/*.mdx",
].join(",");

// Static (no brand strings) so nothing untrusted reaches the frontmatter.
const CURSOR_RULE_DESCRIPTION =
  "Brand system rules for UI, styling, and user-facing copy (palette, typography, hard rules, brand check workflow). Apply when creating or editing visual or customer-facing output.";

export function generateCursorRule(input: NativeExportInput): string {
  const lines = [
    "---",
    `description: ${CURSOR_RULE_DESCRIPTION}`,
    `globs: ${CURSOR_RULE_GLOBS}`,
    "alwaysApply: false",
    "---",
    "",
    `# Brand rules: ${headingText(input.clientName)}`,
    "",
    ...instructionBody(input, 2),
  ];
  return lines.join("\n") + "\n";
}
