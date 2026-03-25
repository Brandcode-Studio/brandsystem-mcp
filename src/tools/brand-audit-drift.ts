import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readFile } from "node:fs/promises";
import { BrandDir } from "../lib/brand-dir.js";
import { buildResponse } from "../lib/response.js";
import {
  loadBrandContext,
  scoreContent,
  isHtmlContent,
  type ContentScore,
  type ContentIssue,
} from "../lib/content-scorer.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DriftItem {
  label: string;
  content: string;
}

interface ItemResult {
  label: string;
  overall_score: number;
  below_threshold: boolean;
  dimensions: Record<string, number>;
  top_issues: string[];
}

// ---------------------------------------------------------------------------
// Content resolution
// ---------------------------------------------------------------------------

async function resolveContent(input: string): Promise<{ content: string; isHtml: boolean }> {
  if (/\.(html?|md|txt)$/i.test(input.trim()) && !input.includes("\n") && input.length < 500) {
    try {
      const content = await readFile(input.trim(), "utf-8");
      return { content, isHtml: /\.html?$/i.test(input.trim()) || isHtmlContent(content) };
    } catch { /* not a file */ }
  }
  return { content: input, isHtml: isHtmlContent(input) };
}

// ---------------------------------------------------------------------------
// Statistical helpers
// ---------------------------------------------------------------------------

function mean(arr: number[]): number {
  return arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function stddev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const avg = mean(arr);
  const variance = arr.reduce((sum, v) => sum + (v - avg) ** 2, 0) / arr.length;
  return Math.sqrt(variance);
}

// ---------------------------------------------------------------------------
// Drift pattern detection
// ---------------------------------------------------------------------------

interface DriftPattern {
  dimension: string;
  pattern: string;
  affected_items: number;
  total_items: number;
  detail: string;
}

function detectDriftPatterns(
  results: Array<{ label: string; score: ContentScore }>,
): DriftPattern[] {
  const patterns: DriftPattern[] = [];
  const total = results.length;
  if (total < 2) return patterns;

  // Collect all issues across items, grouped by dimension+message
  const issueMap = new Map<string, { count: number; dimension: string; message: string; labels: string[] }>();

  for (const r of results) {
    for (const issue of r.score.issues) {
      const key = `${issue.dimension}:${issue.message}`;
      const entry = issueMap.get(key) || { count: 0, dimension: issue.dimension, message: issue.message, labels: [] };
      entry.count++;
      entry.labels.push(r.label);
      issueMap.set(key, entry);
    }
  }

  // Issues appearing in >50% of items are systematic
  for (const [, entry] of issueMap) {
    if (entry.count >= Math.ceil(total * 0.5) && entry.count >= 2) {
      patterns.push({
        dimension: entry.dimension,
        pattern: entry.message,
        affected_items: entry.count,
        total_items: total,
        detail: `Affects: ${entry.labels.slice(0, 3).join(", ")}${entry.labels.length > 3 ? ` (+${entry.labels.length - 3} more)` : ""}`,
      });
    }
  }

  // Check for dimensions that are consistently low across items
  const dimNames = ["token_compliance", "visual_compliance", "voice_alignment", "message_coverage"] as const;
  for (const dim of dimNames) {
    const scores = results
      .map((r) => r.score.dimensions[dim]?.score)
      .filter((s): s is number => s !== undefined);
    if (scores.length >= 2) {
      const avg = mean(scores);
      if (avg < 60) {
        patterns.push({
          dimension: dim,
          pattern: `Consistently low ${dim.replace(/_/g, " ")}`,
          affected_items: scores.filter((s) => s < 60).length,
          total_items: scores.length,
          detail: `Average: ${Math.round(avg)}/100`,
        });
      }
    }
  }

  return patterns;
}

// ---------------------------------------------------------------------------
// Drift report markdown
// ---------------------------------------------------------------------------

function buildDriftReport(
  itemResults: ItemResult[],
  corpusStats: Record<string, unknown>,
  driftPatterns: DriftPattern[],
  threshold: number,
): string {
  const lines: string[] = [
    "# Brand Drift Report",
    "",
    `**Generated:** ${new Date().toISOString().split("T")[0]}`,
    `**Items audited:** ${itemResults.length}`,
    `**Threshold:** ${threshold}`,
    "",
    "## Summary",
    "",
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Mean score | ${(corpusStats.mean_score as number)}/100 |`,
    `| Median score | ${(corpusStats.median_score as number)}/100 |`,
    `| Items below threshold | ${(corpusStats.items_below_threshold as number)}/${itemResults.length} |`,
    "",
  ];

  if (driftPatterns.length > 0) {
    lines.push("## Systematic Drift Patterns", "");
    for (const p of driftPatterns) {
      lines.push(`- **${p.dimension}**: ${p.pattern} (${p.affected_items}/${p.total_items} items)`);
      lines.push(`  - ${p.detail}`);
    }
    lines.push("");
  }

  lines.push("## Per-Item Scores", "");
  lines.push("| Item | Score | Status |");
  lines.push("|------|-------|--------|");
  for (const item of itemResults) {
    const status = item.below_threshold ? "BELOW" : "OK";
    lines.push(`| ${item.label} | ${item.overall_score}/100 | ${status} |`);
  }
  lines.push("");

  // Detail section for below-threshold items
  const belowItems = itemResults.filter((i) => i.below_threshold);
  if (belowItems.length > 0) {
    lines.push("## Items Below Threshold", "");
    for (const item of belowItems) {
      lines.push(`### ${item.label} (${item.overall_score}/100)`, "");
      if (item.top_issues.length > 0) {
        for (const issue of item.top_issues) {
          lines.push(`- ${issue}`);
        }
        lines.push("");
      }
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

interface AuditDriftParams {
  items: string;
  threshold: number;
}

async function handler(input: AuditDriftParams) {
  const brandDir = new BrandDir(process.cwd());

  if (!(await brandDir.exists())) {
    return buildResponse({
      what_happened: "No .brand/ directory found",
      next_steps: ["Run brand_start to create a brand system first"],
      data: { error: "not_initialized" },
    });
  }

  let ctx;
  try {
    ctx = await loadBrandContext(brandDir);
  } catch {
    return buildResponse({
      what_happened: "Could not read brand identity data",
      next_steps: ["Run brand_extract_web to populate core identity"],
      data: { error: "no_core_identity" },
    });
  }

  // Parse items
  let items: DriftItem[];
  try {
    const parsed = JSON.parse(input.items);
    if (!Array.isArray(parsed)) throw new Error("Expected array");
    items = parsed.map((item: { content?: string; label?: string }, i: number) => ({
      label: item.label || `Item ${i + 1}`,
      content: item.content || (typeof item === "string" ? item : ""),
    }));
  } catch {
    return buildResponse({
      what_happened: "Could not parse items — expected a JSON array",
      next_steps: [
        'Provide items as a JSON array: [{"content": "...", "label": "Homepage"}, ...]',
      ],
      data: { error: "invalid_items" },
    });
  }

  if (items.length === 0) {
    return buildResponse({
      what_happened: "No items to audit",
      next_steps: ["Provide at least one content item"],
      data: { error: "empty_items" },
    });
  }

  // Cap at 20 items
  if (items.length > 20) {
    items = items.slice(0, 20);
  }

  // Score each item
  const scored: Array<{ label: string; score: ContentScore }> = [];
  for (const item of items) {
    const { content, isHtml } = await resolveContent(item.content);
    if (!content.trim()) continue;
    const result = scoreContent(content, isHtml, ctx);
    scored.push({ label: item.label, score: result });
  }

  if (scored.length === 0) {
    return buildResponse({
      what_happened: "All items were empty — nothing to audit",
      next_steps: ["Provide content items with actual text or HTML"],
      data: { error: "all_empty" },
    });
  }

  // Compute stats
  const overallScores = scored.map((s) => s.score.overall);
  const belowThreshold = overallScores.filter((s) => s < input.threshold).length;

  const corpusStats = {
    mean_score: Math.round(mean(overallScores)),
    median_score: Math.round(median(overallScores)),
    min_score: Math.min(...overallScores),
    max_score: Math.max(...overallScores),
    stddev: Math.round(stddev(overallScores) * 10) / 10,
    items_below_threshold: belowThreshold,
  };

  // Per-dimension averages
  const dimNames = ["token_compliance", "visual_compliance", "voice_alignment", "message_coverage"] as const;
  const perDimensionAverages: Record<string, number> = {};
  for (const dim of dimNames) {
    const scores = scored
      .map((s) => s.score.dimensions[dim]?.score)
      .filter((s): s is number => s !== undefined);
    if (scores.length > 0) {
      perDimensionAverages[dim] = Math.round(mean(scores));
    }
  }

  // Detect systematic drift
  const driftPatterns = detectDriftPatterns(scored);

  // Build per-item results (compact for response)
  const itemResults: ItemResult[] = scored.map((s) => ({
    label: s.label,
    overall_score: s.score.overall,
    below_threshold: s.score.overall < input.threshold,
    dimensions: Object.fromEntries(
      Object.entries(s.score.dimensions)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, v!.score])
    ),
    top_issues: s.score.issues
      .filter((i) => i.severity !== "info")
      .slice(0, 3)
      .map((i) => i.message),
  }));

  // Write drift report
  const report = buildDriftReport(itemResults, corpusStats, driftPatterns, input.threshold);
  await brandDir.writeMarkdown("drift-report.md", report);

  // Build summary
  const driftSummary = driftPatterns.length > 0
    ? ` Systematic drift in ${driftPatterns.map((p) => p.dimension.replace(/_/g, " ")).join(", ")}.`
    : "";

  return buildResponse({
    what_happened: `Drift audit: ${belowThreshold}/${scored.length} items below threshold (${input.threshold}). Mean: ${corpusStats.mean_score}/100.${driftSummary}`,
    next_steps: belowThreshold > 0
      ? [
          `${belowThreshold} item(s) scored below ${input.threshold} — review .brand/drift-report.md`,
          ...(driftPatterns.length > 0
            ? [`Systematic drift detected — fix the root cause, not individual items`]
            : []),
          "Run brand_write before creating new content to refresh brand context",
        ]
      : ["All items above threshold — brand identity is being applied consistently"],
    data: {
      items_audited: scored.length,
      threshold: input.threshold,
      items_below_threshold: belowThreshold,
      corpus_stats: corpusStats,
      per_dimension_averages: perDimensionAverages,
      systematic_drift: driftPatterns.slice(0, 5),
      items: itemResults,
      report_file: ".brand/drift-report.md",
    } as unknown as Record<string, unknown>,
  });
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

const paramsShape = {
  items: z
    .string()
    .describe(
      'JSON array of content items to audit. Each item: {"content": "text or HTML or file path", "label": "descriptive name"}. Max 20 items. Example: \'[{"content": "public/page.html", "label": "Homepage"}, {"content": "<p>Draft copy</p>", "label": "Email draft"}]\''
    ),
  threshold: z
    .number()
    .min(0)
    .max(100)
    .default(70)
    .describe(
      "Minimum acceptable score (0-100). Items below this are flagged as drifted. Default: 70."
    ),
};

export function register(server: McpServer) {
  server.tool(
    "brand_audit_drift",
    "Batch audit multiple content items to detect systematic brand drift. Scores each item against brand identity, computes corpus-level statistics (mean, median, stddev), and identifies recurring patterns across items (e.g., same off-palette color in 4/5 items). Writes a detailed drift report to .brand/drift-report.md. Use when reviewing a content corpus, auditing a website, or checking whether brand identity is being applied consistently across multiple pieces.",
    paramsShape,
    async (args) => handler(args as AuditDriftParams),
  );
}
