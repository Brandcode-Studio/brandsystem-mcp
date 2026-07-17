import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer, SERVER_INSTRUCTIONS } from '../src/server.js';

describe('createServer', () => {
  it('publishes concise agent workflow instructions during initialization', async () => {
    const server = createServer({ profile: 'core' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'instructions-test', version: '0.0.0' });
    await Promise.all([
      client.connect(clientTransport),
      server.connect(serverTransport),
    ]);
    expect(client.getInstructions()).toBe(SERVER_INSTRUCTIONS);
    expect(SERVER_INSTRUCTIONS.slice(0, 512)).toContain('brand_start');
    expect(SERVER_INSTRUCTIONS.slice(0, 512)).toContain('Do not invoke Brandsystem');
    await client.close();
    await server.close();
  });

  it('returns an McpServer instance without throwing', () => {
    const server = createServer();
    expect(server).toBeDefined();
    expect(typeof server.tool).toBe('function');
  });

  it('registers all tools without throwing', () => {
    // createServer calls 36 register functions.
    // We verify it doesn't throw during registration, which confirms
    // all tool modules load and register successfully.
    expect(() => createServer()).not.toThrow();
  });
});
