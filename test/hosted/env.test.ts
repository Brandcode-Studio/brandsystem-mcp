import { describe, expect, it } from "vitest";
import {
  BRANDCODE_MCP_SERVICE_TOKEN_ENV,
  readAllowedHosts,
  readBrandcodeMcpServiceToken,
  resolveHostedEnvironment,
} from "../../src/hosted/env.js";

describe("hosted env", () => {
  it("reads the canonical Brandcode MCP service-token env var", () => {
    expect(
      readBrandcodeMcpServiceToken({
        [BRANDCODE_MCP_SERVICE_TOKEN_ENV]: " shared-secret ",
      }),
    ).toBe("shared-secret");
  });

  it("does not accept the legacy UCS_SERVICE_TOKEN name", () => {
    expect(
      readBrandcodeMcpServiceToken({
        UCS_SERVICE_TOKEN: "legacy-secret",
      }),
    ).toBeNull();
  });
});

describe("resolveHostedEnvironment", () => {
  it("accepts exactly production or staging", () => {
    expect(resolveHostedEnvironment({ BRANDCODE_MCP_ENV: "production" })).toEqual({
      ok: true,
      environment: "production",
    });
    expect(resolveHostedEnvironment({ BRANDCODE_MCP_ENV: " staging " })).toEqual({
      ok: true,
      environment: "staging",
    });
  });

  it("fails closed on unset or unknown values instead of assuming staging", () => {
    expect(resolveHostedEnvironment({}).ok).toBe(false);
    expect(resolveHostedEnvironment({ BRANDCODE_MCP_ENV: "prod" }).ok).toBe(false);
    expect(resolveHostedEnvironment({ BRANDCODE_MCP_ENV: "STAGING" }).ok).toBe(false);
  });

  it("requires production on a Vercel production deployment", () => {
    expect(
      resolveHostedEnvironment({ BRANDCODE_MCP_ENV: "staging", VERCEL_ENV: "production" }).ok,
    ).toBe(false);
    expect(
      resolveHostedEnvironment({ BRANDCODE_MCP_ENV: "production", VERCEL_ENV: "production" }).ok,
    ).toBe(true);
    expect(
      resolveHostedEnvironment({ BRANDCODE_MCP_ENV: "staging", VERCEL_ENV: "preview" }).ok,
    ).toBe(true);
  });
});

describe("readAllowedHosts", () => {
  it("parses a comma-separated override and ignores blanks", () => {
    expect(
      readAllowedHosts({ BRANDCODE_MCP_ALLOWED_HOSTS: " A.example , b.example,," }),
    ).toEqual(["a.example", "b.example"]);
    expect(readAllowedHosts({})).toBeNull();
    expect(readAllowedHosts({ BRANDCODE_MCP_ALLOWED_HOSTS: " , " })).toBeNull();
  });
});
