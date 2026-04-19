#!/usr/bin/env node
// Local dev entry for the hosted Brandcode MCP.
//
// Reads env:
//   UCS_SERVICE_TOKEN        — required, matches UCS BRANDCODE_MCP_SERVICE_TOKEN
//   UCS_API_BASE_URL         — defaults to https://www.brandcode.studio
//   BRANDCODE_MCP_ENV        — "staging" (default) or "production"
//   BRANDCODE_MCP_TEST_KEYS  — staging token allowlist (see src/hosted/auth.ts)
//   PORT                     — defaults to 3030
//
// Usage (from repo root after `npm run build`):
//   node bin/brandcode-mcp.mjs
import { startServer } from "../dist/index-http.js";

startServer();
