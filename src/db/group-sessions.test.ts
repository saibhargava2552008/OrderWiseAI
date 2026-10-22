
import test from "node:test";
import assert from "node:assert/strict";
import {
  DuplicateMemberNameError,
  GroupSessionNotFoundError,
  MemoryGroupSessionStore,
} from "./group-sessions.js";

test("creates a group with a normalized title and initial member", async () => {
  const store = new MemoryGroupSessionStore();

  const session = await store.create({
    title: "  Dinner Plan  ",
    location: "  Surampalem  ",
    budget: 1000,
    memberName: "  Sai  ",
    spendingLimit: 500,
  });

  assert.equal(session.title, "Dinner Plan");
  assert.equal(session.location, "Surampalem");
  assert.equal(session.budget, 1000);
  assert.equal(session.members.length, 1);
  assert.equal(session.members[0].name, "Sai");
  assert.equal(session.members[0].spendingLimit, 500);
  assert.match(session.code, /^[A-F0-9]{6}$/);
});

test("joins a group using a case-insensitive session code", async () => {
  const store = new MemoryGroupSessionStore();
  const created = await store.create({
    title: "Dinner",
    location: "Surampalem",
    budget: 1000,
    memberName: "Sai",
    spendingLimit: 500,
  });

  const result = await store.join(created.code.toLowerCase(), "Bhargava");

  assert.equal(result.session.members.length, 2);
  assert.equal(result.member.name, "Bhargava");
  assert.equal(result.member.spendingLimit, 1000);
});

test("rejects duplicate member names regardless of letter case", async () => {
  const store = new MemoryGroupSessionStore();
  const created = await store.create({
    title: "Dinner",
    location: "Surampalem",
    budget: 1000,
    memberName: "Sai",
    spendingLimit: 500,
  });

  await assert.rejects(
    store.join(created.code, "  sAI  "),
    DuplicateMemberNameError,
  );
});

test("returns undefined when a group does not exist", async () => {
  const store = new MemoryGroupSessionStore();

  assert.equal(await store.get("ABC123"), undefined);
});

test("throws a not-found error when joining a missing group", async () => {
  const store = new MemoryGroupSessionStore();

  await assert.rejects(
    store.join("ABC123", "Bhargava"),
    GroupSessionNotFoundError,
  );
});

test("retrieves a group with its joined members", async () => {
  const store = new MemoryGroupSessionStore();
  const created = await store.create({
    title: "Dinner",
    location: "Surampalem",
    budget: 1000,
    memberName: "Sai",
    spendingLimit: 500,
  });

  await store.join(created.code, "Bhargava");

  const loaded = await store.get(created.code);

  assert.equal(loaded?.members.length, 2);
  assert.deepEqual(
    loaded?.members.map((member) => member.name),
    ["Sai", "Bhargava"],
  );
});
