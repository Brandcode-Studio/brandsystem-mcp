#!/usr/bin/env node
/**
 * Allowlist-aware `npm audit` gate.
 *
 * A bare `npm audit --audit-level=high` in CI froze every Dependabot PR for two
 * months (Aug–Oct 2026) because an upstream advisory had no fix yet — including
 * the PRs that would eventually have fixed it. This gate keeps high/critical
 * advisories blocking while allowing a time-boxed, reasoned exception:
 *
 *   .github/audit-allowlist.json  { "entries": [{ "ghsa", "reason", "expires" }] }
 *
 * Fails when:
 *   - a high/critical advisory is not allowlisted;
 *   - an allowlist entry has expired, or is missing ghsa/reason/expires;
 *   - (full-tree runs) an allowlist entry matches nothing, so stale entries
 *     get removed instead of silently widening the gate.
 *
 * Flags:
 *   --omit=dev         audit production dependencies only
 *   --warn-only        report but always exit 0
 *   --input <file>     read `npm audit --json` output from a file (tests)
 *   --allowlist <file> default .github/audit-allowlist.json
 *   --today YYYY-MM-DD override the expiry reference date (tests)
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const BLOCKING = new Set(["high", "critical"]);
const GHSA_RE = /GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}/i;

function parseArgs(argv) {
  const opts = { omitDev: false, warnOnly: false, input: null, allowlist: ".github/audit-allowlist.json", today: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--omit=dev") opts.omitDev = true;
    else if (arg === "--warn-only") opts.warnOnly = true;
    else if (arg === "--input") opts.input = argv[++i];
    else if (arg === "--allowlist") opts.allowlist = argv[++i];
    else if (arg === "--today") opts.today = argv[++i];
    else throw new Error(`unknown argument: ${arg}`);
  }
  return opts;
}

function readAuditJson(opts) {
  if (opts.input) return JSON.parse(readFileSync(opts.input, "utf-8"));
  const args = ["audit", "--json"];
  if (opts.omitDev) args.push("--omit=dev");
  // npm audit exits non-zero whenever it finds anything; the JSON is still on stdout.
  const result = spawnSync("npm", args, { encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 });
  if (!result.stdout) throw new Error(`npm audit produced no output: ${result.stderr || result.error}`);
  return JSON.parse(result.stdout);
}

export function collectAdvisories(report) {
  if (report.error) throw new Error(`npm audit failed: ${JSON.stringify(report.error)}`);
  const advisories = new Map();
  for (const vuln of Object.values(report.vulnerabilities ?? {})) {
    for (const via of vuln.via ?? []) {
      if (typeof via !== "object" || via === null) continue;
      const ghsa = (via.url ?? "").match(GHSA_RE)?.[0]?.toUpperCase() ?? `npm-${via.source}`;
      const existing = advisories.get(ghsa);
      const packages = new Set(existing?.packages ?? []);
      packages.add(via.name ?? vuln.name);
      advisories.set(ghsa, {
        ghsa,
        severity: via.severity ?? vuln.severity,
        title: via.title ?? "",
        url: via.url ?? "",
        packages: [...packages],
      });
    }
  }
  return [...advisories.values()];
}

export function evaluate({ advisories, allowlist, today, fullTree }) {
  const errors = [];
  const warnings = [];
  const entries = allowlist.entries ?? [];
  const byGhsa = new Map();

  for (const entry of entries) {
    const ghsa = String(entry.ghsa ?? "").toUpperCase();
    if (!GHSA_RE.test(ghsa) || !entry.reason || !/^\d{4}-\d{2}-\d{2}$/.test(entry.expires ?? "")) {
      errors.push(`allowlist entry needs ghsa, reason, and expires (YYYY-MM-DD): ${JSON.stringify(entry)}`);
      continue;
    }
    if (entry.expires < today) {
      errors.push(`allowlist entry ${ghsa} expired on ${entry.expires} — fix the dependency or renew with a reason`);
      continue;
    }
    byGhsa.set(ghsa, entry);
  }

  const matched = new Set();
  for (const adv of advisories) {
    if (!BLOCKING.has(adv.severity)) continue;
    if (byGhsa.has(adv.ghsa)) {
      matched.add(adv.ghsa);
      warnings.push(`allowlisted ${adv.severity} ${adv.ghsa} (${adv.packages.join(", ")}) until ${byGhsa.get(adv.ghsa).expires}: ${byGhsa.get(adv.ghsa).reason}`);
    } else {
      errors.push(`${adv.severity} ${adv.ghsa} in ${adv.packages.join(", ")}: ${adv.title} ${adv.url}`.trim());
    }
  }

  for (const ghsa of byGhsa.keys()) {
    if (matched.has(ghsa)) continue;
    const msg = `allowlist entry ${ghsa} matches no current high/critical advisory — remove it`;
    if (fullTree) errors.push(msg);
    else warnings.push(msg);
  }

  return { errors, warnings };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const allowlist = existsSync(opts.allowlist) ? JSON.parse(readFileSync(opts.allowlist, "utf-8")) : { entries: [] };
  const advisories = collectAdvisories(readAuditJson(opts));
  const { errors, warnings } = evaluate({ advisories, allowlist, today, fullTree: !opts.omitDev });

  const scope = opts.omitDev ? "production dependencies" : "all dependencies";
  for (const w of warnings) console.log(`[audit-gate] warning: ${w}`);
  if (errors.length === 0) {
    console.log(`[audit-gate] ${scope}: no unaccepted high/critical advisories (${advisories.length} advisories of any severity)`);
    return;
  }
  for (const e of errors) console.error(`[audit-gate] ${e}`);
  if (opts.warnOnly) {
    console.log(`[audit-gate] ${scope}: ${errors.length} issue(s) — warn-only mode, not failing`);
    return;
  }
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
