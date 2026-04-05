# MCP Registry Submissions

Status tracker for listing @brandsystem/mcp on MCP registries and directories.

## Prerequisites

- [ ] npm package published (`npm publish --provenance`)
- [ ] `server.json` committed to repo root
- [ ] GitHub repo is public at Brand-System/brandsystem-mcp

---

## 1. Official MCP Registry

**URL:** https://registry.modelcontextprotocol.io
**Method:** CLI (`mcp-publisher`)
**Status:** Pending

```bash
npx @anthropic/mcp-publisher publish
```

The CLI reads `server.json` from the repo root. No web form needed.

---

## 2. PulseMCP

**URL:** https://pulsemcp.com/submit
**Method:** Web form (manual)
**Status:** Pending

**Fields:**
- Name: `Brandcode MCP`
- npm package: `@brandsystem/mcp`
- GitHub: `https://github.com/Brand-System/brandsystem-mcp`
- Website: `https://brandcode.studio/mcp`
- Description: Extract, manage, and enforce brand identity for AI tools. 28 tools across 4 sessions produce DTCG design tokens, visual identity rules, voice guidelines, and governance policies from any website or Figma file. Works with Claude, ChatGPT, Cursor, and any MCP-compatible tool.
- Category: Design / Branding

---

## 3. Smithery

**URL:** https://smithery.ai
**Method:** CLI or web
**Status:** Pending

```bash
npx @anthropic/mcp-publisher publish --registry smithery
```

Or submit via web at https://smithery.ai/submit with the same fields as PulseMCP.

**Description:** MCP server for brand identity extraction and AI enforcement. Extracts logos, colors, fonts, and voice from websites. Compiles DTCG tokens and runtime contracts. Scores content for brand compliance (0-100). 28 tools, 4 progressive sessions.

---

## 4. Glama

**URL:** https://glama.ai/mcp/submit
**Method:** Web form (manual)
**Status:** Pending

**Fields:**
- Server name: `Brandcode MCP`
- npm: `@brandsystem/mcp`
- GitHub: `https://github.com/Brand-System/brandsystem-mcp`
- Description: Brand identity extraction and enforcement for AI tools. Produces DTCG design tokens, runtime contracts, and interaction policies from any website or Figma file. 28 tools across 4 sessions with content compliance scoring.

---

## 5. mcp.so

**URL:** https://mcp.so/submit
**Method:** Web form (manual)
**Status:** Pending

**Fields:**
- Name: `Brandcode MCP`
- Package: `@brandsystem/mcp`
- Repository: `https://github.com/Brand-System/brandsystem-mcp`
- Description: Extract brand identity from websites and Figma files. Compile DTCG design tokens, visual identity rules, and voice guidelines. Enforce brand compliance in Claude, ChatGPT, Cursor, and any MCP tool. 28 tools, subscribable brand://runtime and brand://policy resources.

---

## 6. MCPMarket

**URL:** https://mcpmarket.com/submit
**Method:** Web form (manual)
**Status:** Pending

**Fields:**
- Name: `Brandcode MCP`
- Install: `npx @brandsystem/mcp`
- GitHub: `https://github.com/Brand-System/brandsystem-mcp`
- Description: AI-native brand identity management. Extract logos, colors, typography, and voice from any URL. Compile into DTCG tokens and enforceable policies. Score content for brand compliance. Works with all MCP clients.

---

## 7. cursor.directory

**URL:** https://cursor.directory/mcp
**Method:** Web submission (manual)
**Status:** Pending

**Fields:**
- Name: `Brandcode MCP`
- Install command: `npx -y @brandsystem/mcp`
- GitHub: `https://github.com/Brand-System/brandsystem-mcp`
- Description: Brand identity extraction and enforcement for Cursor. Extract colors, fonts, logos from any website. Get DTCG design tokens, brand compliance scoring, and voice guidelines. Add to .cursor/mcp.json and run brand_start.

---

## 8. AgentAudit

**URL:** https://agentaudit.dev
**Method:** Web submission (manual, submit after npm publish)
**Status:** Pending

**Expected score rationale:**
- 259+ tests (comprehensive coverage)
- Zod validation on all tool inputs
- SSRF protection (DNS resolution + private IP blocking)
- SVG sanitization (Cheerio DOM whitelist)
- Prompt injection screening on feedback inputs
- 0 npm vulnerabilities (audited in CI)
- npm provenance attestation
