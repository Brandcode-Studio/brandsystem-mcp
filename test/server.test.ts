import { describe, it, expect } from 'vitest';
import { createServer } from '../src/server.js';

describe('createServer', () => {
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
