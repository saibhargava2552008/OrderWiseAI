import type { SwiggyStoreAdapter } from "./store-adapter.js";
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { CALLBACK_PATH, type SwiggyConfig, type SwiggyConfigResult } from "./config.js";
import { SwiggyMcpError, verifyFoodServer } from "./mcp.js";
import {
  SwiggyAuthError,
  buildAuthorizeUrl,
  exchangeCode,
  needsRefresh,
  refreshTokens,
  registerClient,
  logoutSwiggySession,
  type FetchLike,
} from "./oauth.js";
import { codeChallengeFor, createCodeVerifier, randomToken, safeEqual } from "./pkce.js";
import { SESSION_TTL_MS, SwiggyStore, type BrowserSession, type Tokens } from "./store.js";

export type SwiggyDeps = {
  config: SwiggyConfigResult;
  store?: SwiggyStoreAdapter;
  fetchImpl?: FetchLike;
  now?: () => number;
  /** Replaceable in tests. Defaults to a real `get_addresses` call on the Food MCP server. */
  verify?: (config: SwiggyConfig, accessToken: string) => Promise<void>;
  log?: (event: string, fields?: Record<string, string | number | boolean>) => void;
};

/** Outcomes shown to the user after the callback. Closed set: nothing from Swiggy is ever reflected. */
export type CallbackOutcome =
  | "authorized"
  | "denied"
  | "authorization_error"
  | "invalid_state"
  | "invalid_request"
  | "expired"
  | "exchange_failed"
  | "registration_failed"
  | "not_configured";

const callbackQuery = z.object({
  code: z.string().min(1).max(2048).optional(),
  state: z.string().min(1).max(256),
  error: z.string().max(100).optional(),
});

const VERIFY_MIN_INTERVAL_MS = 3_000;

function defaultLog(event: string, fields: Record<string, string | number | boolean> = {}): void {
  // Only event names and short codes are ever logged. Never tokens, codes, state values or session ids.
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...fields }));
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    if (key && !(key in out)) out[key] = value;
  }
  return out;
}

function noStore(res: Response): void {
  res.set("Cache-Control", "no-store");
}

export function createSwiggyRouter(deps: SwiggyDeps): Router {
  const { config } = deps;
  const store = deps.store ?? new SwiggyStore(deps.now);
  const now = deps.now ?? Date.now;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const verify = deps.verify ?? verifyFoodServer;
  const log = deps.log ?? defaultLog;
  const router = Router();

  // "__Host-" cookies must be Secure, so the prefix is used only when the app runs over HTTPS.
  const secure = config.enabled && config.secureCookies;
  const cookieName = secure ? "__Host-ow_sid" : "ow_sid";

  function setSessionCookie(res: Response, id: string): void {
    const attrs = [`${cookieName}=${id}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${SESSION_TTL_MS / 1000}`];
    if (secure) attrs.push("Secure");
    res.append("Set-Cookie", attrs.join("; "));
  }

  function readSessionId(req: Request): string | undefined {
    return parseCookies(req.get("cookie"))[cookieName];
  }

  async function currentSession(req: Request): Promise<BrowserSession | undefined> {
    return await store.getSession(readSessionId(req));
  }

  async function ensureSession(req: Request, res: Response): Promise<BrowserSession> {
    const existing = await currentSession(req);
    if (existing) return existing;
    const created = await store.createSession();
    setSessionCookie(res, created.id);
    return created;
  }

  /** POST routes change state, so they must come from this app's own pages. */
  function requireSameOrigin(req: Request, res: Response, next: NextFunction): void {
    if (!config.enabled) {
      res.status(503).json({ error: "not_configured" });
      return;
    }
    const origin = req.get("origin");
    const site = req.get("sec-fetch-site");
    const ok = origin ? origin === config.appOrigin : site === "same-origin";
    if (!ok) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    next();
  }

  function finish(res: Response, outcome: CallbackOutcome): void {
    noStore(res);
    res.redirect(303, `/?swiggy=${outcome}`);
  }

  // Dynamic Client Registration runs at most once per process, even for parallel requests.
  let registering: Promise<string> | undefined;
  async function resolveClientId(cfg: SwiggyConfig): Promise<string> {
    if (cfg.clientId) return cfg.clientId;
    const known = await store.getClientId(cfg.redirectUri);
    if (known) return known;
    registering ??= registerClient(cfg, fetchImpl)
      .then(async (id) => {
        await store.setClientId(cfg.redirectUri, id);
        log("swiggy_client_registered");
        return id;
      })
      .finally(() => {
        registering = undefined;
      });
    return registering;
  }

  // ---- GET /auth/swiggy/start -------------------------------------------------------------
  router.get("/auth/swiggy/start", async (req, res) => {
    noStore(res);
    if (!config.enabled) return finish(res, "not_configured");

    const session = await ensureSession(req, res);
    let clientId: string;
    try {
      clientId = await resolveClientId(config);
    } catch (error) {
      log("swiggy_registration_failed", { code: error instanceof SwiggyAuthError ? error.code : "unknown" });
      return finish(res, "registration_failed");
    }

    const state = randomToken(32);
    const verifier = createCodeVerifier();
    await store.savePending({ state, verifier, sessionId: session.id, clientId, createdAt: now() });
    log("swiggy_auth_started");
    res.redirect(302, buildAuthorizeUrl(config, { clientId, codeChallenge: codeChallengeFor(verifier), state }));
  });

  // ---- GET /auth/swiggy/callback ----------------------------------------------------------
  router.get(CALLBACK_PATH, async (req, res) => {
    noStore(res);
    if (!config.enabled) return finish(res, "not_configured");

    const query = callbackQuery.safeParse(req.query);
    if (!query.success) return finish(res, "invalid_state");
    const { code, state, error } = query.data;

    // The state is single-use: taking it removes it, so a replayed callback finds nothing.
    const pending = await store.takePending(state);
    if (!pending) {
      log("swiggy_auth_failed", { reason: "unknown_state" });
      return finish(res, "invalid_state");
    }

    // The callback must arrive in the same browser that started the flow.
    const sessionId = readSessionId(req);
    if (!sessionId || !safeEqual(sessionId, pending.sessionId)) {
      log("swiggy_auth_failed", { reason: "session_mismatch" });
      return finish(res, "invalid_state");
    }
    const session = await store.getSession(sessionId);
    if (!session || store.isExpired(pending)) {
      log("swiggy_auth_failed", { reason: "expired" });
      return finish(res, "expired");
    }

    if (error !== undefined) {
      log("swiggy_auth_failed", { reason: "authorization_error" });
      return finish(res, error === "access_denied" ? "denied" : "authorization_error");
    }
    if (code === undefined) return finish(res, "invalid_request");

    let tokens: Tokens;
    try {
      tokens = await exchangeCode(
        config,
        { code, codeVerifier: pending.verifier, clientId: pending.clientId },
        now(),
        fetchImpl,
      );
    } catch (e) {
      log("swiggy_auth_failed", {
        reason: "token_exchange",
        code: e instanceof SwiggyAuthError ? e.code : "unknown",
        ...(e instanceof SwiggyAuthError && e.oauthError ? { oauthError: e.oauthError } : {}),
      });
      return finish(res, "exchange_failed");
    }

    const fresh = await store.rotateSession(session.id, tokens);
    setSessionCookie(res, fresh.id);
    log("swiggy_auth_completed");
    finish(res, "authorized");
  });

  // ---- GET /api/swiggy/status -------------------------------------------------------------
  router.get("/api/swiggy/status", async (req, res) => {
    noStore(res);
    const session = await currentSession(req);
    res.json({
      configured: config.enabled,
      authorized: Boolean(session?.tokens),
      // True only after a real MCP request succeeded. Signing in alone is not enough.
      verified: Boolean(session?.verifiedAt),
    });
  });

  // ---- Token handling ---------------------------------------------------------------------

  class ReauthRequired extends Error {}
  class SessionPersistenceError extends Error {}


  async function freshTokens(cfg: SwiggyConfig, session: BrowserSession, force = false): Promise<Tokens> {
    const original = session.tokens;
    if (!original) throw new ReauthRequired();

    if (!force && !needsRefresh(original, now())) {
      return original;
    }

    try {
      return await store.withRefreshLock(session.id, async (lock) => {
        // Another request may have refreshed tokens while we waited.
        const latest = await store.getSession(session.id);
        if (!latest?.tokens) throw new ReauthRequired();

        const current = latest.tokens;
        const changedSinceCallerRead =
          current.accessToken !== original.accessToken ||
          current.refreshToken !== original.refreshToken;

        // Reuse newer tokens if another request refreshed them.
        if (changedSinceCallerRead && !needsRefresh(current, now())) {
          session.tokens = current;
          return current;
        }

        if (!force && !needsRefresh(current, now())) {
          session.tokens = current;
          return current;
        }

        const next = await refreshTokens(cfg, current, now(), fetchImpl);

        let saved: boolean;
        try {
          saved = await lock.saveRefreshedTokens(latest, current, next);
        } catch {
          throw new SessionPersistenceError();
        }

        if (!saved) {
          const reloaded = await store.getSession(session.id);
          if (reloaded?.tokens && !needsRefresh(reloaded.tokens, now())) {
            session.tokens = reloaded.tokens;
            return reloaded.tokens;
          }
          throw new SessionPersistenceError();
        }

        session.tokens = next;
        session.lastSeen = latest.lastSeen;
        return next;
      });
    } catch (e) {
      if (e instanceof ReauthRequired || e instanceof SessionPersistenceError) {
        throw e;
      }

      const code = e instanceof SwiggyAuthError ? e.code : "unknown";
      log("swiggy_refresh_failed", { code });

      // Transient upstream failures should remain retryable (502).
      if (
        !(e instanceof SwiggyAuthError) ||
        code === "server_error" ||
        code === "network"
      ) {
        throw e;
      }

      // Keep the observed token snapshot intact.
      // The verify route clears credentials only after an atomic token-match check.
      throw new ReauthRequired();
    }
  }


  // ---- POST /api/swiggy/verify ------------------------------------------------------------
  router.post("/api/swiggy/verify", requireSameOrigin, async (req, res) => {
    noStore(res);
    if (!config.enabled) return void res.status(503).json({ error: "not_configured" });
    const session = await currentSession(req);
    if (!session?.tokens) return void res.status(401).json({ error: "not_authorized" });

    if (session.lastVerifyAt && now() - session.lastVerifyAt < VERIFY_MIN_INTERVAL_MS) {
      return void res.status(429).json({ error: "too_many_requests" });
    }
    session.lastVerifyAt = now();

    try {
      let tokens = await freshTokens(config, session);
      try {
        await verify(config, tokens.accessToken);
      } catch (e) {
        // Docs: on a 401, refresh first and re-authorize only if the refresh fails.
        if (!(e instanceof SwiggyMcpError) || e.code !== "unauthorized") throw e;
        tokens = await freshTokens(config, session, true);
        await verify(config, tokens.accessToken);
      }
      await store.updateVerificationMetadata(session.id, {
        verifiedAt: now(),
        lastVerifyAt: session.lastVerifyAt,
      });
      log("swiggy_mcp_verified");
      res.json({ ok: true, verified: true });
    } catch (e) {
      if (e instanceof ReauthRequired || (e instanceof SwiggyMcpError && e.code === "unauthorized")) {
        try {
          const cleared = await store.clearTokensIfMatch(session.id, session.tokens!);
          if (!cleared) {
            // Another request may have refreshed the stored credentials.
            return void res.status(409).json({ error: "session_changed_retry" });
          }
          await store.updateVerificationMetadata(session.id, {
            lastVerifyAt: session.lastVerifyAt,
          });
        } catch {
          log("swiggy_session_persistence_failed");
          return void res.status(502).json({ error: "swiggy_unavailable" });
        }
        return void res.status(401).json({ error: "reauthorization_required" });
      }
      log("swiggy_verify_failed", { code: e instanceof SwiggyMcpError ? e.code : e instanceof SwiggyAuthError ? e.code : "unknown" });
      res.status(502).json({ error: "swiggy_unavailable" });
    }
  });

  // ---- POST /api/swiggy/disconnect --------------------------------------------------------
  router.post("/api/swiggy/disconnect", requireSameOrigin, async (req, res) => {
    noStore(res);
    if (!config.enabled) return void res.status(503).json({ error: "not_configured" });

    const session = await currentSession(req);
    const accessToken = session?.tokens?.accessToken;

    // Drop local credentials immediately, regardless of whether upstream revocation succeeds.
    if (session) await store.deleteSession(session.id);
    res.append(
      "Set-Cookie",
      `${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`,
    );

    const swiggySessionRevoked = accessToken
      ? await logoutSwiggySession(config, accessToken, fetchImpl)
      : false;
    if (accessToken && !swiggySessionRevoked) log("swiggy_logout_failed");
    res.json({ ok: true, swiggySessionRevoked });
  });

  // Last resort for this router: a fixed message, never the underlying error.
  router.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) return next(error);
    log("swiggy_route_error", { name: error instanceof Error ? error.name : "unknown" });
    res.status(500).json({ error: "internal_error" });
  });

  const sweeper = setInterval(() => { void Promise.resolve(store.sweep()).catch(() => log("swiggy_store_sweep_failed")); }, 60_000);
  sweeper.unref();

  return router;
}
