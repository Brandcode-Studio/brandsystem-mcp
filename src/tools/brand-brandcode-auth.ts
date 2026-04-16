import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildResponse, safeParseParams } from "../lib/response.js";
import { ERROR_CODES } from "../types/index.js";
import {
  readAuthCredentials,
  writeAuthCredentials,
  clearAuthCredentials,
} from "../lib/auth-state.js";
import {
  requestMagicLink,
  verifyMagicLink,
  BrandcodeClientError,
} from "../connectors/brandcode/client.js";

const DEFAULT_STUDIO_URL = "https://brandcode.studio";

const paramsShape = {
  mode: z
    .enum(["status", "login", "set_key", "logout"])
    .describe(
      'Auth action. "status" checks if authenticated. "login" starts magic link flow (requires email). "set_key" stores API key after clicking magic link (requires key). "logout" removes stored credentials.',
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
      'Session token from magic link verification. Required when mode="set_key". Format: JWT from /api/auth/verify.',
    ),
  studio_url: z
    .string()
    .optional()
    .describe(
      'Brandcode Studio base URL. Defaults to "https://brandcode.studio". Override for self-hosted instances.',
    ),
};

const ParamsSchema = z.object(paramsShape);
type Params = z.infer<typeof ParamsSchema>;

async function handler(input: Params) {
  const cwd = process.cwd();
  const studioUrl = input.studio_url ?? DEFAULT_STUDIO_URL;

  switch (input.mode) {
    case "status":
      return handleStatus(cwd);
    case "login":
      return handleLogin(cwd, studioUrl, input.email);
    case "set_key":
      return handleSetKey(cwd, studioUrl, input.key);
    case "logout":
      return handleLogout(cwd);
  }
}

async function handleStatus(cwd: string) {
  const creds = await readAuthCredentials(cwd);
  if (!creds) {
    return buildResponse({
      what_happened: "Not authenticated with Brandcode Studio",
      next_steps: [
        'Run brand_brandcode_auth with mode="login" and your email to start authentication',
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
        'Copy the token and run: brand_brandcode_auth mode="set_key" key="<your-token>"',
      ],
      data: {
        email,
        mode: "email",
        expires_at: result.expiresAt,
        studio_url: studioUrl,
      },
    });
  } catch (err) {
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
    'Authenticate with Brandcode Studio for saving and pushing brands. Four modes: "status" checks if authenticated, "login" starts magic link flow (sends email), "set_key" stores session token after clicking magic link, "logout" removes credentials. Credentials stored in .brand/brandcode-auth.json (gitignored). Use when the user says "log in to Brandcode", "authenticate", "brandcode auth", or before saving a brand. Returns auth status, email, and session expiry.',
    paramsShape,
    async (args) => {
      const parsed = safeParseParams(ParamsSchema, args);
      if (!parsed.success) return parsed.response;
      return handler(parsed.data);
    },
  );
}
