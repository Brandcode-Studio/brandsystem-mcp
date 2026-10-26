#!/usr/bin/env node
/**
 * Render the generated part of docs/DATA-FLOWS.md from
 * security/egress-allowlist.json, so the data-flow docs cannot drift from the
 * allowlist that test/security/egress-allowlist.test.ts enforces.
 *
 *   node scripts/render-data-flows.mjs --write   # rewrite the generated block
 *   node scripts/render-data-flows.mjs --check   # exit 1 if the doc is stale
 *
 * Only the text between the BEGIN/END markers is generated; everything around
 * it in docs/DATA-FLOWS.md is hand-written.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const ALLOWLIST_PATH = "security/egress-allowlist.json";
export const DOC_PATH = "docs/DATA-FLOWS.md";
export const BEGIN = "<!-- BEGIN GENERATED FROM security/egress-allowlist.json — edit that file, then run `node scripts/render-data-flows.mjs --write` -->";
export const END = "<!-- END GENERATED -->";

const cell = (s) => String(s).replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\n/g, " ");
const code = (s) => `\`${s}\``;

function hostsOf(d) {
  if (d.hosts.length) return d.hosts.map(code).join(", ");
  return "*any URL you provide*";
}

export function renderGenerated(allowlist) {
  const lines = [];
  lines.push("## Summary", "");
  lines.push("| Destination | Hosts | Consent | Tools |");
  lines.push("|---|---|---|---|");
  for (const d of allowlist.destinations) {
    lines.push(`| [${cell(d.name)}](#${d.id}) | ${cell(hostsOf(d))} | ${cell(d.consent)} | ${cell(d.tools.join(", "))} |`);
  }
  lines.push("");
  for (const d of allowlist.destinations) {
    lines.push(`### <a id="${d.id}"></a>${d.name}`, "");
    lines.push(`- **Hosts:** ${hostsOf(d)}`);
    if (d.dynamic_hosts) lines.push(`- **Which URLs:** ${d.dynamic_hosts}`);
    lines.push(`- **Consent:** ${d.consent}`);
    lines.push(`- **Tools:** ${d.tools.join(", ")}`);
    lines.push(`- **When it is contacted:** ${d.when}`);
    lines.push(`- **What is sent:** ${d.data_sent}`);
    lines.push(`- **How to disable:** ${d.disable}`);
    const endpoints = [...new Set(d.evidence.map((e) => e.literal))];
    if (endpoints.length) lines.push(`- **Hard-coded endpoints:** ${endpoints.map(code).join(", ")}`);
    lines.push(`- **Source:** ${d.modules.map((m) => code(`src/${m}.ts`)).join(", ")}`);
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

/** Replace the generated block inside the doc text. Throws if markers are missing. */
export function spliceGenerated(doc, generated) {
  const start = doc.indexOf(BEGIN);
  const end = doc.indexOf(END);
  if (start < 0 || end < start) throw new Error(`${DOC_PATH} is missing the generated-block markers`);
  return `${doc.slice(0, start + BEGIN.length)}\n\n${generated}\n\n${doc.slice(end)}`;
}

function main() {
  const mode = process.argv[2];
  const allowlist = JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8"));
  const doc = readFileSync(DOC_PATH, "utf8");
  const next = spliceGenerated(doc, renderGenerated(allowlist));
  if (mode === "--write") {
    if (next !== doc) writeFileSync(DOC_PATH, next);
    console.log(next === doc ? `${DOC_PATH} already up to date` : `Updated ${DOC_PATH}`);
  } else if (mode === "--check") {
    if (next !== doc) {
      console.error(`${DOC_PATH} is stale — run: node scripts/render-data-flows.mjs --write`);
      process.exit(1);
    }
    console.log(`${DOC_PATH} matches ${ALLOWLIST_PATH}`);
  } else {
    console.error("Usage: node scripts/render-data-flows.mjs --write | --check");
    process.exit(2);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
