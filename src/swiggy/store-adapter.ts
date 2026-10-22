
import type { BrowserSession, PendingAuth, Tokens } from "./store.js";

export type MaybePromise<T> = T | Promise<T>;

/**
 * Operations available while a session's refresh lock is held.
 *
 * Implementations must ensure that saveRefreshedTokens verifies lock
 * ownership atomically with the token write wherever possible.
 */
export interface RefreshLockContext {
  assertOwnership(): Promise<void>;

  saveRefreshedTokens(
    session: BrowserSession,
    expected: Tokens,
    next: Tokens,
  ): Promise<boolean>;
}

export interface SwiggyStoreAdapter {
  createSession(): MaybePromise<BrowserSession>;
  getSession(id: string | undefined): MaybePromise<BrowserSession | undefined>;
  saveSession(session: BrowserSession): MaybePromise<void>;

  /**
   * Updates verification timestamps without overwriting stored tokens.
   */
  updateVerificationMetadata(
    id: string,
    metadata: { verifiedAt?: number; lastVerifyAt?: number },
  ): MaybePromise<void>;

  /**
   * Clears stored tokens only if they still match the expected token snapshot.
   * Returns false if the stored tokens have changed.
   */
  clearTokensIfMatch(id: string, expected: Tokens): Promise<boolean>;

  /**
   * Saves refreshed tokens only if the stored tokens match the expected
   * snapshot. When called through a RefreshLockContext, the implementation
   * must also verify lock ownership atomically with the write.
   */
  saveRefreshedTokens(
    session: BrowserSession,
    expected: Tokens,
    next: Tokens,
  ): Promise<boolean>;

  rotateSession(oldId: string, tokens: Tokens): MaybePromise<BrowserSession>;
  deleteSession(id: string): MaybePromise<void>;
  savePending(entry: PendingAuth): MaybePromise<void>;
  takePending(state: string): MaybePromise<PendingAuth | undefined>;
  isExpired(entry: PendingAuth): boolean;
  getClientId(redirectUri: string): MaybePromise<string | undefined>;
  setClientId(redirectUri: string, clientId: string): MaybePromise<void>;
  sweep(): MaybePromise<void>;

  /**
   * Runs work while holding the per-session refresh lock.
   * Implementations must bound acquisition time and release only their own lock.
   */
  withRefreshLock<T>(
    sessionId: string,
    work: (lock: RefreshLockContext) => Promise<T>,
  ): Promise<T>;
}
