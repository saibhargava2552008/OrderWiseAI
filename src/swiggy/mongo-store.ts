import { createHash, randomBytes } from "node:crypto";
import type { Collection, Db, Document } from "mongodb";
import { connectMongo } from "../db/mongodb.js";
import { decryptSecret, encryptSecret } from "../db/encryption.js";
import {
  PENDING_TTL_MS,
  SESSION_TTL_MS,
  type BrowserSession,
  type PendingAuth,
  type Tokens,
} from "./store.js";
import type { RefreshLockContext, SwiggyStoreAdapter } from "./store-adapter.js";

type SessionDocument = Document & {
  _id: string;
  lastSeen: number;
  expiresAt: Date;
  encryptedTokens?: string;
  verifiedAt?: number;
  lastVerifyAt?: number;
  refreshLockOwner?: string;
  refreshLockExpiresAt?: Date;
};

type PendingDocument = Document & {
  _id: string;
  encryptedVerifier: string;
  sessionId: string;
  clientId: string;
  createdAt: number;
  expiresAt: Date;
};

type ClientDocument = Document & {
  _id: string;
  redirectUri: string;
  clientId: string;
};

type RefreshLockDocument = Document & {
  _id: string;
  owner: string;
  leaseExpiresAt: Date;
};

const REFRESH_LOCK_LEASE_MS = 30_000;
const REFRESH_LOCK_WAIT_MS = 15_000;
const REFRESH_LOCK_RENEW_MS = 8_000;
const REFRESH_LOCK_POLL_MS = 100;

export class MongoSwiggyStore implements SwiggyStoreAdapter {
  private constructor(private readonly db: Db) {}

  static async create(db?: Db): Promise<MongoSwiggyStore> {
    const database = db ?? await connectMongo();
    const store = new MongoSwiggyStore(database);

    await Promise.all([
      database.collection<SessionDocument>("swiggy_sessions")
        .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      database.collection<PendingDocument>("swiggy_pending_auth")
        .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      database.collection<ClientDocument>("swiggy_clients")
        .createIndex({ redirectUri: 1 }, { unique: true }),
    ]);

    return store;
  }

  private sessions(): Collection<SessionDocument> {
    return this.db.collection<SessionDocument>("swiggy_sessions");
  }

  private pending(): Collection<PendingDocument> {
    return this.db.collection<PendingDocument>("swiggy_pending_auth");
  }

  private clients(): Collection<ClientDocument> {
    return this.db.collection<ClientDocument>("swiggy_clients");
  }

  private refreshLocks(): Collection<RefreshLockDocument> {
    return this.db.collection<RefreshLockDocument>("swiggy_refresh_locks");
  }

  async createSession(): Promise<BrowserSession> {
    const session: BrowserSession = {
      id: randomSessionId(),
      lastSeen: Date.now(),
    };

    await this.sessions().insertOne({
      _id: session.id,
      lastSeen: session.lastSeen,
      expiresAt: new Date(session.lastSeen + SESSION_TTL_MS),
    });

    return session;
  }

  async getSession(id: string | undefined): Promise<BrowserSession | undefined> {
    if (!id) return undefined;

    const now = Date.now();
    const doc = await this.sessions().findOneAndUpdate(
      { _id: id, expiresAt: { $gt: new Date(now) } },
      {
        $set: {
          lastSeen: now,
          expiresAt: new Date(now + SESSION_TTL_MS),
        },
      },
      { returnDocument: "after" },
    );

    if (!doc) return undefined;

    const session: BrowserSession = {
      id: doc._id,
      lastSeen: doc.lastSeen,
      verifiedAt: doc.verifiedAt,
      lastVerifyAt: doc.lastVerifyAt,
    };

    if (doc.encryptedTokens) {
      session.tokens = JSON.parse(
        decryptSecret(doc.encryptedTokens),
      ) as Tokens;
    }

    return session;
  }

  async saveSession(session: BrowserSession): Promise<void> {
    const $set: Document = {
      lastSeen: session.lastSeen,
      expiresAt: new Date(session.lastSeen + SESSION_TTL_MS),
    };
    const $unset: Document = {};

    if (session.tokens) {
      $set.encryptedTokens = encryptSecret(JSON.stringify(session.tokens));
    } else {
      $unset.encryptedTokens = "";
    }

    if (session.verifiedAt === undefined) {
      $unset.verifiedAt = "";
    } else {
      $set.verifiedAt = session.verifiedAt;
    }

    if (session.lastVerifyAt === undefined) {
      $unset.lastVerifyAt = "";
    } else {
      $set.lastVerifyAt = session.lastVerifyAt;
    }

    const update: Document = { $set };
    if (Object.keys($unset).length) update.$unset = $unset;

    const result = await this.sessions().updateOne(
      { _id: session.id },
      update,
    );

    if (result.matchedCount !== 1) {
      throw new Error("Swiggy session no longer exists; refusing to recreate it.");
    }
  }

  /**
   * Updates verification metadata without modifying encrypted tokens.
   */
  async updateVerificationMetadata(
    id: string,
    metadata: { verifiedAt?: number; lastVerifyAt?: number },
  ): Promise<void> {
    const $set: Document = {};
    const $unset: Document = {};

    if (metadata.verifiedAt !== undefined) {
      $set.verifiedAt = metadata.verifiedAt;
    } else {
      $unset.verifiedAt = "";
    }

    if (metadata.lastVerifyAt !== undefined) {
      $set.lastVerifyAt = metadata.lastVerifyAt;
    } else {
      $unset.lastVerifyAt = "";
    }

    const update: Document = {};
    if (Object.keys($set).length) update.$set = $set;
    if (Object.keys($unset).length) update.$unset = $unset;

    const result = await this.sessions().updateOne({ _id: id }, update);
    if (result.matchedCount !== 1) {
      throw new Error("Swiggy session no longer exists.");
    }
  }

  /**
   * Clears tokens only when the stored credentials still match the expected pair.
   */
  async clearTokensIfMatch(id: string, expected: Tokens): Promise<boolean> {
    const sessions = this.sessions();
    const existing = await sessions.findOne(
      { _id: id },
      { projection: { encryptedTokens: 1 } },
    );

    if (typeof existing?.encryptedTokens !== "string") return false;

    let stored: Tokens;
    try {
      stored = JSON.parse(decryptSecret(existing.encryptedTokens)) as Tokens;
    } catch {
      throw new Error("Could not verify stored Swiggy tokens.");
    }

    if (
      stored.accessToken !== expected.accessToken ||
      stored.refreshToken !== expected.refreshToken
    ) {
      return false;
    }

    const result = await sessions.updateOne(
      { _id: id, encryptedTokens: existing.encryptedTokens },
      { $unset: { encryptedTokens: "", verifiedAt: "" } },
    );

    return result.matchedCount === 1;
  }

  /**
   * Atomically saves refreshed tokens only if the stored token snapshot
   * still matches the credentials observed before the refresh request.
   */
  async saveRefreshedTokens(
    session: BrowserSession,
    expected: Tokens,
    next: Tokens,
    lockOwner?: string,
  ): Promise<boolean> {
    const sessions = this.sessions();
    const existing = await sessions.findOne(
      { _id: session.id },
      { projection: { encryptedTokens: 1 } },
    );

    if (typeof existing?.encryptedTokens !== "string") return false;

    let stored: Tokens;
    try {
      stored = JSON.parse(
        decryptSecret(existing.encryptedTokens),
      ) as Tokens;
    } catch {
      throw new Error("Could not verify stored Swiggy tokens.");
    }

    if (
      stored.accessToken !== expected.accessToken ||
      stored.refreshToken !== expected.refreshToken
    ) return false;

    const now = new Date();
    const filter: Document = {
      _id: session.id,
      encryptedTokens: existing.encryptedTokens,
    };
    const update: Document = {
      $set: {
        encryptedTokens: encryptSecret(JSON.stringify(next)),
        lastSeen: now.getTime(),
        expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
      },
    };

    // Critical: ownership and lease validity are checked by the same
    // atomic MongoDB update that writes the new token snapshot.
    if (lockOwner !== undefined) {
      filter.refreshLockOwner = lockOwner;
      filter.refreshLockExpiresAt = { $gt: now };
      (update.$set as Document).refreshLockExpiresAt =
        new Date(now.getTime() + REFRESH_LOCK_LEASE_MS);
    }

    const result = await sessions.updateOne(filter, update);
    return result.matchedCount === 1;
  }

  async rotateSession(oldId: string, tokens: Tokens): Promise<BrowserSession> {
    const fresh = await this.createSession();

    try {
      fresh.tokens = tokens;
      await this.saveSession(fresh);
    } catch (error) {
      await this.deleteSession(fresh.id).catch(() => undefined);
      throw error;
    }

    await this.deleteSession(oldId);
    return fresh;
  }

  async deleteSession(id: string): Promise<void> {
    await this.sessions().deleteOne({ _id: id });
  }

  async savePending(entry: PendingAuth): Promise<void> {
    const expiresAt = new Date(entry.createdAt + PENDING_TTL_MS);

    await this.pending().insertOne({
      _id: entry.state,
      encryptedVerifier: encryptSecret(entry.verifier),
      sessionId: entry.sessionId,
      clientId: entry.clientId,
      createdAt: entry.createdAt,
      expiresAt,
    });
  }

  async takePending(state: string): Promise<PendingAuth | undefined> {
    const doc = await this.pending().findOneAndDelete({
      _id: state,
      expiresAt: { $gt: new Date() },
    });

    if (!doc) return undefined;

    return {
      state: doc._id,
      verifier: decryptSecret(doc.encryptedVerifier),
      sessionId: doc.sessionId,
      clientId: doc.clientId,
      createdAt: doc.createdAt,
    };
  }

  isExpired(entry: PendingAuth): boolean {
    return Date.now() - entry.createdAt > PENDING_TTL_MS;
  }

  async getClientId(redirectUri: string): Promise<string | undefined> {
    const doc = await this.clients().findOne({
      _id: clientKey(redirectUri),
      redirectUri,
    });

    return doc?.clientId;
  }

  async setClientId(redirectUri: string, clientId: string): Promise<void> {
    await this.clients().updateOne(
      { _id: clientKey(redirectUri) },
      { $set: { redirectUri, clientId } },
      { upsert: true },
    );
  }

  /**
   * Acquires a per-session MongoDB lease. The owner token prevents one
   * process from renewing or releasing another process's lock.
   */
  /**
   * Acquires a per-session lease stored on the session document.
   * Token writes check this owner and the unexpired lease atomically.
   */
  async withRefreshLock<T>(
    sessionId: string,
    work: (lock: RefreshLockContext) => Promise<T>,
  ): Promise<T> {
    const sessions = this.sessions();
    const owner = randomBytes(24).toString("base64url");
    const deadline = Date.now() + REFRESH_LOCK_WAIT_MS;
    let acquired = false;

    while (!acquired) {
      const now = new Date();
      const claimed = await sessions.updateOne(
        {
          _id: sessionId,
          expiresAt: { $gt: now },
          $or: [
            { refreshLockExpiresAt: { $exists: false } },
            { refreshLockExpiresAt: { $lte: now } },
          ],
        },
        {
          $set: {
            refreshLockOwner: owner,
            refreshLockExpiresAt: new Date(now.getTime() + REFRESH_LOCK_LEASE_MS),
          },
        },
      );

      if (claimed.matchedCount === 1) {
        acquired = true;
        break;
      }

      if (Date.now() >= deadline) {
        throw new Error("Timed out waiting for Swiggy refresh lock.");
      }

      await new Promise<void>((resolve) =>
        setTimeout(resolve, REFRESH_LOCK_POLL_MS),
      );
    }

    let lost = false;
    let renewalInProgress = false;

    const assertOwnership = async (): Promise<void> => {
      if (lost) throw new Error("Swiggy refresh lock ownership was lost.");

      const now = new Date();
      const result = await sessions.updateOne(
        {
          _id: sessionId,
          refreshLockOwner: owner,
          refreshLockExpiresAt: { $gt: now },
          expiresAt: { $gt: now },
        },
        {
          $set: {
            refreshLockExpiresAt: new Date(now.getTime() + REFRESH_LOCK_LEASE_MS),
          },
        },
      );

      if (result.matchedCount !== 1) {
        lost = true;
        throw new Error("Swiggy refresh lock ownership was lost.");
      }
    };

    const lock: RefreshLockContext = {
      assertOwnership,
      saveRefreshedTokens: async (session, expected, next) => {
        await assertOwnership();
        return this.saveRefreshedTokens(session, expected, next, owner);
      },
    };

    const heartbeat = setInterval(() => {
      if (renewalInProgress || lost) return;
      renewalInProgress = true;
      void assertOwnership()
        .catch(() => { lost = true; })
        .finally(() => { renewalInProgress = false; });
    }, REFRESH_LOCK_RENEW_MS);
    heartbeat.unref?.();

    try {
      await assertOwnership();
      return await work(lock);
    } finally {
      clearInterval(heartbeat);
      await sessions.updateOne(
        { _id: sessionId, refreshLockOwner: owner },
        { $unset: { refreshLockOwner: "", refreshLockExpiresAt: "" } },
      ).catch(() => undefined);
    }
  }

  async sweep(): Promise<void> {
    const now = new Date();

    await Promise.all([
      this.sessions().deleteMany({ expiresAt: { $lte: now } }),
      this.pending().deleteMany({ expiresAt: { $lte: now } }),
      this.refreshLocks().deleteMany({ leaseExpiresAt: { $lte: now } }),
    ]);
  }
}

function randomSessionId(): string {
  return randomBytes(32).toString("base64url");
}

function clientKey(redirectUri: string): string {
  return createHash("sha256").update(redirectUri).digest("hex");
}
