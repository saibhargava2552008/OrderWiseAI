
import "dotenv/config";

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { MongoClient, type Db } from "mongodb";

import {
  MongoGroupSessionStore,
  DuplicateMemberNameError,
} from "../db/group-sessions.js";
import { MongoSwiggyStore } from "./mongo-store.js";
import type { PendingAuth, Tokens } from "./store.js";

const integrationEnabled =
  process.env.RUN_MONGO_INTEGRATION_TESTS === "1";

describe(
  "MongoDB integration",
  { skip: !integrationEnabled },
  () => {
    let client: MongoClient | undefined;
    let db: Db | undefined;

    before(async () => {
      const uri = process.env.MONGODB_URI?.trim();
      const encryptionKey =
        process.env.TOKEN_ENCRYPTION_KEY?.trim();

      assert.ok(
        uri,
        "MONGODB_URI must be configured for integration tests",
      );
      assert.ok(
        encryptionKey,
        "TOKEN_ENCRYPTION_KEY must be configured for integration tests",
      );

      client = new MongoClient(uri, {
        serverSelectionTimeoutMS: 10_000,
        appName: "OrderWiseAI-Test",
      });

      await client.connect();

      // Create a short, unique test database name.
      // Never use the configured application database.
      db = client.db(
        `owtest_${process.pid}_${randomBytes(4).toString("hex")}`,
      );

      await db.command({ ping: 1 });
    });

    after(async () => {
      try {
        if (db) {
          await db.dropDatabase();
        }
      } finally {
        if (client) {
          await client.close();
        }
      }
    });

    it("persists group sessions and atomically rejects concurrent duplicate names", async () => {
      assert.ok(db);

      const store = new MongoGroupSessionStore(db);

      const created = await store.create({
        title: "Integration Test",
        location: "Surampalem",
        budget: 1500,
        memberName: "Owner",
        spendingLimit: 1000,
      });

      // A separate store instance reads the persisted record.
      const anotherStore = new MongoGroupSessionStore(db);
      const loaded = await anotherStore.get(created.code);

      assert.ok(loaded);
      assert.equal(loaded.title, "Integration Test");
      assert.equal(loaded.members[0]?.name, "Owner");

      const duplicateResults = await Promise.allSettled([
        store.join(created.code, "Alex"),
        anotherStore.join(created.code, " alex "),
      ]);

      assert.equal(
        duplicateResults.filter(
          (result) => result.status === "fulfilled",
        ).length,
        1,
        "only one concurrent join with the same normalized name should succeed",
      );

      const rejected = duplicateResults.filter(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      );

      assert.equal(rejected.length, 1);
      assert.ok(
        rejected[0]?.reason instanceof DuplicateMemberNameError,
      );

      const differentResults = await Promise.allSettled([
        store.join(created.code, "Priya"),
        anotherStore.join(created.code, "Ravi"),
      ]);

      assert.equal(
        differentResults.filter(
          (result) => result.status === "fulfilled",
        ).length,
        2,
        "different names should be allowed to join concurrently",
      );

      const finalSession = await store.get(created.code);
      assert.equal(finalSession?.members.length, 4);

      const raw = await db
        .collection<{
          _id: string;
          members: Array<Record<string, unknown>>;
        }>("group_sessions")
        .findOne({ _id: created.code });

      assert.ok(raw);

      assert.ok(
        raw.members.every(
          (member) => typeof member.nameKey === "string",
        ),
        "normalized name keys should be stored in MongoDB",
      );

      assert.ok(
        finalSession?.members.every(
          (member) => !("nameKey" in member),
        ),
        "internal name keys must not appear in public sessions",
      );
    });

    it("stores Swiggy tokens encrypted and restores them from MongoDB", async () => {
      assert.ok(db);

      const store = await MongoSwiggyStore.create(db);
      const oldSession = await store.createSession();

      const tokens: Tokens = {
        accessToken: "integration-access-token",
        refreshToken: "integration-refresh-token",
        expiresAt: Date.now() + 60_000,
        scope: "addresses",
      };

      const freshSession = await store.rotateSession(
        oldSession.id,
        tokens,
      );

      assert.notEqual(freshSession.id, oldSession.id);
      assert.equal(
        await store.getSession(oldSession.id),
        undefined,
      );

      const raw = await db
        .collection<{
          _id: string;
          encryptedTokens: string;
        }>("swiggy_sessions")
        .findOne({ _id: freshSession.id });

      assert.ok(raw);
      assert.equal(typeof raw.encryptedTokens, "string");

      assert.ok(
        !raw.encryptedTokens.includes(tokens.accessToken),
      );
      assert.ok(
        !raw.encryptedTokens.includes(tokens.refreshToken ?? ""),
      );

      // A separate store instance must decrypt persisted credentials.
      const anotherStore = await MongoSwiggyStore.create(db);
      const restored = await anotherStore.getSession(
        freshSession.id,
      );

      assert.deepEqual(restored?.tokens, tokens);
    });

    it("allows only one concurrent refresh to save tokens from the same old snapshot", async () => {
      assert.ok(db);

      const store = await MongoSwiggyStore.create(db);
      const session = await store.createSession();

      const original: Tokens = {
        accessToken: "cas-original-access",
        refreshToken: "cas-original-refresh",
        expiresAt: Date.now() + 60_000,
        scope: "addresses",
      };

      session.tokens = original;
      await store.saveSession(session);

      const nextA: Tokens = {
        accessToken: "cas-next-access-a",
        refreshToken: "cas-next-refresh-a",
        expiresAt: Date.now() + 120_000,
        scope: "addresses",
      };

      const nextB: Tokens = {
        accessToken: "cas-next-access-b",
        refreshToken: "cas-next-refresh-b",
        expiresAt: Date.now() + 120_000,
        scope: "addresses",
      };

      const [savedA, savedB] = await Promise.all([
        store.saveRefreshedTokens(session, original, nextA),
        store.saveRefreshedTokens(session, original, nextB),
      ]);

      assert.equal(
        Number(savedA) + Number(savedB),
        1,
        "exactly one concurrent writer should save the refreshed token pair",
      );

      const restored = await store.getSession(session.id);

      assert.ok(restored?.tokens);
      assert.deepEqual(restored.tokens, savedA ? nextA : nextB);
    });
    it("updates verification metadata without overwriting tokens", async () => {
      assert.ok(db);

      const store = await MongoSwiggyStore.create(db);
      const session = await store.createSession();

      const tokens: Tokens = {
        accessToken: "metadata-access-token",
        refreshToken: "metadata-refresh-token",
        expiresAt: Date.now() + 60_000,
        scope: "addresses",
      };

      session.tokens = tokens;
      await store.saveSession(session);

      await store.updateVerificationMetadata(session.id, {
        verifiedAt: 12345,
        lastVerifyAt: 12300,
      });

      const restored = await store.getSession(session.id);

      assert.deepEqual(restored?.tokens, tokens);
      assert.equal(restored?.verifiedAt, 12345);
      assert.equal(restored?.lastVerifyAt, 12300);
    });

    it("does not clear newer tokens when given a stale snapshot", async () => {
      assert.ok(db);

      const store = await MongoSwiggyStore.create(db);
      const session = await store.createSession();

      const original: Tokens = {
        accessToken: "stale-access-token",
        refreshToken: "stale-refresh-token",
        expiresAt: Date.now() + 60_000,
        scope: "addresses",
      };

      const newer: Tokens = {
        accessToken: "new-access-token",
        refreshToken: "new-refresh-token",
        expiresAt: Date.now() + 120_000,
        scope: "addresses",
      };

      session.tokens = original;
      await store.saveSession(session);

      const saved = await store.saveRefreshedTokens(
        session,
        original,
        newer,
      );
      assert.equal(saved, true);

      const cleared = await store.clearTokensIfMatch(
        session.id,
        original,
      );

      assert.equal(cleared, false);

      const restored = await store.getSession(session.id);
      assert.deepEqual(restored?.tokens, newer);
    });
    it("serializes refresh work across separate MongoDB store instances", async () => {
      assert.ok(db);

      const storeA = await MongoSwiggyStore.create(db);
      const storeB = await MongoSwiggyStore.create(db);
      const session = await storeA.createSession();

      let releaseFirst!: () => void;
      let signalFirstEntered!: () => void;

      const firstGate = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });

      const firstEntered = new Promise<void>((resolve) => {
        signalFirstEntered = resolve;
      });

      let active = 0;
      let maxActive = 0;
      let secondEntered = false;

      const first = storeA.withRefreshLock(
        session.id,
        async (lock) => {
          active++;
          maxActive = Math.max(maxActive, active);
          signalFirstEntered();

          try {
            await firstGate;
            await lock.assertOwnership();
          } finally {
            active--;
          }
        },
      );

      let second: Promise<void> | undefined;

      try {
        await firstEntered;

        second = storeB.withRefreshLock(
          session.id,
          async (lock) => {
            secondEntered = true;
            active++;
            maxActive = Math.max(maxActive, active);

            try {
              await lock.assertOwnership();
            } finally {
              active--;
            }
          },
        );

        await new Promise((resolve) => setTimeout(resolve, 300));

        assert.equal(
          secondEntered,
          false,
          "the second store must wait while the first owns the lock",
        );
      } finally {
        releaseFirst();
      }

      await first;
      await second;

      assert.equal(secondEntered, true);
      assert.equal(
        maxActive,
        1,
        "refresh work must never overlap for the same session",
      );
    });
    it("allows an OAuth pending state to be consumed only once", async () => {
      assert.ok(db);

      const store = await MongoSwiggyStore.create(db);

      const entry: PendingAuth = {
        state: `test-state-${randomBytes(12).toString("hex")}`,
        verifier: `test-verifier-${randomBytes(32).toString("base64url")}`,
        sessionId: "integration-session",
        clientId: "integration-client",
        createdAt: Date.now(),
      };

      await store.savePending(entry);

      const raw = await db
        .collection<{
          _id: string;
          encryptedVerifier: string;
        }>("swiggy_pending_auth")
        .findOne({ _id: entry.state });

      assert.ok(raw);
      assert.equal(typeof raw.encryptedVerifier, "string");

      assert.ok(
        !raw.encryptedVerifier.includes(entry.verifier),
      );

      const results = await Promise.all([
        store.takePending(entry.state),
        store.takePending(entry.state),
      ]);

      assert.equal(
        results.filter((result) => result !== undefined).length,
        1,
        "exactly one concurrent consumer should receive the pending state",
      );

      const consumed = results.find(
        (result) => result !== undefined,
      );

      assert.equal(consumed?.verifier, entry.verifier);
      assert.equal(consumed?.sessionId, entry.sessionId);
      assert.equal(consumed?.clientId, entry.clientId);
    });

    it("persists and updates the registered Swiggy client ID", async () => {
      assert.ok(db);

      const store = await MongoSwiggyStore.create(db);
      const redirectUri =
        "https://example.invalid/api/swiggy/callback";

      assert.equal(
        await store.getClientId(redirectUri),
        undefined,
      );

      await store.setClientId(
        redirectUri,
        "integration-client-1",
      );

      assert.equal(
        await store.getClientId(redirectUri),
        "integration-client-1",
      );

      const anotherStore = await MongoSwiggyStore.create(db);

      assert.equal(
        await anotherStore.getClientId(redirectUri),
        "integration-client-1",
      );

      await anotherStore.setClientId(
        redirectUri,
        "integration-client-2",
      );

      assert.equal(
        await store.getClientId(redirectUri),
        "integration-client-2",
      );
    });
  },
);
