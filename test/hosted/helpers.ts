import { vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createHostedServer } from "../../src/hosted/server.js";
import type { HostedBrandContext } from "../../src/hosted/types.js";

/**
 * Shared hosted-MCP test harness. `buildAuth`/`buildContext` are deliberately
 * NOT factored out here even though they exist in every hosted test file —
 * each file's defaults differ in ways that matter (different default scopes,
 * different buildContext signatures, different embedded fixture packages),
 * so unifying them would risk silently changing what each suite actually
 * tests. Only the two functions below are byte-for-byte identical across
 * every file that defines them.
 */

/** Create a connected client+server pair for a hosted brand context. */
export async function connectHostedClient(
  context: HostedBrandContext,
  clientName = "hosted-test-client",
): Promise<{ server: ReturnType<typeof createHostedServer>; client: Client }> {
  const server = createHostedServer(context);
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: clientName, version: "1.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { server, client };
}

/** Call a hosted tool by name and return the parsed JSON response. */
export async function callHostedTool(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const result = await client.callTool({ name, arguments: args });
  const content = result.content as Array<{ type: string; text: string }>;
  return JSON.parse(content[0].text) as Record<string, unknown>;
}

/** Stub global fetch to return one JSON response. Returns the mock for assertions. */
export function stubJsonFetch(
  body: unknown = { ok: true },
  init: ResponseInit = {},
): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status: init.status ?? 200,
        headers: { "content-type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
