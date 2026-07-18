/**
 * Shared primary-color uncertainty detection (issue #41).
 *
 * Both brand_compile and brand_start's auto pipeline generate clarification
 * queues; an uncertain primary must produce the SAME stable, targetable
 * high-priority item ("clarify-primary") in both, or the exact field-reported
 * flow (brand_start auto → poisoned checks with no fix path) recurs in one
 * lane after being fixed in the other.
 */

import { isChromatic } from "./css-parser.js";
import { confidenceRank } from "./confidence.js";
import { fenceUntrusted } from "./untrusted-text.js";
import type { ClarificationItem } from "../types/index.js";

interface ColorLike {
  name: string;
  value: string;
  role: string;
  confidence: string;
}

/**
 * Returns the clarify-primary item when the primary is uncertain, else null.
 * Uncertain: no primary; or a non-confirmed primary that is achromatic while
 * chromatic alternates exist; or a below-high-confidence primary with ≥1
 * chromatic alternate. A confirmed primary never re-fires (some brands are
 * legitimately grey — confirmation must stick across recompiles).
 */
export function derivePrimaryClarification(colors: ColorLike[]): ClarificationItem | null {
  const primaryColor = colors.find((c) => c.role === "primary");
  const chromaticCandidates = colors.filter(
    (c) => c.role !== "primary" && isChromatic(c.value)
  );

  let uncertain = false;
  if (!primaryColor) {
    uncertain = true;
  } else if (primaryColor.confidence !== "confirmed" && chromaticCandidates.length > 0) {
    const achromaticCrowned = !isChromatic(primaryColor.value);
    const lowConfidenceWithAlternatives =
      confidenceRank(primaryColor.confidence as never) < confidenceRank("high");
    uncertain = achromaticCrowned || lowConfidenceWithAlternatives;
  }
  if (!uncertain) return null;

  const candidateList = chromaticCandidates.map((c) => c.value).join(", ");
  let question: string;
  if (primaryColor) {
    question = `Primary color is uncertain: current primary is ${primaryColor.value} (name: ${fenceUntrusted(primaryColor.name, 60)}), but chromatic candidate(s) exist: ${candidateList}. Which is the true primary brand color?`;
  } else if (chromaticCandidates.length > 0) {
    question = `No primary brand color identified. Chromatic candidate(s): ${candidateList}. Which color is your primary brand color?`;
  } else {
    question = "No primary brand color identified. Which color is your primary brand color?";
  }

  return {
    id: "clarify-primary",
    field: "colors.primary",
    question,
    source: "compilation",
    priority: "high",
  };
}
