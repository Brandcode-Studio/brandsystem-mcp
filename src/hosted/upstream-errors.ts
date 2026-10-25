/**
 * Client-safe descriptions of upstream (UCS) failures.
 *
 * Raw upstream exception text (network error strings, UCS `error` bodies)
 * never reaches MCP clients: it can leak internal hosts/details and, because
 * tool output is read by agents, it is an injection channel. Callers log the
 * raw detail server-side via logUpstreamFailure() and return the generic
 * phrase for the error code instead.
 */

const GENERIC_UPSTREAM_MESSAGES: Record<string, string> = {
  ucs_unreachable: "Brandcode Studio could not be reached",
  ucs_auth: "Brandcode Studio rejected the hosted service credentials",
  ucs_error: "Brandcode Studio returned an error",
  hosted_brand_not_found: "the hosted brand was not found",
  ucs_history_contract_error: "Brandcode Studio rejected the record format",
};

export function publicUpstreamMessage(code: string | undefined): string {
  return (
    (code && GENERIC_UPSTREAM_MESSAGES[code]) ??
    "the hosted brand service is temporarily unavailable"
  );
}

/** Log raw upstream failure detail server-side (never echoed to clients). */
export function logUpstreamFailure(
  where: string,
  slug: string,
  err: unknown,
): void {
  const code =
    err && typeof err === "object" && "code" in err
      ? String((err as { code: unknown }).code)
      : "unknown";
  const message =
    err instanceof Error ? err.message : typeof err === "string" ? err : "";
  console.error(
    `[brandcode-mcp] ${where} failed (slug "${slug}", ${code}): ${message.slice(0, 500)}`,
  );
}

/** Log + return the client-safe phrase for any thrown upstream error. */
export function describeUpstreamFailure(
  where: string,
  slug: string,
  err: unknown,
): string {
  logUpstreamFailure(where, slug, err);
  const code =
    err && typeof err === "object" && "code" in err
      ? String((err as { code: unknown }).code)
      : undefined;
  return publicUpstreamMessage(code);
}
