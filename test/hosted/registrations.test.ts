/**
 * Locks the hosted MCP capability surface at the source-file level.
 *
 * The hosted trust posture depends on "the tool surface is exactly 9 tools."
 * That claim is only meaningful if nothing can silently grow the surface from
 * inside an existing tool file — e.g. a second `server.tool(...)` call, or
 * (structurally identical for this purpose) a `mode` parameter that behaves
 * like a second tool. `src/tools/brand-feedback.ts` (the LOCAL, non-hosted
 * surface) already registers three tool names — brand_feedback,
 * brand_feedback_review, brand_feedback_triage — from one file. This test
 * file exists so the same pattern reaching `src/hosted/tools/` fails CI.
 *
 * Three independent locks, each catching a different drift vector:
 *   1. HOSTED_TOOL_ORDER.length is an exact hardcoded constant (not a floor).
 *   2. Each src/hosted/tools/*.ts file registers an exact, enumerated number
 *      of tools, verified by statically counting `server.tool(` call sites in
 *      the source text — independent of what HOSTED_TOOL_ORDER itself claims,
 *      so a file can't drift out of sync with the manifest.
 *   3. TOOL_SCOPE_REQUIREMENTS has exactly one entry per HOSTED_TOOL_ORDER
 *      name (membership only; the auth.test.ts "covers every locked hosted
 *      tool for each key posture" test already asserts this same equality —
 *      duplicated here as a narrow membership check colocated with the other
 *      surface-lock assertions, not as a replacement for that test).
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { HOSTED_TOOL_ORDER } from "../../src/hosted/registrations.js";
import { TOOL_SCOPE_REQUIREMENTS } from "../../src/hosted/auth.js";

const HOSTED_TOOLS_DIR = fileURLToPath(
  new URL("../../src/hosted/tools/", import.meta.url),
);

/**
 * Expected `server.tool(` registration-call count per file under
 * src/hosted/tools/. This is the KNOWN, intentional shape as of the Phase 0
 * lock: every file registers exactly one tool except assets.ts, which
 * legitimately registers two (list_brand_assets + get_brand_asset). Adding a
 * file here requires deliberately deciding its expected count — that
 * friction is the point.
 */
const EXPECTED_REGISTRATIONS_PER_FILE: Record<string, number> = {
  "runtime.ts": 1,
  "search.ts": 1,
  "check.ts": 1,
  "status.ts": 1,
  "assets.ts": 2,
  "feedback.ts": 1,
  "capture-taste.ts": 1,
  "history.ts": 1,
};

const EXPECTED_HOSTED_TOOL_COUNT = 9;

/**
 * Counts `server.tool(` call sites in source text. Intentionally a plain
 * substring/regex count rather than an AST walk: the goal is to catch someone
 * adding a second literal registration call, which this catches directly and
 * without needing a TS parser dependency. A commented-out call would also be
 * counted — expected, since sabotage checks in this file favor catching the
 * pattern even fuzzily over silently trusting call sites away.
 */
function countToolRegistrations(source: string): number {
  const matches = source.match(/\bserver\s*\.\s*tool\s*\(/g);
  return matches ? matches.length : 0;
}

function listHostedToolFiles(): string[] {
  return readdirSync(HOSTED_TOOLS_DIR)
    .filter((name) => name.endsWith(".ts"))
    .sort();
}

/** Each hosted tool file's source, read once and shared by every test below
 *  (the per-file loop and the aggregate recompute both need it). */
const HOSTED_TOOL_SOURCES: ReadonlyMap<string, string> = new Map(
  listHostedToolFiles().map((file) => [
    file,
    readFileSync(join(HOSTED_TOOLS_DIR, file), "utf8"),
  ]),
);

describe("hosted tool order — exact count lock", () => {
  it(`HOSTED_TOOL_ORDER has exactly ${EXPECTED_HOSTED_TOOL_COUNT} entries (hardcoded, not a floor)`, () => {
    // Deliberately toEqual/toBe on a literal, not toBeGreaterThanOrEqual —
    // the whole point is that growth by even one tool must be a conscious,
    // reviewed edit to this constant, not a silent pass.
    expect(HOSTED_TOOL_ORDER.length).toBe(EXPECTED_HOSTED_TOOL_COUNT);
  });

  it("has no duplicate tool names", () => {
    expect(new Set(HOSTED_TOOL_ORDER).size).toBe(HOSTED_TOOL_ORDER.length);
  });
});

describe("hosted tool files — per-file registration-call count lock", () => {
  it("src/hosted/tools/ contains exactly the known set of tool files", () => {
    // Guards the file inventory itself: a new file dropped into this
    // directory without an entry in EXPECTED_REGISTRATIONS_PER_FILE would
    // otherwise silently register 0-expected tools and pass by omission.
    expect(listHostedToolFiles().sort()).toEqual(
      Object.keys(EXPECTED_REGISTRATIONS_PER_FILE).sort(),
    );
  });

  for (const [file, expectedCount] of Object.entries(
    EXPECTED_REGISTRATIONS_PER_FILE,
  )) {
    it(`${file} registers exactly ${expectedCount} tool(s) via server.tool(...)`, () => {
      const source = HOSTED_TOOL_SOURCES.get(file) ?? "";
      expect(countToolRegistrations(source)).toBe(expectedCount);
    });
  }

  it("sum of per-file registration counts equals HOSTED_TOOL_ORDER.length", () => {
    const total = Object.values(EXPECTED_REGISTRATIONS_PER_FILE).reduce(
      (a, b) => a + b,
      0,
    );
    expect(total).toBe(HOSTED_TOOL_ORDER.length);
  });

  it("actual on-disk registration-call total matches the expected total (independent of the fixture map)", () => {
    // Recomputes the total from the shared HOSTED_TOOL_SOURCES map rather
    // than from EXPECTED_REGISTRATIONS_PER_FILE, so a future PR can't "fix"
    // this test by only editing the fixture map without anyone questioning
    // why the count changed. (Shares the cached file reads with the per-file
    // loop above rather than re-reading disk -- same independence guarantee,
    // no duplicate I/O.)
    let actualTotal = 0;
    for (const source of HOSTED_TOOL_SOURCES.values()) {
      actualTotal += countToolRegistrations(source);
    }
    expect(actualTotal).toBe(EXPECTED_HOSTED_TOOL_COUNT);
  });
});

describe("hosted tool scopes — exact membership lock", () => {
  // NOTE: test/hosted/auth.test.ts already asserts
  // `Object.keys(TOOL_SCOPE_REQUIREMENTS).sort() === [...HOSTED_TOOL_ORDER].sort()`
  // inside "covers every locked hosted tool for each key posture". This test
  // is intentionally duplicated (narrowly) so the full set of surface-lock
  // invariants lives together in one file — it is not filling a gap left by
  // that test.
  it("TOOL_SCOPE_REQUIREMENTS has exactly one entry per HOSTED_TOOL_ORDER name — no more, no fewer", () => {
    const scopeKeys = Object.keys(TOOL_SCOPE_REQUIREMENTS);
    expect(scopeKeys.length).toBe(HOSTED_TOOL_ORDER.length);
    expect(scopeKeys.sort()).toEqual([...HOSTED_TOOL_ORDER].sort());
  });
});
