#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

/** Canonical JSON serialization with object keys sorted recursively. */
export function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function countBy(cases, key) {
  return Object.fromEntries(
    [...cases.reduce((counts, item) => {
      const value = String(item[key] ?? "unspecified");
      counts.set(value, (counts.get(value) ?? 0) + 1);
      return counts;
    }, new Map()).entries()].sort(([a], [b]) => a.localeCompare(b)),
  );
}

export function validateHoldout(document) {
  if (!document || typeof document !== "object" || !Array.isArray(document.cases)) {
    throw new Error("holdout must be a JSON object with a cases array");
  }
  if (document.cases.length === 0) {
    throw new Error("holdout cases array must not be empty");
  }

  const ids = new Set();
  for (const [index, item] of document.cases.entries()) {
    if (!item || typeof item !== "object") {
      throw new Error(`case ${index + 1} must be an object`);
    }
    for (const field of ["id", "prompt", "category", "profile"]) {
      if (typeof item[field] !== "string" || item[field].trim() === "") {
        throw new Error(`case ${index + 1} requires non-empty ${field}`);
      }
    }
    if (ids.has(item.id)) throw new Error(`duplicate case id: ${item.id}`);
    ids.add(item.id);
    if (!Array.isArray(item.expected_tools)) {
      throw new Error(`case ${item.id} requires expected_tools array`);
    }
    if (item.expected_tools.length === 0 && item.expected_action !== "no_tool") {
      throw new Error(`case ${item.id} with no expected tools must set expected_action to no_tool`);
    }
  }
  return document.cases;
}

export function createHoldoutCommitment(document) {
  const cases = validateHoldout(document);
  const serialized = canonicalJson(document);
  return {
    schema_version: "brandsystem-holdout-commitment/v1",
    algorithm: "sha256",
    sha256: createHash("sha256").update(serialized).digest("hex"),
    case_count: cases.length,
    negative_case_count: cases.filter((item) => item.expected_action === "no_tool").length,
    categories: countBy(cases, "category"),
    profiles: countBy(cases, "profile"),
  };
}

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath || inputPath === "--help" || inputPath === "-h") {
    console.log("Usage: npm run eval:commit-holdout -- /private/path/holdout.json");
    console.log("Prints a public SHA-256 commitment and aggregate distribution. Never prints prompts.");
    process.exitCode = inputPath ? 0 : 1;
    return;
  }

  const document = JSON.parse(await readFile(inputPath, "utf8"));
  console.log(JSON.stringify(createHoldoutCommitment(document), null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`Holdout commitment failed: ${error.message}`);
    process.exitCode = 1;
  });
}
