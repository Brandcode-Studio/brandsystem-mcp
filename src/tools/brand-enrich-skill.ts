/**
 * `brand_enrich_skill` — Enrich a Claude Design-style auto-generated SKILL.md
 * against the local `.brand/governance/` folder.
 *
 * What it does
 * ------------
 *   Claude Design auto-generates a SKILL.md from whatever you upload (code,
 *   Figma, assets, blurb). That file knows what it can see. It does not know
 *   your narratives, proof-point status, anti-patterns, or taste notes —
 *   that content lives in governance YAML, not design files.
 *
 *   This tool takes the auto-SKILL.md as input, diffs it against the local
 *   brand's governance (narrative-library.yaml, valid-proof-points.yaml,
 *   anti-patterns.yaml, application-rules.yaml, taste-codes.yaml), and
 *   returns an enriched SKILL.md with missing governance content injected,
 *   cited back to governance IDs, and grouped into canonical sections.
 *
 *   The enrichment is additive only. Existing content is preserved verbatim.
 *   If a section already exists (e.g. "## Hard rules" or "## Guardrails"),
 *   injected entries append to it rather than duplicating the section.
 *
 * Governance source
 * -----------------
 *   Reads from `<cwd>/.brand/governance/*.yaml`. If no governance folder
 *   exists, returns a helpful error pointing at `brand_init`.
 *
 * Spec: S010 N-2 PR3 — cross-repo port of the UCS enricher CLI + web surface.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readFile, access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parse as yamlParse } from "yaml";

import { buildResponse, safeParseParams } from "../lib/response.js";
import { ERROR_CODES } from "../types/index.js";
import { BrandDir } from "../lib/brand-dir.js";
import {
  enrichSkill,
  formatDiffSummary,
  type GovernanceBundle,
} from "../lib/enrich-skill/enrichment.js";

// ── Tool schema ────────────────────────────────────────────────────

const paramsShape = {
  skill_md: z
    .string()
    .min(1)
    .describe(
      "The auto-generated SKILL.md content to enrich. Paste the full file (including frontmatter) as a single string. Maximum 128 KB.",
    ),
  include_application_rules: z
    .boolean()
    .optional()
    .describe(
      "Include the Application rules section summarizing content-type → framework routing. Default: true.",
    ),
  max_per_section: z
    .number()
    .int()
    .min(1)
    .max(24)
    .optional()
    .describe(
      "Cap injected bullets per governance section. Default 12, max 24. Raise for dense libraries; lower for minimal enrichment.",
    ),
};

const ParamsSchema = z.object(paramsShape);
type Params = z.infer<typeof ParamsSchema>;

const MAX_SKILL_BYTES = 128 * 1024;

// ── Handler ─────────────────────────────────────────────────────────

async function handler(input: Params) {
  const cwd = process.cwd();
  const brandDir = new BrandDir(cwd);

  if (Buffer.byteLength(input.skill_md, "utf-8") > MAX_SKILL_BYTES) {
    return buildResponse({
      what_happened: `skill_md exceeds ${MAX_SKILL_BYTES} bytes — paste a smaller SKILL.md or split it.`,
      next_steps: [
        "Trim the SKILL.md to under 128 KB",
        "If your governance is dense enough to require a huge SKILL.md, split it into multiple skills",
      ],
      data: { error: ERROR_CODES.INVALID_FORMAT },
    });
  }

  if (!(await brandDir.exists())) {
    return buildResponse({
      what_happened: "No .brand/ directory found in the current working directory.",
      next_steps: [
        "Run brand_init first to create the .brand/ directory",
        "Or cd to a project that already has a .brand/ folder, then retry",
      ],
      data: { error: ERROR_CODES.NOT_INITIALIZED },
    });
  }

  const bundle = await loadGovernanceBundle(cwd);
  if (!bundle) {
    return buildResponse({
      what_happened:
        "No governance YAML files found under .brand/governance/. Enrichment needs at least one of: narrative-library.yaml, valid-proof-points.yaml, anti-patterns.yaml, application-rules.yaml.",
      next_steps: [
        "Populate .brand/governance/ with at least one governance YAML",
        "Run brand_extract_messaging to seed narratives and proof points from source materials",
        "Run brand_compile to produce the full governance bundle",
      ],
      data: { error: ERROR_CODES.NO_BRAND_DATA },
    });
  }

  let enriched: string;
  let diff: ReturnType<typeof enrichSkill>["diff"];
  try {
    const result = enrichSkill(input.skill_md, bundle, {
      includeApplicationRules: input.include_application_rules ?? true,
      maxPerSection: input.max_per_section ?? 12,
    });
    enriched = result.enriched;
    diff = result.diff;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return buildResponse({
      what_happened: `Enrichment failed: ${message}`,
      next_steps: [
        "Check that the SKILL.md is valid Markdown with optional YAML frontmatter",
        "Run brand_audit on your .brand/ to spot governance YAML schema issues",
      ],
      data: { error: ERROR_CODES.PARSE_FAILED },
    });
  }

  const totalAdded =
    diff.narrativesAdded +
    diff.proofsAdded +
    diff.antiPatternsAdded +
    diff.applicationRulesAdded +
    diff.tasteNotesAdded;

  // Snake-case diff summary per packet contract.
  const diff_summary = {
    narratives_added: diff.narrativesAdded,
    narratives_already_present: diff.narrativesAlreadyPresent,
    proofs_added: diff.proofsAdded,
    proofs_already_present: diff.proofsAlreadyPresent,
    antipatterns_added: diff.antiPatternsAdded,
    antipatterns_already_present: diff.antiPatternsAlreadyPresent,
    application_rules_added: diff.applicationRulesAdded,
    taste_notes_added: diff.tasteNotesAdded,
    warnings: diff.warnings,
  };

  return buildResponse({
    what_happened: `Enriched SKILL.md for brand \`${bundle.brandSlug}\` — ${totalAdded} governance entries added.`,
    next_steps: [
      "Replace the auto-generated SKILL.md in your Claude Design project with the enriched version",
      "Future generations in that project will ground on the full governance set",
      totalAdded === 0
        ? "Zero entries added — your SKILL.md already covers current governance, or governance files are empty"
        : `Diff: ${formatDiffSummary(diff).split("\n")[0]}`,
    ],
    data: {
      enriched_skill_md: enriched,
      diff_summary,
      brand: { slug: bundle.brandSlug, name: bundle.brandName },
    },
  });
}

// ── Governance loader ───────────────────────────────────────────────

async function loadGovernanceBundle(cwd: string): Promise<GovernanceBundle | null> {
  const governanceDir = join(cwd, ".brand", "governance");

  let hasDir = false;
  try {
    await access(governanceDir);
    hasDir = true;
  } catch {
    hasDir = false;
  }
  if (!hasDir) return null;

  const slug = deriveBrandSlug(cwd);
  const bundle: GovernanceBundle = {
    narratives: null,
    proofPoints: null,
    antiPatterns: null,
    applicationRules: null,
    tasteCodes: null,
    brandSlug: slug.slug,
    brandName: slug.name,
  };

  let anyLoaded = false;
  async function tryLoad<K extends keyof GovernanceBundle>(
    filename: string,
    key: K,
  ): Promise<void> {
    const fullPath = resolve(governanceDir, filename);
    try {
      await access(fullPath);
    } catch {
      return;
    }
    try {
      const raw = await readFile(fullPath, "utf-8");
      const parsed = yamlParse(raw);
      if (parsed != null) {
        (bundle[key] as unknown) = parsed;
        anyLoaded = true;
      }
    } catch (err) {
      console.error(`[brand_enrich_skill] YAML parse error in ${filename}:`, err);
    }
  }

  await Promise.all([
    tryLoad("narrative-library.yaml", "narratives"),
    tryLoad("valid-proof-points.yaml", "proofPoints"),
    tryLoad("anti-patterns.yaml", "antiPatterns"),
    tryLoad("application-rules.yaml", "applicationRules"),
    tryLoad("taste-codes.yaml", "tasteCodes"),
  ]);

  return anyLoaded ? bundle : null;
}

/**
 * Derive a brand slug + display name from the project directory. Used only to
 * label provenance in the enriched output — the enricher logic is otherwise
 * slug-agnostic.
 */
function deriveBrandSlug(cwd: string): { slug: string; name: string } {
  const base = cwd.split("/").filter(Boolean).pop() || "brand";
  const slug = base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "brand";
  const name = base
    .split(/[-_\s]/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
  return { slug, name };
}

// ── Registration ────────────────────────────────────────────────────

export function register(server: McpServer) {
  server.tool(
    "brand_enrich_skill",
    "Take a Claude Design-style auto-generated SKILL.md, diff it against this project's .brand/governance/ YAML (narrative-library, valid-proof-points, anti-patterns, application-rules, taste-codes), and return an enriched SKILL.md with missing governance content injected, cited by governance ID, and grouped into canonical sections. Additive only — never rewrites existing content. Requires a .brand/ directory with at least one governance file. The typical flow: Claude Design auto-generates a SKILL.md during onboarding → pass it to this tool → replace the original with the enriched version → every subsequent generation grounds on governed narratives, Active/Watch proof points, hard-rule anti-patterns, and taste signals. This is the low-friction wedge for putting Brandcode governance into any Anthropic-product generation surface.",
    paramsShape,
    async (args) => {
      const parsed = safeParseParams(ParamsSchema, args);
      if (!parsed.success) return parsed.response;
      return handler(parsed.data);
    },
  );
}
