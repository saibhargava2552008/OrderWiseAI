import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** PKCE verifier: 32 random bytes, base64url-encoded (as the Swiggy docs describe). */
export function createCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

/** PKCE challenge: SHA-256 of the verifier, base64url-encoded. The method is always S256. */
export function codeChallengeFor(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/** Unguessable URL-safe token, used for the OAuth `state` and for browser session ids. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
