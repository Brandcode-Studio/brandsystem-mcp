# Brandcode MCP Phase 0 Lock

**Status:** Locked for S009 G-5b Phase 1  
**Date:** 2026-04-19  
**Source charter:** `/Users/jasonlankow/Desktop/UCS/brand-os/s009-brandcode-mcp-discovery-charter-v0.1.md`  
**Scope:** Resolves the Section 14 operator-review questions before the staging prototype.

## Decision Summary

Phase 0 confirms the charter direction: `@brandsystem/mcp` remains the local **Build** MCP, while Brandcode MCP becomes the hosted **Use** MCP. The products are complementary, share governance data through Brandcode Studio, and should be listed side by side without migration pressure.

| Question | Lock |
| --- | --- |
| Product frame | Build / Use / Evolve is accepted. Brandcode MCP v1 owns Use only. |
| Tool surface | Locked at 8 tools for v1. No tool #9 or #10. |
| Naming | Package `@brandcode/mcp`, binary `brandcode-mcp`, listing name "Brandcode MCP". |
| URL | Production `https://mcp.brandcode.studio/{slug}`. Staging `https://mcp.staging.brandcode.studio/{slug}`. |
| Hosting | Vercel Fluid Compute is the primary target. Fly.io remains the fallback if the Vercel spike fails in deployment. |
| Pricing | Free in v1 for active Brandcode Studio brands, protected by rate limits and per-brand caps. |
| Migration story | "Two MCPs, one brand." `@brandsystem/mcp` builds and syncs; Brandcode MCP uses the live hosted brand from any MCP client. |

## Locked Tool Surface

The hosted MCP registers exactly these 8 tools in v1:

| Tool | Scope | Write behavior |
| --- | --- | --- |
| `brand_runtime` | Fetch governed runtime slices: `full`, `visual`, `voice`, `minimal`. | Read-only |
| `brand_search` | Query narratives, proof points, application rules, and governed brand knowledge with provenance. | Read-only |
| `brand_check` | Validate draft text, color, font, and CSS against live governance. Mirrors the `@brandsystem/mcp` signature. | Read-only |
| `brand_status` | Return connection metadata, freshness, rate-limit state, and available scopes. | Read-only |
| `list_brand_assets` | Paginated asset catalog with category and lifecycle filters. | Read-only |
| `get_brand_asset` | Fetch a specific asset URL and metadata. | Read-only |
| `brand_feedback` | Append an observation or proposal to the governance review queue. | Append-only |
| `brand_history` | Return recent MCP runs scoped by API key and brand permissions. | Read-only |

Rejected for v1:

- Build, extraction, compile, and local filesystem tools. Those stay in `@brandsystem/mcp`.
- Canonical governance mutation. Brand Console remains the place where canonical changes are approved.
- Separate `brand_proof_check` or `brand_narrative_routing` tools. Their use cases fold into `brand_check` and `brand_search` for v1.
- Public unauthenticated share-token read mode. API-key auth ships first; public read can be revisited after real usage.

## Auth And URL Contract

Clients connect to:

```text
https://mcp.brandcode.studio/{slug}
Authorization: Bearer bck_live_...
```

Staging uses:

```text
https://mcp.staging.brandcode.studio/{slug}
Authorization: Bearer bck_test_...
```

API keys are per brand and scope-based:

- `read`: `brand_runtime`, `brand_search`, `brand_status`, `list_brand_assets`, `get_brand_asset`, `brand_history`
- `check`: adds `brand_check`
- `feedback`: adds `brand_feedback`

The key format remains `bck_live_{32-byte-base62}` for production and `bck_test_{...}` for staging. Keys are hashed at rest in Brand Console.

## Fluid Compute Spike

Phase 0 validated the minimum transport shape locally against `@modelcontextprotocol/sdk@1.27.0`:

- Stateless `StreamableHTTPServerTransport`
- Bearer auth gate before MCP request handling
- Path-scoped brand slug route
- MCP client connect, `listTools`, and `callTool`
- Unauthorized request returns `401`

Observed local result:

```json
{
  "ok": true,
  "status": 401,
  "toolCount": 1,
  "elapsedMs": 60,
  "result": {
    "ok": true,
    "slug": "acme",
    "provider": "mcp",
    "surface": "mcp-hosted"
  }
}
```

Interpretation: the SDK, stateless Streamable HTTP transport, and bearer-auth composition are viable for the Phase 1 prototype. The local elapsed time is not a production latency claim. Phase 1 still must verify the same route in Vercel Fluid Compute with real deployment limits, response streaming, and Brand Console fetches.

## Phase 1 Handoff

Phase 1 should build the staging prototype, not reopen product naming or tool-surface scope.

Minimum sprint-gate path:

1. Add a hosted HTTP entry that serves `/{slug}` with stateless Streamable HTTP.
2. Register the 8-tool hosted subset from a dedicated hosted registration module.
3. Implement `bck_test_...` bearer auth with per-brand scopes.
4. Fetch live Brandcode Studio governance for at least `brand_status` and `brand_runtime`.
5. Emit `AgentRunRecord` with `provider: "mcp"` and `surface: "mcp-hosted"`.
6. Deploy to `https://mcp.staging.brandcode.studio/{slug}`.
7. Prove one live-governance tool call from a real MCP client.

Phase 1 can ship the sprint gate when at least one tool answers from live governance in staging. The full v0.1 is complete when all 8 tools, auth failures, scopes, rate limits, and observability are covered.

## Directory Positioning Lock

Tagline:

```text
Your brand, live in every AI tool.
```

Short listing description:

```text
Brandcode MCP connects any MCP-capable AI tool to a live governed brand in Brandcode Studio. Use it when a team already has a hosted brand and wants Claude, ChatGPT, Cursor, or other agents to fetch current runtime, search approved knowledge, check draft output, retrieve assets, and leave feedback without copying guidelines between tools.
```

Cross-reference line for Brandcode MCP listings:

```text
Building a new brand? Use @brandsystem/mcp to extract, compile, and sync your brand system first.
```

Cross-reference line for `@brandsystem/mcp` listings:

```text
Already have a hosted Brandcode Studio brand? Brandcode MCP connects your live brand to any MCP client.
```
