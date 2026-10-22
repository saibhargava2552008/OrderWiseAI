
import { test } from "node:test";
import assert from "node:assert/strict";
import { encryptSecret, decryptSecret } from "./encryption.js";

test("encryptSecret and decryptSecret round-trip correctly", () => {
  const originalKey = process.env.TOKEN_ENCRYPTION_KEY;
  process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

  try {
    const secret = "test-access-token-123";
    const encrypted = encryptSecret(secret);

    assert.notEqual(encrypted, secret);
    assert.equal(decryptSecret(encrypted), secret);
  } finally {
    if (originalKey === undefined) {
      delete process.env.TOKEN_ENCRYPTION_KEY;
    } else {
      process.env.TOKEN_ENCRYPTION_KEY = originalKey;
    }
  }
});

test("encryptSecret uses a different IV each time", () => {
  const originalKey = process.env.TOKEN_ENCRYPTION_KEY;
  process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

  try {
    const first = encryptSecret("same-secret");
    const second = encryptSecret("same-secret");

    assert.notEqual(first, second);
    assert.equal(decryptSecret(first), "same-secret");
    assert.equal(decryptSecret(second), "same-secret");
  } finally {
    if (originalKey === undefined) {
      delete process.env.TOKEN_ENCRYPTION_KEY;
    } else {
      process.env.TOKEN_ENCRYPTION_KEY = originalKey;
    }
  }
});

test("decryptSecret rejects tampered ciphertext", () => {
  const originalKey = process.env.TOKEN_ENCRYPTION_KEY;
  process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

  try {
    const encrypted = encryptSecret("secret");
    const parts = encrypted.split(":");
    parts[3] = Buffer.from("tampered-data").toString("base64");

    assert.throws(() => decryptSecret(parts.join(":")));
  } finally {
    if (originalKey === undefined) {
      delete process.env.TOKEN_ENCRYPTION_KEY;
    } else {
      process.env.TOKEN_ENCRYPTION_KEY = originalKey;
    }
  }
});
