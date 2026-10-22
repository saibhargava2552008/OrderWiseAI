import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SwiggyStore } from "./store.js";

describe("SwiggyStore refresh lock", () => {
  it("serializes concurrent refresh work for the same session", async () => {
    const store = new SwiggyStore();
    let releaseFirst!: () => void;
    let firstStarted!: () => void;

    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const started = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });

    let active = 0;
    let maxActive = 0;
    let secondStarted = false;

    const first = store.withRefreshLock("session-1", async (lock) => {
      active++;
      maxActive = Math.max(maxActive, active);
      firstStarted();

      try {
        await firstGate;
        await lock.assertOwnership();
      } finally {
        active--;
      }
    });

    await started;

    const second = store.withRefreshLock("session-1", async (lock) => {
      secondStarted = true;
      active++;
      maxActive = Math.max(maxActive, active);

      try {
        await lock.assertOwnership();
      } finally {
        active--;
      }
    });

    // Let the second request attempt to enter the lock.
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(secondStarted, false, "second refresh must wait for the first");

    releaseFirst();
    await Promise.all([first, second]);

    assert.equal(secondStarted, true);
    assert.equal(maxActive, 1, "refresh work must never overlap for one session");
  });

  it("allows refresh work for different sessions to run concurrently", async () => {
    const store = new SwiggyStore();
    let releaseFirst!: () => void;
    let firstStarted!: () => void;

    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const started = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });

    const first = store.withRefreshLock("session-A", async () => {
      firstStarted();
      await firstGate;
    });

    await started;

    let secondEntered = false;
    const second = store.withRefreshLock("session-B", async () => {
      secondEntered = true;
    });

    await second;
    assert.equal(secondEntered, true, "different sessions should not block each other");

    releaseFirst();
    await first;
  });
});
