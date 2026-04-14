import { describe, expect, it } from "vitest";
import {
  applyConflictResolution,
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
});
