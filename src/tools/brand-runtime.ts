import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BrandDir } from "../lib/brand-dir.js";
import { buildResponse } from "../lib/response.js";

async function handler() {
  const brandDir = new BrandDir(process.cwd());

  if (!(await brandDir.exists())) {
    return buildResponse({
      what_happened: "No .brand/ directory found",
      next_steps: ["Run brand_start to create a brand system first"],
      data: { error: "not_initialized" },
    });
  }

  if (!(await brandDir.hasRuntime())) {
    return buildResponse({
      what_happened: "No brand-runtime.json found — run brand_compile first",
      next_steps: [
        "Run brand_compile to generate the runtime contract",
        "The runtime is automatically compiled from your brand data each time you compile",
      ],
      data: { error: "not_compiled" },
    });
  }

  const runtime = await brandDir.readRuntime();

  return buildResponse({
    what_happened: "Loaded brand runtime contract",
    next_steps: [
      "Use the runtime data to generate on-brand content",
      "The runtime contains colors, typography, voice rules, and strategy — everything an AI agent needs",
      "Run brand_compile to refresh the runtime after making changes",
    ],
    data: { runtime },
  });
}

export function register(server: McpServer) {
  server.tool(
    "brand_runtime",
    "Read the compiled brand runtime contract (brand-runtime.json). Returns the single-document representation of the brand system that AI agents use to generate on-brand content. Includes identity (colors, typography, logo), visual rules, voice constraints, and strategy summary. Read-only — run brand_compile to refresh. Use when loading brand context for content generation.",
    async () => handler()
  );
}
