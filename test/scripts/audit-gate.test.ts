import { describe, it, expect } from "vitest";
import { collectAdvisories, evaluate } from "../../scripts/audit-gate.mjs";

const report = (vias: Array<Record<string, unknown>>) => ({
  vulnerabilities: {
    pkg: { name: "pkg", severity: "high", via: [...vias, "transitive-name-only"] },
  },
});

const highAdvisory = {
  source: 1,
  name: "pkg",
  title: "Bad thing",
  url: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc",
  severity: "high",
};

describe("audit-gate", () => {
  it("collects GHSA ids from via objects and ignores string vias", () => {
    const advisories = collectAdvisories(report([highAdvisory]));
    expect(advisories).toEqual([
      expect.objectContaining({ ghsa: "GHSA-AAAA-BBBB-CCCC", severity: "high", packages: ["pkg"] }),
    ]);
  });

  it("blocks an unaccepted high advisory", () => {
    const { errors } = evaluate({
      advisories: collectAdvisories(report([highAdvisory])),
      allowlist: { entries: [] },
      today: "2026-10-25",
      fullTree: true,
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("GHSA-AAAA-BBBB-CCCC");
  });

  it("does not block moderate advisories", () => {
    const { errors } = evaluate({
      advisories: collectAdvisories(report([{ ...highAdvisory, severity: "moderate" }])),
      allowlist: { entries: [] },
      today: "2026-10-25",
      fullTree: true,
    });
    expect(errors).toEqual([]);
  });

  it("accepts an allowlisted advisory until it expires", () => {
    const allowlist = { entries: [{ ghsa: "GHSA-aaaa-bbbb-cccc", reason: "no upstream fix", expires: "2026-11-01" }] };
    const advisories = collectAdvisories(report([highAdvisory]));
    expect(evaluate({ advisories, allowlist, today: "2026-10-25", fullTree: true }).errors).toEqual([]);
    expect(evaluate({ advisories, allowlist, today: "2026-11-02", fullTree: true }).errors[0]).toContain("expired");
  });

  it("rejects malformed allowlist entries", () => {
    const { errors } = evaluate({
      advisories: [],
      allowlist: { entries: [{ ghsa: "GHSA-aaaa-bbbb-cccc", expires: "2026-11-01" }] },
      today: "2026-10-25",
      fullTree: true,
    });
    expect(errors[0]).toContain("needs ghsa, reason, and expires");
  });

  it("fails stale allowlist entries on full-tree runs and only warns on production-only runs", () => {
    const allowlist = { entries: [{ ghsa: "GHSA-zzzz-zzzz-zzzz", reason: "dev-only", expires: "2026-11-01" }] };
    const full = evaluate({ advisories: [], allowlist, today: "2026-10-25", fullTree: true });
    const prod = evaluate({ advisories: [], allowlist, today: "2026-10-25", fullTree: false });
    expect(full.errors[0]).toContain("matches no current");
    expect(prod.errors).toEqual([]);
    expect(prod.warnings[0]).toContain("matches no current");
  });
});
