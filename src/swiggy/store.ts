import { randomToken } from "./pkce.js";
import type { SwiggyStoreAdapter } from "./store-adapter.js";

export type Tokens = {
  accessToken: string;
  refreshToken?: string;
  /** Epoch milliseconds, computed from the expires_in Swiggy returned. */
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
  /** In-flight refresh shared by requests using the same in-memory object. */
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

export class SwiggyStore implements SwiggyStoreAdapter {
  private sessions = new Map<string, BrowserSession>();
  private pending = new Map<string, PendingAuth>();
  private clients = new Map<string, string>();
  private refreshLocks = new Map<string, Promise<void>>();

  constructor(private readonly now: () => number = Date.now) {}

  createSession(): BrowserSession {
    this.evictOldest(this.sessions, MAX_SESSIONS);
    const session: BrowserSession = {
      id: randomToken(32),
      lastSeen: this.now(),
    };
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

  saveSession(session: BrowserSession): void {
    if (this.sessions.has(session.id)) {
      this.sessions.set(session.id, session);
    }
  }

  updateVerificationMetadata(
    id: string,
    metadata: { verifiedAt?: number; lastVerifyAt?: number },
  ): void {
    const current = this.sessions.get(id);
    if (!current) {
      throw new Error("Swiggy session no longer exists.");
    }

    if (metadata.verifiedAt !== undefined) {
      current.verifiedAt = metadata.verifiedAt;
    } else {
      delete current.verifiedAt;
    }

    if (metadata.lastVerifyAt !== undefined) {
      current.lastVerifyAt = metadata.lastVerifyAt;
    } else {
      delete current.lastVerifyAt;
    }
  }

  async clearTokensIfMatch(
    id: string,
    expected: Tokens,
  ): Promise<boolean> {
    const current = this.sessions.get(id);

    if (
      !current?.tokens ||
      current.tokens.accessToken !== expected.accessToken ||
      current.tokens.refreshToken !== expected.refreshToken
    ) {
      return false;
    }

    current.tokens = undefined;
    current.verifiedAt = undefined;
    return true;
  }

  async saveRefreshedTokens(
    session: BrowserSession,
    expected: Tokens,
    next: Tokens,
  ): Promise<boolean> {
    const current = this.sessions.get(session.id);

    if (
      !current?.tokens ||
      current.tokens.accessToken !== expected.accessToken ||
      current.tokens.refreshToken !== expected.refreshToken
    ) {
      return false;
    }

    current.tokens = next;
    current.lastSeen = session.lastSeen;
    return true;
  }

  /** Issues a new session id after sign-in to prevent session fixation. */
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

  sweep(): void {
    const t = this.now();

    for (const [id, session] of this.sessions) {
      if (t - session.lastSeen > SESSION_TTL_MS) this.sessions.delete(id);
    }

    for (const [state, entry] of this.pending) {
      if (t - entry.createdAt > PENDING_TTL_MS) this.pending.delete(state);
    }
  }

  /**
   * Serializes refresh work for this session within one process.
   * MongoSwiggyStore provides the cross-process implementation.
   */

  async withRefreshLock<T>(
    sessionId: string,
    work: (lock: import("./store-adapter.js").RefreshLockContext) => Promise<T>,
  ): Promise<T> {
    const previous = this.refreshLocks.get(sessionId) ?? Promise.resolve();

    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });

    const tail = previous.then(() => current);
    this.refreshLocks.set(sessionId, tail);

    await previous;

    let active = true;

    const assertOwnership = async (): Promise<void> => {
      if (!active) {
        throw new Error("Refresh lock ownership was lost.");
      }
    };

    const lock: import("./store-adapter.js").RefreshLockContext = {
      assertOwnership,
      saveRefreshedTokens: async (session, expected, next) => {
        await assertOwnership();
        return this.saveRefreshedTokens(session, expected, next);
      },
    };

    try {
      return await work(lock);
    } finally {
      active = false;
      release();

      if (this.refreshLocks.get(sessionId) === tail) {
        this.refreshLocks.delete(sessionId);
      }
    }
  }


  private evictOldest<T>(map: Map<string, T>, max: number): void {
    while (map.size >= max) {
      const oldest = map.keys().next().value;
      if (oldest === undefined) return;
      map.delete(oldest);
    }
  }
}
