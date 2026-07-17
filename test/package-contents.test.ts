import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";

/**
 * Package-boundary guard (0.9.6): the published tarball is the Build MCP only.
 * Fails if hosted Use-MCP code, tests, internal specs, or undeclared
 * executables enter the npm package. Allowlist-based — new top-level
 * additions must be added here deliberately.
 */

const ALLOWLIST: RegExp[] = [
  /^dist\/(?!hosted\/).+/,
  /^bin\/brandsystem-mcp\.mjs$/,
  /^package\.json$/,
  /^README\.md$/i,
  /^LICENSE$/i,
  /^llms\.txt$/,
  /^llms-install\.md$/,
];

const DENYLIST: RegExp[] = [
  /^dist\/hosted\//,
  /^bin\/brandcode-mcp\.mjs$/,
  /^test\//,
  /^specs\//,
  /^docs\//,
  /^src\//,
  /^scripts\//,
  /\.env/,
  /brandcode-auth\.json$/,
];

let files: string[] = [];

beforeAll(() => {
  const out = execFileSync("npm", ["pack", "--dry-run", "--json"], {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 120_000,
  });
  const parsed = JSON.parse(out);
  files = parsed[0].files.map((f: { path: string }) => f.path);
}, 120_000);

describe("npm package contents", () => {
  it("contains only allowlisted paths", () => {
    const violations = files.filter(
      (f) => !ALLOWLIST.some((re) => re.test(f))
    );
    expect(violations, `Files outside the package allowlist: ${violations.join(", ")}`).toEqual([]);
  });

  it("contains no denylisted paths (hosted code, tests, specs, undeclared bins)", () => {
    const violations = files.filter((f) => DENYLIST.some((re) => re.test(f)));
    expect(violations, `Denylisted files in package: ${violations.join(", ")}`).toEqual([]);
  });

  it("declares exactly one executable, and it is in the tarball", () => {
    const pkg = JSON.parse(
      execFileSync("node", ["-p", "JSON.stringify(require('./package.json').bin)"], {
        encoding: "utf-8",
      })
    );
    expect(Object.keys(pkg)).toEqual(["brandsystem-mcp"]);
    const binFiles = files.filter((f) => f.startsWith("bin/"));
    expect(binFiles).toEqual(["bin/brandsystem-mcp.mjs"]);
  });

  it("includes the local stdio entry point", () => {
    expect(files).toContain("dist/index.js");
    expect(files).toContain("dist/server.js");
  });
});
