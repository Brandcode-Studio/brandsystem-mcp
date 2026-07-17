#!/usr/bin/env node
/**
 * Dogfood prompt capture (0.12) — appends a privacy-safe record to a PRIVATE
 * JSONL outside the repository. See eval/dogfood/README.md for the protocol.
 *
 * Never stores brand content. Refuses prompts containing entries from the
 * local denylist (~/.brandsystem/dogfood-denylist.txt, one name per line).
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

const CAPTURE_FILE =
  process.env.BRANDSYSTEM_DOGFOOD_FILE ??
  join(homedir(), ".brandsystem", "dogfood-capture.jsonl");
const DENYLIST_FILE = join(homedir(), ".brandsystem", "dogfood-denylist.txt");

const VALID_OUTCOMES = new Set(["completed", "wrong-tool", "abandoned", "bypassed-mcp"]);

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const val = i + 1 < argv.length && !argv[i + 1].startsWith("--") ? argv[++i] : "";
    out[key] = val;
  }
  return out;
}

function fail(msg) {
  console.error(`dogfood-capture: ${msg}`);
  process.exit(1);
}

const args = parseArgs(process.argv.slice(2));

if (!args.intent) fail("--intent is required (short description, no brand content)");
if (args.outcome && !VALID_OUTCOMES.has(args.outcome)) {
  fail(`--outcome must be one of: ${[...VALID_OUTCOMES].join(", ")}`);
}

// Denylist check: the redacted prompt must not contain any known brand name.
if (args.prompt && existsSync(DENYLIST_FILE)) {
  const names = readFileSync(DENYLIST_FILE, "utf-8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 1 && !l.startsWith("#"));
  const lower = args.prompt.toLowerCase();
  const hit = names.find((n) => lower.includes(n.toLowerCase()));
  if (hit) {
    fail(
      `prompt contains a denylisted name — redact it (replace with {BRAND}) and retry. ` +
        `Denylist: ${DENYLIST_FILE}`
    );
  }
}

const record = {
  date: new Date().toISOString().slice(0, 10),
  intent: args.intent,
  ...(args.prompt ? { prompt_redacted: args.prompt } : {}),
  source: args.source ?? "unattributed",
  ...(args.tools ? { tools_selected: args.tools.split(",").map((t) => t.trim()) } : {}),
  ...(args.outcome ? { outcome: args.outcome } : {}),
  ...(args.friction ? { friction: args.friction } : {}),
  ...(args.repair ? { repair: args.repair } : {}),
};

mkdirSync(dirname(CAPTURE_FILE), { recursive: true });
appendFileSync(CAPTURE_FILE, JSON.stringify(record) + "\n", "utf-8");

const count = readFileSync(CAPTURE_FILE, "utf-8").trim().split("\n").length;
console.log(`captured (${count} total) → ${CAPTURE_FILE}`);
if (count >= 50) {
  console.log(
    "50+ captures — enough to consider the source-split holdout freeze (eval/dogfood/README.md step 1)."
  );
}
