import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getVersion } from "./lib/version.js";
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
import { register as registerBuildJourney } from "./tools/brand-build-journey.js";
import { register as registerBuildPersonas } from "./tools/brand-build-personas.js";
import { register as registerBuildMatrix } from "./tools/brand-build-matrix.js";
import { register as registerBuildThemes } from "./tools/brand-build-themes.js";
import { register as registerExport } from "./tools/brand-export.js";
import { register as registerSetLogo } from "./tools/brand-set-logo.js";
import { register as registerFeedback } from "./tools/brand-feedback.js";
import { register as registerAuditContent } from "./tools/brand-audit-content.js";
import { register as registerCheckCompliance } from "./tools/brand-check-compliance.js";
import { register as registerAuditDrift } from "./tools/brand-audit-drift.js";

export function createServer(): McpServer {
  const server = new McpServer({
    name: "brandsystem",
    version: getVersion(),
  });

  // ── Entry points (register first — agents see these first) ──
  registerStart(server);       // #1: Entry point for new brands
  registerStatus(server);      // #2: "What can I do?" / resume point

  // ── Session 1: Core Identity ──
  registerExtractWeb(server);  // Extract from website
  registerExtractFigma(server);// Extract from Figma
  registerSetLogo(server);     // Add/replace logo manually
  registerCompile(server);     // Generate tokens + VIM
  registerClarify(server);     // Resolve ambiguous values
  registerAudit(server);       // Validate .brand/ directory
  registerReport(server);      // Generate HTML report
  registerInit(server);        // Low-level init (prefer brand_start)

  // ── Session 2: Visual Identity ──
  registerDeepenIdentity(server);
  registerIngestAssets(server);
  registerPreflight(server);

  // ── Session 3: Messaging ──
  registerExtractMessaging(server);
  registerCompileMessaging(server);

  // ── Session 4: Content Strategy ──
  registerBuildPersonas(server);
  registerBuildJourney(server);
  registerBuildThemes(server);
  registerBuildMatrix(server);

  // ── Content scoring ──
  registerAuditContent(server);   // Score content against brand identity
  registerCheckCompliance(server); // Binary pass/fail gate
  registerAuditDrift(server);     // Batch drift detection

  // ── Cross-session utilities ──
  registerWrite(server);       // Load brand context for content gen
  registerExport(server);      // Generate portable brand files
  registerFeedback(server);    // Bug reports + feature ideas

  return server;
}
