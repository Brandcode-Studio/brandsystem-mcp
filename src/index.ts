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

// --profile=core|full (or --profile core|full) selects the tool surface for
// server mode; it is consumed here so MCP client configs can pass it as an arg.
const rawArgs = process.argv.slice(2);
let profileArg: string | undefined;
const cliArgs: string[] = [];
for (let i = 0; i < rawArgs.length; i++) {
  const a = rawArgs[i];
  if (a.startsWith("--profile=")) {
    profileArg = a.slice("--profile=".length);
  } else if (a === "--profile" && i + 1 < rawArgs.length) {
    profileArg = rawArgs[++i];
  } else {
    cliArgs.push(a);
  }
}

// If CLI args remain, run CLI instead of stdio server
if (cliArgs.length > 0) {
  const { runCli } = await import("./cli.js");
  await runCli(cliArgs);
} else {
  try {
    const { resolveProfile } = await import("./lib/tool-profile.js");
    const server = createServer({ profile: resolveProfile(profileArg) });
    const transport = new StdioServerTransport();
    await server.connect(transport);
  } catch (err) {
    console.error("[brandsystem-mcp] Failed to start server:", err);
    process.exit(1);
  }
}
