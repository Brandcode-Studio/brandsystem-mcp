import { describe, it, expect, beforeAll } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/server.js";
import { CORE_TOOL_NAMES } from "../../src/lib/tool-profile.js";
import {
  buildManifest,
  bundleFileName,
  findHostedImports,
  firstSentence,
  HOSTED_ONLY_DEPENDENCIES,
  MANIFEST_VERSION,
  MCPB_CLI_SPEC,
} from "../../scripts/build-mcpb.mjs";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

type Manifest = ReturnType<typeof buildManifest>;

let pkg: Record<string, any>;
let manifest: Manifest;

async function coreTools() {
  const server = createServer({ profile: "core" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "build-mcpb-test", version: "1.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const { tools } = await client.listTools();
  await client.close();
  return tools.map((t) => ({ name: t.name, description: t.description ?? "" }));
}

beforeAll(async () => {
  pkg = JSON.parse(await readFile(join(repoRoot, "package.json"), "utf-8"));
  manifest = buildManifest(pkg, await coreTools());
});

describe("MCPB manifest generator", () => {
  it("emits the required top-level fields for the pinned manifest version", () => {
    expect(manifest.manifest_version).toBe(MANIFEST_VERSION);
    expect(MANIFEST_VERSION).toBe("0.3");
    for (const field of ["manifest_version", "name", "version", "description", "author", "server"] as const) {
      expect(manifest[field], field).toBeTruthy();
    }
    expect(manifest.author.name).toBeTruthy();
    expect(manifest.name).toMatch(/^[a-z0-9-]+$/);
  });

  it("derives version, description, license, keywords, and node runtime from package.json", () => {
    expect(manifest.version).toBe(pkg.version);
    expect(manifest.description).toBe(pkg.description);
    expect(manifest.license).toBe(pkg.license);
    expect(manifest.keywords).toEqual(pkg.keywords);
    expect(manifest.compatibility.runtimes.node).toBe(pkg.engines.node);
    expect(manifest.repository.url).toBe("https://github.com/Brandcode-Studio/brandsystem-mcp");
    expect(bundleFileName(pkg.version)).toBe(`brandsystem-mcp-${pkg.version}.mcpb`);
  });

  it("runs the built stdio server through node with ${__dirname}", () => {
    const { server } = manifest;
    expect(server.type).toBe("node");
    expect(server.entry_point).toBe("dist/index.js");
    expect(server.mcp_config.command).toBe("node");
    expect(server.mcp_config.args).toEqual(["${__dirname}/dist/index.js"]);
    expect(pkg.main).toBe(server.entry_point);
  });

  it("maps every env substitution to a declared user_config key with a valid type", () => {
    const allowedTypes = new Set(["string", "number", "boolean", "directory", "file"]);
    for (const [key, cfg] of Object.entries(manifest.user_config)) {
      expect(allowedTypes.has(cfg.type), key).toBe(true);
      expect(cfg.title && cfg.description, key).toBeTruthy();
    }
    for (const value of Object.values(manifest.server.mcp_config.env)) {
      const m = value.match(/^\$\{user_config\.([a-z_]+)\}$/);
      expect(m, value).not.toBeNull();
      expect(manifest.user_config).toHaveProperty(m![1]);
    }
    expect(manifest.server.mcp_config.env).toHaveProperty("BRANDSYSTEM_PROJECT_DIR");
    expect(manifest.user_config.project_dir.type).toBe("directory");
    expect(manifest.user_config.profile.default).toBe("core");
  });

  it("lists exactly the registered Core tools (generated, not hand-maintained)", () => {
    const names = manifest.tools.map((t) => t.name).sort();
    expect(names).toEqual([...CORE_TOOL_NAMES].sort());
    for (const tool of manifest.tools) {
      expect(Object.keys(tool).sort()).toEqual(["description", "name"]);
      expect(tool.description.length).toBeGreaterThan(10);
      expect(tool.description.length).toBeLessThanOrEqual(200);
    }
    expect(manifest.tools_generated).toBe(true);
  });

  it("firstSentence trims to the first sentence and caps length", () => {
    expect(firstSentence("Do a thing. Then more.")).toBe("Do a thing.");
    expect(firstSentence("Export for Cursor/ChatGPT e.g.this. Next")).toBe("Export for Cursor/ChatGPT e.g.this.");
    expect(firstSentence("x".repeat(500)).length).toBe(200);
  });
});

describe("MCPB bundle contents guard", () => {
  it("non-hosted source never imports the hosted-only dependencies pruned from the bundle", async () => {
    const offenders: string[] = [];
    async function scan(dir: string) {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== "hosted") await scan(full);
        } else if (entry.name.endsWith(".ts")) {
          const src = await readFile(full, "utf-8");
          for (const dep of HOSTED_ONLY_DEPENDENCIES) if (src.includes(`"${dep}`)) offenders.push(`${full} → ${dep}`);
        }
      }
    }
    await scan(join(repoRoot, "src"));
    expect(offenders).toEqual([]);
  });

  it("findHostedImports flags a bundled file that imports a pruned dependency", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mcpb-guard-"));
    try {
      await mkdir(join(dir, "lib"));
      await writeFile(join(dir, "lib", "ok.js"), 'import x from "yaml";\n');
      await writeFile(join(dir, "lib", "bad.js"), 'import { Redis } from "@upstash/redis";\n');
      expect(findHostedImports(dir)).toEqual([join("lib", "bad.js") + " → @upstash/redis"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

const NETWORK_ERROR = /ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNREFUSED|ECONNRESET|ENETUNREACH|network|request to .* failed|code E40[34]/i;

describe("official mcpb validate", () => {
  it(
    `passes \`mcpb validate\` (${MCPB_CLI_SPEC})`,
    async (ctx) => {
      if (process.env.BRANDSYSTEM_SKIP_MCPB_VALIDATE === "1") ctx.skip();
      const dir = await mkdtemp(join(tmpdir(), "mcpb-manifest-"));
      const file = join(dir, "manifest.json");
      await writeFile(file, JSON.stringify(manifest, null, 2));
      try {
        const { stdout } = await execFileAsync(
          "npm",
          ["exec", "--yes", `--package=${MCPB_CLI_SPEC}`, "--", "mcpb", "validate", file],
          { timeout: 120_000, shell: process.platform === "win32" },
        );
        expect(stdout).toMatch(/validation passes/i);
      } catch (err) {
        const e = err as { stdout?: string; stderr?: string; message?: string; killed?: boolean };
        const output = `${e.stdout ?? ""}\n${e.stderr ?? ""}\n${e.message ?? ""}`;
        // Offline / registry unreachable: the structural tests above still apply.
        if (e.killed || NETWORK_ERROR.test(output)) ctx.skip();
        throw new Error(`mcpb validate failed:\n${output}`);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    150_000,
  );
});
