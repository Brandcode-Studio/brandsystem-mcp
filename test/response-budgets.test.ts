import { describe, it, expect, afterEach } from "vitest";
import { rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyFixture, connectWithCwd } from "./helpers.js";
import { buildResponse, estimateTokens } from "../src/lib/response.js";

/**
 * Response budget gates (0.11). Budgets are TOKEN estimates (~4 chars each),
 * set from measured actuals with ~15% headroom. If a change trips one of
 * these, slim the response — do not raise the budget without a deliberate
 * decision (the whole point is that entry tools answer "where am I, what
 * next?" in a few hundred tokens).
 */
const BUDGETS = {
  brand_status_getting_started: 950, // one-time onboarding response
  brand_status_with_brand: 850, // measured 808 on the MAXIMAL fixture (all 4 sessions + connector); typical brands are far smaller
  brand_context_standard: 900, // task-scoped context on a full fixture
  brand_context_compact: 500, // tight sub-agent budget
};

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

async function measure(
  fixtureOrNull: string | null,
  tool: string,
  args: Record<string, unknown> = {}
): Promise<number> {
  const dir = fixtureOrNull
    ? await copyFixture(fixtureOrNull)
    : await mkdtemp(join(tmpdir(), "budget-empty-"));
  const conn = await connectWithCwd(dir);
  cleanups.push(async () => {
    await conn.cleanup();
    await rm(dir, { recursive: true, force: true });
  });
  const result = await conn.client.callTool({ name: tool, arguments: args });
  const text = (result.content as Array<{ type: string; text: string }>)[0].text;
  return estimateTokens(text);
}

describe("entry-tool response budgets", () => {
  it("brand_status getting-started fits its budget", async () => {
    const tokens = await measure(null, "brand_status");
    expect(tokens).toBeLessThanOrEqual(BUDGETS.brand_status_getting_started);
  });

  it("brand_status with a brand fits its budget", async () => {
    const tokens = await measure("brand-complete", "brand_status");
    expect(tokens).toBeLessThanOrEqual(BUDGETS.brand_status_with_brand);
  });

  it("brand_context standard fits its budget", async () => {
    const tokens = await measure("brand-complete", "brand_context", {
      task_type: "social-post",
    });
    expect(tokens).toBeLessThanOrEqual(BUDGETS.brand_context_standard);
  });

  it("brand_context compact fits its budget", async () => {
    const tokens = await measure("brand-complete", "brand_context", {
      task_type: "social-post",
      budget: "compact",
    });
    expect(tokens).toBeLessThanOrEqual(BUDGETS.brand_context_compact);
  });
});

describe("overflow handling (no mid-JSON truncation)", () => {
  it("elides the largest value behind a structured marker and stays valid JSON", () => {
    const huge = "x".repeat(60000);
    const result = buildResponse({
      what_happened: "test",
      next_steps: ["none"],
      data: { big_blob: huge, small: "keep-me" },
    });
    const text = result.content[0].text;
    expect(text).not.toContain("[TRUNCATED]");
    const parsed = JSON.parse(text); // throws if invalid
    expect(parsed.big_blob).toBeUndefined();
    expect(parsed.small).toBe("keep-me");
    expect(parsed.response_overflow.big_blob.elided).toBe(true);
    expect(parsed.response_overflow.big_blob.original_chars).toBeGreaterThan(50000);
  });

  it("returns structuredContent mirroring the text payload", () => {
    const result = buildResponse({
      what_happened: "test",
      next_steps: ["a"],
      data: { k: 1 },
    });
    expect(result.structuredContent).toMatchObject({
      _metadata: { what_happened: "test", next_steps: ["a"] },
      k: 1,
    });
    expect(JSON.parse(result.content[0].text)).toEqual(result.structuredContent);
  });
});
