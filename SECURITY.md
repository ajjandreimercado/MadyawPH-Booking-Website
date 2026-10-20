# Security notes

What protects the site today, and where it lives. Enforcement is on the API; the frontend only mirrors it.
`.cursor/rules/security.mdc` makes these checks mandatory for every new implementation, and
`.github/workflows/security.yml` + Dependabot enforce them automatically on every push.

## API (`server/`)

- **Secrets** stay in `server/.env` / the Render dashboard. The server refuses to start with a missing,
  short (< 32 chars) or placeholder `JWT_SECRET`, or a localhost `MONGODB_URI` in production.
  No database dumps or PII files are tracked in git (`server/data/*.json` is git-ignored).
- **Sessions** are JWTs (HS256, algorithm pinned on sign + verify) in an httpOnly cookie
  (`utils/issueAuthCookie.ts`), checked by `middleware/auth.ts`.
- **Headers**: helmet with CSP, HSTS and a Permissions-Policy (`app.ts`).
- **CORS** allows only the origins in `CLIENT_ORIGIN`; `middleware/csrfOriginGuard.ts` rejects
  cookie-authenticated writes from other origins.
- **Rate limits** on every `/api` route plus stricter ones for login, booking, uploads and webhooks
  (`middleware/rateLimiters.ts`). Promo/member validation requires sign-in (no anonymous
  code/member-ID enumeration or member-PII lookup).
- **Input**: field allowlists and validators (`utils/validators.ts`); JSON bodies capped at 10 KB.
  Uploads (valid ID, payment proof) are type- and size-checked (`middleware/validIdUpload.ts`).
- **Prices** are calculated on the server from the room's stored rate; client totals are ignored.
- **Hotel webhooks** (`/api/bookings/hotel-events`, QR/media cache) need `HOTEL_WEBHOOK_SECRET`.
  Meta Messenger webhooks verify `X-Hub-Signature-256` when `MESSENGER_APP_SECRET` is set — set it.
- **Receipts and payment links** use signed, expiring receipt tokens (`utils/receiptToken.ts`).
- **Guest checkout** (`POST /api/bookings`) is public by design — no account needed to book:
  guarded by `bookingCreateLimiter`, field allowlists, server-side pricing, and one-time
  payment-proof reference/screenshot uniqueness. Guests give a name plus an email **or** a
  mobile number (any email provider — a Gmail/account sign-in is never required; a
  signed-in account email is only a prefill/fallback). Reading/managing a booking still
  requires the owning account or the signed receipt token.
- **Reviews** need a signed-in account with a completed, uncancelled stay at that room; one per stay, and
  the public name comes from the booking.
- Errors never return stack traces to clients. `/api/health` returns liveness only (no DB name/counts).
  Request logs redact `token`, `sig`, and credential query params.

## Frontend (`src/`, static site)

- Security headers for the static host are in `public/_headers` and `render.yaml` (CSP, HSTS,
  X-Frame-Options, Referrer-Policy, Permissions-Policy). `index.html` repeats the CSP as a fallback.
- External links go through `components/ui/SafeLink.tsx` (blocks `javascript:`/`data:` URLs, adds
  `noopener noreferrer`).
- No tokens are kept in localStorage.

## Automation (new implementations)

- **CI** (`.github/workflows/security.yml`, every push/PR + weekly): gitleaks secret scan,
  `npm audit --omit=dev --audit-level=high` gate (root + `server/`), server tests, frontend
  typecheck + build.
- **Dependabot** (`.github/dependabot.yml`): weekly npm + GitHub Actions update PRs.
- **Agent rule** (`.cursor/rules/security.mdc`, always applied): OWASP checklist + finish
  checklist for any feature work in this repo.

## Known gaps / operator actions

- The CSP still allows `'unsafe-inline'` scripts and styles.
- Payment proof is checked by hotel staff, not automatically.
- `server/data/localDatabase.json` (legacy seed with password hashes and guest PII) was removed
  from HEAD, but it still exists in **git history**. Rotate the affected user passwords and the
  hotel `access_password`, and purge history (e.g. `git filter-repo`) if the repo is ever shared
  more widely. Set `MESSENGER_APP_SECRET` on Render to enable webhook signature verification.
