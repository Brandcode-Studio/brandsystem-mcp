import { vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";
import { mkdtemp, cp } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const FIXTURES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
);

/** Copy a fixture directory to a fresh tmpdir. Returns the tmpdir path. */
export async function copyFixture(fixtureName: string): Promise<string> {
  const src = join(FIXTURES_DIR, fixtureName);
  const dest = await mkdtemp(join(tmpdir(), `brand-integ-${fixtureName}-`));
  await cp(src, dest, { recursive: true });
  return dest;
}

/** Create a connected client+server pair with cwd overridden to the given path. */
export async function connectWithCwd(
  cwd: string,
): Promise<{ client: Client; cleanup: () => Promise<void> }> {
  vi.spyOn(process, "cwd").mockReturnValue(cwd);
  const server = createServer();
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "integration-test", version: "1.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return {
    client,
    cleanup: async () => {
      await client.close();
      vi.restoreAllMocks();
    },
  };
}

type McpContent = Array<{ type: string; text: string }>;

/** Call a tool by name with given args and return the parsed JSON response. */
export async function callTool(
  client: Client,
  name: string,
  args?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const result = await client.callTool({ name, arguments: args ?? {} });
  const content = result.content as McpContent;
  return JSON.parse(content[0].text);
}
