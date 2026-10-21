import { z } from "zod";

/** Path of the OAuth callback on this app. Register APP_BASE_URL + this path with Swiggy. */
export const CALLBACK_PATH = "/auth/swiggy/callback";

/** Swiggy's production host. Endpoints below are the ones listed in the Swiggy Builders authenticate docs. */
const DEFAULT_SWIGGY_ORIGIN = "https://mcp.swiggy.com";

export type SwiggyConfig = {
  enabled: true;
  /** Origin of this app, e.g. https://orderwiseai.onrender.com (no path, no trailing slash). */
  appOrigin: string;
  /** Exact redirect URI sent to Swiggy: appOrigin + CALLBACK_PATH. */
  redirectUri: string;
  /** Origin that hosts /auth/authorize, /auth/token and /auth/register. */
  swiggyOrigin: string;
  /** Streamable HTTP endpoint of the Swiggy Food MCP server. */
  foodMcpUrl: string;
  scope: string;
  /** Optional client_id from a previous Dynamic Client Registration. */
  clientId?: string;
  /** True when the app is served over HTTPS, so cookies get the Secure flag. */
  secureCookies: boolean;
};

export type SwiggyConfigResult = SwiggyConfig | { enabled: false; reason: string };

/** HTTPS everywhere, with http allowed only for the literal host "localhost" (the Swiggy docs allow http://localhost). */
function isAllowedUrl(url: URL): boolean {
  return url.protocol === "https:" || (url.protocol === "http:" && url.hostname === "localhost");
}

function parseOrigin(raw: string, label: string): { origin: string } | { error: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { error: `${label} is not a valid URL` };
  }
  if (!isAllowedUrl(url)) return { error: `${label} must use https (http is allowed only for localhost)` };
  if (url.username || url.password) return { error: `${label} must not contain credentials` };
  if (url.pathname !== "/" || url.search || url.hash) return { error: `${label} must be an origin only, with no path, query or fragment` };
  return { origin: url.origin };
}

const envSchema = z.object({
  APP_BASE_URL: z.string().trim().min(1),
  SWIGGY_AUTH_BASE_URL: z.string().trim().min(1).optional(),
  SWIGGY_FOOD_MCP_URL: z.string().trim().min(1).optional(),
  SWIGGY_SCOPE: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9:_ -]{1,100}$/, "SWIGGY_SCOPE contains unexpected characters")
    .optional(),
  SWIGGY_CLIENT_ID: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9._~-]{1,200}$/, "SWIGGY_CLIENT_ID contains unexpected characters")
    .optional(),
});

/**
 * Reads and validates Swiggy OAuth settings. Fails closed: when anything is missing or invalid the
 * integration is reported as disabled (with a reason that never contains values) and the rest of
 * the app keeps working.
 */
export function loadSwiggyConfig(env: Record<string, string | undefined>): SwiggyConfigResult {
  const blank = (v: string | undefined) => (v === undefined || v.trim() === "" ? undefined : v);
  if (blank(env.APP_BASE_URL) === undefined) {
    return { enabled: false, reason: "APP_BASE_URL is not set" };
  }

  const parsed = envSchema.safeParse({
    APP_BASE_URL: blank(env.APP_BASE_URL),
    SWIGGY_AUTH_BASE_URL: blank(env.SWIGGY_AUTH_BASE_URL),
    SWIGGY_FOOD_MCP_URL: blank(env.SWIGGY_FOOD_MCP_URL),
    SWIGGY_SCOPE: blank(env.SWIGGY_SCOPE),
    SWIGGY_CLIENT_ID: blank(env.SWIGGY_CLIENT_ID),
  });
  if (!parsed.success) {
    const names = [...new Set(parsed.error.issues.map((i) => String(i.path[0])))];
    return { enabled: false, reason: `invalid environment variable(s): ${names.join(", ")}` };
  }
  const v = parsed.data;

  const app = parseOrigin(v.APP_BASE_URL, "APP_BASE_URL");
  if ("error" in app) return { enabled: false, reason: app.error };

  const swiggy = parseOrigin(v.SWIGGY_AUTH_BASE_URL ?? DEFAULT_SWIGGY_ORIGIN, "SWIGGY_AUTH_BASE_URL");
  if ("error" in swiggy) return { enabled: false, reason: swiggy.error };

  const foodRaw = v.SWIGGY_FOOD_MCP_URL ?? `${swiggy.origin}/food`;
  let foodUrl: URL;
  try {
    foodUrl = new URL(foodRaw);
  } catch {
    return { enabled: false, reason: "SWIGGY_FOOD_MCP_URL is not a valid URL" };
  }
  if (!isAllowedUrl(foodUrl) || foodUrl.username || foodUrl.password || foodUrl.search || foodUrl.hash) {
    return { enabled: false, reason: "SWIGGY_FOOD_MCP_URL must be an https URL with no credentials, query or fragment" };
  }

  return {
    enabled: true,
    appOrigin: app.origin,
    redirectUri: `${app.origin}${CALLBACK_PATH}`,
    swiggyOrigin: swiggy.origin,
    foodMcpUrl: foodUrl.toString(),
    scope: v.SWIGGY_SCOPE ?? "mcp:tools",
    clientId: v.SWIGGY_CLIENT_ID,
    secureCookies: app.origin.startsWith("https:"),
  };
}
