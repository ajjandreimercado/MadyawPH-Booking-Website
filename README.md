# Madyaw booking website

Guest-facing booking site for Madyaw partner hotels (www.madyaw.com). Guests search hotels, pick a room
type and dates, and send a **reservation request**. The hotel reviews it in the separate hotel management
app; after it confirms, the guest pays the full stay online by scanning the hotel's GCash/Maya QR and
uploading proof. Guests do not sign in.

The website and the hotel app share one MongoDB database (`hotel_hms`). This repo holds only the website.

```
src/      React 19 + Vite + Tailwind frontend (static site)
server/   Express + Mongoose API (TypeScript), tests in server/src/__tests__
public/   static files, including _headers (security headers for the static host)
render.yaml  Render blueprint: madyaw-api (web service) + madyaw-frontend (static site)
```

## How a booking flows

1. `POST /api/bookings` saves the booking (`status: pending`) and an `external_reservations` row
   (`pending_approval`) so it shows in the hotel app's Online Bookings queue. The guest gets a
   "request received" email.
2. The hotel approves, declines or cancels in the hotel app. The API picks this up from a MongoDB change
   stream (`external_reservations` and `bookings`) or from the `POST /api/bookings/hotel-events` webhook,
   updates the booking and emails the guest in the hotel's name.
3. After approval the guest pays and uploads proof (`POST /api/bookings/:id/payment-proof`); the hotel
   verifies it in the hotel app.

Room availability is date-based (`server/src/utils/roomAvailability.ts`): it counts website and hotel-app
bookings, including checked-in guests. Requests the hotel has not reviewed stop holding a room after
48 hours.

## Run locally

Requires Node.js 20+.

```bash
npm install
npm --prefix server install
cp server/.env.example server/.env   # then fill in JWT_SECRET, MONGODB_URI, CLIENT_ORIGIN
npm run dev                          # API on :5001, site on :3000 (Vite proxies /api)
```

Tests and type checks:

```bash
npm --prefix server test
npm run lint                 # frontend type check
```

## Configuration

- `server/.env` (see `server/.env.example`): `JWT_SECRET`, `MONGODB_URI`, `CLIENT_ORIGIN`, and optional
  `RESEND_API_KEY` / `EMAIL_FROM` (email), `HOTEL_APP_PUBLIC_URL` (where hotel photos and QR files live),
  `MADYAW_API_PUBLIC_URL`, `HOTEL_WEBHOOK_SECRET`, Messenger tokens.
- Frontend (`.env.example`): only public `VITE_*` values, e.g. `VITE_API_URL`. Anything `VITE_*` ends up
  in the browser bundle, so never put secrets there.

## Deploy

Pushing to `main` redeploys both Render services. The API's `/api/health` is pinged every 5 minutes by
UptimeRobot so the free instance does not sleep.
