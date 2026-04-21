import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getVersion } from "./lib/version.js";
import { BrandDir } from "./lib/brand-dir.js";
import { checkOnramp } from "./lib/response.js";
import { registerResources } from "./resources/brand-resources.js";
import { registerPrompts } from "./prompts/brand-prompts.js";
import { trackToolCall } from "./lib/telemetry.js";
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
import { register as registerExtractSite } from "./tools/brand-extract-site.js";
import { register as registerGenerateDesignMd } from "./tools/brand-generate-designmd.js";
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
import { register as registerRuntime } from "./tools/brand-runtime.js";
import { register as registerCheck } from "./tools/brand-check.js";
import { register as registerPreview } from "./tools/brand-preview.js";
import { register as registerExtractVisual } from "./tools/brand-extract-visual.js";
import { register as registerExtractPdf } from "./tools/brand-extract-pdf.js";
import { register as registerResolveConflicts } from "./tools/brand-resolve-conflicts.js";
import { register as registerBrandcodeAuth } from "./tools/brand-brandcode-auth.js";
import { register as registerBrandcodeConnect } from "./tools/brand-brandcode-connect.js";
import { register as registerBrandcodeSync } from "./tools/brand-brandcode-sync.js";
import { register as registerBrandcodeStatus } from "./tools/brand-brandcode-status.js";
import { register as registerBrandcodeLive } from "./tools/brand-brandcode-live.js";
import { register as registerRepoConnect } from "./tools/brand-repo-connect.js";
import { register as registerRepoStatus } from "./tools/brand-repo-status.js";
import { register as registerEnrichSkill } from "./tools/brand-enrich-skill.js";

export function createServer(): McpServer {
  const server = new McpServer({
    name: "brandsystem",
    version: getVersion(),
  });

  // ── Entry points (register first — agents see these first) ──
  registerStart(server);       // #1: Entry point for new brands
  registerStatus(server);      // #2: "What can I do?" / resume point

  // ── Session 1: Core Identity ──
  registerExtractWeb(server);  // Extract from website (CSS parsing)
  registerExtractVisual(server); // Extract from website (headless Chrome + vision)
  registerExtractSite(server); // Extract from website (multi-page rendered crawl)
  registerExtractPdf(server); // Extract from PDF guidelines
  registerResolveConflicts(server); // Compare and resolve source conflicts
  registerGenerateDesignMd(server); // Generate design-synthesis.json + DESIGN.md
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

  // ── Runtime ──
  registerRuntime(server);     // Read compiled brand runtime contract
  registerCheck(server);       // Fast inline brand gate
  registerPreview(server);     // Visual proof page

  // ── Brandcode Studio connector ──
  registerBrandcodeAuth(server);     // Authenticate with Studio
  registerBrandcodeConnect(server);  // Connect to hosted brand (pull or save)
  registerBrandcodeSync(server);     // Sync with hosted brand (pull or push)
  registerBrandcodeStatus(server);   // Inspect connection status
  registerBrandcodeLive(server);     // Toggle Live Mode — read tools via hosted runtime

  // ── Git-connected source ──
  registerRepoConnect(server);       // Connect a GitHub repo for auto-sync
  registerRepoStatus(server);        // Check repo connection health

  // ── Cross-session utilities ──
  registerWrite(server);       // Load brand context for content gen
  registerExport(server);      // Generate portable brand files
  registerEnrichSkill(server); // Enrich an auto-SKILL.md against .brand/governance/
  registerFeedback(server);    // Bug reports + feature ideas

  // ── Resources (read-only, subscribable brand data) ──
  const brandDir = new BrandDir(process.cwd());
  registerResources(server, brandDir);

  // ── Prompts (reusable interaction templates) ──
  registerPrompts(server);

  // ── Onramp check (async, non-blocking) ──
  // Assess brand completeness on startup so responses can include
  // contextual CTAs pointing to Brand Loader when context is thin.
  void checkOnramp().catch(() => {
    // Onramp is advisory — never block server startup
  });

  return server;
}
