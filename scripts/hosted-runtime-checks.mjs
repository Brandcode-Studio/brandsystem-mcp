// Pure assertions on hosted brand_runtime payloads, shared by
// scripts/hosted-mcp-smoke.mjs and its unit tests. Zero dependencies so the
// smoke script can import it without a build step.

function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function colorCount(runtime) {
  const colors = isRecord(runtime?.identity) ? runtime.identity.colors : null;
  return isRecord(colors)
    ? Object.values(colors).filter((v) => typeof v === "string" && v.length > 0).length
    : 0;
}

/**
 * Evaluate one brand_runtime slice response. Returns { ok, detail }.
 *
 * Catches the 2026-10 production regression: the raw brandInstance was
 * served as the runtime, so `full` was elided by the response cap and
 * `visual`/`minimal` came back with no identity at all.
 */
export function evaluateRuntimeSlice(slice, payload) {
  if (!isRecord(payload)) {
    return { ok: false, detail: `brand_runtime ${slice} returned no payload` };
  }
  if (isRecord(payload.response_overflow) && payload.response_overflow.runtime) {
    return {
      ok: false,
      detail: `brand_runtime ${slice} runtime was elided by the response cap`,
    };
  }
  const runtime = payload.runtime;
  if (!isRecord(runtime)) {
    return { ok: false, detail: `brand_runtime ${slice} returned no runtime` };
  }
  // A UCS runtime contract (schemaVersion) carries identity elsewhere; only
  // the legacy/normalized runtime shape is held to the identity check.
  const isContract =
    typeof runtime.schemaVersion === "string" &&
    runtime.schemaVersion.startsWith("brandcode-runtime-contract/");
  if (!isContract && (slice === "minimal" || slice === "visual" || slice === "full")) {
    if (colorCount(runtime) === 0) {
      return {
        ok: false,
        detail: `brand_runtime ${slice} returned no identity colors`,
      };
    }
  }
  if (!isContract && slice === "voice" && !isRecord(runtime.voice)) {
    return { ok: false, detail: "brand_runtime voice returned no voice section" };
  }
  return {
    ok: true,
    detail: isContract
      ? `brand_runtime ${slice} returned a runtime contract`
      : slice === "voice"
        ? "brand_runtime voice returned a voice section"
        : `brand_runtime ${slice} returned identity (${colorCount(runtime)} colors)`,
  };
}
