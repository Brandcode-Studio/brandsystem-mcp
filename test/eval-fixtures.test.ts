/**
 * Structural guarantees for the public evaluation fixtures.
 *
 * The development prompt set is the surface description authors optimize
 * against; these tests keep its schema honest (set marker, categories,
 * negative-case labeling) so the harness's scoring and the holdout
 * commitment tooling can rely on it.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateHoldout } from "../scripts/holdout-commitment.mjs";
import { isNegativeCase } from "../scripts/agent-eval.mjs";

const prompts = JSON.parse(
  readFileSync(join(process.cwd(), "eval", "fixtures", "prompts.json"), "utf-8")
);
const compliance = JSON.parse(
  readFileSync(
    join(process.cwd(), "eval", "fixtures", "compliance", "cases.json"),
    "utf-8"
  )
);

describe("eval/fixtures/prompts.json (development set)", () => {
  it("is explicitly marked as the development set", () => {
    expect(prompts.set).toBe("development");
  });

  it("has unique ids and a category + profile on every case", () => {
    const ids = prompts.cases.map((c: { id: string }) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of prompts.cases) {
      expect(c.prompt, c.id).toBeTypeOf("string");
      expect(c.prompt.length, c.id).toBeGreaterThan(0);
      expect(c.category, c.id).toBeTypeOf("string");
      expect(["core", "full"], c.id).toContain(c.profile);
      expect(Array.isArray(c.expected_tools), c.id).toBe(true);
    }
  });

  it("contains 6-8 negative routing cases labeled category=negative with no expected tools", () => {
    const negatives = prompts.cases.filter(
      (c: { category?: string }) => c.category === "negative"
    );
    expect(negatives.length).toBeGreaterThanOrEqual(6);
    expect(negatives.length).toBeLessThanOrEqual(8);
    for (const c of negatives) {
      expect(c.expected_tools, c.id).toEqual([]);
      expect(c.expected_action, c.id).toBe("no_tool");
      expect(isNegativeCase(c), c.id).toBe(true);
    }
  });

  it("gives every positive case at least one expected tool and never a no_tool label", () => {
    const positives = prompts.cases.filter(
      (c: { category?: string }) => c.category !== "negative"
    );
    expect(positives.length).toBeGreaterThan(0);
    for (const c of positives) {
      expect(c.expected_tools.length, c.id).toBeGreaterThan(0);
      expect(c.expected_action, c.id).toBeUndefined();
      expect(isNegativeCase(c), c.id).toBe(false);
    }
  });

  it("conforms to the same case schema the holdout commitment tool validates", () => {
    // The dev and holdout sets share one case shape, so a holdout can be
    // assembled from the same schema without translation.
    expect(() => validateHoldout(prompts)).not.toThrow();
  });
});

describe("eval/fixtures/compliance/cases.json", () => {
  it("has unique ids and a binary expected verdict on every case", () => {
    const ids = compliance.cases.map((c: { id: string }) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of compliance.cases) {
      expect(["pass", "fail"], c.id).toContain(c.expected);
      expect(c.content.length, c.id).toBeGreaterThan(0);
      expect(c.reason.length, c.id).toBeGreaterThan(0);
    }
  });
});
