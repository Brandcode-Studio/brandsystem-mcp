import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BrandDir } from "../lib/brand-dir.js";
import { buildResponse } from "../lib/response.js";
import { BrandConfigSchema, CoreIdentitySchema } from "../schemas/index.js";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { ERROR_CODES } from "../types/index.js";

interface AuditResult {
  check: string;
  status: "pass" | "warn" | "fail";
  detail: string;
}

async function handler() {
  const brandDir = new BrandDir(process.cwd());

  if (!(await brandDir.exists())) {
    return buildResponse({
      what_happened: "No .brand/ directory found",
      next_steps: [
        "Run brand_init first to create the .brand/ directory",
        "If this keeps happening, run brand_feedback to report the issue.",
      ],
      data: { error: ERROR_CODES.NOT_INITIALIZED },
    });
  }

  const results: AuditResult[] = [];

  for (const file of ["brand.config.yaml", "core-identity.yaml"]) {
    try {
      await access(join(brandDir.brandPath, file));
      results.push({ check: `File: ${file}`, status: "pass", detail: "exists" });
    } catch {
      results.push({ check: `File: ${file}`, status: "fail", detail: "missing" });
    }
  }

  for (const compiledFile of ["tokens.json", "brand-runtime.json", "interaction-policy.json"]) {
    try {
      await access(join(brandDir.brandPath, compiledFile));
      results.push({ check: `File: ${compiledFile}`, status: "pass", detail: "exists" });
    } catch {
      results.push({ check: `File: ${compiledFile}`, status: "warn", detail: "missing — run brand_compile" });
    }
  }

  try {
    BrandConfigSchema.parse(await brandDir.readConfig());
    results.push({ check: "Schema: brand.config.yaml", status: "pass", detail: "valid" });
  } catch (err) {
    results.push({ check: "Schema: brand.config.yaml", status: "fail", detail: `invalid: ${err instanceof Error ? err.message : String(err)}` });
  }

  let identity;
  try {
    identity = CoreIdentitySchema.parse(await brandDir.readCoreIdentity());
    results.push({ check: "Schema: core-identity.yaml", status: "pass", detail: "valid" });
  } catch (err) {
    results.push({ check: "Schema: core-identity.yaml", status: "fail", detail: `invalid: ${err instanceof Error ? err.message : String(err)}` });
    return formatResults(results);
  }

  const hasPrimary = identity.colors.some((c) => c.role === "primary");
  results.push({
    check: "Primary color",
    status: hasPrimary ? "pass" : "warn",
    detail: hasPrimary ? identity.colors.find((c) => c.role === "primary")!.value : "no color assigned 'primary' role",
  });

  results.push({
    check: "Typography",
    status: identity.typography.length > 0 ? "pass" : "warn",
    detail: identity.typography.length > 0
      ? `${identity.typography.length} font(s): ${identity.typography.map((t) => t.family).join(", ")}`
      : "no fonts detected",
  });

  const invalidColors = identity.colors.filter((c) => !/^#[0-9a-fA-F]{3,8}$/.test(c.value));
  results.push({
    check: "Color hex values",
    status: invalidColors.length === 0 ? "pass" : "fail",
    detail: invalidColors.length === 0
      ? `all ${identity.colors.length} colors are valid hex`
      : `${invalidColors.length} invalid: ${invalidColors.map((c) => c.value).join(", ")}`,
  });

  results.push({
    check: "Logo",
    status: identity.logo.length > 0 ? "pass" : "warn",
    detail: identity.logo.length > 0
      ? `${identity.logo.length} logo(s) — ${identity.logo.map((l) => `${l.type} (${l.source})`).join(", ")}`
      : "no logo found",
  });

  for (const logo of identity.logo) {
    for (const variant of logo.variants) {
      if (variant.inline_svg) {
        const valid = variant.inline_svg.includes("<svg") && variant.inline_svg.includes("</svg>");
        results.push({
          check: `Logo SVG: ${variant.name}`,
          status: valid ? "pass" : "fail",
          detail: valid ? "well-formed" : "malformed SVG",
        });
      }
    }
  }

  const allConf = [
    ...identity.colors.map((c) => c.confidence),
    ...identity.typography.map((t) => t.confidence),
    ...identity.logo.map((l) => l.confidence),
  ];
  const lowCount = allConf.filter((c) => c === "low").length;
  results.push({
    check: "Confidence distribution",
    status: lowCount === 0 ? "pass" : "warn",
    detail: `confirmed: ${allConf.filter((c) => c === "confirmed").length}, high: ${allConf.filter((c) => c === "high").length}, medium: ${allConf.filter((c) => c === "medium").length}, low: ${lowCount}`,
  });

  return formatResults(results);
}

function formatResults(results: AuditResult[]) {
  const passes = results.filter((r) => r.status === "pass").length;
  const warns = results.filter((r) => r.status === "warn").length;
  const fails = results.filter((r) => r.status === "fail").length;
  const overall = fails > 0 ? "FAIL" : warns > 0 ? "WARN" : "PASS";

  const lines = results.map(
    (r) => `${r.status === "pass" ? "✓" : r.status === "warn" ? "⚠" : "✗"} ${r.check}: ${r.detail}`
  );

  const nextSteps: string[] = [];
  if (fails > 0) nextSteps.push("Fix failing checks before proceeding");
  if (warns > 0) nextSteps.push("Review warnings — run brand_compile to address clarification items");
  if (fails === 0 && warns === 0) {
    nextSteps.push("Brand system passes all checks");
    nextSteps.push("Run brand_deepen_identity to start Session 2 — capture composition rules, visual patterns, and anti-patterns that make your brand recognizable beyond tokens");
  }

  return buildResponse({
    what_happened: `Audit complete: ${overall} (${passes} pass, ${warns} warn, ${fails} fail)`,
    next_steps: nextSteps,
    data: { overall, summary: { pass: passes, warn: warns, fail: fails }, report: lines.join("\n") },
  });
}

export function register(server: McpServer) {
  server.tool(
    "brand_audit",
    "Validate the .brand/ directory for completeness and correctness. Checks file existence, YAML schema validity, primary color assignment, typography coverage, logo embedding (SVG well-formedness), and confidence distribution. Use after brand_compile to verify readiness, or anytime to diagnose issues. Returns pass/warn/fail for each check with actionable details. NOT for checking content copy — use brand_audit_content. NOT for checking HTML/CSS — use brand_preflight.",
    async () => handler()
  );
}
