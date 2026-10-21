import type { Express } from "express";
import { loadSwiggyConfig } from "./config.js";
import { createSwiggyRouter } from "./routes.js";

/**
 * Mounts the Swiggy OAuth routes. When the environment is incomplete the routes still exist but
 * report "not configured", so the rest of the app is unaffected.
 */
export function mountSwiggyAuth(app: Express, env: Record<string, string | undefined> = process.env): void {
  const config = loadSwiggyConfig(env);
  if (config.enabled) {
    console.log(JSON.stringify({ event: "swiggy_oauth_ready", redirectUri: config.redirectUri }));
  } else {
    console.log(JSON.stringify({ event: "swiggy_oauth_disabled", reason: config.reason }));
  }
  app.use(createSwiggyRouter({ config }));
}
