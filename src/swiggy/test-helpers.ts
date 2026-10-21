// Test helpers only. This file is not loaded by the server.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { loadSwiggyConfig, type SwiggyConfigResult } from "./config.js";
import { createSwiggyRouter, type SwiggyDeps } from "./routes.js";
import { SwiggyStore } from "./store.js";

export const APP_ORIGIN = "https://orderwiseai.onrender.com";
export const REDIRECT_URI = `${APP_ORIGIN}/auth/swiggy/callback`;

export type Recorded = { method: string; path: string; headers: Record<string, string | string[] | undefined>; body: unknown };
type Reply = { status: number; body?: unknown; raw?: string };

/** A stand-in for mcp.swiggy.com. It checks that this app speaks the documented protocol. It is not Swiggy. */
export class FakeSwiggy {
  server!: Server;
  origin = "";
  requests: Recorded[] = [];
  registerReply: () => Reply = () => ({ status: 201, body: { client_id: "test-client" } });
  tokenReply: (body: Record<string, unknown>) => Reply = () => ({
    status: 200,
    body: { access_token: "AT-1", refresh_token: "RT-1", token_type: "Bearer", expires_in: 432000, scope: "mcp:tools" },
  });
  logoutReply: () => Reply = () => ({ status: 200, body: { ok: true } });
  /** Access tokens the fake MCP server accepts. */
  validAccessTokens = new Set<string>(["AT-1"]);

  async start(): Promise<void> {
    this.server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((resolve) => this.server.listen(0, resolve));
    this.origin = `http://localhost:${(this.server.address() as AddressInfo).port}`;
  }

  async stop(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  calls(path: string): Recorded[] {
    return this.requests.filter((r) => r.path === path);
  }

  private async readBody(req: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const text = Buffer.concat(chunks).toString();
    try {
      return text ? JSON.parse(text) : undefined;
    } catch {
      return text;
    }
  }

  private send(res: ServerResponse, reply: Reply): void {
    res.statusCode = reply.status;
    res.setHeader("Content-Type", "application/json");
    res.end(reply.raw ?? JSON.stringify(reply.body ?? {}));
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = (req.url ?? "").split("?")[0];
    const body = await this.readBody(req);
    this.requests.push({ method: req.method ?? "", path, headers: req.headers, body });

    if (req.method === "POST" && path === "/auth/register") return this.send(res, this.registerReply());
    if (req.method === "POST" && path === "/auth/token") return this.send(res, this.tokenReply(body as Record<string, unknown>));
    if (req.method === "POST" && path === "/auth/logout") return this.send(res, this.logoutReply());

    if (path === "/food") {
      const auth = req.headers.authorization ?? "";
      const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
      if (!this.validAccessTokens.has(token)) return this.send(res, { status: 401, body: { error: "unauthorized" } });
      // A real MCP server, so the app's client is exercised against the actual protocol.
      const mcp = new McpServer({ name: "fake-swiggy-food", version: "0.0.0" });
      mcp.registerTool("get_addresses", { description: "Saved addresses (fake)" }, async () => ({
        content: [{ type: "text", text: JSON.stringify({ success: true, data: [] }) }],
      }));
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on("close", () => void transport.close());
      await mcp.connect(transport);
      await transport.handleRequest(req as IncomingMessage & { auth?: never }, res, body);
      return;
    }
    this.send(res, { status: 404, body: { error: "not_found" } });
  }
}

export class Clock {
  constructor(public t = 1_800_000_000_000) {}
  now = () => this.t;
  advance(ms: number): void {
    this.t += ms;
  }
}

export type Harness = {
  url: string;
  close: () => Promise<void>;
  logs: string[];
  clock: Clock;
  store: SwiggyStore;
};

export async function startApp(
  swiggy: FakeSwiggy | undefined,
  overrides: Partial<SwiggyDeps> = {},
  env: Record<string, string | undefined> = {},
): Promise<Harness> {
  const clock = new Clock();
  const logs: string[] = [];
  const config: SwiggyConfigResult =
    overrides.config ??
    loadSwiggyConfig({ APP_BASE_URL: APP_ORIGIN, SWIGGY_AUTH_BASE_URL: swiggy?.origin, ...env });
  const store = overrides.store ?? new SwiggyStore(clock.now);

  const app = express();
  app.use(express.json());
  app.use(
    createSwiggyRouter({
      config,
      store,
      now: clock.now,
      log: (event, fields) => logs.push(JSON.stringify({ event, ...fields })),
      ...overrides,
    }),
  );
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://localhost:${port}`,
    clock,
    store,
    logs,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/** A minimal browser: keeps cookies, never follows redirects, so tests can inspect each hop. */
export class Browser {
  cookies = new Map<string, string>();
  constructor(private base: string) {}

  get cookieHeader(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  async request(path: string, init: RequestInit & { headers?: Record<string, string> } = {}) {
    const headers: Record<string, string> = { ...(init.headers ?? {}) };
    if (this.cookies.size) headers.cookie = this.cookieHeader;
    const res = await fetch(`${this.base}${path}`, { ...init, headers, redirect: "manual" });
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(";");
      const i = pair.indexOf("=");
      const name = pair.slice(0, i);
      const value = pair.slice(i + 1);
      if (/max-age=0/i.test(line) || value === "") this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    const text = await res.text();
    return { status: res.status, headers: res.headers, text, location: res.headers.get("location") ?? "", setCookie: res.headers.getSetCookie() };
  }

  post(path: string, origin: string | null = APP_ORIGIN) {
    return this.request(path, { method: "POST", headers: origin ? { origin } : {} });
  }

  async status() {
    return JSON.parse((await this.request("/api/swiggy/status")).text) as { configured: boolean; authorized: boolean; verified: boolean };
  }
}

/** Runs /auth/swiggy/start and returns the parameters Swiggy would receive. */
export async function begin(browser: Browser) {
  const res = await browser.request("/auth/swiggy/start");
  const url = new URL(res.location);
  return { res, url, params: url.searchParams, state: url.searchParams.get("state") ?? "" };
}

export function callbackPath(params: Record<string, string>): string {
  return `/auth/swiggy/callback?${new URLSearchParams(params).toString()}`;
}
