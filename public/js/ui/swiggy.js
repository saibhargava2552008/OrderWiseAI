import { h } from "../lib/dom.js";
import { showToast } from "./toast.js";

// The page only ever learns three booleans from the server. Tokens never reach the browser.
// "Verified" means a real MCP request succeeded; signing in alone is not enough to say so.

const OUTCOMES = {
  authorized: ["success", "Signed in to Swiggy. Select “Verify connection” to check that it works."],
  denied: ["info", "Swiggy sign-in was cancelled. Select “Connect Swiggy” to try again."],
  authorization_error: ["error", "Swiggy couldn't complete the sign-in. Try again in a moment."],
  invalid_state: ["error", "That sign-in link wasn't valid or was already used. Select “Connect Swiggy” to start again."],
  invalid_request: ["error", "The sign-in response was incomplete. Select “Connect Swiggy” to try again."],
  expired: ["error", "The sign-in took too long and expired. Select “Connect Swiggy” to start again."],
  exchange_failed: ["error", "Swiggy sign-in didn't finish. Try again. If it keeps failing, check the server logs."],
  registration_failed: ["error", "Swiggy didn't accept this app's registration. Production access may still be waiting for approval."],
  not_configured: ["info", "Swiggy sign-in isn't set up on this server."],
};

const DEMO_NOTICE =
  "Every restaurant, dish, price, rating and delivery time on this page is made up. OrderWise AI isn't connected to Swiggy yet, and it can't place orders.";
const VERIFIED_NOTICE =
  "Your Swiggy sign-in is verified, but every restaurant, dish, price, rating and delivery time on this page is still made up. OrderWise AI can't place orders yet.";

async function api(path, method = "GET") {
  const response = await fetch(path, { method, headers: { Accept: "application/json" } });
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { ok: response.ok, status: response.status, body };
}

function announceCallbackOutcome() {
  const params = new URLSearchParams(location.search);
  const outcome = params.get("swiggy");
  if (outcome === null) return;
  // Only known outcome codes are shown. Anything else in the URL is ignored.
  const known = Object.hasOwn(OUTCOMES, outcome) ? OUTCOMES[outcome] : null;
  if (known) showToast(known[1], { tone: known[0] === "success" ? "success" : "info", duration: 10000 });
  params.delete("swiggy");
  const rest = params.toString();
  history.replaceState(null, "", location.pathname + (rest ? `?${rest}` : "") + location.hash);
}

export async function initSwiggy() {
  const chip = document.getElementById("swiggy-status");
  const chipText = document.getElementById("swiggy-status-text");
  const actions = document.getElementById("swiggy-actions");
  const noticeText = document.getElementById("notice-text");
  if (!chip || !chipText || !actions) return;

  announceCallbackOutcome();

  async function refresh() {
    let status = { configured: false, authorized: false, verified: false };
    try {
      const result = await api("/api/swiggy/status");
      if (result.ok && result.body) status = result.body;
    } catch {
      // The server is unreachable. The chip keeps saying "not connected", which is true.
    }
    render(status);
  }

  async function verify(button) {
    button.disabled = true;
    button.textContent = "Verifying…";
    try {
      const result = await api("/api/swiggy/verify", "POST");
      if (result.ok) {
        showToast("Swiggy accepted a real request, so the connection works. Restaurants and prices are still demo data.", {
          tone: "success",
          duration: 10000,
        });
      } else if (result.status === 401) {
        showToast("Your Swiggy sign-in ended. Select “Connect Swiggy” to sign in again.", { tone: "info", duration: 10000 });
      } else if (result.status === 429) {
        showToast("Wait a few seconds, then verify again.", { tone: "info" });
      } else {
        showToast("Swiggy didn't respond. Try again in a minute.", { tone: "info" });
      }
    } catch {
      showToast("Couldn't reach the OrderWise server. Check your connection and try again.", { tone: "info" });
    }
    await refresh();
  }

  async function disconnect(button) {
    button.disabled = true;
    try {
      await api("/api/swiggy/disconnect", "POST");
      showToast("Signed out of Swiggy in OrderWise. Your Swiggy session itself isn't revoked.", { tone: "info", duration: 10000 });
    } catch {
      showToast("Couldn't sign out. Try again.", { tone: "info" });
    }
    await refresh();
  }

  function render({ configured, authorized, verified }) {
    chip.classList.toggle("status-chip--ok", Boolean(verified));
    chipText.textContent = verified
      ? "Swiggy connection verified"
      : authorized
        ? "Signed in to Swiggy, not verified"
        : "Swiggy not connected";
    if (noticeText) noticeText.textContent = verified ? VERIFIED_NOTICE : DEMO_NOTICE;

    const buttons = [];
    if (configured && !authorized) {
      buttons.push(h("a", { class: "btn btn--secondary", href: "/auth/swiggy/start" }, "Connect Swiggy"));
    }
    if (authorized && !verified) {
      buttons.push(h("button", { type: "button", class: "btn btn--secondary", onclick: (e) => verify(e.currentTarget) }, "Verify connection"));
    }
    if (authorized) {
      buttons.push(h("button", { type: "button", class: "btn btn--quiet", onclick: (e) => disconnect(e.currentTarget) }, "Disconnect"));
    }
    actions.replaceChildren(...buttons);
  }

  await refresh();
}
