import { describe, it, expect, beforeEach } from "vitest";
import {
  parseBearer,
  tokenEnvironment,
  toolHasScope,
  authorizeRequest,
  AuthError,
} from "../../src/hosted/auth.js";

describe("parseBearer", () => {
  it("returns null when header is absent", () => {
    expect(parseBearer(new Headers())).toBeNull();
  });

  it("returns null on non-bearer schemes", () => {
    const headers = new Headers({ authorization: "Basic abc123" });
    expect(parseBearer(headers)).toBeNull();
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
    expect(toolHasScope("brand_status", ["read"])).toBe(true);
    expect(toolHasScope("list_brand_assets", ["read"])).toBe(true);
  });
  it("check tool accepts read-only keys (progressive trust)", () => {
    expect(toolHasScope("brand_check", ["read"])).toBe(true);
    expect(toolHasScope("brand_check", ["check"])).toBe(true);
  });
  it("feedback requires explicit feedback scope", () => {
    expect(toolHasScope("brand_feedback", ["read"])).toBe(false);
    expect(toolHasScope("brand_feedback", ["read", "check"])).toBe(false);
    expect(toolHasScope("brand_feedback", ["feedback"])).toBe(true);
  });
  it("unknown tool rejects", () => {
    expect(toolHasScope("nonexistent_tool", ["read"])).toBe(false);
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
      "bck_test_primary:acme:read,check,feedback|bck_test_primary:pendium:read|bck_test_readonly:acme:read";
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.BRANDCODE_MCP_TEST_KEYS;
    } else {
      process.env.BRANDCODE_MCP_TEST_KEYS = originalEnv;
    }
  });

  it("parses multi-slug + multi-scope seeds", async () => {
    const { buildDefaultValidator } = await import(
      "../../src/hosted/auth.js"
    );
    const v = buildDefaultValidator("staging");
    const info = await v("bck_test_primary");
    expect(info).not.toBeNull();
    expect(info!.allowedSlugs.sort()).toEqual(["acme", "pendium"]);
    expect(info!.scopes.sort()).toEqual(["check", "feedback", "read"]);
  });

  it("rejects tokens whose prefix mismatches environment", async () => {
    const { buildDefaultValidator } = await import(
      "../../src/hosted/auth.js"
    );
    const v = buildDefaultValidator("production");
    expect(await v("bck_test_primary")).toBeNull();
  });

  it("rejects unknown tokens", async () => {
    const { buildDefaultValidator } = await import(
      "../../src/hosted/auth.js"
    );
    const v = buildDefaultValidator("staging");
    expect(await v("bck_test_unknown")).toBeNull();
  });
});

// Keep AuthError import used so TS tree-shake doesn't warn
void AuthError;

// Late import of afterEach to keep grouping with beforeEach above
import { afterEach } from "vitest";
