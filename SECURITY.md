# Security notes

What protects the site today, and where it lives. Enforcement is on the API; the frontend only mirrors it.

## API (`server/`)

- **Secrets** stay in `server/.env` / the Render dashboard. The server refuses to start with a missing,
  short (< 32 chars) or placeholder `JWT_SECRET`, or a localhost `MONGODB_URI` in production.
- **Sessions** (staff/admin only; guests do not sign in) are JWTs in an httpOnly cookie
  (`utils/issueAuthCookie.ts`), checked by `middleware/auth.ts`.
- **Headers**: helmet with CSP, HSTS and a Permissions-Policy (`app.ts`).
- **CORS** allows only the origins in `CLIENT_ORIGIN`; `middleware/csrfOriginGuard.ts` rejects
  cookie-authenticated writes from other origins.
- **Rate limits** on every `/api` route plus stricter ones for login, booking, uploads and webhooks
  (`middleware/rateLimiters.ts`).
- **Input**: field allowlists and validators (`utils/validators.ts`); JSON bodies capped at 10 KB.
  Uploads (valid ID, payment proof) are type- and size-checked (`middleware/validIdUpload.ts`).
- **Prices** are calculated on the server from the room's stored rate; client totals are ignored.
- **Hotel webhooks** (`/api/bookings/hotel-events`, QR/media cache) need `HOTEL_WEBHOOK_SECRET`.
- **Receipts and payment links** use signed, expiring receipt tokens (`utils/receiptToken.ts`).
- **Reviews** need a signed-in account with a completed, uncancelled stay at that room; one per stay, and
  the public name comes from the booking.
- Errors never return stack traces to clients.

## Frontend (`src/`, static site)

- Security headers for the static host are in `public/_headers` and `render.yaml` (CSP, HSTS,
  X-Frame-Options, Referrer-Policy, Permissions-Policy). `index.html` repeats the CSP as a fallback.
- External links go through `components/ui/SafeLink.tsx` (blocks `javascript:`/`data:` URLs, adds
  `noopener noreferrer`).
- No tokens are kept in localStorage.

## Known gaps

- The CSP still allows `'unsafe-inline'` scripts and styles.
- Payment proof is checked by hotel staff, not automatically.
