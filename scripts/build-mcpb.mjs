#!/usr/bin/env node
/**
 * Build the MCP Bundle (.mcpb) for one-click Claude Desktop install.
 *
 * Spec: https://github.com/modelcontextprotocol/mcpb (MANIFEST.md). We emit
 * manifest_version 0.3 — the current documented version for node servers.
 * The official CLI also accepts 0.4, which differs from 0.3 only by adding
 * the `uv` (Python) server type, so 0.3 keeps the widest host compatibility.
 *
 * Nothing in the manifest is hand-maintained:
 *   - name/version/description/license/keywords/engines come from package.json
 *   - `tools` is the live Core-profile tool list from the built server
 *
 * Usage:
 *   npm run build:mcpb                 → build/brandsystem-mcp-<version>.mcpb
 *   node scripts/build-mcpb.mjs --manifest-only   (stage manifest.json only)
 *
 * Packing and validation use the official CLI (@anthropic-ai/mcpb), pinned
 * and run via `npm exec` at build time rather than installed as a
 * devDependency: its dependency tree (node-forge, zod 3, tmp) carries
 * unfixed high-severity advisories that would fail the daily full-tree audit.
 */

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const MANIFEST_VERSION = "0.3";
export const MCPB_CLI_SPEC = "@anthropic-ai/mcpb@2.1.2";
export const BUNDLE_NAME = "brandsystem-mcp";

/** Runtime deps only the hosted (Vercel) server imports — dist/hosted is not bundled. */
export const HOSTED_ONLY_DEPENDENCIES = ["@upstash/redis", "@vercel/functions"];

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function bundleFileName(version) {
  return `${BUNDLE_NAME}-${version}.mcpb`;
}

/** First sentence of a tool description, capped for the Claude Desktop tool list. */
export function firstSentence(text, max = 200) {
  const flat = String(text ?? "").replace(/\s+/g, " ").trim();
  const match = flat.match(/^.*?[.!?](?=\s|$)/);
  const sentence = match ? match[0] : flat;
  return sentence.length > max ? `${sentence.slice(0, max - 1)}…` : sentence;
}

function repoUrl(pkg) {
  const url = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
  return String(url ?? "").replace(/^git\+/, "").replace(/\.git$/, "");
}

/**
 * Build the MCPB manifest from package.json and the registered tool list.
 * @param {Record<string, any>} pkg parsed package.json
 * @param {Array<{ name: string, description?: string }>} tools registered Core tools
 */
export function buildManifest(pkg, tools) {
  const repo = repoUrl(pkg);
  const bugs = typeof pkg.bugs === "string" ? pkg.bugs : pkg.bugs?.url;
  return {
    manifest_version: MANIFEST_VERSION,
    name: BUNDLE_NAME,
    display_name: "Brandsystem",
    version: pkg.version,
    description: pkg.description,
    long_description:
      "Turns the brand material you already have (a website, PDF guidelines, a Figma library, or a Brandcode Studio brand) into a portable `.brand/` runtime: DTCG design tokens, voice rules, provenance, and compliance checks. " +
      "Choose the folder where your brand lives; the server reads and writes `.brand/` there. " +
      "Use brand_export to drop the brand into AGENTS.md, Cursor rules, CSS variables, Tailwind v4, or shadcn/ui. " +
      "The default Core profile covers the complete adopt → context → create → check loop; switch the profile to `full` for the deep authoring tools.",
    author: { name: "Brandcode Studio", url: "https://brandcode.studio" },
    repository: { type: "git", url: repo },
    homepage: pkg.homepage,
    documentation: `${repo}#readme`,
    ...(bugs ? { support: bugs } : {}),
    license: pkg.license,
    keywords: pkg.keywords,
    server: {
      type: "node",
      entry_point: "dist/index.js",
      mcp_config: {
        command: "node",
        args: ["${__dirname}/dist/index.js"],
        env: {
          BRANDSYSTEM_PROJECT_DIR: "${user_config.project_dir}",
          BRANDSYSTEM_PROFILE: "${user_config.profile}",
        },
      },
    },
    tools: tools.map((t) => ({ name: t.name, description: firstSentence(t.description) })),
    // The `full` profile registers more tools than the Core list above.
    tools_generated: true,
    compatibility: {
      platforms: ["darwin", "win32", "linux"],
      runtimes: { node: pkg.engines?.node ?? ">=22.13.0" },
    },
    user_config: {
      project_dir: {
        type: "directory",
        title: "Brand project folder",
        description:
          "Folder that holds (or will hold) your .brand/ directory — usually your project or a dedicated brand folder.",
        required: true,
      },
      profile: {
        type: "string",
        title: "Tool profile",
        description: "core (default: 12 tools, the complete adopt-to-check loop) or full (every authoring tool).",
        required: false,
        default: "core",
      },
    },
  };
}

/** List the tools the built server registers under the given profile. */
export async function listTools(serverModulePath, profile = "core") {
  const { createServer } = await import(pathToFileURL(serverModulePath).href);
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
  const server = createServer({ profile });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "build-mcpb", version: "1.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const { tools } = await client.listTools();
    return tools.map((t) => ({ name: t.name, description: t.description ?? "" }));
  } finally {
    await client.close();
  }
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

/** Fail the build if bundled code imports a dependency we prune from the bundle. */
export function findHostedImports(distDir, deps = HOSTED_ONLY_DEPENDENCIES) {
  const offenders = [];
  for (const file of walk(distDir)) {
    if (!file.endsWith(".js")) continue;
    const src = readFileSync(file, "utf-8");
    for (const dep of deps) {
      if (src.includes(`"${dep}`) || src.includes(`'${dep}`)) offenders.push(`${relative(distDir, file)} → ${dep}`);
    }
  }
  return offenders;
}

function run(cmd, args, cwd) {
  execFileSync(cmd, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
}

function mcpbCli(args, cwd) {
  run("npm", ["exec", "--yes", `--package=${MCPB_CLI_SPEC}`, "--", "mcpb", ...args], cwd);
}

async function main(argv) {
  const manifestOnly = argv.includes("--manifest-only");
  const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf-8"));
  const distDir = join(REPO_ROOT, "dist");
  if (!existsSync(join(distDir, "index.js"))) {
    throw new Error("dist/index.js not found — run `npm run build` first (npm run build:mcpb does this for you).");
  }

  const tools = await listTools(join(distDir, "server.js"), "core");
  const manifest = buildManifest(pkg, tools);

  const buildDir = join(REPO_ROOT, "build");
  const stage = join(buildDir, "mcpb");
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });
  writeFileSync(join(stage, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(`[build-mcpb] manifest_version ${MANIFEST_VERSION}, ${tools.length} Core tools, v${pkg.version}`);
  if (manifestOnly) {
    console.log(`[build-mcpb] wrote ${relative(REPO_ROOT, join(stage, "manifest.json"))}`);
    return;
  }

  // Runtime code only: mirror package.json "files" (no hosted server, no maps) and drop type declarations.
  cpSync(distDir, join(stage, "dist"), {
    recursive: true,
    filter: (src) => {
      const rel = relative(distDir, src);
      if (rel === "hosted" || rel.startsWith(`hosted${sep}`)) return false;
      return !src.endsWith(".map") && !src.endsWith(".d.ts");
    },
  });
  const offenders = findHostedImports(join(stage, "dist"));
  if (offenders.length > 0) {
    throw new Error(`Bundled code imports hosted-only dependencies:\n  ${offenders.join("\n  ")}`);
  }
  for (const file of ["README.md", "LICENSE"]) cpSync(join(REPO_ROOT, file), join(stage, file));

  const dependencies = Object.fromEntries(
    Object.entries(pkg.dependencies ?? {}).filter(([name]) => !HOSTED_ONLY_DEPENDENCIES.includes(name)),
  );
  const stagePkg = {
    name: pkg.name,
    version: pkg.version,
    description: pkg.description,
    type: pkg.type,
    main: pkg.main,
    license: pkg.license,
    engines: pkg.engines,
    dependencies,
    ...(pkg.overrides ? { overrides: pkg.overrides } : {}),
  };
  writeFileSync(join(stage, "package.json"), JSON.stringify(stagePkg, null, 2) + "\n");
  // The repo lockfile pins every transitive version; npm prunes the removed deps.
  cpSync(join(REPO_ROOT, "package-lock.json"), join(stage, "package-lock.json"));
  run("npm", ["install", "--omit=dev", "--omit=optional", "--ignore-scripts", "--no-audit", "--no-fund"], stage);

  const outFile = join(buildDir, bundleFileName(pkg.version));
  rmSync(outFile, { force: true });
  mcpbCli(["validate", join(stage, "manifest.json")], REPO_ROOT);
  mcpbCli(["pack", stage, outFile], REPO_ROOT);
  console.log(`[build-mcpb] bundle: ${relative(REPO_ROOT, outFile)}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(`[build-mcpb] ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
