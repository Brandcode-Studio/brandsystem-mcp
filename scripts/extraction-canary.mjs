#!/usr/bin/env node
/**
 * Extraction canary — live-yield, NON-BLOCKING lane.
 *
 * Runs brand_start auto mode against 10 real (drifting) public websites and
 * captures yield metrics (colors/fonts/logo present). This measures YIELD, not
 * correctness — the labeled, release-gating lane is the deterministic corpus in
 * test/extraction-quality.test.ts + test/fixtures/extraction-corpus/.
 *
 * This script never exits non-zero: network failures and per-site errors are
 * reported in the results, not thrown. It is intentionally excluded from
 * `npm test`.
 *
 * Usage:
 *   node scripts/extraction-canary.mjs                       # run all 10 sites
 *   node scripts/extraction-canary.mjs --limit 2             # run first N sites
 *   node scripts/extraction-canary.mjs --compare <baseline-summary.json> <current-summary.json>
 *                                                            # print per-site yield deltas (markdown)
 *
 * Output: scripts/audit-results/ directory with per-brand JSON + summary.json
 */

import { mkdtemp, rm, readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const LANE = "canary (live-yield, non-blocking)";

function packageVersion() {
  try {
    const pkg = JSON.parse(
      readFileSync(join(import.meta.dirname, "..", "package.json"), "utf-8"),
    );
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

// 10 brands spanning different CSS patterns, industries, and complexity
const BRANDS = [
  { name: "Linear", url: "https://linear.app", category: "SaaS", css_pattern: "Tailwind/CSS-in-JS", notes: "Dark theme, minimal, modern SaaS" },
  { name: "Stripe", url: "https://stripe.com", category: "Fintech", css_pattern: "Custom CSS", notes: "Gradient-heavy, polished, complex" },
  { name: "Notion", url: "https://notion.so", category: "Productivity", css_pattern: "CSS modules", notes: "Light/dark, clean typography" },
  { name: "Vercel", url: "https://vercel.com", category: "Developer tools", css_pattern: "Tailwind/CSS vars", notes: "Dark default, geist font" },
  { name: "Figma", url: "https://figma.com", category: "Design", css_pattern: "Custom/complex", notes: "Colorful, illustration-heavy" },
  { name: "Basecamp", url: "https://basecamp.com", category: "Project mgmt", css_pattern: "Traditional CSS", notes: "Opinionated design, unique typography" },
  { name: "Arc", url: "https://arc.net", category: "Browser", css_pattern: "Modern CSS", notes: "Gradient, playful, distinctive" },
  { name: "Superhuman", url: "https://superhuman.com", category: "Email", css_pattern: "Custom", notes: "Dark, premium, minimal" },
  { name: "Cal.com", url: "https://cal.com", category: "Scheduling", css_pattern: "Tailwind", notes: "Open source, standard Tailwind patterns" },
  { name: "Loom", url: "https://loom.com", category: "Video", css_pattern: "Mixed", notes: "Purple brand, video-centric" },
];

async function runExtraction(brand) {
  // Lazy imports so `--compare` mode works without a built dist/
  const { createServer } = await import("../dist/server.js");
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");

  // Create a temp directory for this brand
  const tmpDir = await mkdtemp(join(tmpdir(), `canary-${brand.name.toLowerCase()}-`));

  // Monkey-patch process.cwd for this extraction
  const originalCwd = process.cwd;
  process.cwd = () => tmpDir;

  const server = createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "canary", version: "1.0.0" });

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  const startTime = Date.now();
  let result;
  let error = null;

  try {
    const response = await client.callTool({
      name: "brand_start",
      arguments: {
        client_name: brand.name,
        website_url: brand.url,
        mode: "auto",
      },
    });

    // Handle multi-content responses (visual extraction returns image + text)
    const textBlock = response.content.find(c => c.type === "text");
    const text = textBlock?.text;
    result = text ? JSON.parse(text) : null;
  } catch (err) {
    error = err.message || String(err);
  }

  const duration = Date.now() - startTime;

  // Restore cwd
  process.cwd = originalCwd;

  // Check what files were written
  let filesWritten = [];
  try {
    const brandDir = join(tmpDir, ".brand");
    const files = await readdir(brandDir, { recursive: true });
    filesWritten = files;
  } catch { /* no .brand dir */ }

  // Read tokens if they exist
  let tokenData = null;
  try {
    const tokens = await readFile(join(tmpDir, ".brand", "tokens.json"), "utf-8");
    tokenData = JSON.parse(tokens);
  } catch { /* no tokens */ }

  // Read runtime if it exists
  let runtimeData = null;
  try {
    const runtime = await readFile(join(tmpDir, ".brand", "brand-runtime.json"), "utf-8");
    runtimeData = JSON.parse(runtime);
  } catch { /* no runtime */ }

  // Clean up
  await rm(tmpDir, { recursive: true, force: true });
  await client.close();

  return {
    brand: brand.name,
    url: brand.url,
    category: brand.category,
    css_pattern: brand.css_pattern,
    duration_ms: duration,
    error,
    extraction_quality: result?.extraction_quality ?? null,
    extraction_summary: result?.extraction_summary ?? null,
    colors: result?.all_colors ?? [],
    fonts: result?.fonts ?? [],
    logo_found: result?.confirmation_needed?.logo?.found ?? false,
    clarifications: result?.clarifications ?? null,
    files_written: filesWritten,
    token_count: tokenData ? Object.keys(tokenData?.brand?.color ?? {}).length + Object.keys(tokenData?.brand?.typography ?? {}).length : 0,
    runtime_sessions: runtimeData?.sessions_completed ?? null,
    has_runtime: !!runtimeData,
    has_policy: filesWritten.includes("interaction-policy.json"),
  };
}

// ── Baseline comparison (--compare) ─────────────────────────────
// Prints per-site yield deltas as markdown (for the GitHub job summary).
// Regressions WARN — this never exits non-zero.

function yieldRow(r) {
  return {
    colors: r?.colors?.length ?? 0,
    fonts: r?.fonts?.length ?? 0,
    logo: r?.logo_found ? 1 : 0,
    quality: r?.extraction_quality?.points ?? 0,
    error: r?.error ?? null,
  };
}

function compareSummaries(baselinePath, currentPath) {
  let baseline, current;
  try {
    baseline = JSON.parse(readFileSync(baselinePath, "utf-8"));
  } catch (err) {
    console.log(`No usable baseline at ${baselinePath} (${err.message}) — skipping comparison.`);
    return;
  }
  try {
    current = JSON.parse(readFileSync(currentPath, "utf-8"));
  } catch (err) {
    console.log(`No usable current summary at ${currentPath} (${err.message}) — skipping comparison.`);
    return;
  }

  const baseByBrand = new Map((baseline.results ?? []).map((r) => [r.brand, r]));
  const warnings = [];

  console.log(`## Extraction canary — yield vs baseline`);
  console.log("");
  console.log(`Lane: ${LANE}. Regressions are warnings only — this job never fails on yield.`);
  console.log("");
  console.log(`Baseline: v${baseline.version ?? "?"} (${baseline.date ?? "unknown date"}) → Current: v${current.version ?? "?"} (${current.date ?? "unknown date"})`);
  console.log("");
  console.log("| Site | Colors | Fonts | Logo | Quality pts | Status |");
  console.log("|------|--------|-------|------|-------------|--------|");

  for (const r of current.results ?? []) {
    const cur = yieldRow(r);
    const base = baseByBrand.get(r.brand) ? yieldRow(baseByBrand.get(r.brand)) : null;

    const fmt = (curV, baseV) => {
      if (baseV === null || baseV === undefined) return `${curV}`;
      const d = curV - baseV;
      const delta = d === 0 ? "±0" : d > 0 ? `+${d}` : `${d}`;
      return `${curV} (${delta})`;
    };

    let status = "OK";
    if (cur.error) {
      status = "ERROR";
      warnings.push(`${r.brand}: extraction error — ${cur.error}`);
    } else if (base) {
      const regressions = [];
      if (cur.colors < base.colors) regressions.push(`colors ${base.colors}→${cur.colors}`);
      if (cur.fonts < base.fonts) regressions.push(`fonts ${base.fonts}→${cur.fonts}`);
      if (cur.logo < base.logo) regressions.push("logo lost");
      if (cur.quality < base.quality) regressions.push(`quality ${base.quality}→${cur.quality}`);
      if (regressions.length > 0) {
        status = "⚠️ WARN";
        warnings.push(`${r.brand}: ${regressions.join(", ")}`);
      }
    } else {
      status = "new";
    }

    console.log(
      `| ${r.brand} | ${fmt(cur.colors, base?.colors ?? null)} | ${fmt(cur.fonts, base?.fonts ?? null)} | ${cur.logo ? "✓" : "✗"} | ${fmt(cur.quality, base?.quality ?? null)} | ${status} |`
    );
  }

  console.log("");
  if (warnings.length > 0) {
    console.log(`### ⚠️ ${warnings.length} yield regression(s)/error(s) — non-blocking`);
    for (const w of warnings) console.log(`- ${w}`);
    console.log("");
    console.log("Live sites drift; a WARN here means \"look\", not \"the release is broken\". The release gate is the deterministic corpus in test/extraction-quality.test.ts.");
  } else {
    console.log("No yield regressions vs baseline.");
  }
}

async function main() {
  const args = process.argv.slice(2);

  const compareIdx = args.indexOf("--compare");
  if (compareIdx !== -1) {
    const baselinePath = args[compareIdx + 1];
    const currentPath = args[compareIdx + 2];
    if (!baselinePath || !currentPath) {
      console.log("Usage: node scripts/extraction-canary.mjs --compare <baseline-summary.json> <current-summary.json>");
      return;
    }
    compareSummaries(baselinePath, currentPath);
    return;
  }

  const limitIdx = args.indexOf("--limit");
  const limit = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : BRANDS.length;
  const brands = BRANDS.slice(0, Number.isFinite(limit) && limit > 0 ? limit : BRANDS.length);

  const version = packageVersion();
  const outputDir = join(import.meta.dirname, "audit-results");
  await mkdir(outputDir, { recursive: true });

  console.log(`Extraction Canary — ${LANE}`);
  console.log(`Testing ${brands.length} live sites against @brandsystem/mcp v${version}`);
  console.log("NOTE: this lane measures live-site YIELD and never fails the build.");
  console.log("The labeled, release-gating lane is test/extraction-quality.test.ts.\n");

  const results = [];

  for (const brand of brands) {
    process.stdout.write(`  ${brand.name} (${brand.url})... `);
    try {
      const result = await runExtraction(brand);
      results.push(result);

      if (result.error) {
        console.log(`ERROR (recorded, non-blocking): ${result.error.slice(0, 80)}`);
      } else {
        const colorCount = result.colors.length;
        const fontCount = result.fonts.length;
        const quality = result.extraction_quality?.score ?? "?";
        const logo = result.logo_found ? "✓" : "✗";
        console.log(`${colorCount} colors, ${fontCount} fonts, logo ${logo}, quality ${quality}, ${result.duration_ms}ms`);
      }

      // Save individual result
      await writeFile(
        join(outputDir, `${brand.name.toLowerCase()}.json`),
        JSON.stringify(result, null, 2),
      );
    } catch (err) {
      console.log(`ERROR (recorded, non-blocking): ${err.message}`);
      results.push({
        brand: brand.name,
        url: brand.url,
        error: err.message,
        duration_ms: 0,
      });
    }
  }

  // Generate summary report
  console.log("\n" + "=".repeat(80));
  console.log("EXTRACTION CANARY — LIVE-YIELD SUMMARY (non-blocking)");
  console.log("=".repeat(80) + "\n");

  console.log("Brand            Colors  Fonts  Logo  Quality  Runtime  Duration  Issues");
  console.log("-".repeat(80));

  let totalColors = 0, totalFonts = 0, totalLogos = 0, totalDuration = 0;
  let qualityScores = [];
  const issues = [];

  for (const r of results) {
    if (r.error) {
      console.log(`${r.brand.padEnd(17)} ERROR: ${r.error.slice(0, 50)}`);
      issues.push({ brand: r.brand, issue: `Extraction failed: ${r.error}` });
      continue;
    }

    const colorCount = r.colors.length;
    const fontCount = r.fonts.length;
    const logo = r.logo_found ? "✓" : "✗";
    const quality = r.extraction_quality?.score ?? "?";
    const qualityPts = r.extraction_quality?.points ?? 0;
    const runtime = r.has_runtime ? "✓" : "✗";
    const duration = `${r.duration_ms}ms`;

    console.log(
      `${r.brand.padEnd(17)}${String(colorCount).padEnd(8)}${String(fontCount).padEnd(7)}${logo.padEnd(6)}${String(quality).padEnd(9)}${runtime.padEnd(9)}${duration}`
    );

    totalColors += colorCount;
    totalFonts += fontCount;
    if (r.logo_found) totalLogos++;
    totalDuration += r.duration_ms;
    if (qualityPts) qualityScores.push(qualityPts);

    // Flag issues
    if (colorCount === 0) issues.push({ brand: r.brand, issue: "Zero colors extracted" });
    if (fontCount === 0) issues.push({ brand: r.brand, issue: "Zero fonts extracted" });
    if (!r.logo_found) issues.push({ brand: r.brand, issue: "No logo found" });
    if (colorCount > 0 && !r.colors.some(c => c.role === "primary")) {
      issues.push({ brand: r.brand, issue: "No primary color identified" });
    }
    const unknownRoles = r.colors.filter(c => c.role === "unknown").length;
    if (unknownRoles > colorCount * 0.5) {
      issues.push({ brand: r.brand, issue: `${unknownRoles}/${colorCount} colors have unknown role (>${50}%)` });
    }
    if (!r.has_runtime) issues.push({ brand: r.brand, issue: "No brand-runtime.json generated" });
  }

  console.log("-".repeat(80));
  const avgQuality = qualityScores.length > 0 ? (qualityScores.reduce((a, b) => a + b, 0) / qualityScores.length).toFixed(1) : "N/A";
  console.log(`\nTotals: ${totalColors} colors, ${totalFonts} fonts, ${totalLogos}/${results.length} logos`);
  console.log(`Average quality: ${avgQuality}/10`);
  console.log(`Average duration: ${Math.round(totalDuration / Math.max(results.length, 1))}ms`);
  console.log(`Logo detection rate: ${Math.round(totalLogos / Math.max(results.length, 1) * 100)}%`);

  if (issues.length > 0) {
    console.log(`\nISSUES (${issues.length}) — informational, non-blocking:`);
    for (const i of issues) {
      console.log(`  [${i.brand}] ${i.issue}`);
    }
  }

  // Save full summary
  const summary = {
    lane: LANE,
    version,
    date: new Date().toISOString(),
    brands_tested: results.length,
    totals: { colors: totalColors, fonts: totalFonts, logos: totalLogos },
    avg_quality: avgQuality,
    avg_duration_ms: Math.round(totalDuration / Math.max(results.length, 1)),
    logo_detection_rate: Math.round(totalLogos / Math.max(results.length, 1) * 100),
    issues,
    results,
  };

  await writeFile(
    join(outputDir, "summary.json"),
    JSON.stringify(summary, null, 2),
  );

  console.log(`\nFull results saved to scripts/audit-results/`);
}

// Canary lane: never exit non-zero — even a crash degrades to a report.
main().catch((err) => {
  console.error("Canary crashed (recorded, non-blocking):", err);
  process.exitCode = 0;
});
