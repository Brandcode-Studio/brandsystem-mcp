#!/usr/bin/env node
/**
 * Post-publish release invariant (0.14.x lesson, automated).
 *
 * v0.14.2 was tagged before a merged security fix, so npm consumers lacked a
 * fix the repository had — repo-truth and installed-truth diverged silently
 * at tag time. A checklist makes that less likely; this script makes the
 * divergence LOUD: it runs at the end of every publish and fails the workflow
 * if closure cannot honestly be declared.
 *
 * Invariants:
 *   1. The tag being published matches package.json's version.
 *   2. No shippable-code commits (src/, bin/, package.json, lockfile) exist
 *      between the release commit and origin/main — i.e. the release is not
 *      already behind main on code at publish time.
 *   3. The npm registry serves exactly this version as latest (polled, since
 *      registry propagation lags the publish by seconds).
 *
 * A red publish run does not unpublish anything — it prevents a false "done"
 * and names exactly which invariant broke.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const failures = [];
const note = (msg) => console.log(`[release-invariant] ${msg}`);

const pkg = JSON.parse(readFileSync("package.json", "utf-8"));
const refName = process.env.GITHUB_REF_NAME ?? "";
const tagVersion = refName.startsWith("v") ? refName.slice(1) : null;

// ── 1. Tag ↔ package version alignment ──
if (tagVersion === null) {
  note(`no vX.Y.Z ref (ref: "${refName}") — skipping tag alignment (workflow_dispatch run)`);
} else if (tagVersion !== pkg.version) {
  failures.push(`tag ${refName} != package.json version ${pkg.version}`);
} else {
  note(`tag ${refName} matches package.json ${pkg.version}`);
}

// ── 2. Release-boundary check: is this release already behind main on code? ──
try {
  execFileSync("git", ["fetch", "--quiet", "origin", "main"], { stdio: "pipe" });
  const behind = execFileSync(
    "git",
    ["log", "HEAD..origin/main", "--oneline", "--", "src/", "bin/", "package.json", "package-lock.json"],
    { encoding: "utf-8" }
  ).trim();
  if (behind) {
    failures.push(
      `release is BEHIND origin/main on shippable code — the v0.14.2 gap:\n${behind}\n` +
        "Cut a follow-up release containing these commits before declaring closure."
    );
  } else {
    note("no shippable-code commits between release and origin/main");
  }
} catch (err) {
  failures.push(`boundary check could not run: ${err}`);
}

// ── 3. npm serves this version (poll for propagation) ──
const expect = tagVersion ?? pkg.version;
let served = null;
for (let attempt = 1; attempt <= 10; attempt++) {
  try {
    served = execFileSync("npm", ["view", pkg.name, "version"], { encoding: "utf-8" }).trim();
    if (served === expect) break;
  } catch {
    // registry hiccup — retry
  }
  if (attempt < 10) execFileSync("sleep", ["15"]);
}
if (served === expect) {
  note(`npm serves ${pkg.name}@${served} as latest`);
} else {
  failures.push(`npm latest is ${served ?? "unreadable"}, expected ${expect}`);
}

if (failures.length > 0) {
  console.error("\n[release-invariant] CLOSURE CANNOT BE DECLARED:");
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
note("all release invariants hold — installed-truth matches repo-truth");
