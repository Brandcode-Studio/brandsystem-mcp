import { describe, it, expect, afterEach } from "vitest";
import { z } from "zod";
import { safeParseParams, setActiveProfile, buildResponse } from "../../src/lib/response.js";
import { CORE_TOOL_NAMES } from "../../src/lib/tool-profile.js";

/**
 * Regression tests for the Colovore field-report papercuts (#42):
 * unknown-argument teaching errors and profile-aware guidance.
 */

const shape = z.object({
  client_name: z.string(),
  website_url: z.string().optional(),
  mode: z.enum(["interactive", "auto"]).default("interactive"),
});

afterEach(() => {
  // restore default profile state for other suites
  setActiveProfile("core", new Set());
});

describe("unknown-argument detection (#42.1)", () => {
  it("rejects a misspelled key with a did-you-mean suggestion", () => {
    const parsed = safeParseParams(shape, { client_name: "Colovore", url: "https://colovore.com" });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const body = JSON.parse(parsed.response.content[0].text);
      expect(body._metadata.what_happened).toContain('"url"');
      expect(body._metadata.what_happened).toContain('did you mean "website_url"');
      expect(body.valid_arguments).toContain("website_url");
    }
  });

  it("accepts exactly-valid arguments unchanged", () => {
    const parsed = safeParseParams(shape, { client_name: "Colovore", website_url: "https://colovore.com" });
    expect(parsed.success).toBe(true);
  });
});

describe("profile-aware guidance (#42.2)", () => {
  it("annotates next_steps that reference full-only tools when core is active", () => {
    setActiveProfile("core", CORE_TOOL_NAMES);
    const res = buildResponse({
      what_happened: "test",
      next_steps: [
        "Run brand_extract_visual for a rendered pass",
        "Run brand_context for task-scoped context",
      ],
      data: {},
    });
    const body = JSON.parse(res.content[0].text);
    expect(body._metadata.next_steps[0]).toContain("--profile=full");
    expect(body._metadata.next_steps[1]).not.toContain("--profile=full");
  });

  it("leaves guidance untouched in the full profile", () => {
    setActiveProfile("full", CORE_TOOL_NAMES);
    const res = buildResponse({
      what_happened: "test",
      next_steps: ["Run brand_extract_visual for a rendered pass"],
      data: {},
    });
    const body = JSON.parse(res.content[0].text);
    expect(body._metadata.next_steps[0]).not.toContain("--profile=full");
  });
});
