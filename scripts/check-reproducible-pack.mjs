#!/usr/bin/env node
/**
 * Reproducible-build check: build and pack twice from a clean dist/ and
 * require byte-identical tarballs.
 *
 * Why this is expected to hold: `npm pack` writes every tar entry with a
 * fixed mtime (1985-10-26), fixed modes and sorted paths, and `tsc` output is
 * a pure function of the sources + compiler version. So any difference means
 * something non-deterministic leaked into dist/ (timestamps, absolute paths,
 * random IDs) — exactly what a third party rebuilding a release from the tag
 * would trip over.
 *
 * SOURCE_DATE_EPOCH is pinned to the HEAD commit time (when not already set)
 * so any tool that honours it stays deterministic too.
 *
 * Usage:
 *   node scripts/check-reproducible-pack.mjs [--out <dir>]
 *
 * Prints both sha256 hashes; exits 1 (with the differing files) on mismatch.
 * Run after `npm ci`; it never installs anything itself.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

const NPM = process.platform === "win32" ? "npm.cmd" : "npm";

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts });
  if (res.status !== 0) {
    process.stderr.write(res.stdout ?? "");
    process.stderr.write(res.stderr ?? "");
    throw new Error(`${cmd} ${args.join(" ")} exited ${res.status}`);
  }
  return res.stdout;
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function listFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(relative(dir, p));
    }
  };
  walk(dir);
  return out.sort();
}

function buildAndPack(dest, env) {
  rmSync("dist", { recursive: true, force: true });
  run(NPM, ["run", "build"], { env });
  mkdirSync(dest, { recursive: true });
  const json = run(NPM, ["pack", "--json", "--pack-destination", dest], { env });
  const [{ filename }] = JSON.parse(json);
  return join(dest, filename);
}

function explainDiff(a, b, work) {
  const ex = (tgz, name) => {
    const d = join(work, name);
    mkdirSync(d, { recursive: true });
    run("tar", ["-xzf", tgz, "-C", d]);
    return d;
  };
  const da = ex(a, "x1");
  const db = ex(b, "x2");
  const fa = listFiles(da);
  const fb = listFiles(db);
  const all = [...new Set([...fa, ...fb])].sort();
  const diffs = [];
  for (const f of all) {
    let ha = null;
    let hb = null;
    try { ha = sha256(join(da, f)); } catch { /* missing */ }
    try { hb = sha256(join(db, f)); } catch { /* missing */ }
    if (ha !== hb) diffs.push(`${f}: ${ha ?? "(missing)"} vs ${hb ?? "(missing)"}`);
  }
  return diffs;
}

const args = process.argv.slice(2);
const outIdx = args.indexOf("--out");
const work = outIdx >= 0 ? args[outIdx + 1] : mkdtempSync(join(tmpdir(), "repro-pack-"));

const env = { ...process.env };
if (!env.SOURCE_DATE_EPOCH) {
  try {
    env.SOURCE_DATE_EPOCH = run("git", ["log", "-1", "--format=%ct"]).trim();
  } catch {
    // Not a git checkout — leave unset; npm pack mtimes are fixed regardless.
  }
}

const first = buildAndPack(join(work, "pack-1"), env);
const second = buildAndPack(join(work, "pack-2"), env);
const h1 = sha256(first);
const h2 = sha256(second);

console.log(`SOURCE_DATE_EPOCH ${/^\d+$/.test(env.SOURCE_DATE_EPOCH ?? "") ? "set" : "unset"}`);
console.log(`pack 1: ${h1}  ${first}`);
console.log(`pack 2: ${h2}  ${second}`);

if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `### Reproducible pack\n\n| Pack | sha256 |\n|---|---|\n| 1 | \`${h1}\` |\n| 2 | \`${h2}\` |\n\n${h1 === h2 ? "Identical." : "**MISMATCH**"}\n`,
  );
}

if (h1 !== h2) {
  console.error("Tarballs differ. Files that changed between builds:");
  for (const line of explainDiff(first, second, work)) console.error(`  ${line}`);
  process.exit(1);
}
console.log("Reproducible: both packs are byte-identical.");
