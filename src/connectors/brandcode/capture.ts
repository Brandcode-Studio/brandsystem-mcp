/**
 * Inbound capture client for the Brandcode Studio runtime.
 *
 * Posts edge taste judgments and research/intelligence findings to the UCS
 * inbound capture routes (UCS packet s078-ti35):
 *   POST /api/brand/{slug}/runtime/taste-capture
 *   POST /api/brand/{slug}/runtime/intelligence-capture
 *
 * These routes QUEUE candidates for human review in the brand's refinery — they
 * never promote to canon. This client carries the user's session bearer token;
 * the route enforces brand-runtime authority and refuses before any write.
 */

import { BrandcodeClientError } from "./client.js";

const USER_AGENT = "brandsystem-mcp";
const TIMEOUT_MS = 15_000;

async function postJson<T>(url: string, authToken: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "user-agent": USER_AGENT,
      authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new BrandcodeClientError(
      `Brandcode capture API ${res.status}: ${res.statusText}`,
      res.status,
      text,
    );
  }
  return (await res.json()) as T;
}

// ── taste-capture ────────────────────────────────────────────────────────────

export type TasteCapturePayload = {
  candidateRef: string;
  candidateText?: string | null;
  verdict: "distinctive" | "generic" | "flag";
  attributeReason: string;
  surface: "chat" | "code" | "studio";
  actor?: string;
  turnId?: string;
  sessionId?: string;
};

export type TasteCaptureResponse =
  | { ok: true; routed: "queued"; ref: string; quarantined: boolean; canonicalMutation: false }
  | { ok: false; code?: string; error?: string; message?: string };

export async function postTasteCapture(
  baseUrl: string,
  slug: string,
  authToken: string,
  payload: TasteCapturePayload,
): Promise<TasteCaptureResponse> {
  return postJson<TasteCaptureResponse>(
    `${baseUrl}/api/brand/${slug}/runtime/taste-capture`,
    authToken,
    payload,
  );
}

// ── intelligence-capture ───────────────────────────────────────────────────────

export type ResearchCitationPayload = { url: string; title?: string };

export type ResearchFindingPayload = {
  statement: string;
  citations: ResearchCitationPayload[];
  direction?: "supports" | "gap" | "escalate";
  confidence?: number;
};

export type ResearchRecipePayload = {
  id: string;
  question: string;
  cadence?: "manual" | "weekly" | "on_signal";
  sources?: string[];
  defaultTarget?: "proof_point" | "narrative" | "escalate";
  defaultInsightType?: string;
};

export type IntelligenceCaptureOutcome =
  | { status: "queued"; statement: string; ref: string; quarantined: boolean }
  | { status: "escalated-to-decision"; statement: string; decisionPrompt: string }
  | { status: "refused"; code: string; message: string };

export type IntelligenceCaptureResponse =
  | { ok: true; mode: "findings" | "candidate"; count: number; outcomes: IntelligenceCaptureOutcome[] }
  | { ok: false; code?: string; error?: string; message?: string };

export async function postIntelligenceFindings(
  baseUrl: string,
  slug: string,
  authToken: string,
  recipe: ResearchRecipePayload,
  findings: ResearchFindingPayload[],
): Promise<IntelligenceCaptureResponse> {
  return postJson<IntelligenceCaptureResponse>(
    `${baseUrl}/api/brand/${slug}/runtime/intelligence-capture`,
    authToken,
    { recipe, findings },
  );
}
