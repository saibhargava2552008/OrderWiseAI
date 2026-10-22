import "dotenv/config";
import { loadSwiggyConfig } from "./config.js";
import { SwiggyAuthError, registerClient } from "./oauth.js";

/**
 * One-off Dynamic Client Registration. Run it once per redirect URI, then put the printed
 * client_id in SWIGGY_CLIENT_ID so the server does not register a new client on every restart.
 * A client_id is a public identifier, not a secret.
 */
const config = loadSwiggyConfig(process.env);
if (!config.enabled) {
  console.error(`Cannot register: ${config.reason}`);
  process.exit(1);
}

console.log(`Registering redirect URI: ${config.redirectUri}`);
try {
  const clientId = await registerClient(config);
  console.log("Registered. Add this to your environment:");
  console.log(`SWIGGY_CLIENT_ID=${clientId}`);
} catch (error) {
  if (error instanceof SwiggyAuthError) {
    console.error(`Registration failed (${error.code}${error.oauthError ? `: ${error.oauthError}` : ""}).`);
    if (error.code === "rejected") {
      console.error("If the redirect URI is not allowlisted yet, Swiggy may refuse it until your application is approved.");
    } else if (error.code === "network") {
      console.error("Could not reach Swiggy. Check your internet connection and SWIGGY_AUTH_BASE_URL.");
    }
  } else {
    console.error("Registration failed.");
  }
  process.exit(1);
}
