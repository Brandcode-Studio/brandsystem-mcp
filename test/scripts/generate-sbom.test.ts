import { describe, it, expect } from "vitest";
import { productionKeys, toProductionSbom } from "../../scripts/generate-sbom.mjs";

const pkg = {
  name: "@brandsystem/mcp",
  version: "1.2.3",
  dependencies: { yaml: "^2", zod: "^4" },
  devDependencies: { vitest: "^4" },
};

const lock = {
  packages: {
    "": { name: "@brandsystem/mcp", version: "1.2.3" },
    "node_modules/yaml": { version: "2.9.1" },
    "node_modules/zod": { version: "4.6.7" },
    "node_modules/vitest": { version: "4.1.12", dev: true },
    "node_modules/vite": { version: "7.0.0", dev: true },
    "node_modules/vitest/node_modules/zod": { version: "3.0.0", dev: true },
  },
};

const comp = (name: string, version: string) => ({ "bom-ref": `${name}@${version}`, name, version });

const fullSbom = {
  bomFormat: "CycloneDX",
  specVersion: "1.5",
  metadata: { component: { "bom-ref": "@brandsystem/mcp@1.2.3", name: "checkout-dir", version: "1.2.3" } },
  components: [comp("yaml", "2.9.1"), comp("zod", "4.6.7"), comp("vitest", "4.1.12"), comp("vite", "7.0.0"), comp("zod", "3.0.0")],
  dependencies: [
    { ref: "@brandsystem/mcp@1.2.3", dependsOn: ["yaml@2.9.1", "zod@4.6.7", "vitest@4.1.12"] },
    { ref: "vitest@4.1.12", dependsOn: ["vite@7.0.0", "zod@3.0.0"] },
    { ref: "vite@7.0.0", dependsOn: ["yaml@2.9.1"] },
  ],
};

describe("generate-sbom", () => {
  it("classifies production packages from package-lock (dev:true excluded, root skipped)", () => {
    expect([...productionKeys(lock)].sort()).toEqual(["yaml@2.9.1", "zod@4.6.7"]);
  });

  it("keeps a prod package that is also reachable from a dev package (the npm sbom --omit dev bug)", () => {
    const { sbom, problems } = toProductionSbom(fullSbom, pkg, lock);
    expect(problems).toEqual([]);
    expect(sbom.components.map((c: { "bom-ref": string }) => c["bom-ref"]).sort()).toEqual(["yaml@2.9.1", "zod@4.6.7"]);
    expect(sbom.dependencies).toEqual([
      { ref: "@brandsystem/mcp@1.2.3", dependsOn: ["yaml@2.9.1", "zod@4.6.7"] },
    ]);
    expect(sbom.metadata.component.name).toBe("@brandsystem/mcp");
  });

  it("does not mutate its input", () => {
    toProductionSbom(fullSbom, pkg, lock);
    expect(fullSbom.components).toHaveLength(5);
    expect(fullSbom.metadata.component.name).toBe("checkout-dir");
  });

  it("reports a production package missing from npm's output", () => {
    const missing = { ...fullSbom, components: fullSbom.components.filter((c) => c.name !== "yaml") };
    const { problems } = toProductionSbom(missing, pkg, lock);
    expect(problems.join("\n")).toMatch(/yaml@2\.9\.1 .*missing/);
    expect(problems.join("\n")).toMatch(/production dependency yaml is missing/);
  });

  it("reports a version mismatch and a non-CycloneDX document", () => {
    const { problems } = toProductionSbom({ ...fullSbom, bomFormat: "SPDX" }, { ...pkg, version: "9.9.9" }, lock);
    expect(problems.join("\n")).toMatch(/bomFormat/);
    expect(problems.join("\n")).toMatch(/root version 1\.2\.3 != package\.json 9\.9\.9/);
  });
});
