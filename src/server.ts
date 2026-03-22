import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { register as registerInit } from "./tools/brand-init.js";
import { register as registerStatus } from "./tools/brand-status.js";
import { register as registerExtractWeb } from "./tools/brand-extract-web.js";
import { register as registerExtractFigma } from "./tools/brand-extract-figma.js";
import { register as registerCompile } from "./tools/brand-compile.js";
import { register as registerAudit } from "./tools/brand-audit.js";

export function createServer(): McpServer {
  const server = new McpServer({
    name: "brandsystem",
    version: "0.1.0",
  });

  registerInit(server);
  registerStatus(server);
  registerExtractWeb(server);
  registerExtractFigma(server);
  registerCompile(server);
  registerAudit(server);

  return server;
}
