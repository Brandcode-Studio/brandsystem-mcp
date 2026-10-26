import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchClearbitLogo,
  fetchGoogleFavicon,
  thirdPartyLogoFallbackEnabled,
} from "../../src/lib/logo-extractor.js";

describe("third-party logo fallback switch", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("is on by default and off for off/0/false/no in any case", () => {
    expect(thirdPartyLogoFallbackEnabled({})).toBe(true);
    for (const value of ["off", "OFF", "0", "false", "No", " off "]) {
      expect(thirdPartyLogoFallbackEnabled({ BRANDSYSTEM_THIRD_PARTY_LOGO_FALLBACK: value })).toBe(false);
    }
    expect(thirdPartyLogoFallbackEnabled({ BRANDSYSTEM_THIRD_PARTY_LOGO_FALLBACK: "on" })).toBe(true);
  });

  it("makes no network request to Clearbit or Google when off", async () => {
    vi.stubEnv("BRANDSYSTEM_THIRD_PARTY_LOGO_FALLBACK", "off");
    const fetchSpy = vi.fn(() => {
      throw new Error("network must not be used");
    });
    vi.stubGlobal("fetch", fetchSpy);
    await expect(fetchClearbitLogo("https://example.com")).resolves.toBeNull();
    await expect(fetchGoogleFavicon("https://example.com")).resolves.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
