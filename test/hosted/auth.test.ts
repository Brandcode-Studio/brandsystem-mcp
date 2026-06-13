import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  parseBearer,
  tokenEnvironment,
  toolHasScope,
  authorizeRequest,
  AuthError,
  buildDefaultValidator,
  TOOL_SCOPE_REQUIREMENTS,
} from "../../src/hosted/auth.js";
import { HOSTED_TOOL_ORDER } from "../../src/hosted/registrations.js";

describe("parseBearer", () => {
  it("returns null when header is absent", () => {
    expect(parseBearer(new Headers())).toBeNull();
  });

  it("returns null on non-bearer schemes", () => {
    const headers = new Headers({ authorization: "Basic abc123" });
    expect(parseBearer(headers)).toBeNull();
  });

  it("returns null on malformed bearer headers", () => {
    expect(
      parseBearer(new Headers({ authorization: "Bearer" })),
    ).toBeNull();
    expect(
      parseBearer(new Headers({ authorization: "Bearer bck_test_abc extra" })),
    ).toBeNull();
  });

  it("extracts the token verbatim", () => {
    const headers = new Headers({ authorization: "Bearer bck_test_abc" });
    expect(parseBearer(headers)).toBe("bck_test_abc");
  });

  it("is case-insensitive on scheme", () => {
    const headers = new Headers({ authorization: "bearer bck_test_abc" });
    expect(parseBearer(headers)).toBe("bck_test_abc");
  });
});

describe("tokenEnvironment", () => {
  it("identifies staging tokens", () => {
    expect(tokenEnvironment("bck_test_anything")).toBe("staging");
  });
  it("identifies production tokens", () => {
    expect(tokenEnvironment("bck_live_anything")).toBe("production");
  });
  it("rejects unknown prefixes", () => {
    expect(tokenEnvironment("sk_live_foo")).toBeNull();
    expect(tokenEnvironment("")).toBeNull();
  });
});

describe("toolHasScope", () => {
  it("read scope covers all read tools", () => {
    expect(toolHasScope("brand_runtime", ["read"])).toBe(true);
    expect(toolHasScope("brand_search", ["read"])).toBe(true);
    expect(toolHasScope("brand_status", ["read"])).toBe(true);
    expect(toolHasScope("list_brand_assets", ["read"])).toBe(true);
    expect(toolHasScope("get_brand_asset", ["read"])).toBe(true);
    expect(toolHasScope("brand_history", ["read"])).toBe(true);
  });
  it("check tool requires explicit check scope", () => {
    expect(toolHasScope("brand_check", ["read"])).toBe(false);
    expect(toolHasScope("brand_check", ["check"])).toBe(true);
  });
  it("feedback requires explicit feedback scope", () => {
    expect(toolHasScope("brand_feedback", ["read"])).toBe(false);
    expect(toolHasScope("brand_feedback", ["read", "check"])).toBe(false);
    expect(toolHasScope("brand_feedback", ["feedback"])).toBe(true);
  });
  it("capture tools require explicit capture scope", () => {
    expect(toolHasScope("capture_taste", ["read"])).toBe(false);
    expect(toolHasScope("capture_taste", ["feedback"])).toBe(false);
    expect(toolHasScope("capture_taste", ["capture"])).toBe(true);
  });
  it("unknown tool rejects", () => {
    expect(toolHasScope("nonexistent_tool", ["read"])).toBe(false);
  });

  it("covers every locked hosted tool for each key posture", () => {
    const tools = [...HOSTED_TOOL_ORDER];
    expect(Object.keys(TOOL_SCOPE_REQUIREMENTS).sort()).toEqual(
      [...HOSTED_TOOL_ORDER].sort(),
    );

    const matrix = (scopes: Array<"read" | "check" | "feedback" | "capture">) =>
      Object.fromEntries(
        tools.map((tool) => [tool, toolHasScope(tool, scopes)]),
      );

    expect(matrix(["read"])).toEqual({
      brand_runtime: true,
      brand_search: true,
      brand_status: true,
      list_brand_assets: true,
      get_brand_asset: true,
      brand_history: true,
      brand_check: false,
      brand_feedback: false,
      capture_taste: false,
    });
    expect(matrix(["check"])).toEqual({
      brand_runtime: false,
      brand_search: false,
      brand_status: false,
      list_brand_assets: false,
      get_brand_asset: false,
      brand_history: false,
      brand_check: true,
      brand_feedback: false,
      capture_taste: false,
    });
    expect(matrix(["feedback"])).toEqual({
      brand_runtime: false,
      brand_search: false,
      brand_status: false,
      list_brand_assets: false,
      get_brand_asset: false,
      brand_history: false,
      brand_check: false,
      brand_feedback: true,
      capture_taste: false,
    });
    expect(matrix(["capture"])).toEqual({
      brand_runtime: false,
      brand_search: false,
      brand_status: false,
      list_brand_assets: false,
      get_brand_asset: false,
      brand_history: false,
      brand_check: false,
      brand_feedback: false,
      capture_taste: true,
    });
    expect(matrix(["read", "check", "feedback", "capture"])).toEqual({
      brand_runtime: true,
      brand_search: true,
      brand_status: true,
      list_brand_assets: true,
      get_brand_asset: true,
      brand_history: true,
      brand_check: true,
      brand_feedback: true,
      capture_taste: true,
    });
  });
});

describe("authorizeRequest", () => {
  const validator = async (token: string) => {
    if (token === "bck_test_acme_read") {
      return {
        token,
        keyId: token.slice(0, 16),
        scopes: ["read"] as const,
        allowedSlugs: ["acme"],
        environment: "staging" as const,
      };
    }
    return null;
  };

  it("rejects missing bearer with 401 missing_bearer", async () => {
    await expect(
      authorizeRequest(new Headers(), "acme", {
        environment: "staging",
        ucsServiceToken: "t",
        validateToken: validator,
      }),
    ).rejects.toMatchObject({ status: 401, code: "missing_bearer" });
  });

  it("rejects malformed bearer with 401 missing_bearer", async () => {
    await expect(
      authorizeRequest(
        new Headers({ authorization: "Bearer bck_test_acme_read extra" }),
        "acme",
        {
          environment: "staging",
          ucsServiceToken: "t",
          validateToken: validator,
        },
      ),
    ).rejects.toMatchObject({ status: 401, code: "missing_bearer" });
  });

  it("rejects unknown token with 401 invalid_token", async () => {
    const headers = new Headers({ authorization: "Bearer bck_test_unknown" });
    await expect(
      authorizeRequest(headers, "acme", {
        environment: "staging",
        ucsServiceToken: "t",
        validateToken: validator,
      }),
    ).rejects.toMatchObject({ status: 401, code: "invalid_token" });
  });

  it("rejects slug mismatch with 403 slug_forbidden", async () => {
    const headers = new Headers({
      authorization: "Bearer bck_test_acme_read",
    });
    await expect(
      authorizeRequest(headers, "pendium", {
        environment: "staging",
        ucsServiceToken: "t",
        validateToken: validator,
      }),
    ).rejects.toMatchObject({ status: 403, code: "slug_forbidden" });
  });

  it("resolves auth info when token + slug match", async () => {
    const headers = new Headers({
      authorization: "Bearer bck_test_acme_read",
    });
    const info = await authorizeRequest(headers, "acme", {
      environment: "staging",
      ucsServiceToken: "t",
      validateToken: validator,
    });
    expect(info.scopes).toContain("read");
    expect(info.allowedSlugs).toEqual(["acme"]);
    expect(info.environment).toBe("staging");
  });
});

describe("buildDefaultValidator (env-seeded staging keys)", () => {
  const originalEnv = process.env.BRANDCODE_MCP_TEST_KEYS;

  beforeEach(() => {
    process.env.BRANDCODE_MCP_TEST_KEYS =
      "bck_test_primary:acme:read,check,feedback,capture|bck_test_primary:pendium:read|bck_test_readonly:acme:read|bck_live_primary:acme:read,check,feedback,capture";
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.BRANDCODE_MCP_TEST_KEYS;
    } else {
      process.env.BRANDCODE_MCP_TEST_KEYS = originalEnv;
    }
  });

  it("parses multi-slug + multi-scope seeds", async () => {
    const v = buildDefaultValidator("staging");
    const info = await v("bck_test_primary");
    expect(info).not.toBeNull();
    expect(info!.allowedSlugs.sort()).toEqual(["acme", "pendium"]);
    expect(info!.scopes.sort()).toEqual(["capture", "check", "feedback", "read"]);
  });

  it("rejects tokens whose prefix mismatches environment", async () => {
    const staging = buildDefaultValidator("staging");
    const production = buildDefaultValidator("production");
    expect(await staging("bck_live_primary")).toBeNull();
    expect(await production("bck_test_primary")).toBeNull();
  });

  it("accepts production-prefixed seeds only in production mode", async () => {
    const v = buildDefaultValidator("production");
    const info = await v("bck_live_primary");
    expect(info).toMatchObject({
      allowedSlugs: ["acme"],
      environment: "production",
      scopes: ["read", "check", "feedback", "capture"],
    });
  });

  it("rejects unknown tokens", async () => {
    const v = buildDefaultValidator("staging");
    expect(await v("bck_test_unknown")).toBeNull();
  });
});

// Keep AuthError import used so TS tree-shake doesn't warn
void AuthError;
