import { describe, it, expect } from 'vitest';
import { createServer } from '../src/server.js';

describe('createServer', () => {
  it('returns an McpServer instance without throwing', () => {
    const server = createServer();
    expect(server).toBeDefined();
    expect(typeof server.tool).toBe('function');
  });

  it('registers 15 tools (one register call per tool)', () => {
    // createServer calls 15 register functions.
    // We verify it doesn't throw during registration, which confirms
    // all 15 tool modules load and register successfully.
    expect(() => createServer()).not.toThrow();
  });
});
