import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { BrandDir } from "../lib/brand-dir.js";
import { buildResponse, safeParseParams } from "../lib/response.js";
import type { ColorEntry, ClarificationItem } from "../types/index.js";
import type { NeedsClarificationData } from "../schemas/index.js";
import type { CoreIdentityData } from "../schemas/index.js";

const paramsShape = {
  id: z.string().describe("Clarification item ID from needs-clarification.yaml (e.g. 'clarify-1')"),
  answer: z.string().describe("The user's answer: a hex color (#ff0000), a role name (primary, secondary, accent), a font name, 'yes'/'no', or natural language ('the purple one is accent, the dark one is neutral')"),
};

const ParamsSchema = z.object(paramsShape);
type Params = z.infer<typeof ParamsSchema>;

const HEX_RE = /^#[0-9a-fA-F]{3,8}$/;
const VALID_ROLES = ["primary", "secondary", "accent", "neutral", "surface", "text", "action"] as const;
type ColorRole = (typeof VALID_ROLES)[number];

function isValidRole(s: string): s is ColorRole {
  return (VALID_ROLES as readonly string[]).includes(s.toLowerCase());
}

/**
 * Parse a hex color string into RGB components (0-255).
 * Supports 3, 4, 6, and 8 character hex values.
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let h = hex.replace("#", "").toLowerCase();
  // Expand shorthand (3 or 4 char) to 6 or 8 char
  if (h.length === 3 || h.length === 4) {
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  }
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return { r, g, b };
}

/**
 * Compute relative luminance (0 = black, 1 = white).
 */
function luminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/**
 * Compute HSL saturation (0-1) from a hex color.
 */
function saturation(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  if (max === min) return 0;
  const l = (max + min) / 2;
  return l > 0.5
    ? (max - min) / (2 - max - min)
    : (max - min) / (max + min);
}

// Scoring functions for color keyword matching: higher = better match
const colorKeywords: Record<string, (hex: string) => number> = {
  purple: (h) => {
    const { r, g, b } = hexToRgb(h);
    // Purple = high blue + some red, low green
    return (r + b) / 2 - g + (b > g && r > g ? 50 : 0);
  },
  violet: (h) => {
    const { r, g, b } = hexToRgb(h);
    return (r + b) / 2 - g + (b > g && r > g ? 50 : 0);
  },
  blue: (h) => {
    const { r, g, b } = hexToRgb(h);
    return b - (r + g) / 2;
  },
  red: (h) => {
    const { r, g, b } = hexToRgb(h);
    return r - (g + b) / 2;
  },
  coral: (h) => {
    const { r, g, b } = hexToRgb(h);
    // Coral = high red, some green, low blue (warm reddish)
    return r - b + (r > 150 && g > 50 && g < 150 ? 30 : 0);
  },
  orange: (h) => {
    const { r, g, b } = hexToRgb(h);
    // Orange = high red, medium green, low blue
    return r + g / 2 - b * 2 + (r > 180 && g > 80 && g < 200 && b < 100 ? 50 : 0);
  },
  yellow: (h) => {
    const { r, g, b } = hexToRgb(h);
    return (r + g) / 2 - b;
  },
  green: (h) => {
    const { r, g, b } = hexToRgb(h);
    return g - (r + b) / 2;
  },
  teal: (h) => {
    const { r, g, b } = hexToRgb(h);
    return (g + b) / 2 - r;
  },
  cyan: (h) => {
    const { r, g, b } = hexToRgb(h);
    return (g + b) / 2 - r;
  },
  pink: (h) => {
    const { r, g, b } = hexToRgb(h);
    return (r + b) / 2 - g + (r > 180 ? 30 : 0);
  },
  magenta: (h) => {
    const { r, g, b } = hexToRgb(h);
    return (r + b) / 2 - g;
  },
  dark: (h) => {
    return 1 - luminance(h); // darker = higher score
  },
  light: (h) => {
    return luminance(h); // lighter = higher score
  },
  white: (h) => {
    return luminance(h); // closest to white
  },
  black: (h) => {
    return 1 - luminance(h); // closest to black
  },
  gray: (h) => {
    // Low saturation = more gray
    return 1 - saturation(h);
  },
  grey: (h) => {
    return 1 - saturation(h);
  },
  neutral: (h) => {
    return 1 - saturation(h);
  },
};

/**
 * Find the scoring function that matches a color description.
 * Returns the scoreFn or null if no keyword matched.
 */
function findScoringFunction(desc: string): ((hex: string) => number) | null {
  const lower = desc.toLowerCase().trim();
  for (const [keyword, scoreFn] of Object.entries(colorKeywords)) {
    if (lower.includes(keyword)) {
      return scoreFn;
    }
  }
  return null;
}

/**
 * Match a natural-language color description (e.g. "purple", "dark", "the light one")
 * to the best-matching hex value from a list of colors.
 * Returns the hex string of the best match, or null if no keyword matched.
 */
export function matchColorByDescription(
  desc: string,
  colors: Array<{ value: string; role: string }>
): string | null {
  const lower = desc.toLowerCase().trim();

  // Direct hex match
  if (/^#[0-9a-f]{3,8}$/i.test(lower)) return lower;

  const scoreFn = findScoringFunction(desc);
  if (!scoreFn) return null;

  let bestHex: string | null = null;
  let bestScore = -Infinity;
  for (const c of colors) {
    const score = scoreFn(c.value);
    if (score > bestScore) {
      bestScore = score;
      bestHex = c.value;
    }
  }
  return bestHex;
}

/**
 * Match a natural-language color description to the top N best-matching hex values.
 * Used when the user refers to colors in the plural ("the coral/red ones are secondary").
 * Returns up to `limit` hex strings sorted by score (best first), or empty array if no match.
 */
export function matchMultipleColorsByDescription(
  desc: string,
  colors: Array<{ value: string; role: string }>,
  limit = 3
): string[] {
  const lower = desc.toLowerCase().trim();

  // Direct hex match — return as single-element array
  if (/^#[0-9a-f]{3,8}$/i.test(lower)) return [lower];

  const scoreFn = findScoringFunction(desc);
  if (!scoreFn) return [];

  return colors
    .map((c) => ({ hex: c.value, score: scoreFn(c.value) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .filter((s) => s.score > 0)
    .map((s) => s.hex);
}

/**
 * Parse role assignment strings like "#5544f2 is accent, #f44d37 is secondary"
 * or natural language like "the purple one is accent, the dark color is neutral".
 * Returns an array of { hex, role } pairs.
 */
function parseRoleAssignments(
  answer: string,
  colors: Array<{ value: string; role: string }> = []
): Array<{ hex: string; role: ColorRole }> {
  const assignments: Array<{ hex: string; role: ColorRole }> = [];

  // --- Primary path: exact hex references ---
  const hexPattern = /(#[0-9a-fA-F]{3,8})\s*(?:is|=|:|-|—)\s*(\w+)/gi;
  let match: RegExpExecArray | null;

  while ((match = hexPattern.exec(answer)) !== null) {
    const hex = match[1].toLowerCase();
    const roleName = match[2].toLowerCase();
    if (HEX_RE.test(hex) && isValidRole(roleName)) {
      assignments.push({ hex, role: roleName as ColorRole });
    }
  }

  if (assignments.length > 0) return assignments;

  // --- Fallback: natural language color descriptions ---
  // Split on commas, semicolons, periods, "and"
  const segments = answer.split(/[,;.]|\band\b/i).map((s) => s.trim()).filter(Boolean);

  for (const segment of segments) {
    // Match patterns like "the purple one is primary", "dark color is neutral",
    // "purple = accent", "the light one is surface",
    // "the coral/red ones are secondary"
    const nlPattern = /(?:the\s+)?(.+?)\s+(?:ones?\s+)?(?:is|are|=|:|-|—)\s*(\w+)/i;
    const nlMatch = segment.match(nlPattern);
    if (!nlMatch) continue;

    const colorDesc = nlMatch[1].trim();
    const roleName = nlMatch[2].trim().toLowerCase();

    if (!isValidRole(roleName)) continue;

    // Detect plural indicators — assign to multiple matching colors
    const isPlural = /\bones\b|\bcolors\b|\bboth\b|\ball\b/i.test(segment);

    if (isPlural) {
      const matchedHexes = matchMultipleColorsByDescription(colorDesc, colors, 3);
      for (const hex of matchedHexes) {
        assignments.push({ hex: hex.toLowerCase(), role: roleName as ColorRole });
      }
    } else {
      const matchedHex = matchColorByDescription(colorDesc, colors);
      if (matchedHex) {
        assignments.push({ hex: matchedHex.toLowerCase(), role: roleName as ColorRole });
      }
    }
  }

  return assignments;
}

async function handler(input: Params) {
  const brandDir = new BrandDir(process.cwd());

  if (!(await brandDir.exists())) {
    return buildResponse({
      what_happened: "No .brand/ directory found",
      next_steps: ["Run brand_init first"],
      data: { error: "not_initialized" },
    });
  }

  // Read clarifications
  let clarifications: NeedsClarificationData;
  try {
    await access(join(brandDir.brandPath, "needs-clarification.yaml"));
    clarifications = await brandDir.readClarifications();
  } catch {
    return buildResponse({
      what_happened: "No needs-clarification.yaml found",
      next_steps: ["Run brand_compile first to generate clarification items"],
      data: { error: "no_clarifications" },
    });
  }

  // Find the item by ID
  const item = clarifications.items.find((i) => i.id === input.id);
  if (!item) {
    const validIds = clarifications.items.map((i) => `${i.id}: ${i.question}`);
    return buildResponse({
      what_happened: `Clarification item "${input.id}" not found`,
      next_steps: [
        clarifications.items.length > 0
          ? "Use one of the valid IDs listed below"
          : "No clarification items remain — run brand_compile to check for new ones",
      ],
      data: {
        error: "item_not_found",
        valid_items: validIds,
      },
    });
  }

  // Read core identity
  const identity = await brandDir.readCoreIdentity();
  const changes: string[] = [];

  // Apply the answer based on the field
  if (item.field === "colors.roles") {
    // Bulk role assignment for unknown-role colors
    const assignments = parseRoleAssignments(input.answer, identity.colors);
    if (assignments.length === 0) {
      const colorList = identity.colors.map(
        (c) => `${c.value} (current role: ${c.role})`
      );
      return buildResponse({
        what_happened: "Could not parse role assignments from your answer",
        next_steps: [
          'Format: "#hex is role" or "the purple one is accent, the dark color is neutral"',
          `Valid roles: ${VALID_ROLES.join(", ")}`,
          `Available colors: ${colorList.join(", ")}`,
          "If this keeps happening, run brand_feedback to report the issue.",
        ],
        data: { error: "parse_failed", answer: input.answer },
      });
    }

    for (const { hex, role } of assignments) {
      const colorIdx = identity.colors.findIndex(
        (c) => c.value.toLowerCase() === hex
      );
      if (colorIdx !== -1) {
        identity.colors[colorIdx].role = role;
        identity.colors[colorIdx].confidence = "confirmed";
        changes.push(`${hex} → role "${role}" (confirmed)`);
      } else {
        changes.push(`${hex} not found in colors — skipped`);
      }
    }
  } else if (item.field.startsWith("colors.")) {
    const rolePart = item.field.replace("colors.", "");
    const answer = input.answer.trim();

    // Extract hex from the question text to identify which specific color this item is about
    const hexInQuestion = item.question
      .match(/#[0-9a-fA-F]{3,8}/)?.[0]
      ?.toLowerCase();

    if (HEX_RE.test(answer)) {
      // Answer is a hex value — update or add a color with this role
      // Prefer matching by hex from question when role is "unknown"
      let existingIdx = -1;
      if (hexInQuestion) {
        existingIdx = identity.colors.findIndex(
          (c) => c.value.toLowerCase() === hexInQuestion
        );
      }
      if (existingIdx === -1) {
        existingIdx = identity.colors.findIndex(
          (c) => c.role === rolePart || c.value.toLowerCase() === answer.toLowerCase()
        );
      }

      if (existingIdx !== -1) {
        identity.colors[existingIdx].value = answer.toLowerCase();
        if (isValidRole(rolePart)) {
          identity.colors[existingIdx].role = rolePart;
        }
        identity.colors[existingIdx].confidence = "confirmed";
        changes.push(`Updated color ${answer} as "${rolePart}" (confirmed)`);
      } else {
        // Add new color entry
        const newColor: ColorEntry = {
          name: rolePart,
          value: answer.toLowerCase(),
          role: isValidRole(rolePart) ? rolePart : "unknown",
          source: "manual",
          confidence: "confirmed",
        };
        identity.colors.push(newColor);
        changes.push(`Added color ${answer} as "${rolePart}" (confirmed)`);
      }
    } else if (isValidRole(answer.toLowerCase())) {
      // Answer is a role name — find a matching color and update its role
      // Prefer matching by hex from question to avoid grabbing the wrong "unknown" color
      let colorIdx = -1;
      if (hexInQuestion) {
        colorIdx = identity.colors.findIndex(
          (c) => c.value.toLowerCase() === hexInQuestion
        );
      }
      if (colorIdx === -1) {
        colorIdx = identity.colors.findIndex(
          (c) => c.role === rolePart || c.role === "unknown"
        );
      }
      if (colorIdx !== -1) {
        const oldRole = identity.colors[colorIdx].role;
        identity.colors[colorIdx].role = answer.toLowerCase() as ColorRole;
        identity.colors[colorIdx].confidence = "confirmed";
        changes.push(
          `Color ${identity.colors[colorIdx].value}: role "${oldRole}" → "${answer.toLowerCase()}" (confirmed)`
        );
      } else {
        changes.push(`No color found with role "${rolePart}" to update`);
      }
    } else {
      // Freeform answer — try to confirm the existing color
      // Prefer matching by hex from question
      let colorIdx = -1;
      if (hexInQuestion) {
        colorIdx = identity.colors.findIndex(
          (c) => c.value.toLowerCase() === hexInQuestion
        );
      }
      if (colorIdx === -1) {
        colorIdx = identity.colors.findIndex((c) => c.role === rolePart);
      }
      if (colorIdx !== -1) {
        identity.colors[colorIdx].confidence = "confirmed";
        changes.push(`Confirmed color ${identity.colors[colorIdx].value} as "${rolePart}"`);
      } else {
        changes.push(`Applied freeform answer for "${item.field}"`);
      }
    }
  } else if (item.field.startsWith("typography.") || item.field === "typography") {
    const familyName = item.field === "typography" ? null : item.field.replace("typography.", "");
    const answerLower = input.answer.trim().toLowerCase();

    if (familyName) {
      // Specific font clarification
      const fontIdx = identity.typography.findIndex(
        (t) => t.family.toLowerCase() === familyName.toLowerCase()
      );

      if (answerLower === "yes" || answerLower === "correct" || answerLower === "confirmed") {
        // Confirm the font
        if (fontIdx !== -1) {
          identity.typography[fontIdx].confidence = "confirmed";
          changes.push(`Font "${familyName}" confirmed`);
        }
      } else if (answerLower === "no" || answerLower === "remove" || answerLower === "wrong") {
        // Remove the font
        if (fontIdx !== -1) {
          identity.typography.splice(fontIdx, 1);
          changes.push(`Font "${familyName}" removed`);
        }
      } else {
        // Correction — update the family name
        if (fontIdx !== -1) {
          const oldFamily = identity.typography[fontIdx].family;
          identity.typography[fontIdx].family = input.answer.trim();
          identity.typography[fontIdx].name = input.answer.trim();
          identity.typography[fontIdx].confidence = "confirmed";
          changes.push(`Font "${oldFamily}" → "${input.answer.trim()}" (confirmed)`);
        } else {
          // Add as a new font entry
          identity.typography.push({
            name: input.answer.trim(),
            family: input.answer.trim(),
            source: "manual",
            confidence: "confirmed",
          });
          changes.push(`Added font "${input.answer.trim()}" (confirmed)`);
        }
      }
    } else {
      // Generic "no fonts detected" — add whatever the user says
      identity.typography.push({
        name: input.answer.trim(),
        family: input.answer.trim(),
        source: "manual",
        confidence: "confirmed",
      });
      changes.push(`Added font "${input.answer.trim()}" (confirmed)`);
    }
  } else if (item.field === "logo") {
    // Logo clarification — just acknowledge; user needs to provide a file via extraction
    changes.push(`Noted logo information: "${input.answer}". Use brand_extract_web or brand_extract_figma to capture the actual logo file.`);
  } else {
    // Unknown field — apply as freeform confirmation
    changes.push(`Applied answer for field "${item.field}": ${input.answer}`);
  }

  // Write updated core identity
  await brandDir.writeCoreIdentity(identity);

  // Remove the resolved item from clarifications
  clarifications.items = clarifications.items.filter((i) => i.id !== input.id);
  await brandDir.writeClarifications(clarifications);

  const remaining = clarifications.items.length;

  const nextSteps: string[] = [];
  const conversationGuide: Record<string, string> = {};

  if (remaining > 0) {
    const nextItem = clarifications.items[0];
    nextSteps.push(
      `${remaining} clarification(s) remaining — next: brand_clarify id="${nextItem.id}" (${nextItem.question})`
    );
    conversationGuide.auto_chain = `Immediately ask the user about the next clarification item: "${nextItem.question}" (id: ${nextItem.id}). Don't wait for them to ask.`;
  } else {
    nextSteps.push("All clarifications resolved — run brand_compile to regenerate tokens with confirmed values");
    nextSteps.push("Then run brand_report to generate the updated report");
    conversationGuide.auto_chain = "All clarifications resolved. Immediately run brand_compile (don't wait for the user to ask). After compile, run brand_report. After the report, transition to Session 2 by running brand_deepen_identity.";
  }

  return buildResponse({
    what_happened: `Resolved clarification "${item.id}": ${item.question}`,
    next_steps: nextSteps,
    data: {
      resolved_id: item.id,
      changes,
      remaining_clarifications: remaining,
      remaining_items: clarifications.items.map((i) => ({
        id: i.id,
        question: i.question,
        priority: i.priority,
      })),
      conversation_guide: conversationGuide,
    },
  });
}

export function register(server: McpServer) {
  server.tool(
    "brand_clarify",
    "Resolve an ambiguous brand value interactively. After brand_compile, some values need human confirmation — wrong primary color, unknown font, unassigned color roles. Pass the clarification item ID and the user's answer (hex color, role name, font name, or 'yes'/'no'). Supports natural language: 'the purple one is accent' or '#5544f2 is secondary'. Returns updated identity and remaining clarification count.",
    paramsShape,
    async (args) => {
      const parsed = safeParseParams(ParamsSchema, args);
      if (!parsed.success) return parsed.response;
      return handler(parsed.data);
    }
  );
}
