import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readFile } from "node:fs/promises";
import { BrandDir } from "../lib/brand-dir.js";
import { buildResponse, safeParseParams } from "../lib/response.js";
import {
  loadBrandContext,
  scoreContent,
  isHtmlContent,
} from "../lib/content-scorer.js";
import { ERROR_CODES } from "../types/index.js";

// ---------------------------------------------------------------------------
// Content resolution
// ---------------------------------------------------------------------------

async function resolveContent(input: string): Promise<{ content: string; isHtml: boolean }> {
  // Check if it's a file path
  if (/\.(html?|md|txt)$/i.test(input.trim()) && !input.includes("\n") && input.length < 500) {
    try {
      const content = await readFile(input.trim(), "utf-8");
      return { content, isHtml: /\.html?$/i.test(input.trim()) || isHtmlContent(content) };
    } catch {
      // Not a file path — treat as inline content
    }
  }
  return { content: input, isHtml: isHtmlContent(input) };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

async function handler(input: AuditContentParams) {
  const brandDir = new BrandDir(process.cwd());

  if (!(await brandDir.exists())) {
    return buildResponse({
      what_happened: "No .brand/ directory found",
      next_steps: ["Run brand_start to create a brand system first"],
      data: { error: ERROR_CODES.NOT_INITIALIZED },
    });
  }

  let ctx;
  try {
    ctx = await loadBrandContext(brandDir);
  } catch {
    return buildResponse({
      what_happened: "Could not read brand identity data",
      next_steps: ["Run brand_extract_web to populate core identity"],
      data: { error: ERROR_CODES.NO_CORE_IDENTITY },
    });
  }

  const { content, isHtml } = await resolveContent(input.content);

  if (!content.trim()) {
    return buildResponse({
      what_happened: "Empty content — nothing to audit",
      next_steps: ["Provide content to audit (text, HTML, or file path)"],
      data: { error: ERROR_CODES.EMPTY_CONTENT },
    });
  }

  const result = scoreContent(content, isHtml, ctx);

  // Build summary
  const dimNames = result.dimensions_available;
  const summary = `Content audit: ${result.overall}/100 across ${dimNames.length} dimension(s) (${dimNames.join(", ")})`;

  const nextSteps: string[] = [];
  if (result.overall < 70) {
    nextSteps.push("Score is below 70 — review the issues and fix before publishing");
  }
  if (result.issues.filter((i) => i.severity === "critical").length > 0) {
    nextSteps.push("Critical issues found — these are hard-stop violations");
  }
  if (result.dimensions_locked.length > 0) {
    const sessions: string[] = [];
    if (result.dimensions_locked.includes("token_compliance")) sessions.push("Session 1 (brand_extract_web)");
    if (result.dimensions_locked.includes("visual_compliance")) sessions.push("Session 2 (brand_deepen_identity)");
    if (result.dimensions_locked.includes("voice_alignment") || result.dimensions_locked.includes("message_coverage")) {
      sessions.push("Session 3 (brand_compile_messaging)");
    }
    nextSteps.push(`${result.dimensions_locked.length} dimension(s) locked — complete ${sessions.join(", ")} to unlock`);
  }
  if (result.overall >= 70 && result.issues.filter((i) => i.severity === "critical").length === 0) {
    nextSteps.push("Content passes baseline compliance — review warnings for further improvement");
  }

  return buildResponse({
    what_happened: summary,
    next_steps: nextSteps,
    data: {
      overall_score: result.overall,
      dimensions_available: result.dimensions_available,
      dimensions_locked: result.dimensions_locked,
      scores: result.dimensions,
      issues: result.issues.slice(0, 15),
      content_type_detected: isHtml ? "html" : "text",
      conversation_guide: {
        instruction: "Present the overall score prominently, then walk through each dimension. For low-scoring dimensions, show specific examples from the content and suggest rewrites.",
      },
    } as unknown as Record<string, unknown>,
  });
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

const paramsShape = {
  content: z
    .string()
    .describe(
      "Content to audit: raw text, an HTML string, or a file path ending in .html/.htm/.md/.txt. HTML gets visual + voice analysis; plain text gets voice analysis only."
    ),
  depth: z
    .enum(["quick", "standard", "deep"])
    .default("standard")
    .describe(
      "Audit depth: 'quick' = token compliance only, 'standard' = + voice and message coverage, 'deep' = + visual anti-patterns. Default: 'standard'."
    ),
};

const ParamsSchema = z.object(paramsShape);
type AuditContentParams = z.infer<typeof ParamsSchema>;

export function register(server: McpServer) {
  server.tool(
    "brand_audit_content",
    "Check if content is on-brand — score any text or markup 0-100 for brand compliance. Checks color/font usage, voice alignment, anti-pattern violations, and message coverage. Use when asked 'is this on-brand?', 'brand compliance score', 'check brand alignment', or after generating any content. Works progressively: Session 1 scores tokens, Session 2 adds visual compliance, Session 3 adds voice and messaging. Returns 0-100 score with per-dimension breakdown and specific issues. NOT for .brand/ directory validation (use brand_audit) or HTML/CSS rule checking (use brand_preflight).",
    paramsShape,
    async (args) => {
      const parsed = safeParseParams(ParamsSchema, args);
      if (!parsed.success) return parsed.response;
      return handler(parsed.data);
    },
  );
}
