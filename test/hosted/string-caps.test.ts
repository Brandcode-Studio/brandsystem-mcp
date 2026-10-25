/**
 * Hosted string-length caps: advertised in the JSON schema (maxLength, via
 * zod 4 + strictInputSchema) and enforced at call time; search scoring is
 * bounded by a cap on unique query terms.
 */
import { describe, expect, it } from "vitest";
import { connectHostedClient } from "./helpers.js";
import {
  SEARCH_MAX_QUERY_TERMS,
  SEARCH_QUERY_MAX_LENGTH,
  tokenize,
} from "../../src/hosted/tools/search.js";
import {
  CHECK_CSS_MAX_LENGTH,
  CHECK_TEXT_MAX_LENGTH,
  CHECK_TOKEN_MAX_LENGTH,
} from "../../src/hosted/tools/check.js";
import type { HostedBrandContext } from "../../src/hosted/types.js";

function context(): HostedBrandContext {
  return {
    slug: "acme",
    auth: {
      token: "t",
      keyId: "k",
      scopes: ["read", "check", "feedback", "capture"],
      allowedSlugs: ["acme"],
      environment: "staging",
    },
    loadBrandPackage: async () => ({
      runtime: { version: "1.0.0", client_name: "Acme" },
    }),
    loadTasteGuidance: async () => null,
    ucsBaseUrl: "https://ucs.test",
    ucsServiceToken: "svc",
  };
}

type Schema = {
  properties?: Record<string, { maxLength?: number }>;
  additionalProperties?: unknown;
};

describe("advertised maxLength on hosted string inputs", () => {
  it("brand_search, brand_check, and brand_history advertise their caps", async () => {
    const { client } = await connectHostedClient(context());
    const { tools } = await client.listTools();
    const schema = (name: string) =>
      tools.find((t) => t.name === name)!.inputSchema as Schema;

    const search = schema("brand_search");
    expect(search.properties!.query.maxLength).toBe(SEARCH_QUERY_MAX_LENGTH);
    expect(search.additionalProperties).toBe(false);

    const check = schema("brand_check");
    expect(check.properties!.text.maxLength).toBe(CHECK_TEXT_MAX_LENGTH);
    expect(check.properties!.css.maxLength).toBe(CHECK_CSS_MAX_LENGTH);
    expect(check.properties!.color.maxLength).toBe(CHECK_TOKEN_MAX_LENGTH);
    expect(check.properties!.font.maxLength).toBe(CHECK_TOKEN_MAX_LENGTH);
    expect(check.additionalProperties).toBe(false);

    expect(schema("brand_history").properties!.cursor.maxLength).toBe(500);
  });

  it("rejects over-cap inputs at call time", async () => {
    const { client } = await connectHostedClient(context());
    const overQuery = await client.callTool({
      name: "brand_search",
      arguments: { query: "a ".repeat(SEARCH_QUERY_MAX_LENGTH) },
    });
    expect(overQuery.isError).toBe(true);

    const overText = await client.callTool({
      name: "brand_check",
      arguments: { text: "x".repeat(CHECK_TEXT_MAX_LENGTH + 1) },
    });
    expect(overText.isError).toBe(true);

    const overColor = await client.callTool({
      name: "brand_check",
      arguments: { color: "#".repeat(CHECK_TOKEN_MAX_LENGTH + 1) },
    });
    expect(overColor.isError).toBe(true);

    const atCap = await client.callTool({
      name: "brand_search",
      arguments: { query: "logo ".repeat(SEARCH_QUERY_MAX_LENGTH / 5).slice(0, SEARCH_QUERY_MAX_LENGTH) },
    });
    expect(atCap.isError).not.toBe(true);
  });
});

describe("search scoring term cap", () => {
  it("scores at most the first 32 unique query terms", () => {
    const words = Array.from({ length: 100 }, (_, i) => `term${i}`);
    const tokens = tokenize(words.join(" "));
    expect(tokens).toHaveLength(SEARCH_MAX_QUERY_TERMS);
    expect(tokens[0]).toBe("term0");
    expect(tokens.at(-1)).toBe(`term${SEARCH_MAX_QUERY_TERMS - 1}`);
    expect(tokenize("logo logo color")).toEqual(["logo", "color"]);
  });
});
