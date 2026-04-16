import { describe, it, expect } from "vitest";
import { resolveBrandcodeHostedUrl } from "../../src/connectors/brandcode/resolve.js";

describe("resolveBrandcodeHostedUrl", () => {
  it("resolves a bare slug", () => {
    const r = resolveBrandcodeHostedUrl("pendium");
    expect(r.slug).toBe("pendium");
    expect(r.baseUrl).toBe("https://www.brandcode.studio");
    expect(r.detailUrl).toBe(
      "https://www.brandcode.studio/api/brand/hosted/pendium",
    );
    expect(r.connectUrl).toBe(
      "https://www.brandcode.studio/api/brand/hosted/pendium/connect",
    );
    expect(r.pullUrl).toBe(
      "https://www.brandcode.studio/api/brand/hosted/pendium/pull",
    );
  });

  it("resolves a /start/brands/ URL", () => {
    const r = resolveBrandcodeHostedUrl(
      "https://www.brandcode.studio/start/brands/pendium",
    );
    expect(r.slug).toBe("pendium");
    expect(r.baseUrl).toBe("https://www.brandcode.studio");
  });

  it("resolves an /api/brand/hosted/ URL", () => {
    const r = resolveBrandcodeHostedUrl(
      "https://www.brandcode.studio/api/brand/hosted/my-brand",
    );
    expect(r.slug).toBe("my-brand");
    expect(r.pullUrl).toBe(
      "https://www.brandcode.studio/api/brand/hosted/my-brand/pull",
    );
  });

  it("resolves a custom domain URL", () => {
    const r = resolveBrandcodeHostedUrl(
      "https://custom.example.com/start/brands/acme",
    );
    expect(r.slug).toBe("acme");
    expect(r.baseUrl).toBe("https://custom.example.com");
    expect(r.pullUrl).toBe(
      "https://custom.example.com/api/brand/hosted/acme/pull",
    );
  });

  it("handles slug with hyphens", () => {
    const r = resolveBrandcodeHostedUrl("my-cool-brand");
    expect(r.slug).toBe("my-cool-brand");
  });

  it("trims whitespace", () => {
    const r = resolveBrandcodeHostedUrl("  pendium  ");
    expect(r.slug).toBe("pendium");
  });

  it("throws on empty string", () => {
    expect(() => resolveBrandcodeHostedUrl("")).toThrow("Empty");
  });

  it("throws on invalid slug characters", () => {
    expect(() => resolveBrandcodeHostedUrl("My Brand!")).toThrow(
      "Invalid brand slug",
    );
  });

  it("throws on URL with no recognizable path pattern", () => {
    expect(() =>
      resolveBrandcodeHostedUrl("https://example.com/random/path"),
    ).toThrow("Cannot extract brand slug");
  });

  it("resolves URL with trailing path after slug", () => {
    const r = resolveBrandcodeHostedUrl(
      "https://www.brandcode.studio/api/brand/hosted/pendium/connect",
    );
    expect(r.slug).toBe("pendium");
  });
});
