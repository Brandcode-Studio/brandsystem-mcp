/**
 * Provenance-integrity detector (0.10): the detection mechanism behind the
 * poisoned-runtime response runbook. Answers one question — does the
 * brand-runtime.json on disk actually correspond to (a) the current source
 * YAMLs and (b) an approval level the stored state supports? A runtime that
 * diverges (hand-edited, tampered, or stale after source poisoning was
 * cleaned) is flagged with the specific fields that differ.
 */

import { BrandDir } from "./brand-dir.js";
import { compileRuntime } from "./runtime-compiler.js";
import { resolveEffectiveApproval } from "./approval-state.js";

export interface IntegrityFinding {
  check: string;
  status: "pass" | "warn" | "fail";
  detail: string;
}

/** Policy-bearing paths agents consume as rules — the fields that matter. */
const POLICY_PATHS: ReadonlyArray<[section: string, key: string]> = [
  ["visual", "anti_patterns"],
  ["voice", "never_say"],
  ["voice", "ai_ism_patterns"],
  ["voice", "tone_descriptors"],
  ["voice", "never_sounds_like"],
  ["voice", "anchor_terms"],
];

function stable(value: unknown): string {
  return JSON.stringify(value ?? null);
}

export async function checkProvenanceIntegrity(cwd: string): Promise<IntegrityFinding[]> {
  const brandDir = new BrandDir(cwd);
  const findings: IntegrityFinding[] = [];

  if (!(await brandDir.hasRuntime())) {
    return [
      {
        check: "Provenance: runtime present",
        status: "warn",
        detail: "no brand-runtime.json — run brand_compile",
      },
    ];
  }

  const onDisk = (await brandDir.readRuntime()) as Record<string, unknown>;

  // 1. Approval claim must be supported by the stored approval state.
  const claimed = (onDisk.approval as string | undefined) ?? "provisional_extracted";
  const supported = await resolveEffectiveApproval(cwd);
  if (claimed === supported) {
    findings.push({
      check: "Provenance: approval claim",
      status: "pass",
      detail: `runtime claims ${claimed}; approval state supports it`,
    });
  } else {
    findings.push({
      check: "Provenance: approval claim",
      status: "fail",
      detail: `runtime claims ${claimed} but approval state supports ${supported} — recompile with brand_compile (possible tampering or stale confirmation)`,
    });
  }

  // 2. Policy-bearing fields must match a fresh compile of current sources.
  try {
    const config = await brandDir.readConfig();
    const identity = await brandDir.readCoreIdentity();
    const visual = (await brandDir.hasVisualIdentity())
      ? await brandDir.readVisualIdentity()
      : null;
    const messaging = (await brandDir.hasMessaging())
      ? await brandDir.readMessaging()
      : null;
    const strategy = (await brandDir.hasStrategy()) ? await brandDir.readStrategy() : null;
    const fresh = compileRuntime(
      config,
      identity,
      visual,
      messaging,
      strategy,
      supported
    ) as unknown as Record<string, unknown>;

    const divergent: string[] = [];
    for (const [section, key] of POLICY_PATHS) {
      const diskSection = onDisk[section] as Record<string, unknown> | null | undefined;
      const freshSection = fresh[section] as Record<string, unknown> | null | undefined;
      const diskValue = diskSection ? diskSection[key] : undefined;
      const freshValue = freshSection ? freshSection[key] : undefined;
      if (stable(diskValue) !== stable(freshValue)) {
        divergent.push(`${section}.${key}`);
      }
    }

    if (divergent.length === 0) {
      findings.push({
        check: "Provenance: policy fields match sources",
        status: "pass",
        detail: "all policy-bearing runtime fields match a fresh compile of the source YAMLs",
      });
    } else {
      findings.push({
        check: "Provenance: policy fields match sources",
        status: "fail",
        detail: `runtime policy diverges from sources at: ${divergent.join(", ")} — the runtime was edited outside brand_compile or sources changed without recompiling. Recompile, then review the diff (see poisoned-runtime runbook).`,
      });
    }
  } catch (err) {
    findings.push({
      check: "Provenance: policy fields match sources",
      status: "warn",
      detail: `could not recompile for comparison: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  return findings;
}
