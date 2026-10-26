/**
 * Egress allowlist, enforced.
 *
 * The package claims to be local-first: it only talks to sources you point it
 * at, plus a short list of documented, mostly opt-in destinations. This test
 * makes that claim checkable. It statically scans src/ and the built dist/
 * (both minus the hosted code, which is not in the npm package) and
 * bin/brandsystem-mcp.mjs for every hard-coded http(s)/ws(s) host and fails
 * unless each occurrence is
 *   (a) a destination in security/egress-allowlist.json, in one of that
 *       destination's listed source modules, or
 *   (b) matched by one of the explicit, reasoned IGNORE_RULES below.
 *
 * It also keeps the allowlist and docs/DATA-FLOWS.md honest: every documented
 * endpoint must still exist in src/ and dist/, every allowlisted host and
 * ignore rule must still match something (no stale entries), and the
 * generated block of DATA-FLOWS.md must equal what the allowlist renders to.
 *
 * Requires a build (`npm run build`), like the stdio tests.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { renderGenerated, BEGIN, END, ALLOWLIST_PATH, DOC_PATH } from "../../scripts/render-data-flows.mjs";

interface Destination {
  id: string;
  name: string;
  hosts: string[];
  consent: string;
  tools: string[];
  when: string;
  data_sent: string;
  disable: string;
  modules: string[];
  evidence: Array<{ module: string; literal: string }>;
}
interface Allowlist {
  destinations: Destination[];
}

interface IgnoreRule {
  hosts: string[];
  /** Module keys (path under src/ or dist/ without extension); "*" = anywhere. */
  modules: string[] | "*";
  reason: string;
}

/**
 * Hosts that appear in the code but are never contacted by the package.
 * Each rule is scoped to the modules where the reference is known to be
 * harmless, so the same host showing up in a new module still fails.
 */
const IGNORE_RULES: IgnoreRule[] = [
  {
    // Loopback never leaves the machine: the browser egress proxy listens on
    // 127.0.0.1, and localhost Studio origins are an explicit dev opt-in.
    hosts: ["localhost", "127.0.0.1", "[::1]"],
    modules: "*",
    reason: "loopback only",
  },
  {
    // SVG XML namespace identifiers (xmlns="http://www.w3.org/2000/svg"),
    // never dereferenced.
    hosts: ["www.w3.org"],
    modules: ["lib/svg-resolver"],
    reason: "XML namespace URI",
  },
  {
    // Example URLs inside tool-parameter descriptions and recovery hints that
    // tell the agent what an argument looks like. Never fetched by the code.
    hosts: ["acme.com", "basecamp.com", "yourbrand.com"],
    modules: [
      "tools/brand-extract-messaging",
      "tools/brand-extract-site",
      "tools/brand-extract-web",
      "tools/brand-extract-visual",
      "tools/brand-start",
      "tools/brand-status",
      "lib/recovery-guidance",
    ],
    reason: "example URL in a tool description",
  },
  {
    // Doc comments: an example custom brand domain, an example value for the
    // BRANDCODE_STUDIO_TRUSTED_ORIGINS opt-in, and the proxy's request-target
    // grammar ("http://host/path").
    hosts: ["custom.host", "staging.brandcode.studio", "host"],
    modules: ["connectors/brandcode/resolve", "connectors/brandcode/trust", "lib/browser-egress-proxy"],
    reason: "example in a code comment",
  },
  {
    // Studio links shown to the user or agent (example brand URLs in tool
    // descriptions, the onboarding CTA, the hosted-MCP URL to configure in a
    // client, the footer link of a generated preview). Displayed, never
    // requested by this package.
    hosts: ["brandcode.studio", "www.brandcode.studio", "mcp.brandcode.studio"],
    modules: [
      "tools/brand-brandcode-connect",
      "tools/brand-start",
      "tools/brand-brandcode-status",
      "lib/onramp",
      "lib/preview-generator",
    ],
    reason: "link displayed to the user, not fetched",
  },
  {
    // Attribution links written into generated exports and brand-report.html.
    hosts: ["brandsystem.app"],
    modules: ["tools/brand-export", "lib/report-html"],
    reason: "attribution link in generated output",
  },
];

const ROOT = process.cwd();
// Host part of a URL literal (bracketed IPv6, or a name/IPv4 with optional
// port); stops at path, query, fragment, quote, space, or a "[" placeholder.
const URL_RE = /\b(?:https?|wss?):\/\/(\[[0-9a-f:.]*\]|[^\s"'`<>()\\/?#,;|[\]]+)/gi;

interface Occurrence {
  file: string;
  module: string;
  host: string;
}

function walk(dir: string, exts: string[], skipDir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (p === skipDir) continue;
      out.push(...walk(p, exts, skipDir));
    } else if (exts.some((e) => name.endsWith(e)) && !name.endsWith(".d.ts")) {
      out.push(p);
    }
  }
  return out;
}

function normalizeHost(raw: string): string | null {
  let host = raw.toLowerCase();
  // Template-literal or concatenated hosts (`https://${host}`) are dynamic,
  // i.e. user-supplied or config-driven; they are covered at runtime by the
  // SSRF guard / trusted-origin checks, not by this static scan.
  if (host.startsWith("$") || host.includes("${")) return null;
  host = host.replace(/^[^@]*@/, ""); // userinfo
  if (host.startsWith("[")) host = host.slice(0, host.indexOf("]") + 1);
  else host = host.replace(/:\d*$/, "");
  host = host.replace(/\.+$/, ""); // sentence-ending dot in comments
  return host || null;
}

function moduleKey(file: string): string {
  const rel = relative(ROOT, file).split(sep).join("/");
  return rel
    .replace(/^(src|dist)\//, "")
    .replace(/\.(ts|mts|js|mjs)$/, "");
}

function scan(files: string[]): Occurrence[] {
  const out: Occurrence[] = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(URL_RE)) {
      const host = normalizeHost(m[1]);
      if (host) out.push({ file: relative(ROOT, file), module: moduleKey(file), host });
    }
  }
  return out;
}

const allowlist: Allowlist = JSON.parse(readFileSync(join(ROOT, ALLOWLIST_PATH), "utf8"));
let srcFiles: string[] = [];
let distFiles: string[] = [];
let occurrences: Occurrence[] = [];

function ignoredBy(o: Occurrence): IgnoreRule | undefined {
  return IGNORE_RULES.find(
    (r) => r.hosts.includes(o.host) && (r.modules === "*" || r.modules.includes(o.module)),
  );
}
function allowedBy(o: Occurrence): Destination | undefined {
  return allowlist.destinations.find((d) => d.hosts.includes(o.host) && d.modules.includes(o.module));
}

beforeAll(() => {
  if (!existsSync(join(ROOT, "dist", "index.js"))) {
    throw new Error("dist/ is missing — run `npm run build` before `npm test`");
  }
  srcFiles = walk(join(ROOT, "src"), [".ts", ".mts", ".js", ".mjs"], join(ROOT, "src", "hosted"));
  distFiles = walk(join(ROOT, "dist"), [".js", ".mjs"], join(ROOT, "dist", "hosted"));
  occurrences = scan([...srcFiles, ...distFiles, join(ROOT, "bin", "brandsystem-mcp.mjs")]);
});

describe("egress allowlist", () => {
  it("scans a non-trivial surface (sanity)", () => {
    expect(srcFiles.length).toBeGreaterThan(50);
    expect(distFiles.length).toBeGreaterThan(50);
    expect(occurrences.length).toBeGreaterThan(10);
  });

  it("scanner self-test: extracts hosts, skips dynamic ones, flags undeclared ones", () => {
    const dir = mkdtempSync(join(tmpdir(), "egress-scan-"));
    const file = join(dir, "probe.js");
    writeFileSync(
      file,
      [
        'await fetch("https://Telemetry.Evil.example.net:8443/v1?x=1");',
        "const u = `https://${host}/path`;",
        'const v = "http://[::1]:3000/";',
        "// see https://www.brandcode.studio.",
      ].join("\n"),
    );
    const found = scan([file]).map((o) => o.host);
    expect(found).toEqual(["telemetry.evil.example.net", "[::1]", "www.brandcode.studio"]);
    const probe = scan([file]);
    expect(probe.filter((o) => !ignoredBy(o) && !allowedBy(o)).map((o) => o.host)).toEqual([
      "telemetry.evil.example.net",
      "www.brandcode.studio", // allowlisted host, but not for this module
    ]);
  });

  it("excludes only code that is not in the npm package", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    expect(pkg.files).toContain("!dist/hosted");
  });

  it("every hard-coded outbound host is allowlisted for that module or explicitly ignored", () => {
    const violations = occurrences
      .filter((o) => !ignoredBy(o) && !allowedBy(o))
      .map((o) => `${o.file}: ${o.host}`);
    expect(
      [...new Set(violations)],
      "Undeclared outbound host. Add it to security/egress-allowlist.json (host + module) and run " +
        "`node scripts/render-data-flows.mjs --write`, or add a reasoned IGNORE_RULES entry if it is never contacted.",
    ).toEqual([]);
  });

  it("allowlist entries are well-formed", () => {
    const ids = new Set<string>();
    for (const d of allowlist.destinations) {
      expect(ids.has(d.id), `duplicate id ${d.id}`).toBe(false);
      ids.add(d.id);
      for (const field of ["name", "consent", "when", "data_sent", "disable"] as const) {
        expect(typeof d[field] === "string" && d[field].length > 0, `${d.id}.${field}`).toBe(true);
      }
      expect(d.tools.length, `${d.id}.tools`).toBeGreaterThan(0);
      expect(d.modules.length, `${d.id}.modules`).toBeGreaterThan(0);
      for (const m of d.modules) {
        expect(existsSync(join(ROOT, "src", `${m}.ts`)), `${d.id}: src/${m}.ts does not exist`).toBe(true);
      }
    }
  });

  it("every documented endpoint still exists in src/ and dist/", () => {
    for (const d of allowlist.destinations) {
      for (const { module, literal } of d.evidence) {
        const src = readFileSync(join(ROOT, "src", `${module}.ts`), "utf8");
        const dist = readFileSync(join(ROOT, "dist", `${module}.js`), "utf8");
        expect(src.includes(literal), `${d.id}: "${literal}" not found in src/${module}.ts`).toBe(true);
        expect(dist.includes(literal), `${d.id}: "${literal}" not found in dist/${module}.js`).toBe(true);
      }
    }
  });

  it("has no stale allowlisted hosts or ignore rules", () => {
    for (const d of allowlist.destinations) {
      for (const host of d.hosts) {
        const used = occurrences.some((o) => o.host === host && d.modules.includes(o.module));
        expect(used, `${d.id}: host ${host} no longer appears in its modules`).toBe(true);
      }
    }
    for (const rule of IGNORE_RULES) {
      const used = occurrences.some((o) => ignoredBy(o) === rule);
      expect(used, `ignore rule "${rule.reason}" (${rule.hosts.join(", ")}) matches nothing`).toBe(true);
    }
  });

  it("docs/DATA-FLOWS.md is generated from the allowlist (no drift)", () => {
    const doc = readFileSync(join(ROOT, DOC_PATH), "utf8");
    const start = doc.indexOf(BEGIN);
    const end = doc.indexOf(END);
    expect(start, "generated-block markers missing from DATA-FLOWS.md").toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const actual = doc.slice(start + BEGIN.length, end).trim();
    expect(actual, "DATA-FLOWS.md is stale — run `node scripts/render-data-flows.mjs --write`").toBe(
      renderGenerated(allowlist),
    );
    for (const d of allowlist.destinations) {
      for (const host of d.hosts) expect(doc).toContain(`\`${host}\``);
    }
  });

  it("SECURITY.md links the data-flow doc", () => {
    expect(readFileSync(join(ROOT, "SECURITY.md"), "utf8")).toContain("docs/DATA-FLOWS.md");
  });
});
