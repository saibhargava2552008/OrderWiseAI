import { z } from "zod";
import type { SwiggyConfig } from "./config.js";
import type { Tokens } from "./store.js";

/**
 * Swiggy OAuth 2.1 + PKCE client.
 *
 * Every endpoint, parameter and body below comes from the Swiggy Builders authenticate docs
 * (https://mcp.swiggy.com/builders/docs/start/authenticate/):
 *   GET  /auth/authorize   response_type, client_id, redirect_uri, code_challenge,
 *                          code_challenge_method, state, scope
 *   POST /auth/token       JSON body. Code exchange: grant_type, code, code_verifier, redirect_uri.
 *                          Refresh: grant_type, refresh_token, optional user_id.
 *   POST /auth/register    Dynamic Client Registration (RFC 7591). The docs do not list the request
 *                          fields, so the standard RFC 7591 names are used. See registerClient().
 *
 * Errors carry only a short code. Response bodies are never copied into messages or logs, because
 * a body could contain tokens.
 */

export type AuthErrorCode =
  | "network" // request failed, timed out or was redirected
  | "bad_response" // reply was not the JSON shape the docs describe
  | "invalid_grant" // docs: bad signature, expired token or user_id mismatch. Do not retry; re-authorize.
  | "server_error" // 5xx. Retrying with backoff is reasonable.
  | "rejected"; // any other 4xx

export class SwiggyAuthError extends Error {
  constructor(
    public readonly code: AuthErrorCode,
    /** Short OAuth `error` value such as "invalid_request", only when it looks like one. */
    public readonly oauthError?: string,
  ) {
    super(code);
    this.name = "SwiggyAuthError";
  }
}

const REQUEST_TIMEOUT_MS = 10_000;
const OAUTH_ERROR_PATTERN = /^[a-z_]{1,40}$/;

export type FetchLike = typeof fetch;

async function postJson(url: string, body: Record<string, unknown>, fetchImpl: FetchLike): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new SwiggyAuthError("network");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(await response.text());
  } catch {
    payload = undefined;
  }

  if (!response.ok) {
    const raw = (payload as { error?: unknown } | undefined)?.error;
    const oauthError = typeof raw === "string" && OAUTH_ERROR_PATTERN.test(raw) ? raw : undefined;
    if (response.status >= 500) throw new SwiggyAuthError("server_error", oauthError);
    if (oauthError === "invalid_grant") throw new SwiggyAuthError("invalid_grant", oauthError);
    throw new SwiggyAuthError("rejected", oauthError);
  }
  if (payload === undefined || payload === null || typeof payload !== "object") {
    throw new SwiggyAuthError("bad_response");
  }
  return payload;
}

const registrationSchema = z.object({ client_id: z.string().regex(/^[A-Za-z0-9._~-]{1,200}$/) });

/**
 * Dynamic Client Registration. UNVERIFIED: the docs name the endpoint and RFC 7591 but do not list
 * its request fields. The fields below are the standard RFC 7591 client metadata names. If Swiggy
 * rejects them, the response code tells us what to change; nothing else is guessed.
 *
 * Any `client_secret` in the reply is ignored and never stored: this app registers as a public
 * client (token_endpoint_auth_method "none", one of the methods in Swiggy's published metadata)
 * and relies on PKCE.
 */
export async function registerClient(config: SwiggyConfig, fetchImpl: FetchLike = fetch): Promise<string> {
  const payload = await postJson(
    `${config.swiggyOrigin}/auth/register`,
    {
      client_name: "OrderWise AI",
      redirect_uris: [config.redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: config.scope,
    },
    fetchImpl,
  );
  const parsed = registrationSchema.safeParse(payload);
  if (!parsed.success) throw new SwiggyAuthError("bad_response");
  return parsed.data.client_id;
}

export function buildAuthorizeUrl(
  config: SwiggyConfig,
  params: { clientId: string; codeChallenge: string; state: string },
): string {
  const url = new URL(`${config.swiggyOrigin}/auth/authorize`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", params.state);
  url.searchParams.set("scope", config.scope);
  return url.toString();
}

const tokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  token_type: z.string().refine((v) => v.toLowerCase() === "bearer"),
  // The docs show two different lifetimes, so the value Swiggy returns is what counts.
  expires_in: z.number().positive().finite(),
  scope: z.string().optional(),
});

function toTokens(payload: unknown, now: number, previous?: Tokens): Tokens {
  const parsed = tokenSchema.safeParse(payload);
  if (!parsed.success) throw new SwiggyAuthError("bad_response");
  const t = parsed.data;
  return {
    accessToken: t.access_token,
    // Refresh tokens rotate. If a reply ever omits one, keep the last known value.
    refreshToken: t.refresh_token ?? previous?.refreshToken,
    expiresAt: now + t.expires_in * 1000,
    scope: t.scope ?? previous?.scope,
  };
}

export async function exchangeCode(
  config: SwiggyConfig,
  params: { code: string; codeVerifier: string },
  now: number,
  fetchImpl: FetchLike = fetch,
): Promise<Tokens> {
  const payload = await postJson(
    `${config.swiggyOrigin}/auth/token`,
    {
      grant_type: "authorization_code",
      code: params.code,
      code_verifier: params.codeVerifier,
      redirect_uri: config.redirectUri,
    },
    fetchImpl,
  );
  return toTokens(payload, now);
}

/** Refreshes the access token. The previous refresh token must be discarded; the reply carries a new one. */
export async function refreshTokens(
  config: SwiggyConfig,
  current: Tokens,
  now: number,
  fetchImpl: FetchLike = fetch,
): Promise<Tokens> {
  if (!current.refreshToken) throw new SwiggyAuthError("invalid_grant");
  const payload = await postJson(
    `${config.swiggyOrigin}/auth/token`,
    { grant_type: "refresh_token", refresh_token: current.refreshToken },
    fetchImpl,
  );
  return toTokens(payload, now, current);
}

/** Docs: refresh when 60 seconds or less remain. */
export const REFRESH_WINDOW_MS = 60_000;

export function needsRefresh(tokens: Tokens, now: number): boolean {
  return tokens.expiresAt - now <= REFRESH_WINDOW_MS;
}
