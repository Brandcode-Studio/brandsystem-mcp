import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

process.on("uncaughtException", (err) => {
  console.error("[brandsystem-mcp] Uncaught exception:", err);
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  console.error("[brandsystem-mcp] Unhandled rejection:", reason);
  process.exit(1);
});

try {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
} catch (err) {
  console.error("[brandsystem-mcp] Failed to start server:", err);
  process.exit(1);
}
