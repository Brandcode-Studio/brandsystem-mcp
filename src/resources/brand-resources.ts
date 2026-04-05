import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BrandDir } from "../lib/brand-dir.js";

const NOT_COMPILED = JSON.stringify(
  { error: "not_compiled", message: "Run brand_compile to generate the runtime contract" },
  null,
  2
);

export function registerResources(server: McpServer, brandDir: BrandDir): void {
  server.registerResource(
    "Brand Runtime Contract",
    "brand://runtime",
    {
      description:
        "Compiled brand identity, visual rules, messaging, and strategy in a single document. Updated on every brand_compile. Returns null sections for incomplete sessions.",
      mimeType: "application/json",
    },
    async () => {
      try {
        if (!(await brandDir.exists())) {
          return { contents: [{ uri: "brand://runtime", mimeType: "application/json", text: NOT_COMPILED }] };
        }
        const runtime = await brandDir.readRuntime();
        return { contents: [{ uri: "brand://runtime", mimeType: "application/json", text: JSON.stringify(runtime, null, 2) }] };
      } catch {
        return { contents: [{ uri: "brand://runtime", mimeType: "application/json", text: NOT_COMPILED }] };
      }
    }
  );

  server.registerResource(
    "Brand Interaction Policy",
    "brand://policy",
    {
      description:
        "Enforceable brand rules — visual anti-patterns, voice constraints, never-say words, content claims policies. Used by preflight and scoring tools.",
      mimeType: "application/json",
    },
    async () => {
      try {
        if (!(await brandDir.exists())) {
          return { contents: [{ uri: "brand://policy", mimeType: "application/json", text: NOT_COMPILED }] };
        }
        const policy = await brandDir.readPolicy();
        return { contents: [{ uri: "brand://policy", mimeType: "application/json", text: JSON.stringify(policy, null, 2) }] };
      } catch {
        return { contents: [{ uri: "brand://policy", mimeType: "application/json", text: NOT_COMPILED }] };
      }
    }
  );
}
