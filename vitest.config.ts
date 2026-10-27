import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Fails the run if any test writes .brand/, .gitignore, or .mcp.json at the repo root.
    globalSetup: ['test/repo-guard.ts'],
  },
});
