#!/usr/bin/env node
/**
 * Lane I — Extraction Quality Audit
 * Runs brand_start auto mode against 10 real brands and captures structured results.
 *
 * Usage: node scripts/extraction-audit.mjs
 * Output: scripts/audit-results/ directory with per-brand JSON + summary report
 */

import { createServer } from "../dist/server.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdtemp, rm, readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

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
  // Create a temp directory for this brand
  const tmpDir = await mkdtemp(join(tmpdir(), `audit-${brand.name.toLowerCase()}-`));

  // Monkey-patch process.cwd for this extraction
  const originalCwd = process.cwd;
  process.cwd = () => tmpDir;

  const server = createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "audit", version: "1.0.0" });

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

async function main() {
  const outputDir = join(import.meta.dirname, "audit-results");
  await mkdir(outputDir, { recursive: true });

  console.log("Lane I — Extraction Quality Audit");
  console.log(`Testing ${BRANDS.length} brands against @brandsystem/mcp v0.3.12\n`);

  const results = [];

  for (const brand of BRANDS) {
    process.stdout.write(`  ${brand.name} (${brand.url})... `);
    try {
      const result = await runExtraction(brand);
      results.push(result);

      const colorCount = result.colors.length;
      const fontCount = result.fonts.length;
      const quality = result.extraction_quality?.score ?? "?";
      const logo = result.logo_found ? "✓" : "✗";

      console.log(`${colorCount} colors, ${fontCount} fonts, logo ${logo}, quality ${quality}, ${result.duration_ms}ms`);

      // Save individual result
      await writeFile(
        join(outputDir, `${brand.name.toLowerCase()}.json`),
        JSON.stringify(result, null, 2),
      );
    } catch (err) {
      console.log(`ERROR: ${err.message}`);
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
  console.log("EXTRACTION QUALITY AUDIT — SUMMARY");
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
  console.log(`Average duration: ${Math.round(totalDuration / results.length)}ms`);
  console.log(`Logo detection rate: ${Math.round(totalLogos / results.length * 100)}%`);

  if (issues.length > 0) {
    console.log(`\nISSUES (${issues.length}):`);
    for (const i of issues) {
      console.log(`  [${i.brand}] ${i.issue}`);
    }
  }

  // Save full summary
  const summary = {
    version: "0.3.12",
    date: new Date().toISOString(),
    brands_tested: results.length,
    totals: { colors: totalColors, fonts: totalFonts, logos: totalLogos },
    avg_quality: avgQuality,
    avg_duration_ms: Math.round(totalDuration / results.length),
    logo_detection_rate: Math.round(totalLogos / results.length * 100),
    issues,
    results,
  };

  await writeFile(
    join(outputDir, "summary.json"),
    JSON.stringify(summary, null, 2),
  );

  console.log(`\nFull results saved to scripts/audit-results/`);
}

main().catch(console.error);
