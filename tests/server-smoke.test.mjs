// Starts the real src/server.ts and checks that existing behaviour still works
// next to the Swiggy OAuth routes. No request in this file leaves the machine.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { after, before, describe, it } from "node:test";

async function freePort() {
  return new Promise((resolve) => {
    const s = createServer();
    s.listen(0, () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

async function startServer(extraEnv) {
  const port = await freePort();
  // Start from a clean environment so a developer's own .env or shell cannot change the result.
  const env = {
  PATH: process.env.PATH,
  SystemRoot: process.env.SystemRoot,
  NODE_ENV: "test",
  PERSISTENCE_MODE: "memory",
  PORT: String(port),
  ...extraEnv,
};
  const child = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], { env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (d) => (output += d));
  child.stderr.on("data", (d) => (output += d));
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${base}/health`)).ok) return { base, child, output: () => output };
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  child.kill();
  throw new Error(`server did not start. Output:\n${output}`);
}

const json = (body) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("server without Swiggy settings", () => {
  let srv;
  before(async () => (srv = await startServer({})));
  after(() => srv.child.kill());

  it("still answers /health", async () => {
    const res = await fetch(`${srv.base}/health`);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).status, "ok");
  });

  it("still creates, joins and loads group sessions", async () => {
    const created = await fetch(`${srv.base}/api/sessions`, json({ title: "Hostel dinner", location: "Block C", budget: 1400, memberName: "Asha", spendingLimit: 300 }));
    assert.equal(created.status, 201);
    const { session } = await created.json();
    assert.match(session.code, /^[A-F0-9]{6}$/);

    const joined = await fetch(`${srv.base}/api/sessions/join`, json({ code: session.code.toLowerCase(), memberName: "Ravi" }));
    assert.equal(joined.status, 200);
    assert.equal((await joined.json()).session.members.length, 2);

    const dup = await fetch(`${srv.base}/api/sessions/join`, json({ code: session.code, memberName: "asha" }));
    assert.equal(dup.status, 409);

    const loaded = await fetch(`${srv.base}/api/sessions/${session.code}`);
    assert.equal(loaded.status, 200);
    assert.equal((await loaded.json()).session.title, "Hostel dinner");

    const missing = await fetch(`${srv.base}/api/sessions/NOPE00`);
    assert.equal(missing.status, 404);

    const invalid = await fetch(`${srv.base}/api/sessions`, json({ title: "", location: "x", budget: 10, memberName: "A", spendingLimit: 5 }));
    assert.equal(invalid.status, 400);
  });

  it("still serves the frontend, with the Helmet headers", async () => {
    const res = await fetch(`${srv.base}/`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /id="swiggy-status"/);
    assert.ok(res.headers.get("content-security-policy"));
    for (const path of ["/js/main.js", "/js/ui/swiggy.js", "/js/lib/basket.js", "/css/styles.css"]) {
      assert.equal((await fetch(`${srv.base}${path}`)).status, 200, path);
    }
  });

  it("reports Swiggy as not configured and never starts a sign-in", async () => {
    const status = await (await fetch(`${srv.base}/api/swiggy/status`)).json();
    assert.deepEqual(status, { configured: false, authorized: false, verified: false });
    const start = await fetch(`${srv.base}/auth/swiggy/start`, { redirect: "manual" });
    assert.equal(start.headers.get("location"), "/?swiggy=not_configured");
    assert.ok(srv.output().includes("swiggy_oauth_disabled"));
  });
});

describe("server with Swiggy settings for the Render deployment", () => {
  let srv;
  before(
    async () =>
      (srv = await startServer({
        APP_BASE_URL: "https://orderwiseai.onrender.com",
        // A client id is supplied, so no registration request is made and nothing leaves the machine.
        SWIGGY_CLIENT_ID: "smoke-test-client",
      })),
  );
  after(() => srv.child.kill());

  it("logs the exact redirect URI to register with Swiggy", () => {
    assert.ok(srv.output().includes("https://orderwiseai.onrender.com/auth/swiggy/callback"));
  });

  it("builds the authorization URL for the real Swiggy host", async () => {
    const res = await fetch(`${srv.base}/auth/swiggy/start`, { redirect: "manual" });
    assert.equal(res.status, 302);
    const url = new URL(res.headers.get("location"));
    assert.equal(url.origin + url.pathname, "https://mcp.swiggy.com/auth/authorize");
    assert.equal(url.searchParams.get("redirect_uri"), "https://orderwiseai.onrender.com/auth/swiggy/callback");
    assert.equal(url.searchParams.get("client_id"), "smoke-test-client");
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    const cookie = res.headers.getSetCookie().join(";");
    assert.match(cookie, /__Host-ow_sid=/);
    assert.match(cookie, /Secure/);
  });

  it("does not print secrets or state values to the console", () => {
    const out = srv.output();
    assert.ok(!/code_verifier|access_token|refresh_token/.test(out));
  });
});
