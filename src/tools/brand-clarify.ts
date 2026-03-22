import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { BrandDir } from "../lib/brand-dir.js";
import { buildResponse } from "../lib/response.js";
import type { ColorEntry, ClarificationItem } from "../types/index.js";
import type { NeedsClarificationData } from "../schemas/index.js";
import type { CoreIdentityData } from "../schemas/index.js";

const paramsShape = {
  id: z.string().describe("Clarification item ID (e.g. 'clarify-1')"),
  answer: z.string().describe("Your answer or correction for this clarification item"),
};

type Params = { id: string; answer: string };

const HEX_RE = /^#[0-9a-fA-F]{3,8}$/;
const VALID_ROLES = ["primary", "secondary", "accent", "neutral", "surface", "text", "action"] as const;
type ColorRole = (typeof VALID_ROLES)[number];

function isValidRole(s: string): s is ColorRole {
  return (VALID_ROLES as readonly string[]).includes(s.toLowerCase());
}

/**
 * Parse role assignment strings like "#5544f2 is accent, #f44d37 is secondary"
 * Returns an array of { hex, role } pairs.
 */
function parseRoleAssignments(answer: string): Array<{ hex: string; role: ColorRole }> {
  const assignments: Array<{ hex: string; role: ColorRole }> = [];

  // Match patterns like "#hex is role" or "#hex = role" or "#hex: role"
  const pattern = /(#[0-9a-fA-F]{3,8})\s*(?:is|=|:|-|—)\s*(\w+)/gi;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(answer)) !== null) {
    const hex = match[1].toLowerCase();
    const roleName = match[2].toLowerCase();
    if (HEX_RE.test(hex) && isValidRole(roleName)) {
      assignments.push({ hex, role: roleName as ColorRole });
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
    const assignments = parseRoleAssignments(input.answer);
    if (assignments.length === 0) {
      return buildResponse({
        what_happened: "Could not parse role assignments from your answer",
        next_steps: [
          'Format: "#hex is role, #hex is role" (e.g. "#5544f2 is accent, #f44d37 is secondary")',
          `Valid roles: ${VALID_ROLES.join(", ")}`,
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

    if (HEX_RE.test(answer)) {
      // Answer is a hex value — update or add a color with this role
      const existingIdx = identity.colors.findIndex(
        (c) => c.role === rolePart || c.value.toLowerCase() === answer.toLowerCase()
      );

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
      const colorIdx = identity.colors.findIndex(
        (c) => c.role === rolePart || c.role === "unknown"
      );
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
      const colorIdx = identity.colors.findIndex((c) => c.role === rolePart);
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
    "Resolve a clarification item from needs-clarification.yaml. Each item has an ID and a question about ambiguous brand data (colors, fonts, roles). Provide the item ID and your answer to update core-identity.yaml with confirmed values. Use AFTER brand_compile surfaces clarification items.",
    paramsShape,
    async (args) => handler(args as Params)
  );
}
