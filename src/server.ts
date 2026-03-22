import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { register as registerInit } from "./tools/brand-init.js";
import { register as registerStatus } from "./tools/brand-status.js";
import { register as registerExtractWeb } from "./tools/brand-extract-web.js";
import { register as registerExtractFigma } from "./tools/brand-extract-figma.js";
import { register as registerCompile } from "./tools/brand-compile.js";
import { register as registerAudit } from "./tools/brand-audit.js";
import { register as registerReport } from "./tools/brand-report.js";
import { register as registerStart } from "./tools/brand-start.js";
import { register as registerClarify } from "./tools/brand-clarify.js";
import { register as registerDeepenIdentity } from "./tools/brand-deepen-identity.js";
import { register as registerIngestAssets } from "./tools/brand-ingest-assets.js";
import { register as registerPreflight } from "./tools/brand-preflight.js";
import { register as registerExtractMessaging } from "./tools/brand-extract-messaging.js";
import { register as registerWrite } from "./tools/brand-write.js";
import { register as registerCompileMessaging } from "./tools/brand-compile-messaging.js";

export function createServer(): McpServer {
  const server = new McpServer({
    name: "brandsystem",
    version: "0.1.0",
  });

  registerStart(server);
  registerInit(server);
  registerStatus(server);
  registerExtractWeb(server);
  registerExtractFigma(server);
  registerCompile(server);
  registerAudit(server);
  registerReport(server);
  registerClarify(server);
  registerDeepenIdentity(server);
  registerIngestAssets(server);
  registerPreflight(server);
  registerExtractMessaging(server);
  registerWrite(server);
  registerCompileMessaging(server);

  return server;
}
