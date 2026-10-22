
import type { Express } from "express";
import { loadSwiggyConfig } from "./config.js";
import { createSwiggyRouter } from "./routes.js";
import type { SwiggyStoreAdapter } from "./store-adapter.js";

/**
 * Mounts the Swiggy OAuth routes.
 * A persistent store can be injected during server startup.
 */
export function mountSwiggyAuth(
  app: Express,
  env: Record<string, string | undefined> = process.env,
  store?: SwiggyStoreAdapter,
): void {
  const config = loadSwiggyConfig(env);

  if (config.enabled) {
    console.log(
      JSON.stringify({
        event: "swiggy_oauth_ready",
        redirectUri: config.redirectUri,
      }),
    );
  } else {
    console.log(
      JSON.stringify({
        event: "swiggy_oauth_disabled",
        reason: config.reason,
      }),
    );
  }

  app.use(createSwiggyRouter({ config, store }));
}
