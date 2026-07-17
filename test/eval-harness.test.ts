/**
 * Unit tests for the pure helpers exported by scripts/agent-eval.mjs.
 * Importing the harness must NOT trigger a run (the script guards execution
 * behind an import.meta.url check, same pattern as holdout-commitment.mjs).
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_MODEL,
  inferProvider,
  normalizeToolReply,
  isNoToolReply,
  isNegativeCase,
  deriveClarifyAnswer,
  formatCommitmentBlock,
  createAdapter,
  parseArgs,
} from "../scripts/agent-eval.mjs";
import { createHoldoutCommitment } from "../scripts/holdout-commitment.mjs";

describe("provider inference", () => {
  it("keeps the documented default model", () => {
    expect(DEFAULT_MODEL).toBe("claude-haiku-4-5-20251001");
  });

  it("routes claude-* to anthropic and gpt-*/o<digit>* to openai", () => {
    expect(inferProvider("claude-haiku-4-5-20251001", null, null)).toBe("anthropic");
    expect(inferProvider("claude-sonnet-4-5", null, null)).toBe("anthropic");
    expect(inferProvider("gpt-4o-mini", null, null)).toBe("openai");
    expect(inferProvider("o3-mini", null, null)).toBe("openai");
    expect(inferProvider("o4-mini", null, null)).toBe("openai");
  });

  it("prefers an explicit --provider override and a base URL over prefixes", () => {
    expect(inferProvider("gpt-4o-mini", "openai-compatible", null)).toBe("openai-compatible");
    expect(inferProvider("claude-haiku-4-5-20251001", "anthropic", "http://localhost:8080/v1")).toBe("anthropic");
    expect(inferProvider("llama-3.3-70b", null, "http://localhost:8080/v1")).toBe("openai-compatible");
  });

  it("falls back to anthropic for unknown prefixes with no base URL", () => {
    expect(inferProvider("unknown-model", null, null)).toBe("anthropic");
  });
});

describe("adapters", () => {
  it("builds an adapter per provider and rejects unknown providers", () => {
    expect(createAdapter("anthropic", "claude-haiku-4-5-20251001").requiredKeyEnv).toBe("ANTHROPIC_API_KEY");
    expect(createAdapter("openai", "gpt-4o-mini").requiredKeyEnv).toBe("OPENAI_API_KEY");
    const compatible = createAdapter("openai-compatible", "llama-3.3-70b", {
      baseUrl: "http://localhost:8080/v1",
    });
    expect(compatible.keyOptional).toBe(true);
    expect(() => createAdapter("gemini", "gemini-pro")).toThrow(/Unknown provider/);
    expect(() => createAdapter("openai-compatible", "m", {})).toThrow(/BRANDSYSTEM_EVAL_BASE_URL/);
  });
});

describe("reply scoring", () => {
  it("normalizes quoted/backticked tool replies", () => {
    expect(normalizeToolReply("`brand_start`")).toBe("brand_start");
    expect(normalizeToolReply('  "brand_status".  ')).toBe("brand_status");
  });

  it("accepts NONE and no-tool variants for negative cases", () => {
    expect(isNoToolReply("NONE")).toBe(true);
    expect(isNoToolReply("none.")).toBe(true);
    expect(isNoToolReply("`NONE`")).toBe(true);
    expect(isNoToolReply("No tool applies to this request.")).toBe(true);
    expect(isNoToolReply("no_tool")).toBe(true);
    expect(isNoToolReply("brand_status")).toBe(false);
    expect(isNoToolReply("Nonesuch is a brand")).toBe(false);
  });

  it("classifies negative cases by category, expected_action, or empty expected_tools", () => {
    expect(isNegativeCase({ category: "negative", expected_tools: [] })).toBe(true);
    expect(isNegativeCase({ expected_action: "no_tool", expected_tools: [] })).toBe(true);
    expect(isNegativeCase({ expected_tools: [] })).toBe(true);
    expect(isNegativeCase({ category: "adoption", expected_tools: ["brand_start"] })).toBe(false);
  });
});

describe("deriveClarifyAnswer (e2e scripted answers)", () => {
  const groundTruth = {
    colors: [
      { name: "Navy Blue", value: "#2a4494", role: "primary" },
      { name: "Coral Red", value: "#e8523f", role: "secondary" },
      { name: "Gold", value: "#f5a623", role: "accent" },
    ],
    typography: [{ name: "Heading", family: "Inter" }],
  };

  it("answers a color clarification with the hex from the question", () => {
    expect(
      deriveClarifyAnswer(
        {
          field: "colors.accent",
          question: "Color #f5a623 (name: Gold) has low confidence. Is this correct and what role does it play?",
        },
        groundTruth
      )
    ).toBe("#f5a623");
  });

  it("falls back to the ground-truth color for the role when the question has no hex", () => {
    expect(
      deriveClarifyAnswer(
        { field: "colors.secondary", question: "Which color is secondary?" },
        groundTruth
      )
    ).toBe("#e8523f");
  });

  it("maps colors.roles questions to '#hex is role' assignments from ground truth", () => {
    const answer = deriveClarifyAnswer(
      {
        field: "colors.roles",
        question: "2 color(s) have no assigned role: #e8523f, #f5a623. What role does each play?",
      },
      groundTruth
    );
    expect(answer).toBe("#e8523f is secondary, #f5a623 is accent");
  });

  it("answers typography clarifications from ground truth", () => {
    expect(deriveClarifyAnswer({ field: "typography", question: "No fonts detected." }, groundTruth)).toBe("Inter");
    expect(deriveClarifyAnswer({ field: "typography.Inter", question: "Is Inter your brand font?" }, groundTruth)).toBe("yes");
  });

  it("gives deterministic freeform answers for logo and unknown fields", () => {
    expect(deriveClarifyAnswer({ field: "logo", question: "No logo detected." }, groundTruth)).toContain("logo");
    expect(deriveClarifyAnswer({ field: "spacing", question: "Base unit?" }, groundTruth).length).toBeGreaterThan(0);
  });
});

describe("commitment block formatting", () => {
  it("prints hash, counts, and distributions without any prompt text", () => {
    const commitment = createHoldoutCommitment({
      schema_version: "brandsystem-agent-holdout/v1",
      cases: [
        {
          id: "h-1",
          prompt: "private prompt text",
          category: "adoption",
          profile: "core",
          expected_tools: ["brand_start"],
        },
        {
          id: "h-2",
          prompt: "another private prompt",
          category: "negative-unrelated",
          profile: "core",
          expected_action: "no_tool",
          expected_tools: [],
        },
      ],
    });
    const block = formatCommitmentBlock(commitment, {
      date: "2026-07-17",
      packageCommit: "abc123",
    });
    expect(block).toContain(`sha256: \`${commitment.sha256}\``);
    expect(block).toContain("case_count: 2");
    expect(block).toContain("negative_case_count: 1");
    expect(block).toContain("adoption=1");
    expect(block).toContain("negative-unrelated=1");
    expect(block).toContain("package_commit: abc123");
    expect(block).not.toContain("private prompt");
  });
});

describe("CLI parsing", () => {
  it("parses the commit-holdout subcommand with --file", () => {
    expect(parseArgs(["commit-holdout", "--file", "/tmp/h.json"])).toMatchObject({
      command: "commit-holdout",
      file: "/tmp/h.json",
    });
  });

  it("parses run flags in both --flag value and --flag=value forms", () => {
    expect(parseArgs(["--with-llm", "--model", "gpt-4o-mini", "--provider=openai"])).toMatchObject({
      command: "run",
      withLlm: true,
      model: "gpt-4o-mini",
      provider: "openai",
    });
    expect(parseArgs([])).toMatchObject({ command: "run", withLlm: false, model: null });
  });
});
