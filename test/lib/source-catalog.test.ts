import { describe, expect, it } from "vitest";
import {
  applyConflictResolution,
  buildSourceCatalogRecords,
  findConflicts,
  type SourceCatalogFile,
} from "../../src/lib/source-catalog.js";
import type { CoreIdentityData } from "../../src/schemas/index.js";

describe("source-catalog", () => {
  it("finds conflicting field values and recommends the higher-priority source", () => {
    const catalog: SourceCatalogFile = {
      schema_version: "0.1.0",
      updated_at: "2026-04-14T00:00:00.000Z",
      fields: {
        "colors.primary": [
          { source: "web", value: "#00749a", confidence: "high", recorded_at: "2026-04-14T00:00:00.000Z" },
          { source: "guidelines", value: "#00a3e0", confidence: "high", recorded_at: "2026-04-14T00:00:01.000Z" },
        ],
      },
    };

    const conflicts = findConflicts(catalog, ["guidelines", "figma", "visual", "web", "manual"]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].field).toBe("colors.primary");
    expect(conflicts[0].recommended).toBe("guidelines");
  });

  it("applies a resolved record back into core identity", () => {
    const identity: CoreIdentityData = {
      schema_version: "0.1.0",
      colors: [
        { name: "Brand Blue", value: "#00749a", role: "primary", source: "web", confidence: "high" },
      ],
      typography: [],
      logo: [],
      spacing: null,
    };

    const updated = applyConflictResolution(identity, "colors.primary", {
      source: "guidelines",
      value: "#00a3e0",
      confidence: "high",
      recorded_at: "2026-04-14T00:00:00.000Z",
      metadata: { name: "Primary Blue", role: "primary" },
    });

    expect(updated.colors.find((entry) => entry.role === "primary")?.value).toBe("#00a3e0");
    expect(updated.colors.find((entry) => entry.role === "primary")?.source).toBe("guidelines");
  });

  // Theme dimension (issue #35 gap 1): the catalog must keep light and dark
  // variants of the same role in separate slots, matching mergeColor's
  // (role, theme) key.
  it("gives dark-theme colors their own catalog field and carries theme metadata", () => {
    const records = buildSourceCatalogRecords({
      colors: [
        { name: "Surface", value: "#ffffff", role: "surface", source: "web", confidence: "high" },
        { name: "Surface Dark", value: "#111111", role: "surface", source: "web", confidence: "high", theme: "dark" },
      ],
    });

    expect(records.map((r) => r.field)).toEqual(["colors.surface", "colors.surface.dark"]);
    expect(records[0].record.metadata?.theme).toBeUndefined();
    expect(records[1].record.metadata?.theme).toBe("dark");
  });

  it("does not report light vs dark variants of the same role as a conflict", () => {
    const records = buildSourceCatalogRecords({
      colors: [
        { name: "Surface", value: "#ffffff", role: "surface", source: "web", confidence: "high" },
        { name: "Surface Dark", value: "#111111", role: "surface", source: "web", confidence: "high", theme: "dark" },
      ],
    });
    const catalog: SourceCatalogFile = {
      schema_version: "0.1.0",
      updated_at: "2026-07-18T00:00:00.000Z",
      fields: Object.fromEntries(records.map((r) => [r.field, [r.record]])),
    };

    expect(findConflicts(catalog, ["guidelines", "figma", "visual", "web", "manual"])).toHaveLength(0);
  });

  it("resolves a dark-theme record without evicting the light entry for the same role", () => {
    const identity: CoreIdentityData = {
      schema_version: "0.1.0",
      colors: [
        { name: "Surface", value: "#ffffff", role: "surface", source: "web", confidence: "high" },
        { name: "Surface Dark", value: "#222222", role: "surface", source: "web", confidence: "medium", theme: "dark" },
      ],
      typography: [],
      logo: [],
      spacing: null,
    };

    const updated = applyConflictResolution(identity, "colors.surface.dark", {
      source: "guidelines",
      value: "#111111",
      confidence: "high",
      recorded_at: "2026-07-18T00:00:00.000Z",
      metadata: { name: "Surface Dark", role: "surface", theme: "dark" },
    });

    const light = updated.colors.find((entry) => entry.role === "surface" && entry.theme !== "dark");
    const dark = updated.colors.find((entry) => entry.role === "surface" && entry.theme === "dark");
    expect(light?.value).toBe("#ffffff");
    expect(dark?.value).toBe("#111111");
    expect(dark?.source).toBe("guidelines");
    expect(updated.colors.filter((entry) => entry.role === "surface")).toHaveLength(2);
  });

  it("resolving the light field leaves the dark entry untouched", () => {
    const identity: CoreIdentityData = {
      schema_version: "0.1.0",
      colors: [
        { name: "Surface", value: "#ffffff", role: "surface", source: "web", confidence: "high" },
        { name: "Surface Dark", value: "#111111", role: "surface", source: "web", confidence: "high", theme: "dark" },
      ],
      typography: [],
      logo: [],
      spacing: null,
    };

    const updated = applyConflictResolution(identity, "colors.surface", {
      source: "manual",
      value: "#fafafa",
      confidence: "high",
      recorded_at: "2026-07-18T00:00:00.000Z",
      metadata: { name: "Surface", role: "surface" },
    });

    expect(updated.colors.find((e) => e.role === "surface" && e.theme !== "dark")?.value).toBe("#fafafa");
    expect(updated.colors.find((e) => e.role === "surface" && e.theme === "dark")?.value).toBe("#111111");
  });
});
