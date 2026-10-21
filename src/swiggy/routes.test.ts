import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, it } from "node:test";
import { SwiggyAuthError } from "./oauth.js";
import {
  APP_ORIGIN,
  Browser,
  FakeSwiggy,
  REDIRECT_URI,
  begin,
  callbackPath,
  startApp,
  type Harness,
} from "./test-helpers.js";

let swiggy: FakeSwiggy;
let app: Harness;
let browser: Browser;

beforeEach(async () => {
  swiggy = new FakeSwiggy();
  await swiggy.start();
  app = await startApp(swiggy);
  browser = new Browser(app.url);
});

afterEach(async () => {
  await app.close();
  await swiggy.stop();
});

/** Starts the flow and finishes it with a valid code, like a user who completed phone + OTP. */
async function signIn(b = browser) {
  const { state, params } = await begin(b);
  const res = await b.request(callbackPath({ code: "AUTH-CODE-1", state }));
  return { state, params, res };
}

function assertNoSecrets(label: string, haystack: string, secrets: string[]) {
  for (const s of secrets) assert.ok(!haystack.includes(s), `${label} leaked a secret value`);
}

describe("authorization request", () => {
  it("redirects to the documented authorize endpoint with exactly the documented parameters", async () => {
    const { res, url, params } = await begin(browser);
    assert.equal(res.status, 302);
    assert.equal(url.origin, swiggy.origin);
    assert.equal(url.pathname, "/auth/authorize");
    assert.deepEqual([...params.keys()].sort(), [
      "client_id",
      "code_challenge",
      "code_challenge_method",
      "redirect_uri",
      "response_type",
      "scope",
      "state",
    ]);
    assert.equal(params.get("response_type"), "code");
    assert.equal(params.get("client_id"), "test-client");
    assert.equal(params.get("redirect_uri"), REDIRECT_URI);
    assert.equal(params.get("code_challenge_method"), "S256");
    assert.equal(params.get("scope"), "mcp:tools");
    assert.match(params.get("state") ?? "", /^[A-Za-z0-9_-]{43}$/);
    assert.match(params.get("code_challenge") ?? "", /^[A-Za-z0-9_-]{43}$/);
    assert.equal(res.headers.get("cache-control"), "no-store");
  });

  it("sets a hardened session cookie", async () => {
    const { res } = await begin(browser);
    const cookie = res.setCookie.find((c) => c.startsWith("__Host-ow_sid="));
    assert.ok(cookie, "session cookie present");
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /Secure/);
    assert.match(cookie, /SameSite=Lax/);
    assert.match(cookie, /Path=\//);
    assert.doesNotMatch(cookie, /Domain=/i);
  });

  it("uses a different state and challenge every time", async () => {
    const a = await begin(browser);
    const b = await begin(browser);
    assert.notEqual(a.state, b.state);
    assert.notEqual(a.params.get("code_challenge"), b.params.get("code_challenge"));
  });

  it("registers the client once, with the exact redirect URI, and reuses it", async () => {
    await Promise.all([begin(new Browser(app.url)), begin(new Browser(app.url))]);
    await begin(browser);
    const calls = swiggy.calls("/auth/register");
    assert.equal(calls.length, 1);
    const body = calls[0].body as Record<string, unknown>;
    assert.deepEqual(body.redirect_uris, [REDIRECT_URI]);
    assert.equal(body.token_endpoint_auth_method, "none");
    assert.equal(calls[0].headers["content-type"], "application/json");
  });

  it("skips registration when SWIGGY_CLIENT_ID is configured", async () => {
    const other = await startApp(swiggy, {}, { SWIGGY_CLIENT_ID: "preregistered-1" });
    try {
      const { params } = await begin(new Browser(other.url));
      assert.equal(params.get("client_id"), "preregistered-1");
      assert.equal(swiggy.calls("/auth/register").length, 0);
    } finally {
      await other.close();
    }
  });

  it("sends the user back with a safe message when registration fails, and stores no pending state", async () => {
    swiggy.registerReply = () => ({ status: 400, body: { error: "invalid_redirect_uri", error_description: "secret-detail" } });
    const res = await browser.request("/auth/swiggy/start");
    assert.equal(res.status, 303);
    assert.equal(res.location, "/?swiggy=registration_failed");
    assert.ok(!res.text.includes("secret-detail") && !res.location.includes("secret-detail"));
    assert.ok(app.logs.some((l) => l.includes("swiggy_registration_failed")));
    assert.ok(!app.logs.join("").includes("secret-detail"));
  });
});

describe("callback success", () => {
  it("exchanges the code with the documented JSON body and a PKCE verifier that matches the challenge", async () => {
    const { params, res } = await signIn();
    assert.equal(res.status, 303);
    assert.equal(res.location, "/?swiggy=authorized");

    const [call] = swiggy.calls("/auth/token");
    assert.equal(call.headers["content-type"], "application/json");
    const body = call.body as Record<string, string>;
    assert.deepEqual(Object.keys(body).sort(), ["code", "code_verifier", "grant_type", "redirect_uri"]);
    assert.equal(body.grant_type, "authorization_code");
    assert.equal(body.code, "AUTH-CODE-1");
    assert.equal(body.redirect_uri, REDIRECT_URI);
    const challenge = createHash("sha256").update(body.code_verifier).digest("base64url");
    assert.equal(challenge, params.get("code_challenge"));
  });

  it("rotates the session id on sign-in and reports authorized but not verified", async () => {
    const { res: startRes } = await begin(browser);
    const before = browser.cookies.get("__Host-ow_sid");
    assert.ok(before);
    const state = new URL(startRes.location).searchParams.get("state") ?? "";
    await browser.request(callbackPath({ code: "c", state }));
    const after = browser.cookies.get("__Host-ow_sid");
    assert.ok(after && after !== before, "session id changed");
    assert.deepEqual(await browser.status(), { configured: true, authorized: true, verified: false });
  });

  it("never exposes tokens in responses, redirects or logs", async () => {
    const { res } = await signIn();
    const status = await browser.request("/api/swiggy/status");
    const secrets = ["AT-1", "RT-1", "AUTH-CODE-1"];
    assertNoSecrets("callback redirect", res.location + res.text, secrets);
    assertNoSecrets("status", status.text, secrets);
    assertNoSecrets("logs", app.logs.join("\n"), secrets);
    const verifier = (swiggy.calls("/auth/token")[0].body as Record<string, string>).code_verifier;
    assertNoSecrets("logs", app.logs.join("\n"), [verifier]);
    assert.deepEqual(Object.keys(JSON.parse(status.text)).sort(), ["authorized", "configured", "verified"]);
  });
});

describe("callback errors", () => {
  const exchangeCalls = () => swiggy.calls("/auth/token").length;

  it("rejects a callback with no parameters", async () => {
    const res = await browser.request("/auth/swiggy/callback");
    assert.equal(res.location, "/?swiggy=invalid_state");
    assert.equal(exchangeCalls(), 0);
  });

  it("rejects a callback with a state this server never issued", async () => {
    await begin(browser);
    const res = await browser.request(callbackPath({ code: "c", state: "forged-state-value" }));
    assert.equal(res.location, "/?swiggy=invalid_state");
    assert.equal(exchangeCalls(), 0);
    assert.equal((await browser.status()).authorized, false);
  });

  it("rejects a callback with a code but no state", async () => {
    await begin(browser);
    const res = await browser.request(callbackPath({ code: "c" }));
    assert.equal(res.location, "/?swiggy=invalid_state");
    assert.equal(exchangeCalls(), 0);
  });

  it("rejects duplicate state parameters", async () => {
    const { state } = await begin(browser);
    const res = await browser.request(`/auth/swiggy/callback?code=c&state=${state}&state=${state}`);
    assert.equal(res.location, "/?swiggy=invalid_state");
    assert.equal(exchangeCalls(), 0);
  });

  it("accepts a state only once, so a replayed callback fails", async () => {
    const { state } = await begin(browser);
    const first = await browser.request(callbackPath({ code: "c", state }));
    assert.equal(first.location, "/?swiggy=authorized");
    const replay = await browser.request(callbackPath({ code: "c", state }));
    assert.equal(replay.location, "/?swiggy=invalid_state");
    assert.equal(exchangeCalls(), 1);
  });

  it("rejects a valid state that arrives without the cookie of the browser that started the flow", async () => {
    const { state } = await begin(browser);
    const stranger = new Browser(app.url);
    const res = await stranger.request(callbackPath({ code: "c", state }));
    assert.equal(res.location, "/?swiggy=invalid_state");
    assert.equal(exchangeCalls(), 0);
    assert.equal((await stranger.status()).authorized, false);
    // The state was consumed by the failed attempt, so the real browser cannot finish with it either.
    const late = await browser.request(callbackPath({ code: "c", state }));
    assert.equal(late.location, "/?swiggy=invalid_state");
  });

  it("rejects a valid state presented with another browser's session cookie", async () => {
    const { state } = await begin(browser);
    const other = new Browser(app.url);
    await begin(other);
    const res = await other.request(callbackPath({ code: "c", state }));
    assert.equal(res.location, "/?swiggy=invalid_state");
    assert.equal(exchangeCalls(), 0);
  });

  it("expires pending sign-ins after 10 minutes and makes no token request", async () => {
    const { state } = await begin(browser);
    app.clock.advance(10 * 60 * 1000 + 1);
    const res = await browser.request(callbackPath({ code: "c", state }));
    assert.equal(res.location, "/?swiggy=expired");
    assert.equal(exchangeCalls(), 0);
  });

  it("reports a denied consent screen without exchanging anything", async () => {
    const { state } = await begin(browser);
    const res = await browser.request(callbackPath({ error: "access_denied", state }));
    assert.equal(res.location, "/?swiggy=denied");
    assert.equal(exchangeCalls(), 0);
    assert.equal((await browser.status()).authorized, false);
  });

  it("never reflects error text from the query string", async () => {
    const { state } = await begin(browser);
    const res = await browser.request(
      callbackPath({ error: "server_error", error_description: "<script>alert(1)</script>", state }),
    );
    assert.equal(res.location, "/?swiggy=authorization_error");
    assert.ok(!res.location.includes("script") && !res.text.includes("script"));
  });

  it("ignores an error parameter that comes with an unknown state", async () => {
    const res = await browser.request(callbackPath({ error: "access_denied", state: "nope" }));
    assert.equal(res.location, "/?swiggy=invalid_state");
  });

  it("rejects a valid state with no code", async () => {
    const { state } = await begin(browser);
    const res = await browser.request(callbackPath({ state }));
    assert.equal(res.location, "/?swiggy=invalid_request");
    assert.equal(exchangeCalls(), 0);
  });

  const failures: [string, () => void][] = [
    ["a 400 invalid_grant", () => (swiggy.tokenReply = () => ({ status: 400, body: { error: "invalid_grant", error_description: "SECRET-DETAIL" } }))],
    ["a 500 server error", () => (swiggy.tokenReply = () => ({ status: 500, body: { error: "server_error" } }))],
    ["a non-JSON body", () => (swiggy.tokenReply = () => ({ status: 200, raw: "<html>oops AT-LEAK</html>" }))],
    ["a token_type other than Bearer", () => (swiggy.tokenReply = () => ({ status: 200, body: { access_token: "AT-LEAK", token_type: "mac", expires_in: 100 } }))],
    ["a missing access_token", () => (swiggy.tokenReply = () => ({ status: 200, body: { token_type: "Bearer", expires_in: 100 } }))],
    ["a non-numeric expires_in", () => (swiggy.tokenReply = () => ({ status: 200, body: { access_token: "AT-LEAK", token_type: "Bearer", expires_in: "soon" } }))],
  ];
  for (const [label, arrange] of failures) {
    it(`fails safely when the token endpoint returns ${label}`, async () => {
      arrange();
      const { state } = await begin(browser);
      const res = await browser.request(callbackPath({ code: "c", state }));
      assert.equal(res.location, "/?swiggy=exchange_failed");
      assert.deepEqual(await browser.status(), { configured: true, authorized: false, verified: false });
      assertNoSecrets("response", res.location + res.text, ["SECRET-DETAIL", "AT-LEAK"]);
      assertNoSecrets("logs", app.logs.join("\n"), ["SECRET-DETAIL", "AT-LEAK"]);
      const replay = await browser.request(callbackPath({ code: "c", state }));
      assert.equal(replay.location, "/?swiggy=invalid_state");
    });
  }

  it("fails safely when the token endpoint cannot be reached", async () => {
    const down = await startApp(swiggy, {
      fetchImpl: async (input, init) => {
        if (String(input).endsWith("/auth/token")) throw new TypeError("connect ECONNREFUSED token-leak");
        return fetch(input, init);
      },
    });
    try {
      const b = new Browser(down.url);
      const { state } = await begin(b);
      const res = await b.request(callbackPath({ code: "c", state }));
      assert.equal(res.location, "/?swiggy=exchange_failed");
      assertNoSecrets("logs", down.logs.join("\n"), ["token-leak"]);
    } finally {
      await down.close();
    }
  });
});

describe("when the integration is not configured", () => {
  it("reports not configured and never contacts Swiggy", async () => {
    const off = await startApp(undefined, { config: { enabled: false, reason: "APP_BASE_URL is not set" } });
    try {
      const b = new Browser(off.url);
      const start = await b.request("/auth/swiggy/start");
      assert.equal(start.location, "/?swiggy=not_configured");
      assert.deepEqual(await b.status(), { configured: false, authorized: false, verified: false });
      const verify = await b.post("/api/swiggy/verify");
      assert.equal(verify.status, 503);
      const cb = await b.request(callbackPath({ code: "c", state: "s" }));
      assert.equal(cb.location, "/?swiggy=not_configured");
    } finally {
      await off.close();
    }
  });
});

describe("state-changing routes", () => {
  it("reject requests without a matching Origin", async () => {
    await signIn();
    for (const origin of [null, "https://evil.example", "http://orderwiseai.onrender.com", `${APP_ORIGIN}.evil.example`]) {
      assert.equal((await browser.post("/api/swiggy/verify", origin)).status, 403, `origin ${origin}`);
      assert.equal((await browser.post("/api/swiggy/disconnect", origin)).status, 403, `origin ${origin}`);
    }
    assert.equal((await browser.status()).authorized, true);
  });

  it("accept same-origin browser requests that send Sec-Fetch-Site instead of Origin", async () => {
    await signIn();
    const res = await browser.request("/api/swiggy/disconnect", { method: "POST", headers: { "sec-fetch-site": "same-origin" } });
    assert.equal(res.status, 200);
    const cross = await browser.request("/api/swiggy/disconnect", { method: "POST", headers: { "sec-fetch-site": "cross-site" } });
    assert.equal(cross.status, 403);
  });
});

describe("verifying with a real MCP request", () => {
  it("requires sign-in first", async () => {
    assert.equal((await browser.post("/api/swiggy/verify")).status, 401);
  });

  it("calls get_addresses with the bearer token and only then reports verified", async () => {
    await signIn();
    assert.equal((await browser.status()).verified, false);
    const res = await browser.post("/api/swiggy/verify");
    assert.equal(res.status, 200);
    assert.deepEqual(JSON.parse(res.text), { ok: true, verified: true });
    const mcpCalls = swiggy.calls("/food");
    assert.ok(mcpCalls.length >= 2, "initialize and tools/call both reached the MCP server");
    assert.ok(mcpCalls.every((c) => c.headers.authorization === "Bearer AT-1"));
    const toolCall = mcpCalls.find((c) => (c.body as { method?: string })?.method === "tools/call");
    assert.equal((toolCall?.body as { params: { name: string } }).params.name, "get_addresses");
    assert.equal((await browser.status()).verified, true);
    assertNoSecrets("verify response", res.text, ["AT-1", "RT-1"]);
    assertNoSecrets("logs", app.logs.join("\n"), ["AT-1", "RT-1"]);
  });

  it("rate-limits repeated verification", async () => {
    await signIn();
    assert.equal((await browser.post("/api/swiggy/verify")).status, 200);
    assert.equal((await browser.post("/api/swiggy/verify")).status, 429);
    app.clock.advance(3_001);
    assert.equal((await browser.post("/api/swiggy/verify")).status, 200);
  });

  it("refreshes after a 401 using the documented body, rotates the refresh token, then retries", async () => {
    await signIn();
    swiggy.validAccessTokens = new Set(["AT-2"]);
    swiggy.tokenReply = (body) =>
      body.grant_type === "refresh_token"
        ? { status: 200, body: { access_token: "AT-2", refresh_token: "RT-2", token_type: "Bearer", expires_in: 432000 } }
        : { status: 400, body: {} };

    const res = await browser.post("/api/swiggy/verify");
    assert.equal(res.status, 200);
    const refresh = swiggy.calls("/auth/token").find((c) => (c.body as Record<string, string>).grant_type === "refresh_token");
    assert.deepEqual(refresh?.body, { grant_type: "refresh_token", refresh_token: "RT-1" });
    assert.equal(refresh?.headers.authorization, undefined, "docs: no Authorization header on refresh");
    assert.equal((await browser.status()).verified, true);

    // The next refresh must use the rotated token.
    app.clock.advance(432000 * 1000 - 30_000);
    swiggy.validAccessTokens = new Set(["AT-3"]);
    swiggy.tokenReply = () => ({ status: 200, body: { access_token: "AT-3", refresh_token: "RT-3", token_type: "Bearer", expires_in: 432000 } });
    assert.equal((await browser.post("/api/swiggy/verify")).status, 200);
    const refreshes = swiggy.calls("/auth/token").filter((c) => (c.body as Record<string, string>).grant_type === "refresh_token");
    assert.deepEqual(refreshes.at(-1)?.body, { grant_type: "refresh_token", refresh_token: "RT-2" });
  });

  it("refreshes ahead of expiry when 60 seconds or less remain", async () => {
    await signIn();
    app.clock.advance(432000 * 1000 - 59_000);
    swiggy.validAccessTokens = new Set(["AT-9"]);
    swiggy.tokenReply = () => ({ status: 200, body: { access_token: "AT-9", refresh_token: "RT-9", token_type: "Bearer", expires_in: 432000 } });
    assert.equal((await browser.post("/api/swiggy/verify")).status, 200);
    assert.equal(swiggy.calls("/food").filter((c) => c.headers.authorization === "Bearer AT-1").length, 0, "stale token never sent");
  });

  it("asks the user to sign in again when the refresh token is rejected", async () => {
    await signIn();
    swiggy.validAccessTokens = new Set();
    swiggy.tokenReply = () => ({ status: 400, body: { error: "invalid_grant", error_description: "SECRET-DETAIL" } });
    const res = await browser.post("/api/swiggy/verify");
    assert.equal(res.status, 401);
    assert.deepEqual(JSON.parse(res.text), { error: "reauthorization_required" });
    assert.deepEqual(await browser.status(), { configured: true, authorized: false, verified: false });
    assertNoSecrets("logs", app.logs.join("\n"), ["SECRET-DETAIL", "RT-1"]);
  });

  it("keeps the sign-in and reports unavailable on a temporary Swiggy error during refresh", async () => {
    await signIn();
    swiggy.validAccessTokens = new Set();
    swiggy.tokenReply = () => ({ status: 500, body: { error: "server_error" } });
    const res = await browser.post("/api/swiggy/verify");
    assert.equal(res.status, 502);
    assert.deepEqual(JSON.parse(res.text), { error: "swiggy_unavailable" });
    assert.equal((await browser.status()).authorized, true);
  });

  it("returns a fixed message when something unexpected is thrown", async () => {
    const boom = await startApp(swiggy, {
      verify: async () => {
        throw new Error("internal detail with token AT-LEAK");
      },
    });
    try {
      const b = new Browser(boom.url);
      await signIn(b);
      const res = await b.post("/api/swiggy/verify");
      assert.equal(res.status, 502);
      assert.deepEqual(JSON.parse(res.text), { error: "swiggy_unavailable" });
      assertNoSecrets("response", res.text, ["AT-LEAK"]);
      assertNoSecrets("logs", boom.logs.join("\n"), ["AT-LEAK"]);
    } finally {
      await boom.close();
    }
  });

  it("does not leak the failure when Swiggy rejects the call for a reason other than auth", async () => {
    const failing = await startApp(swiggy, {
      verify: async () => {
        throw new SwiggyAuthError("rejected", "invalid_request");
      },
    });
    try {
      const b = new Browser(failing.url);
      await signIn(b);
      assert.equal((await b.post("/api/swiggy/verify")).status, 502);
    } finally {
      await failing.close();
    }
  });
});

describe("disconnect", () => {
  it("forgets the sign-in, clears the cookie, and does not claim Swiggy revoked anything", async () => {
    await signIn();
    const res = await browser.post("/api/swiggy/disconnect");
    assert.equal(res.status, 200);
    assert.deepEqual(JSON.parse(res.text), { ok: true, swiggySessionRevoked: false });
    assert.ok(res.setCookie.some((c) => /__Host-ow_sid=;.*Max-Age=0/.test(c)));
    assert.deepEqual(await browser.status(), { configured: true, authorized: false, verified: false });
    assert.equal(swiggy.calls("/auth/logout").length, 0, "no undocumented logout request is sent");
  });
});
