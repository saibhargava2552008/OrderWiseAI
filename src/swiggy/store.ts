import { randomToken } from "./pkce.js";

export type Tokens = {
  accessToken: string;
  refreshToken?: string;
  /** Epoch milliseconds, computed from the `expires_in` Swiggy returned. */
  expiresAt: number;
  scope?: string;
};

export type BrowserSession = {
  id: string;
  lastSeen: number;
  tokens?: Tokens;
  /** Set only after a real MCP request succeeded with these tokens. */
  verifiedAt?: number;
  lastVerifyAt?: number;
  /** In-flight refresh, so parallel requests never reuse a rotating refresh token twice. */
  refreshing?: Promise<Tokens>;
};

export type PendingAuth = {
  state: string;
  verifier: string;
  /** The browser session that started the flow. The callback must come from the same browser. */
  sessionId: string;
  clientId: string;
  createdAt: number;
};

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const PENDING_TTL_MS = 10 * 60 * 1000;
const MAX_SESSIONS = 10_000;
const MAX_PENDING = 2_000;

/**
 * In-memory store. Everything here is lost when the process restarts, which means users sign in
 * to Swiggy again. A persistent store can replace this class later without touching the routes.
 */
export class SwiggyStore {
  private sessions = new Map<string, BrowserSession>();
  private pending = new Map<string, PendingAuth>();
  private clients = new Map<string, string>();

  constructor(private readonly now: () => number = Date.now) {}

  createSession(): BrowserSession {
    this.evictOldest(this.sessions, MAX_SESSIONS);
    const session: BrowserSession = { id: randomToken(32), lastSeen: this.now() };
    this.sessions.set(session.id, session);
    return session;
  }

  getSession(id: string | undefined): BrowserSession | undefined {
    if (!id) return undefined;
    const session = this.sessions.get(id);
    if (!session) return undefined;
    if (this.now() - session.lastSeen > SESSION_TTL_MS) {
      this.sessions.delete(id);
      return undefined;
    }
    session.lastSeen = this.now();
    return session;
  }

  /** Issues a new session id and carries the tokens over. Prevents session fixation after sign-in. */
  rotateSession(oldId: string, tokens: Tokens): BrowserSession {
    this.sessions.delete(oldId);
    const fresh = this.createSession();
    fresh.tokens = tokens;
    return fresh;
  }

  deleteSession(id: string): void {
    this.sessions.delete(id);
  }

  savePending(entry: PendingAuth): void {
    this.evictOldest(this.pending, MAX_PENDING);
    this.pending.set(entry.state, entry);
  }

  /** Removes and returns the entry, so a state value can only ever be used once. */
  takePending(state: string): PendingAuth | undefined {
    const entry = this.pending.get(state);
    if (!entry) return undefined;
    this.pending.delete(state);
    return entry;
  }

  isExpired(entry: PendingAuth): boolean {
    return this.now() - entry.createdAt > PENDING_TTL_MS;
  }

  getClientId(redirectUri: string): string | undefined {
    return this.clients.get(redirectUri);
  }

  setClientId(redirectUri: string, clientId: string): void {
    this.clients.set(redirectUri, clientId);
  }

  /** Drops expired entries. Called on a timer by the router. */
  sweep(): void {
    const t = this.now();
    for (const [id, s] of this.sessions) if (t - s.lastSeen > SESSION_TTL_MS) this.sessions.delete(id);
    for (const [state, p] of this.pending) if (t - p.createdAt > PENDING_TTL_MS) this.pending.delete(state);
  }

  private evictOldest<T>(map: Map<string, T>, max: number): void {
    while (map.size >= max) {
      const oldest = map.keys().next().value;
      if (oldest === undefined) return;
      map.delete(oldest);
    }
  }
}
