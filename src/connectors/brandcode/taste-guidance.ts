import { BrandcodeClientError } from "./client.js";

const USER_AGENT = "brandcode-mcp";
const TIMEOUT_MS = 15_000;

export type TasteGuidanceItem = {
  id: string;
  directive: string;
  polarity: "use" | "avoid";
  reason: string | null;
  scope: {
    artifactKind: string | null;
    patternRef: string | null;
    surfaces: string[];
  };
  provenance: string;
  reviewedBy: "brand-admin";
  reviewedAt: string | null;
  canonicalMutation: false;
};

export type TasteGuidanceProjection = {
  schemaVersion: "s078-tmcp1-taste-memory-guidance/v0.1";
  brandSlug: string;
  tasteRevision: string;
  updatedAt: string | null;
  guidance: TasteGuidanceItem[];
  counts: { approved: number };
  boundary: string;
};

type TasteGuidanceResponse =
  | { ok: true; guidance: TasteGuidanceProjection }
  | { ok: false; error?: string };

export async function fetchTasteGuidance(input: {
  baseUrl: string;
  slug: string;
  authToken: string;
}): Promise<TasteGuidanceProjection | null> {
  const response = await fetch(
    `${input.baseUrl}/api/brand/${encodeURIComponent(input.slug)}/runtime/taste-guidance`,
    {
      method: "GET",
      headers: {
        accept: "application/json",
        "user-agent": USER_AGENT,
        authorization: `Bearer ${input.authToken}`,
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    },
  );
  const body = (await response
    .json()
    .catch(() => null)) as TasteGuidanceResponse | null;
  if (!response.ok || !body?.ok) {
    throw new BrandcodeClientError(
      body && "error" in body && body.error
        ? body.error
        : `Brandcode Taste Guidance API ${response.status}`,
      response.status,
      body ? JSON.stringify(body) : "",
    );
  }
  return body.guidance;
}
