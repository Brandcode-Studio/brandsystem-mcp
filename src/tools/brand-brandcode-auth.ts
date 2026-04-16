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
  requestDeviceCode,
  pollDeviceCode as pollDeviceCodeApi,
  BrandcodeClientError,
} from "../connectors/brandcode/client.js";

const DEFAULT_STUDIO_URL = "https://www.brandcode.studio";

const paramsShape = {
  mode: z
    .enum(["status", "activate", "login", "set_key", "logout"])
    .describe(
      'Auth action. "activate" (recommended) starts device code flow — displays a short code for the user to enter at brandcode.studio/activate, then polls for completion. No copy-paste needed. "status" checks if authenticated. "login" starts magic link flow (fallback). "set_key" stores token manually. "logout" removes credentials.',
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

async function handleActivate(cwd: string, studioUrl: string, email?: string, deviceCode?: string) {
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

  // Phase 2: poll for a previously created device code
  if (deviceCode) {
    try {
      const poll = await pollDeviceCodeApi(studioUrl, deviceCode);

      if (poll.status === "complete") {
        await writeAuthCredentials(cwd, {
          email: poll.email,
          token: poll.token,
          expiresAt: poll.expiresAt,
          studioUrl,
        });
        return buildResponse({
          what_happened: `Activated as ${poll.email}`,
          next_steps: [
            "You can now save and push brands to Studio",
            'Run brand_brandcode_connect mode="save" to upload your brand',
          ],
          data: { authenticated: true, email: poll.email, studio_url: studioUrl },
        });
      }

      if (poll.status === "expired") {
        return buildResponse({
          what_happened: "Device code expired",
          next_steps: ['Run brand_brandcode_auth mode="activate" email="..." to get a new code'],
          data: { error: ERROR_CODES.AUTH_EXPIRED },
        });
      }

      if (poll.status === "not_found") {
        return buildResponse({
          what_happened: "Device code not found",
          next_steps: ['Run brand_brandcode_auth mode="activate" email="..." to get a new code'],
          data: { error: ERROR_CODES.AUTH_FAILED },
        });
      }

      // Still pending — tell agent to wait and poll again
      return buildResponse({
        what_happened: "Waiting for user to approve at brandcode.studio/activate",
        next_steps: [
          `Ask the user if they've entered the code at brandcode.studio/activate yet`,
          `Then call brand_brandcode_auth mode="activate" key="${deviceCode}" to check again`,
        ],
        data: { status: "pending", code: deviceCode },
      });
    } catch (err) {
      return buildResponse({
        what_happened: `Poll failed: ${(err as Error).message}`,
        next_steps: [`Try again: brand_brandcode_auth mode="activate" key="${deviceCode}"`],
        data: { error: ERROR_CODES.FETCH_FAILED },
      });
    }
  }

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

    return buildResponse({
      what_happened: `Activation code created: ${result.code}`,
      next_steps: [
        `Tell the user: "Go to ${result.activate_url} and enter code ${result.code} to connect your agent to Brandcode Studio"`,
        `After they approve, call brand_brandcode_auth mode="activate" key="${result.code}" to complete activation`,
      ],
      data: {
        code: result.code,
        activate_url: result.activate_url,
        expires_at: result.expires_at,
        poll_interval: result.poll_interval,
        conversation_guide: {
          instruction: `Display this to the user: "Go to ${result.activate_url} and enter code **${result.code}** to activate." Then wait for them to confirm they've done it, and call brand_brandcode_auth mode="activate" key="${result.code}" to complete.`,
        },
      },
    });
  } catch (err) {
    if (err instanceof BrandcodeClientError) {
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

async function handleStatus(cwd: string) {
  const creds = await readAuthCredentials(cwd);
  if (!creds) {
    return buildResponse({
      what_happened: "Not authenticated with Brandcode Studio",
      next_steps: [
        'Run brand_brandcode_auth mode="activate" email="you@example.com" to connect to Brandcode Studio',
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
    'Activate Brandcode Studio connection for saving and pushing brands. Preferred mode: "activate" displays a short code (e.g. BRAND-7K4X) for the user to enter at brandcode.studio/activate — no copy-paste of tokens needed. Also supports: "status" (check auth), "login" (magic link fallback), "set_key" (manual token), "logout" (clear credentials). Use when the user wants to save their brand to Studio or says "activate", "connect to Brandcode", or "save my brand online". NOT needed for extraction, preview, or brand_check — those work without auth.',
    paramsShape,
    async (args) => {
      const parsed = safeParseParams(ParamsSchema, args);
      if (!parsed.success) return parsed.response;
      return handler(parsed.data);
    },
  );
}
