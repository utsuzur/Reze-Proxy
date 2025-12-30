<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1RmqoxXmMZ0nqGAi3ylNejZAXPpJ6_esg

## Run Locally

**Prerequisites:** Node.js

1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Admin authentication (cookie session)

Admin access is protected by a server-side session stored in an `HttpOnly` cookie (12-hour expiry) and CSRF checks.

### Required environment variables (server)

Set these for the backend (the process running [`server/index.ts`](server/index.ts:1)):

- `ADMIN_USER` (e.g. `admin`)
- `ADMIN_PASSWORD_HASH` (bcrypt hash, generated once and stored as-is)

Generate a bcrypt hash (recommended) using the installed `bcryptjs` dependency:

- Windows/macOS/Linux (Node):
  - `node -e "console.log(require('bcryptjs').hashSync('CHANGE_ME_PASSWORD', 12))"`

Then set:

- `ADMIN_PASSWORD_HASH=<paste the printed hash>`

### Production notes

- Run behind HTTPS (Nginx/Cloudflare) and set `NODE_ENV=production` so the session cookie is issued as a `Secure` `__Host-` cookie.
- “Logout everywhere” revokes all rows in the `admin_sessions` table.

### Public endpoints

The landing page uses read-only public endpoints:

- `GET /api/public/providers`
- `GET /api/public/models`

Admin management endpoints (providers/models/tokens/log pruning) require the admin session.

## Security properties & residual risks

### Security properties (what this implementation does)

- Server-side admin sessions stored in SQLite (`admin_sessions` table).
- Cookie session token is `HttpOnly` (not readable by JavaScript) and `SameSite=Strict`.
- Session secrets are stored as hashes (`validatorHash`) so a DB read alone doesn’t mint a valid cookie.
- CSRF protection on state-changing admin routes via `reze_csrf` cookie + `X-CSRF-Token` header.
- Login brute-force mitigation (basic IP-window rate limiting) and audit logging (`admin_audit_log`).

### Residual risks (what is still possible)

- XSS in the admin SPA can still perform authenticated actions (even if it can’t read the `HttpOnly` cookie).
- A stolen cookie (e.g., from a compromised browser or TLS termination compromise) can be replayed until expiry/revocation.
- Compromised admin machine/browser defeats most web-layer protections.

### Operational requirements

- HTTPS in production is required for `Secure` cookies.
- Reverse proxy must forward correct headers; the app uses `trust proxy` for accurate IP and cookie handling.
- Keep `ADMIN_PASSWORD_HASH` secret and rotate it if compromise is suspected (then revoke sessions via “logout everywhere”).
