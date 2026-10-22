
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function getEncryptionKey(): Buffer {
  const encoded = process.env.TOKEN_ENCRYPTION_KEY?.trim();

  if (!encoded) {
    throw new Error("TOKEN_ENCRYPTION_KEY is not configured.");
  }

  const key = Buffer.from(encoded, "base64");

  if (
    key.length !== 32 ||
    key.toString("base64") !== encoded
  ) {
    throw new Error("TOKEN_ENCRYPTION_KEY must be a valid base64-encoded 32-byte key.");
  }

  return key;
}

export function encryptSecret(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  return [
    "v1",
    iv.toString("base64"),
    authTag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

export function decryptSecret(encrypted: string): string {
  const parts = encrypted.split(":");

  if (parts.length !== 4 || parts[0] !== "v1") {
    throw new Error("Unsupported encrypted secret format.");
  }

  const [, encodedIv, encodedTag, encodedCiphertext] = parts;

  const iv = Buffer.from(encodedIv, "base64");
  const authTag = Buffer.from(encodedTag, "base64");
  const ciphertext = Buffer.from(encodedCiphertext, "base64");

  if (iv.length !== IV_LENGTH || authTag.length !== AUTH_TAG_LENGTH) {
    throw new Error("Invalid encrypted secret.");
  }

  const key = getEncryptionKey();
  const decipher = createDecipheriv(ALGORITHM, key, iv);

  decipher.setAuthTag(authTag);

  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
}
