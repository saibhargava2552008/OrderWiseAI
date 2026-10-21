import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { SwiggyConfig } from "./config.js";

export type McpErrorCode = "unauthorized" | "tool_error" | "unavailable";

export class SwiggyMcpError extends Error {
  constructor(public readonly code: McpErrorCode) {
    super(code);
    this.name = "SwiggyMcpError";
  }
}

const MCP_TIMEOUT_MS = 15_000;

/** Docs: auth failures appear as HTTP 401 or JSON-RPC error -32001. */
function isUnauthorized(error: unknown): boolean {
  const e = error as { code?: unknown; name?: unknown } | null;
  return e?.code === 401 || e?.code === -32001 || e?.name === "UnauthorizedError";
}

/**
 * Makes one read-only MCP request, `get_addresses` on the Food server, as the documented first
 * tool call. It proves that the token is accepted. The result is deliberately not read or kept,
 * because saved addresses are personal data this app has no need for.
 *
 * The token goes in an `Authorization: Bearer` header, the documented route for SDKs without
 * native OAuth support.
 */
export async function verifyFoodServer(config: SwiggyConfig, accessToken: string): Promise<void> {
  const transport = new StreamableHTTPClientTransport(new URL(config.foodMcpUrl), {
    requestInit: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
  const client = new Client({ name: "orderwise-ai", version: "1.0.0" });
  try {
    await client.connect(transport, { timeout: MCP_TIMEOUT_MS });
    const result = await client.callTool({ name: "get_addresses", arguments: {} }, undefined, {
      timeout: MCP_TIMEOUT_MS,
    });
    if (result.isError) throw new SwiggyMcpError("tool_error");
  } catch (error) {
    if (error instanceof SwiggyMcpError) throw error;
    throw new SwiggyMcpError(isUnauthorized(error) ? "unauthorized" : "unavailable");
  } finally {
    await client.close().catch(() => undefined);
  }
}
