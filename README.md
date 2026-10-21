# OrderWise AI

Group meal planning for students, hostel residents and working professionals: one shared budget, individual spending limits, dietary needs and cuisine picks, and a Smart Basket that finds a combination that works for everyone.

**Restaurants, dishes and prices are demo data.** OrderWise AI cannot place orders. The app only claims a Swiggy connection after a real Swiggy request has succeeded (see [Swiggy sign-in](#swiggy-sign-in-oauth-21--pkce)).

## Run locally

```powershell
npm install
Copy-Item .env.example .env
npm run dev          # http://localhost:3000
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Starts the server with reload |
| `npm run build` | Type-checks the TypeScript (`tsc --noEmit`) |
| `npm test` | Runs all tests (Node's built-in test runner) |
| `npm run swiggy:register` | One-off Swiggy client registration (see below) |

## Swiggy sign-in (OAuth 2.1 + PKCE)

This follows the [Swiggy Builders authentication docs](https://mcp.swiggy.com/builders/docs/start/authenticate/). Swiggy has no API key: each person signs in to their own Swiggy account with phone and OTP on Swiggy's page, and the app receives tokens for that person.

### How the flow works

1. The browser opens `GET /auth/swiggy/start`. The server creates a PKCE verifier and a random `state`, ties both to the browser's session cookie, and redirects to Swiggy's `/auth/authorize` with `response_type`, `client_id`, `redirect_uri`, `code_challenge`, `code_challenge_method=S256`, `state` and `scope`.
2. The user signs in on Swiggy's page.
3. Swiggy redirects to `GET /auth/swiggy/callback?code=…&state=…`. The server accepts it only if the `state` was issued here, has not been used, has not expired (10 minutes), and arrives in the same browser that started the flow.
4. The server posts `grant_type`, `code`, `code_verifier` and `redirect_uri` as JSON to `/auth/token`, and keeps the tokens in server memory. They never reach the browser.
5. `POST /api/swiggy/verify` makes one read-only MCP request (`get_addresses` on the Food server). Only after it succeeds does the page say the connection is verified.

Routes: `/auth/swiggy/start`, `/auth/swiggy/callback`, `GET /api/swiggy/status`, `POST /api/swiggy/verify`, `POST /api/swiggy/disconnect`. The status route returns only `configured`, `authorized` and `verified`.

### Environment variables

| Variable | Required | Meaning |
| --- | --- | --- |
| `APP_BASE_URL` | Yes, to enable sign-in | Public address of this app: no path, no trailing slash. HTTPS, except `http://localhost`. |
| `SWIGGY_CLIENT_ID` | Recommended in production | The `client_id` printed by `npm run swiggy:register`. Not a secret. |
| `SWIGGY_AUTH_BASE_URL` | No | Default `https://mcp.swiggy.com`. For example, a staging host from Swiggy. |
| `SWIGGY_FOOD_MCP_URL` | No | Default `https://mcp.swiggy.com/food` |
| `SWIGGY_SCOPE` | No | Default `mcp:tools` |

There is no client secret. Do not put tokens in any file or environment variable.

### The redirect URI to give Swiggy

It is `APP_BASE_URL` plus `/auth/swiggy/callback`, character for character. Swiggy matches it exactly, with no wildcards.

| Where | Redirect URI |
| --- | --- |
| Production (Render) | `https://orderwiseai.onrender.com/auth/swiggy/callback` |
| Local development | `http://localhost:3000/auth/swiggy/callback` |

When the server starts it logs the exact redirect URI it will use (`swiggy_oauth_ready`).

### Registering with Swiggy

**Important: Registration and production access are not yet verified.**

1. Confirm the applicable Swiggy Builders onboarding process and whether this app requires delegated authentication for multiple users.
2. Confirm the accepted Dynamic Client Registration (DCR) request fields, redirect URI allowlisting requirements, and token exchange format with Swiggy.
3. Use the staging environment and credentials provided or approved by Swiggy before attempting a real authentication flow.
4. The proposed production callback URI is `https://orderwiseai.onrender.com/auth/swiggy/callback`. Do not assume it is allowlisted or approved until Swiggy confirms it.
5. Configure `SWIGGY_CLIENT_ID` and production environment variables only after the registration and callback requirements are confirmed.

The local automated tests use a mock MCP server. They do not establish that live Swiggy authentication or registration will succeed. Do not describe the Swiggy integration as verified until a real, authorized authentication and read-only verification request succeed.