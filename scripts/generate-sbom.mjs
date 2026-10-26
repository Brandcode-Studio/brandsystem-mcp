#!/usr/bin/env node
/**
 * Generate the release SBOM: CycloneDX JSON for the production dependency
 * tree, built from npm's own `npm sbom` output (npm >= 10).
 *
 *   node scripts/generate-sbom.mjs [--out brandsystem-mcp.cdx.json]
 *
 * Why not just `npm sbom --omit dev`: on npm 11.x it silently drops
 * production packages that are ALSO optional peers of a dev package
 * (observed: `yaml` — a direct dependency — and `source-map-js`, both
 * optional peers of vite). In a pruned production-only tree it instead
 * fails with ESBOMPROBLEMS for the missing dev dependencies. So:
 *
 *   1. `npm sbom --sbom-format cyclonedx --package-lock-only` describes the
 *      whole locked tree, independent of what happens to be on disk (it also
 *      lists every platform-specific optional binary, not just the runner's).
 *   2. Components are filtered to package-lock entries without `dev: true` —
 *      npm's own classification of what `npm install --omit=dev` installs —
 *      and the dependency graph is filtered to match.
 *   3. npm names the root component after the checkout directory; the name
 *      is reset from package.json (its purl and bom-ref were already right).
 *   4. Self-checks: every direct production dependency is present, no direct
 *      dev-only dependency is, and every production lock entry is covered —
 *      so an npm regression fails the release build instead of shipping a
 *      misleading SBOM.
 */

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** name@version keys of every package-lock entry npm would install with --omit=dev. */
export function productionKeys(lock) {
  const keys = new Set();
  for (const [path, entry] of Object.entries(lock.packages ?? {})) {
    if (!path || entry.dev) continue; // "" is the root package
    if (!path.includes("node_modules/")) continue; // workspace links, if any
    const name = entry.name ?? path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);
    keys.add(`${name}@${entry.version}`);
  }
  return keys;
}

/** Filter a full-tree CycloneDX SBOM to production components. Returns { sbom, problems }. */
export function toProductionSbom(fullSbom, pkg, lock) {
  const sbom = structuredClone(fullSbom);
  const problems = [];
  const prod = productionKeys(lock);

  if (sbom.bomFormat !== "CycloneDX") problems.push(`bomFormat is ${sbom.bomFormat}, expected CycloneDX`);
  const root = sbom.metadata?.component;
  if (!root) problems.push("metadata.component (the package itself) is missing");
  else {
    if (root.version !== pkg.version) problems.push(`root version ${root.version} != package.json ${pkg.version}`);
    root.name = pkg.name;
    root.properties = [
      ...(root.properties ?? []),
      { name: "brandsystem:sbom-scope", value: "production dependencies (package-lock entries without dev:true)" },
    ];
  }

  const keyOf = (c) => `${c.name}@${c.version}`;
  sbom.components = (sbom.components ?? []).filter((c) => prod.has(keyOf(c)));
  const kept = new Set(sbom.components.map((c) => c["bom-ref"]));
  if (root?.["bom-ref"]) kept.add(root["bom-ref"]);
  sbom.dependencies = (sbom.dependencies ?? [])
    .filter((d) => kept.has(d.ref))
    .map((d) => ({ ...d, dependsOn: (d.dependsOn ?? []).filter((ref) => kept.has(ref)) }));

  const present = new Set(sbom.components.map(keyOf));
  for (const key of prod) {
    if (!present.has(key)) problems.push(`production package ${key} is in package-lock.json but missing from the SBOM`);
  }
  const names = new Set(sbom.components.map((c) => c.name));
  const prodDeps = pkg.dependencies ?? {};
  for (const dep of Object.keys(prodDeps)) {
    if (!names.has(dep)) problems.push(`production dependency ${dep} is missing from the SBOM`);
  }
  for (const dep of Object.keys(pkg.devDependencies ?? {})) {
    if (dep in prodDeps) continue;
    const lockEntry = lock.packages?.[`node_modules/${dep}`];
    if (lockEntry?.dev && names.has(dep)) problems.push(`dev dependency ${dep} leaked into the production SBOM`);
  }
  return { sbom, problems };
}

function main() {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf("--out");
  const out = outIdx >= 0 ? args[outIdx + 1] : "brandsystem-mcp.cdx.json";

  const NPM = process.platform === "win32" ? "npm.cmd" : "npm";
  const res = spawnSync(NPM, ["sbom", "--sbom-format", "cyclonedx", "--package-lock-only"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.status !== 0) {
    process.stderr.write(res.stderr ?? "");
    console.error(`npm sbom exited ${res.status}`);
    process.exit(1);
  }

  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
  const { sbom, problems } = toProductionSbom(JSON.parse(res.stdout), pkg, lock);
  if (problems.length) {
    for (const p of problems) console.error(`SBOM check failed: ${p}`);
    process.exit(1);
  }
  writeFileSync(out, `${JSON.stringify(sbom, null, 2)}\n`);
  console.log(`Wrote ${out}: CycloneDX ${sbom.specVersion}, ${sbom.components.length} production components`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
