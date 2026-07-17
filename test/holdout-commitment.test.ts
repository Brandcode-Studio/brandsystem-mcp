import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  createHoldoutCommitment,
  validateHoldout,
} from "../scripts/holdout-commitment.mjs";

const FIXTURE = {
  schema_version: "brandsystem-agent-holdout/v1",
  cases: [
    {
      id: "adopt-1",
      prompt: "Use this guide with AI",
      category: "adoption",
      profile: "core",
      expected_tools: ["brand_start"],
    },
    {
      id: "negative-1",
      prompt: "What is a brand archetype?",
      category: "negative-unrelated",
      profile: "core",
      expected_action: "no_tool",
      expected_tools: [],
    },
  ],
};

describe("holdout commitment", () => {
  it("canonicalizes object key order", () => {
    expect(canonicalJson({ b: 2, a: { d: 4, c: 3 } })).toBe(
      '{"a":{"c":3,"d":4},"b":2}',
    );
  });

  it("creates a deterministic prompt-free public commitment", () => {
    const first = createHoldoutCommitment(FIXTURE);
    const reordered = createHoldoutCommitment({
      cases: FIXTURE.cases,
      schema_version: FIXTURE.schema_version,
    });
    expect(first).toEqual(reordered);
    expect(first.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(first.case_count).toBe(2);
    expect(first.negative_case_count).toBe(1);
    expect(first.categories).toEqual({ adoption: 1, "negative-unrelated": 1 });
    expect(JSON.stringify(first)).not.toContain("Use this guide");
  });

  it("rejects unlabeled negative cases and duplicate ids", () => {
    expect(() => validateHoldout({
      cases: [{ ...FIXTURE.cases[1], expected_action: undefined }],
    })).toThrow(/expected_action/);
    expect(() => validateHoldout({
      cases: [FIXTURE.cases[0], FIXTURE.cases[0]],
    })).toThrow(/duplicate case id/);
  });
});
