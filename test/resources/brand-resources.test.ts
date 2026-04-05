import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BrandDir } from "../../src/lib/brand-dir.js";
import { registerResources } from "../../src/resources/brand-resources.js";
import { compileRuntime } from "../../src/lib/runtime-compiler.js";
import { compileInteractionPolicy } from "../../src/lib/interaction-policy-compiler.js";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig() {
  return {
    schema_version: "0.1.0" as const,
    session: 1,
    client_name: "Test Brand",
    created_at: "2026-01-01T00:00:00Z",
  };
}

function makeIdentity() {
  return {
    schema_version: "0.1.0" as const,
    colors: [
      { name: "Blue", value: "#0000ff", role: "primary" as const, source: "web" as const, confidence: "high" as const },
    ],
    typography: [],
    logo: [],
    spacing: null,
  };
}

async function connectPair(brandDir: BrandDir) {
  const server = new McpServer({ name: "test-resources", version: "1.0.0" });
  registerResources(server, brandDir);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { server, client };
}

// ---------------------------------------------------------------------------
// Tests: resource registration
// ---------------------------------------------------------------------------

describe("resource registration", () => {
  let tmpDir: string;
  let client: Client;

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "res-reg-"));
    const bd = new BrandDir(tmpDir);
    ({ client } = await connectPair(bd));
  });

  afterAll(async () => {
    await rm(tmpDir, { recursive: true });
  });

  it("listResources returns both brand://runtime and brand://policy", async () => {
    const { resources } = await client.listResources();
    const uris = resources.map((r) => r.uri);
    expect(uris).toContain("brand://runtime");
    expect(uris).toContain("brand://policy");
  });

  it("runtime resource has correct metadata", async () => {
    const { resources } = await client.listResources();
    const runtime = resources.find((r) => r.uri === "brand://runtime");
    expect(runtime).toBeDefined();
    expect(runtime!.name).toBe("Brand Runtime Contract");
    expect(runtime!.mimeType).toBe("application/json");
  });

  it("policy resource has correct metadata", async () => {
    const { resources } = await client.listResources();
    const policy = resources.find((r) => r.uri === "brand://policy");
    expect(policy).toBeDefined();
    expect(policy!.name).toBe("Brand Interaction Policy");
    expect(policy!.mimeType).toBe("application/json");
  });
});

// ---------------------------------------------------------------------------
// Tests: no .brand/ directory
// ---------------------------------------------------------------------------

describe("no .brand/ directory", () => {
  let tmpDir: string;
  let client: Client;

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "res-nobrand-"));
    const bd = new BrandDir(tmpDir);
    ({ client } = await connectPair(bd));
  });

  afterAll(async () => {
    await rm(tmpDir, { recursive: true });
  });

  it("readResource brand://runtime returns graceful error", async () => {
    const result = await client.readResource({ uri: "brand://runtime" });
    expect(result.contents).toHaveLength(1);
    const json = JSON.parse(result.contents[0].text as string);
    expect(json.error).toBe("not_compiled");
    expect(json.message).toContain("brand_compile");
  });

  it("readResource brand://policy returns graceful error", async () => {
    const result = await client.readResource({ uri: "brand://policy" });
    expect(result.contents).toHaveLength(1);
    const json = JSON.parse(result.contents[0].text as string);
    expect(json.error).toBe("not_compiled");
    expect(json.message).toContain("brand_compile");
  });
});

// ---------------------------------------------------------------------------
// Tests: compiled .brand/ directory
// ---------------------------------------------------------------------------

describe("compiled .brand/ directory", () => {
  let tmpDir: string;
  let client: Client;

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "res-compiled-"));
    const bd = new BrandDir(tmpDir);
    const config = makeConfig();
    const identity = makeIdentity();

    await bd.initBrand(config);

    // Compile and write runtime + policy
    const runtime = compileRuntime(config, identity, null, null, null);
    await bd.writeRuntime(runtime);

    const policy = compileInteractionPolicy(config.schema_version, null, null, null);
    await bd.writePolicy(policy);

    ({ client } = await connectPair(bd));
  });

  afterAll(async () => {
    await rm(tmpDir, { recursive: true });
  });

  it("readResource brand://runtime returns valid JSON", async () => {
    const result = await client.readResource({ uri: "brand://runtime" });
    expect(result.contents).toHaveLength(1);
    const json = JSON.parse(result.contents[0].text as string);
    expect(json.error).toBeUndefined();
    expect(json.client_name).toBe("Test Brand");
    expect(json.version).toBeDefined();
    expect(json.compiled_at).toBeDefined();
    expect(json.identity).toBeDefined();
  });

  it("readResource brand://policy returns valid JSON", async () => {
    const result = await client.readResource({ uri: "brand://policy" });
    expect(result.contents).toHaveLength(1);
    const json = JSON.parse(result.contents[0].text as string);
    expect(json.error).toBeUndefined();
    expect(json.version).toBeDefined();
    expect(json.compiled_at).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Tests: .brand/ exists but runtime not yet compiled
// ---------------------------------------------------------------------------

describe(".brand/ exists but not compiled", () => {
  let tmpDir: string;
  let client: Client;

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "res-nocompile-"));
    const bd = new BrandDir(tmpDir);
    await bd.initBrand(makeConfig());
    // .brand/ exists with config + identity, but no runtime/policy files
    ({ client } = await connectPair(bd));
  });

  afterAll(async () => {
    await rm(tmpDir, { recursive: true });
  });

  it("readResource brand://runtime returns not_compiled error", async () => {
    const result = await client.readResource({ uri: "brand://runtime" });
    const json = JSON.parse(result.contents[0].text as string);
    expect(json.error).toBe("not_compiled");
  });

  it("readResource brand://policy returns not_compiled error", async () => {
    const result = await client.readResource({ uri: "brand://policy" });
    const json = JSON.parse(result.contents[0].text as string);
    expect(json.error).toBe("not_compiled");
  });
});
