/**
 * `inspect` subcommand — print package version, resolved tool profile,
 * the core tool list, and the .brand/ artifact inventory in cwd.
 * All local; no network.
 */

import { access } from "node:fs/promises";
import { join } from "node:path";
import { getVersion } from "../lib/version.js";
import { resolveProfile, CORE_TOOL_NAMES } from "../lib/tool-profile.js";

/** Standard .brand/ artifacts across sessions 1-4. */
export const STANDARD_BRAND_FILES: readonly string[] = [
  "brand.config.yaml",
  "core-identity.yaml",
  "visual-identity.yaml",
  "messaging.yaml",
  "strategy.yaml",
  "extraction-evidence.json",
  "design-synthesis.json",
  "DESIGN.md",
  "tokens.json",
  "brand-runtime.json",
  "interaction-policy.json",
  "needs-clarification.yaml",
  "brand-report.html",
];

export interface ArtifactEntry {
  file: string;
  exists: boolean;
}

/** Which of the standard .brand/ files exist in cwd. */
export async function getArtifactInventory(
  cwd: string,
): Promise<ArtifactEntry[]> {
  const brandPath = join(cwd, ".brand");
  const entries: ArtifactEntry[] = [];
  for (const file of STANDARD_BRAND_FILES) {
    let exists = false;
    try {
      await access(join(brandPath, file));
      exists = true;
    } catch {
      // missing
    }
    entries.push({ file, exists });
  }
  return entries;
}

/** Run the inspect command. Always exits 0. */
export async function runInspect(
  cwd: string,
  explicitProfile?: string,
): Promise<number> {
  const profile = resolveProfile(explicitProfile);

  console.log(`@brandsystem/mcp ${getVersion()}`);
  console.log(``);
  console.log(`Profile: ${profile}`);
  if (profile === "core") {
    console.log(
      `  Core profile registers ${CORE_TOOL_NAMES.size} tools (pass --profile=full for the complete surface):`,
    );
    for (const name of CORE_TOOL_NAMES) {
      console.log(`    ${name}`);
    }
  } else {
    console.log(
      `  Full profile registers the complete tool surface (all tools, including the ${CORE_TOOL_NAMES.size} core tools).`,
    );
  }

  console.log(``);
  const brandExists = await (async () => {
    try {
      await access(join(cwd, ".brand"));
      return true;
    } catch {
      return false;
    }
  })();

  if (!brandExists) {
    console.log(`.brand/ inventory: no .brand/ directory in ${cwd}`);
    console.log(`  Run brand_start (via an MCP client) to begin.`);
    return 0;
  }

  console.log(`.brand/ inventory (${cwd}):`);
  const inventory = await getArtifactInventory(cwd);
  for (const entry of inventory) {
    console.log(`  ${entry.exists ? "present" : "missing"}  ${entry.file}`);
  }
  return 0;
}
