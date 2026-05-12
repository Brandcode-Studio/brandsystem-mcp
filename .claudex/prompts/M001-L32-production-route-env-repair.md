# Prompt - M001-L32 Production Route And Env Repair

You are in `/Users/jasonlankow/Desktop/brandsystem-mcp` as a Sprint PO/build
session for M001.

Read first:

- `AGENTS.md`
- `.claudex/packets/M001-L32-production-route-env-repair.md`
- `.claudex/sprints/current.md`
- `HANDOFF.md`
- `specs/brandcode-mcp-production-proof-preflight.md`
- `specs/brandcode-mcp-operational-roadmap-m001-m003.md`
- `specs/brandcode-mcp-limited-client-key-ops-runbook.md`

Goal:

Repair production route/env readiness for `https://mcp.brandcode.studio/brandcode`
so the next lane can safely generate live keys and run production smoke.

Keep this narrow:

- configure or verify `mcp.brandcode.studio` as the production MCP route;
- configure or verify Production env baseline:
  `BRANDCODE_MCP_ENV=production`, `BRANDCODE_MCP_SERVICE_TOKEN`, durable
  shared Redis REST rate-limit env, and the production key-store path/name;
- prove unauthenticated access reaches app-level bearer auth, ideally
  `401 missing_bearer`;
- record exact blockers if DNS, alias, certificate, Vercel, or env
  provisioning cannot be completed.

Do not:

- generate `bck_live_` keys;
- run production smoke;
- publish, release, submit to directories, change package metadata, add hosted
  tools, relax custody, issue production client handoff keys, or promise public
  deletion/export;
- print, commit, or document service tokens, bearer keys, private URLs, or
  sensitive env values.

Closeout:

- update `specs/brandcode-mcp-production-proof-preflight.md`, L32 packet,
  `.claudex/sprints/current.md`, `.claudex/messages/M001-messages.md`, and
  `HANDOFF.md`;
- run `git diff --check`;
- run additional tests only if code changed;
- commit directly to `main` with
  `Repair Brandcode MCP production route env readiness`;
- do not push unless Jason explicitly asks.
