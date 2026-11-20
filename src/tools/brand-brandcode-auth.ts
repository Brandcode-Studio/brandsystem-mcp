import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildResponse, safeParseParams } from "../lib/response.js";
import { ERROR_CODES } from "../types/index.js";
import {
  readAuthCredentials,
  writeAuthCredentials,
  clearAuthCredentials,
} from "../lib/auth-state.js";
import { CredentialGitignoreError } from "../lib/credential-gitignore.js";
import {
  requestMagicLink,
  verifyMagicLink,
  requestDeviceCode,
  pollDeviceCode as pollDeviceCodeApi,
  BrandcodeClientError,
} from "../connectors/brandcode/client.js";
import {
  isTrustedBrandcodeOrigin,
  originOf,
  trustedOriginsHint,
} from "../connectors/brandcode/trust.js";

const DEFAULT_STUDIO_URL = "https://www.brandcode.studio";

const paramsShape = {
  mode: z
    .enum(["status", "activate", "login", "set_key", "logout"])
    .describe(
      'Auth action. "activate" (recommended) starts the device code flow: call with email to get a short code; the user opens brandcode.studio/activate, types that code, checks that it shows their email, and clicks Approve; then call again with key=<that short code> to finish. No token copy-paste. "status" checks if authenticated. "login" starts magic link flow (fallback). "set_key" stores token manually. "logout" removes credentials.',
    ),
  email: z
    .string()
    .email()
    .optional()
    .describe('Email address for login. Required when mode="login".'),
  key: z
    .string()
    .optional()
    .describe(
      'mode="set_key": session token (JWT) from magic link verification. mode="activate": the short activation code (e.g. "BRAND-7K4X") returned by the first activate call, to check whether the user approved it.',
    ),
  studio_url: z
    .string()
    .optional()
    .describe(
      'Brandcode Studio base URL. Defaults to "https://www.brandcode.studio". Must be a trusted Studio origin; self-hosted/staging origins are added via the BRANDCODE_STUDIO_TRUSTED_ORIGINS environment variable.',
    ),
};

const ParamsSchema = z.object(paramsShape);
type Params = z.infer<typeof ParamsSchema>;

async function handler(input: Params) {
  const cwd = process.cwd();
  // Credentials are bound to the Studio origin they are issued by, so that
  // origin must be on the trusted allowlist (env override for dev/staging).
  const studioUrl = originOf((input.studio_url ?? DEFAULT_STUDIO_URL).trim()) ?? "";
  if (
    input.mode !== "status" &&
    input.mode !== "logout" &&
    !isTrustedBrandcodeOrigin(studioUrl)
  ) {
    return buildResponse({
      what_happened: `Refused: studio_url ${studioUrl || "(invalid URL)"} is not a trusted Brandcode Studio origin, so no credentials will be requested from or stored for it.`,
      next_steps: [
        "Omit studio_url to use https://www.brandcode.studio",
        trustedOriginsHint(),
      ],
      data: { error: ERROR_CODES.VALIDATION_FAILED },
    });
  }

  switch (input.mode) {
    case "status":
      return handleStatus(cwd);
    case "activate":
      return handleActivate(cwd, studioUrl, input.email, input.key);
    case "login":
      return handleLogin(cwd, studioUrl, input.email);
    case "set_key":
      return handleSetKey(cwd, studioUrl, input.key);
    case "logout":
      return handleLogout(cwd);
  }
}

/** Credentials were not stored because git would commit them. */
function gitignoreRefusal(err: CredentialGitignoreError) {
  return buildResponse({
    what_happened: err.message,
    next_steps: [
      "Fix the ignore rule named above so git ignores .brand/brandcode-auth.json",
      "Run `npx @brandsystem/mcp doctor` to confirm, then sign in again",
    ],
    data: { error: ERROR_CODES.AUTH_FAILED, reason: "credentials_not_gitignored" },
  });
}

// ---------------------------------------------------------------------------
// Device-code activation
//
// Studio returns two codes: a short `user_code` the human checks at
// /activate, and a high-entropy `device_code` secret that is the only value
// the poll endpoint accepts. The secret is held here, in this process's
// memory, keyed by the short code; it is never written to tool output, so an
// agent transcript cannot be replayed to claim the session.
// ---------------------------------------------------------------------------

interface PendingActivation {
  cwd: string;
  studioUrl: string;
  userCode: string;
  deviceCode: string;
  /** Studio predates the device_code split: poll with ?code=<user code>. */
  legacyParam: boolean;
  email: string;
  expiresAt: number;
  createdAt: number;
}

const MAX_PENDING_ACTIVATIONS = 16;
const pendingActivations = new Map<string, PendingActivation>();

function normalizeUserCode(code: string): string {
  return code.trim().toUpperCase();
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function pendingKey(cwd: string, studioUrl: string, userCode: string): string {
  return `${cwd}\0${studioUrl}\0${normalizeUserCode(userCode)}`;
}

function prunePendingActivations(now = Date.now()): void {
  for (const [key, entry] of pendingActivations) {
    if (entry.expiresAt <= now) pendingActivations.delete(key);
  }
  while (pendingActivations.size > MAX_PENDING_ACTIVATIONS) {
    const oldest = pendingActivations.keys().next().value;
    if (oldest === undefined) break;
    pendingActivations.delete(oldest);
  }
}

function rememberActivation(entry: PendingActivation): void {
  const key = pendingKey(entry.cwd, entry.studioUrl, entry.userCode);
  pendingActivations.delete(key);
  pendingActivations.set(key, entry);
  prunePendingActivations();
}

function forgetActivation(entry: PendingActivation): void {
  pendingActivations.delete(pendingKey(entry.cwd, entry.studioUrl, entry.userCode));
}

/** Look up by short code, or (no code) the most recent activation for this cwd + Studio. */
function findActivation(cwd: string, studioUrl: string, userCode?: string): PendingActivation | null {
  prunePendingActivations();
  if (userCode) return pendingActivations.get(pendingKey(cwd, studioUrl, userCode)) ?? null;
  let latest: PendingActivation | null = null;
  for (const entry of pendingActivations.values()) {
    if (entry.cwd !== cwd || entry.studioUrl !== studioUrl) continue;
    if (!latest || entry.createdAt >= latest.createdAt) latest = entry;
  }
  return latest;
}

/** Test hook: drop in-memory activations between tests. */
export function resetPendingActivationsForTests(): void {
  pendingActivations.clear();
}

/** The email claim of a session JWT, decoded for comparison only (Studio verifies on use). */
function jwtEmailClaim(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf-8")) as {
      email?: unknown;
    };
    return typeof payload.email === "string" ? payload.email : null;
  } catch {
    return null;
  }
}

/**
 * Always the bare activation page on the trusted Studio origin: the user types
 * the code there, so a link can never carry an approvable code.
 */
function safeActivateUrl(_raw: unknown, studioUrl: string, _userCode: string): string {
  return `${studioUrl}/activate`;
}

const USER_CODE_PATTERN = /^[A-Za-z0-9-]{4,32}$/;

function approveInstruction(url: string, userCode: string, email: string): string {
  return `Open ${url}, sign in to Brandcode Studio as ${email}, type the code ${userCode}, check that the page shows ${email}, then click Approve.`;
}

function emailMismatchResponse(entry: PendingActivation) {
  return buildResponse({
    what_happened: `Studio refused activation ${entry.userCode}: the account that approved it is not ${entry.email}. No credentials were stored.`,
    next_steps: [
      `Ask the user to sign in to Brandcode Studio as ${entry.email} before approving, then run brand_brandcode_auth mode="activate" email="${entry.email}" for a new code`,
      'Or, if they use a different Studio account, run brand_brandcode_auth mode="activate" email="<that account\'s email>"',
    ],
    data: { error: ERROR_CODES.AUTH_FAILED, reason: "email_mismatch", code: entry.userCode },
  });
}

function redact(message: string, secret: string): string {
  return secret ? message.split(secret).join("[redacted]") : message;
}

async function handleActivate(cwd: string, studioUrl: string, email?: string, userCode?: string) {
  // Check if already authenticated
  const existing = await readAuthCredentials(cwd);
  if (existing) {
    return buildResponse({
      what_happened: `Already authenticated as ${existing.email}`,
      next_steps: [
        'Run brand_brandcode_auth mode="logout" first to switch accounts',
        "Or continue using the current session",
      ],
      data: { authenticated: true, email: existing.email },
    });
  }

  // Phase 2: poll an activation this process created. `key` is the short
  // code; with neither key nor email, resume the latest pending activation.
  const pending = userCode || !email ? findActivation(cwd, studioUrl, userCode) : null;
  if (userCode && !pending) {
    return buildResponse({
      what_happened: `No pending activation for code ${normalizeUserCode(userCode)} in this session — it expired, was already used, or the MCP server restarted (pending codes are kept in memory only).`,
      next_steps: ['Start again: brand_brandcode_auth mode="activate" email="you@example.com"'],
      data: { error: ERROR_CODES.AUTH_FAILED, reason: "no_pending_activation" },
    });
  }
  if (pending) return pollActivation(cwd, pending);

  // Phase 1: create a new device code
  if (!email) {
    return buildResponse({
      what_happened: "Email is required to activate",
      next_steps: ['Provide an email: brand_brandcode_auth mode="activate" email="you@example.com"'],
      data: { error: ERROR_CODES.VALIDATION_FAILED },
    });
  }

  try {
    const result = await requestDeviceCode(studioUrl, email);
    const shortCode = typeof result.user_code === "string" ? result.user_code : result.code;
    if (typeof shortCode !== "string" || !USER_CODE_PATTERN.test(shortCode)) {
      return buildResponse({
        what_happened: "Activation failed: Studio returned no usable activation code",
        next_steps: ["Try again in a moment", 'Or use brand_brandcode_auth mode="login" (magic link)'],
        data: { error: ERROR_CODES.AUTH_FAILED },
      });
    }
    const secret = typeof result.device_code === "string" ? result.device_code.trim() : "";
    const expiresAtMs = Date.parse(result.expires_at);
    const entry: PendingActivation = {
      cwd,
      studioUrl,
      userCode: normalizeUserCode(shortCode),
      // Older Studios have no separate secret and poll by the short code.
      deviceCode: secret || shortCode,
      legacyParam: !secret,
      email,
      expiresAt: Number.isFinite(expiresAtMs) ? expiresAtMs : Date.now() + 60 * 60 * 1000,
      createdAt: Date.now(),
    };
    rememberActivation(entry);

    const url = safeActivateUrl(result.activate_url, studioUrl, entry.userCode);
    const instruction = approveInstruction(url, entry.userCode, email);

    return buildResponse({
      what_happened: `Activation code ${entry.userCode} created for ${email} — waiting for the user to approve it in Studio`,
      next_steps: [
        `Tell the user: "${instruction}"`,
        `After they confirm they clicked Approve, call brand_brandcode_auth mode="activate" key="${entry.userCode}" to finish`,
      ],
      data: {
        code: entry.userCode,
        email,
        activate_url: url,
        expires_at: result.expires_at,
        poll_interval: result.poll_interval,
        conversation_guide: {
          instruction: `Display this to the user: "${instruction}" Wait for them to confirm they approved it, then call brand_brandcode_auth mode="activate" key="${entry.userCode}". If the email shown in Studio is not ${email}, they should not approve — start over with the right email.`,
        },
      },
    });
  } catch (err) {
    if (err instanceof BrandcodeClientError) {
      if (err.status === 429) {
        return buildResponse({
          what_happened: "Activation failed: too many activation requests for this email",
          next_steps: ["Wait a few minutes, then try again"],
          data: { error: ERROR_CODES.RATE_LIMITED, status: err.status },
        });
      }
      return buildResponse({
        what_happened: `Activation failed: ${err.message}`,
        next_steps: ["Check network connectivity and try again"],
        data: { error: ERROR_CODES.AUTH_FAILED, status: err.status },
      });
    }
    return buildResponse({
      what_happened: `Activation failed: ${(err as Error).message}`,
      next_steps: ["Check network connectivity and try again"],
      data: { error: ERROR_CODES.FETCH_FAILED },
    });
  }
}

async function pollActivation(cwd: string, entry: PendingActivation) {
  const { studioUrl, userCode, email } = entry;
  const again = `brand_brandcode_auth mode="activate" key="${userCode}"`;
  const restart = `brand_brandcode_auth mode="activate" email="${email}"`;

  let poll: Awaited<ReturnType<typeof pollDeviceCodeApi>>;
  try {
    poll = await pollDeviceCodeApi(studioUrl, entry.deviceCode, entry.legacyParam);
  } catch (err) {
    if (err instanceof BrandcodeClientError) {
      if (err.status === 403) {
        forgetActivation(entry);
        return emailMismatchResponse(entry);
      }
      if (err.status === 404 || err.status === 410) {
        forgetActivation(entry);
        return buildResponse({
          what_happened: `Activation code ${userCode} ${err.status === 410 ? "expired" : "was not found"} in Studio`,
          next_steps: [`Start again: ${restart}`],
          data: { error: err.status === 410 ? ERROR_CODES.AUTH_EXPIRED : ERROR_CODES.AUTH_FAILED },
        });
      }
      if (err.status === 429) {
        return buildResponse({
          what_happened: "Studio asked us to slow down while checking the activation",
          next_steps: [`Wait a few seconds, then check again: ${again}`],
          data: { error: ERROR_CODES.RATE_LIMITED, status: "pending", code: userCode },
        });
      }
    }
    return buildResponse({
      what_happened: `Poll failed: ${redact((err as Error).message, entry.deviceCode)}`,
      next_steps: [`Try again: ${again}`],
      data: { error: ERROR_CODES.FETCH_FAILED, code: userCode },
    });
  }

  switch (poll.status) {
    case "complete": {
      forgetActivation(entry);
      // The session must belong to the email the user asked to activate —
      // both the poll's email and the token's own claim.
      const expected = normalizeEmail(email);
      const claimed = typeof poll.token === "string" ? jwtEmailClaim(poll.token) : null;
      if (
        typeof poll.token !== "string" ||
        typeof poll.email !== "string" ||
        normalizeEmail(poll.email) !== expected ||
        (claimed !== null && normalizeEmail(claimed) !== expected)
      ) {
        return emailMismatchResponse(entry);
      }
      try {
        await writeAuthCredentials(cwd, {
          email: poll.email,
          token: poll.token,
          expiresAt: poll.expiresAt,
          studioUrl,
        });
      } catch (err) {
        if (err instanceof CredentialGitignoreError) return gitignoreRefusal(err);
        throw err;
      }
      return buildResponse({
        what_happened: `Activated as ${poll.email}`,
        next_steps: [
          "You can now save and push brands to Studio",
          'Run brand_brandcode_connect mode="save" to upload your brand',
        ],
        data: { authenticated: true, email: poll.email, studio_url: studioUrl },
      });
    }
    case "pending":
      return buildResponse({
        what_happened: `Waiting for the user to approve code ${userCode} in Brandcode Studio`,
        next_steps: [
          `Ask the user whether they opened the activation page, typed the code, checked that it shows ${email}, and clicked Approve`,
          `Then check again: ${again}`,
        ],
        data: { status: "pending", code: userCode, email },
      });
    case "expired":
      forgetActivation(entry);
      return buildResponse({
        what_happened: `Activation code ${userCode} expired`,
        next_steps: [`Start again: ${restart}`],
        data: { error: ERROR_CODES.AUTH_EXPIRED },
      });
    case "not_found":
      forgetActivation(entry);
      return buildResponse({
        what_happened: `Activation code ${userCode} was not found in Studio (already used or expired)`,
        next_steps: [`Start again: ${restart}`],
        data: { error: ERROR_CODES.AUTH_FAILED },
      });
    case "email_mismatch":
      forgetActivation(entry);
      return emailMismatchResponse(entry);
    default:
      // denied / rejected / anything a newer Studio adds: never store, start over.
      forgetActivation(entry);
      return buildResponse({
        what_happened: `Studio did not approve activation ${userCode}. No credentials were stored.`,
        next_steps: [`If the user meant to approve it, start again: ${restart}`],
        data: { error: ERROR_CODES.AUTH_FAILED, reason: "not_approved" },
      });
  }
}

async function handleStatus(cwd: string) {
  const creds = await readAuthCredentials(cwd);
  if (!creds) {
    return buildResponse({
      what_happened: "Not authenticated with Brandcode Studio",
      next_steps: [
        'Run brand_brandcode_auth mode="activate" email="you@example.com" to connect — displays a short code, no token copy needed',
      ],
      data: {
        authenticated: false,
      },
    });
  }

  const expiresAt = new Date(creds.expiresAt);
  const daysLeft = Math.ceil(
    (expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
  );

  return buildResponse({
    what_happened: `Authenticated as ${creds.email}`,
    next_steps: [
      "You can now use brand_brandcode_connect with mode=\"save\" to upload brands",
      "You can use brand_brandcode_sync with direction=\"push\" to push updates",
    ],
    data: {
      authenticated: true,
      email: creds.email,
      studio_url: creds.studioUrl,
      expires_at: creds.expiresAt,
      days_remaining: daysLeft,
    },
  });
}

async function handleLogin(cwd: string, studioUrl: string, email?: string) {
  if (!email) {
    return buildResponse({
      what_happened: "Email is required for login",
      next_steps: [
        'Provide an email address: brand_brandcode_auth mode="login" email="you@example.com"',
      ],
      data: { error: ERROR_CODES.VALIDATION_FAILED },
    });
  }

  // Check if already authenticated
  const existing = await readAuthCredentials(cwd);
  if (existing) {
    return buildResponse({
      what_happened: `Already authenticated as ${existing.email}`,
      next_steps: [
        'Run brand_brandcode_auth mode="logout" first to switch accounts',
        "Or continue using the current session",
      ],
      data: {
        authenticated: true,
        email: existing.email,
        studio_url: existing.studioUrl,
      },
    });
  }

  try {
    const result = await requestMagicLink(studioUrl, email);

    if (result.mode === "development" && result.token) {
      // Dev mode: auto-verify and store the token
      const verifyResult = await verifyMagicLink(studioUrl, result.token);
      await writeAuthCredentials(cwd, {
        email: verifyResult.email,
        token: verifyResult.token,
        expiresAt: verifyResult.expiresAt,
        studioUrl,
      });

      return buildResponse({
        what_happened: `Authenticated as ${verifyResult.email} (dev mode — auto-verified)`,
        next_steps: [
          "You can now save and push brands to Studio",
          'Run brand_brandcode_connect with mode="save" to upload a brand',
        ],
        data: {
          authenticated: true,
          email: verifyResult.email,
          mode: "development",
          studio_url: studioUrl,
        },
      });
    }

    // Production mode: email sent, user needs to click link and provide key
    return buildResponse({
      what_happened: `Magic link sent to ${email}`,
      next_steps: [
        "Check your email and click the magic link",
        "After clicking, the browser will show a session token",
        `Copy the token and run: brand_brandcode_auth mode="set_key" key="<your-token>" studio_url="${studioUrl}"`,
        'Note: mode="activate" is easier — no token copy needed. Use it next time.',
      ],
      data: {
        email,
        mode: "email",
        expires_at: result.expiresAt,
        studio_url: studioUrl,
      },
    });
  } catch (err) {
    if (err instanceof CredentialGitignoreError) return gitignoreRefusal(err);
    if (err instanceof BrandcodeClientError) {
      return buildResponse({
        what_happened: `Login failed: ${err.message}`,
        next_steps: [
          "Check the email address and try again",
          "Verify the Studio URL is correct",
        ],
        data: { error: ERROR_CODES.AUTH_FAILED, status: err.status },
      });
    }
    return buildResponse({
      what_happened: `Login failed: ${(err as Error).message}`,
      next_steps: [
        "Check network connectivity",
        "Verify the Studio URL is correct and reachable",
      ],
      data: { error: ERROR_CODES.FETCH_FAILED },
    });
  }
}

async function handleSetKey(cwd: string, studioUrl: string, key?: string) {
  if (!key) {
    return buildResponse({
      what_happened: "Session key is required",
      next_steps: [
        'After clicking the magic link, provide the token: brand_brandcode_auth mode="set_key" key="<token>"',
      ],
      data: { error: ERROR_CODES.VALIDATION_FAILED },
    });
  }

  // The key from the verify endpoint is a JWT — decode the email from it
  // We verify it by calling the Studio to validate (or trust it if it's a JWT)
  // For robustness, just store it and let the next API call validate
  try {
    // Decode JWT payload to extract email and expiry (no verification — Studio validates on use)
    const parts = key.split(".");
    if (parts.length !== 3) {
      return buildResponse({
        what_happened: "Invalid token format — expected a JWT from the magic link verification",
        next_steps: [
          "Make sure you copied the full token from the verification page",
          'The token should be a long string with two dots (header.payload.signature)',
        ],
        data: { error: ERROR_CODES.VALIDATION_FAILED },
      });
    }

    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf-8"),
    ) as { email?: string; exp?: number };

    if (!payload.email) {
      return buildResponse({
        what_happened: "Token does not contain an email claim",
        next_steps: [
          "This doesn't appear to be a valid Brandcode session token",
          'Run brand_brandcode_auth mode="login" to start a new authentication flow',
        ],
        data: { error: ERROR_CODES.VALIDATION_FAILED },
      });
    }

    const expiresAt = payload.exp
      ? new Date(payload.exp * 1000).toISOString()
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    await writeAuthCredentials(cwd, {
      email: payload.email,
      token: key,
      expiresAt,
      studioUrl,
    });

    return buildResponse({
      what_happened: `Authenticated as ${payload.email}`,
      next_steps: [
        "You can now save and push brands to Studio",
        'Run brand_brandcode_connect with mode="save" to upload a brand',
      ],
      data: {
        authenticated: true,
        email: payload.email,
        expires_at: expiresAt,
        studio_url: studioUrl,
      },
    });
  } catch (err) {
    if (err instanceof CredentialGitignoreError) return gitignoreRefusal(err);
    return buildResponse({
      what_happened: `Failed to process token: ${(err as Error).message}`,
      next_steps: [
        "Make sure you copied the full token from the verification page",
        'Run brand_brandcode_auth mode="login" to start a new authentication flow',
      ],
      data: { error: ERROR_CODES.AUTH_FAILED },
    });
  }
}

async function handleLogout(cwd: string) {
  const creds = await readAuthCredentials(cwd);
  await clearAuthCredentials(cwd);

  if (!creds) {
    return buildResponse({
      what_happened: "No stored credentials to remove",
      next_steps: [
        'Run brand_brandcode_auth mode="login" to authenticate',
      ],
      data: { was_authenticated: false },
    });
  }

  return buildResponse({
    what_happened: `Logged out (was ${creds.email})`,
    next_steps: [
      'Run brand_brandcode_auth mode="login" to authenticate with a different account',
    ],
    data: {
      was_authenticated: true,
      was_email: creds.email,
    },
  });
}

export function register(server: McpServer) {
  server.tool(
    "brand_brandcode_auth",
    'Activate Brandcode Studio connection for saving and pushing brands. Preferred mode: "activate" gives a short code (e.g. BRAND-7K4X); the user types it at brandcode.studio/activate, checks the email shown, and clicks Approve — no copy-paste of tokens needed. Also supports: "status" (check auth), "login" (magic link fallback), "set_key" (manual token), "logout" (clear credentials). Use when the user wants to save their brand to Studio or says "activate", "connect to Brandcode", or "save my brand online". NOT needed for extraction, preview, or brand_check — those work without auth.',
    paramsShape,
    { title: "Brandcode Studio auth", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    async (args) => {
      const parsed = safeParseParams(ParamsSchema, args);
      if (!parsed.success) return parsed.response;
      return handler(parsed.data);
    },
  );
}
