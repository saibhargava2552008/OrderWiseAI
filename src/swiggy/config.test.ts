import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CALLBACK_PATH, loadSwiggyConfig } from "./config.js";
import { codeChallengeFor, createCodeVerifier, randomToken, safeEqual } from "./pkce.js";

describe("loadSwiggyConfig", () => {
  it("builds the exact production redirect URI for the Render service", () => {
    const c = loadSwiggyConfig({ APP_BASE_URL: "https://orderwiseai.onrender.com" });
    assert.ok(c.enabled);
    assert.equal(c.redirectUri, "https://orderwiseai.onrender.com/auth/swiggy/callback");
    assert.equal(CALLBACK_PATH, "/auth/swiggy/callback");
    assert.equal(c.swiggyOrigin, "https://mcp.swiggy.com");
    assert.equal(c.foodMcpUrl, "https://mcp.swiggy.com/food");
    assert.equal(c.scope, "mcp:tools");
    assert.equal(c.secureCookies, true);
  });

  it("removes a trailing slash so the redirect URI never has a double slash", () => {
    const c = loadSwiggyConfig({ APP_BASE_URL: "https://orderwiseai.onrender.com/" });
    assert.ok(c.enabled);
    assert.equal(c.redirectUri, "https://orderwiseai.onrender.com/auth/swiggy/callback");
  });

  it("allows http only for localhost, as the Swiggy docs do", () => {
    const local = loadSwiggyConfig({ APP_BASE_URL: "http://localhost:3000" });
    assert.ok(local.enabled);
    assert.equal(local.redirectUri, "http://localhost:3000/auth/swiggy/callback");
    assert.equal(local.secureCookies, false);
  });

  for (const [label, value] of [
    ["plain http on a public host", "http://orderwiseai.onrender.com"],
    ["http on 127.0.0.1 (docs allow only http://localhost)", "http://127.0.0.1:3000"],
    ["a path", "https://orderwiseai.onrender.com/app"],
    ["a query string", "https://orderwiseai.onrender.com/?a=1"],
    ["a fragment", "https://orderwiseai.onrender.com/#x"],
    ["embedded credentials", "https://user:pass@orderwiseai.onrender.com"],
    ["a non-URL", "orderwiseai.onrender.com"],
    ["a custom scheme", "myapp://callback"],
  ] as const) {
    it(`disables the integration for APP_BASE_URL with ${label}`, () => {
      const c = loadSwiggyConfig({ APP_BASE_URL: value });
      assert.equal(c.enabled, false);
    });
  }

  it("is disabled, not crashing, when APP_BASE_URL is missing or blank", () => {
    assert.deepEqual(loadSwiggyConfig({}), { enabled: false, reason: "APP_BASE_URL is not set" });
    assert.equal(loadSwiggyConfig({ APP_BASE_URL: "   " }).enabled, false);
  });

  it("rejects an unsafe Swiggy base URL and odd scope or client id values, without echoing them", () => {
    const base = { APP_BASE_URL: "https://orderwiseai.onrender.com" };
    assert.equal(loadSwiggyConfig({ ...base, SWIGGY_AUTH_BASE_URL: "http://mcp.swiggy.com" }).enabled, false);
    const badScope = loadSwiggyConfig({ ...base, SWIGGY_SCOPE: "mcp:tools&admin=1" });
    assert.equal(badScope.enabled, false);
    const badClient = loadSwiggyConfig({ ...base, SWIGGY_CLIENT_ID: "abc def<script>" });
    assert.equal(badClient.enabled, false);
    assert.ok(!JSON.stringify(badClient).includes("script"));
  });

  it("accepts a pre-registered client id", () => {
    const c = loadSwiggyConfig({ APP_BASE_URL: "https://orderwiseai.onrender.com", SWIGGY_CLIENT_ID: "client-123" });
    assert.ok(c.enabled);
    assert.equal(c.clientId, "client-123");
  });
});

describe("PKCE", () => {
  it("matches the S256 test vector from RFC 7636 appendix B", () => {
    assert.equal(
      codeChallengeFor("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });

  it("creates a verifier from 32 random bytes, base64url without padding", () => {
    const v = createCodeVerifier();
    assert.match(v, /^[A-Za-z0-9_-]{43}$/);
    assert.notEqual(v, createCodeVerifier());
  });

  it("creates unique, URL-safe random tokens", () => {
    const seen = new Set(Array.from({ length: 200 }, () => randomToken()));
    assert.equal(seen.size, 200);
    for (const t of seen) assert.match(t, /^[A-Za-z0-9_-]{43}$/);
  });

  it("compares strings safely", () => {
    assert.equal(safeEqual("abc", "abc"), true);
    assert.equal(safeEqual("abc", "abd"), false);
    assert.equal(safeEqual("abc", "abcd"), false);
  });
});
