# brandsystem-mcp

MCP server that extracts and manages brand identity (logo, colors, typography, voice, visual rules) for AI tools. Creates a `.brand/` directory with structured YAML, DTCG tokens, and portable HTML reports.

## Build and Test

```bash
npm install          # Install dependencies
npm run build        # Compile TypeScript to dist/
npm test             # Run vitest tests
npm run lint         # Type-check without emitting (tsc --noEmit)
npm run dev          # Watch mode for development
npm start            # Start the server (stdio transport)
```

Build must pass before committing. The entry point is `src/index.ts` (stdio transport) which creates the server from `src/server.ts`.

## Architecture

```
src/
  index.ts         # Stdio transport entry point
  server.ts        # Creates McpServer, registers all 28 tools in priority order
  tools/           # One file per tool (29 files, 31 tools). Each exports a register(server) function.
  lib/             # Shared utilities (brand-dir, css-parser, dtcg-compiler, content-scorer, etc.)
  types/           # TypeScript type definitions
  schemas/         # Zod schemas for validation
bin/
  brandsystem-mcp.mjs  # CLI entry point (npx @brandsystem/mcp)
```

### Tool Registration Order (in server.ts)

Tools are registered in the order agents see them. Entry points first:
1. `brand_start` -- always first (entry point for new brands)
2. `brand_status` -- always second ("what can I do?" / resume point)
3. Session 1 tools (extract, compile, clarify, audit, report)
4. Session 2 tools (deepen identity, ingest assets, preflight)
5. Session 3 tools (extract messaging, compile messaging)
6. Session 4 tools (personas, journey, themes, matrix)
7. Content scoring tools (audit-content, check-compliance, audit-drift)
8. Runtime (brand_runtime -- read compiled runtime contract)
9. Cross-session utilities (write, export, feedback)

### Response Format

All tools return responses via `buildResponse()` from `src/lib/response.ts`:
```typescript
{
  what_happened: string,    // One-line summary of what the tool did
  next_steps: string[],     // What the agent should do next
  data: Record<string, unknown>  // Structured output data
}
```

Many tools include a `conversation_guide` in the data to help agents present results well.

### Key Libraries

- `src/lib/brand-dir.ts` -- All `.brand/` directory I/O (read/write YAML, JSON, markdown, assets)
- `src/lib/css-parser.ts` -- CSS color and font extraction from raw CSS text
- `src/lib/dtcg-compiler.ts` -- Compile CoreIdentity into DTCG-format tokens.json
- `src/lib/confidence.ts` -- Confidence scoring, source precedence, merge logic
- `src/lib/logo-extractor.ts` -- Logo candidate detection from HTML
- `src/lib/svg-resolver.ts` -- SVG sanitization, inlining, base64 encoding
- `src/lib/report-html.ts` -- HTML report generation
- `src/lib/vim-generator.ts` -- Visual Identity Manifest markdown generation
- `src/lib/runtime-compiler.ts` -- Compile brand-runtime.json from 4 source YAMLs
- `src/lib/interaction-policy-compiler.ts` -- Compile interaction-policy.json (enforceable rules)
- `src/lib/content-scorer.ts` -- Brand compliance scoring engine
- `src/lib/color-namer.ts` -- Human-readable color name generation
- `src/lib/response.ts` -- Structured MCP response builder

## How to Add a New Tool

1. Create `src/tools/brand-<name>.ts` with this structure:
   ```typescript
   import { z } from "zod";
   import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
   import { BrandDir } from "../lib/brand-dir.js";
   import { buildResponse } from "../lib/response.js";

   const paramsShape = {
     // Zod schemas with .describe() on EVERY parameter
   };

   async function handler(input: Params) {
     const brandDir = new BrandDir(process.cwd());
     // ... tool logic ...
     return buildResponse({ what_happened, next_steps, data });
   }

   export function register(server: McpServer) {
     server.tool(
       "brand_<name>",
       "Description: WHAT it does, WHEN to use it, what it RETURNS.",
       paramsShape,
       async (args) => handler(args as Params)
     );
   }
   ```

2. Import and register in `src/server.ts` in the appropriate section.

3. Run the Architecture Alignment Checklist (below) before committing.

4. Tool description must include:
   - WHAT the tool does (one sentence)
   - WHEN to use it (trigger words/conditions)
   - What it RETURNS (output format hint)

4. Every Zod parameter must have `.describe()` with examples where helpful.

## Tool Description Guidelines

Tool descriptions are the #1 thing agents read to decide whether to call a tool. Every description should:
- Start with a verb: "Extract...", "Generate...", "Check...", "Define..."
- Include trigger phrases (what the user might say that should invoke this tool)
- End with what the tool returns
- Be under 300 characters for the first sentence (some clients truncate)

## Architecture Alignment Checklist

Run this checklist when adding a new tool, changing tool behavior, or making architecture changes that affect what the MCP produces or how users interact with it.

### Current Architecture (as of v0.3.2)

The MCP has three operating lanes:
1. **Local self-contained** — extract from website/Figma, compile to `.brand/` directory
2. **Brandcode Studio connector** — connect/sync/status with hosted brands
3. **Content enforcement** — score, compliance gate, preflight, drift detection

Session 1 outputs: `brand.config.yaml`, `core-identity.yaml`, `tokens.json`, `brand-runtime.json`, `interaction-policy.json`, `needs-clarification.yaml`, `brand-report.html`

MCP resources: `brand://runtime` and `brand://policy` (subscribable)

The canonical field for the brand name is `client_name` (not `brand_name`).

### When adding a new tool

- [ ] Description starts with a verb and includes trigger phrases
- [ ] Description mentions what it returns
- [ ] Description includes NOT-for disambiguation if it overlaps with existing tools
- [ ] If the tool produces compiled output, it delegates to the canonical compiler (runtime-compiler.ts, interaction-policy-compiler.ts, dtcg-compiler.ts) rather than reimplementing
- [ ] If the tool has a `what_happened` message, it accurately describes what was written
- [ ] If the tool has `next_steps`, they reference the current architecture (including connector path when relevant)
- [ ] If the tool has `conversation_guide`, it mentions runtime/policy artifacts and the Brandcode Studio option where appropriate
- [ ] Tool is registered in `src/server.ts` in the correct section
- [ ] Tool is listed in `brand_status` getting-started guide
- [ ] Tool is covered by at least one smoke test in `test/tools/smoke.test.ts`

### When changing compiled output format

- [ ] `brand_start` auto mode produces the same artifacts as `brand_compile`
- [ ] `brand_status` session descriptions match actual outputs
- [ ] `brand_audit` checks for new output files
- [ ] `llms.txt` Key Capabilities section is updated
- [ ] `README.md` .brand/ directory listing is updated
- [ ] `CHANGELOG.md` documents the change
- [ ] MCP resources (brand-resources.ts) serve the new format if applicable
- [ ] Integration tests verify the new output

### When changing the connector

- [ ] `brand_status` connector section reflects the change
- [ ] `brand_start` conversation_guide mentions the updated connector flow
- [ ] `brand_brandcode_connect`, `brand_brandcode_sync`, `brand_brandcode_status` descriptions are consistent
- [ ] `llms.txt` connector capability line is current
- [ ] Connector types in `src/connectors/brandcode/types.ts` match the API contract

### Common drift patterns to watch for

1. **Duplicated compile logic** — any tool that reimplements token/runtime/policy generation instead of calling the canonical compiler
2. **Stale Session 1 description** — "Produces tokens.json and brand-report.html" should be "Produces tokens.json, brand-runtime.json, interaction-policy.json, and brand-report.html"
3. **Missing connector mention** — entry tools (brand_start, brand_status) should mention the connector path as an option
4. **Field name inconsistency** — `client_name` is canonical, not `brand_name`
5. **next_steps that skip the current session** — after Session 1, tools should mention Session 2 OR Brandcode Studio connector, not just Session 2

## Commit Style

Imperative mood, no trailing period, concise. Example: "Add password-protected Engine client microsite"
