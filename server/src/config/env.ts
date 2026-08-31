import dotenv from 'dotenv';
import path from 'path';

// Secrets live ONLY in server/.env (or the host env, e.g. Render dashboard).
// Never put JWT / Mongo / Xendit / Resend keys in the frontend Vite env.
dotenv.config({ path: path.resolve(__dirname, '../../.env'), override: true });

function requireEnv(name: string): string {
	const raw = process.env[name];

	if (!raw || !raw.trim()) {
		throw new Error(`Missing ${name} in environment variables`);
	}

	// Trim whitespace/newlines that can sneak in from copy-paste in dashboards.
	return raw.trim();
}

function optionalEnv(name: string): string {
  return (process.env[name] ?? '').trim();
}

export const PORT = Number(requireEnv('PORT'));
export const JWT_SECRET = requireEnv('JWT_SECRET');
export const JWT_EXPIRES_IN = requireEnv('JWT_EXPIRES_IN');
export const MONGODB_URI = requireEnv('MONGODB_URI');

// ─── CLIENT_ORIGIN(S): supports comma-separated list of allowed origins ─────────
// Examples:
//   Single:   https://madyaw.com
//   Multiple: https://madyaw.com,https://madyaw-frontend.onrender.com
const _rawOrigins = requireEnv('CLIENT_ORIGIN');

export const CLIENT_ORIGINS: string[] = _rawOrigins
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

// Validate each origin is a proper URL to catch bad Render env values early.
for (const origin of CLIENT_ORIGINS) {
  try {
    new URL(origin);
  } catch {
    throw new Error(
      `[CONFIG] CLIENT_ORIGIN contains an invalid URL: "${origin}"\n` +
      '  Use comma-separated URLs, e.g. https://madyaw.com,https://madyaw-frontend.onrender.com',
    );
  }
}

// Log allowed origins at startup (safe — no secrets here).
console.log(`[CONFIG] CORS allowed origins: ${CLIENT_ORIGINS.join(', ')}`);

// GOOGLE_CLIENT_ID is required for the POST /auth/google route.
// The server still boots without it (to support non-OAuth environments), but
// every Google sign-in will fail with a 500. Log a clear warning at startup.
const _googleClientId = optionalEnv('GOOGLE_CLIENT_ID');
if (!_googleClientId) {
  console.warn('[CONFIG] GOOGLE_CLIENT_ID is not set. Google OAuth sign-in will be unavailable.');
}
export const GOOGLE_CLIENT_ID = _googleClientId;

// ─── Provider secrets (server-only — never send these in API responses) ────────
// Accessed via getters so call sites cannot accidentally import a raw constant
// into a route serializer or log dump.

/** Xendit secret key. Empty when online payments are disabled. */
export function getXenditSecretKey(): string {
  return optionalEnv('XENDIT_SECRET_KEY');
}

/** Resend API key. Empty when email falls back to console logging. */
export function getResendApiKey(): string {
  return optionalEnv('RESEND_API_KEY');
}

export function getEmailFrom(): string {
  return optionalEnv('EMAIL_FROM') || 'Madyaw Bookings <noreply@madyaw.com>';
}

export function getHotelAppPublicUrl(): string {
  return optionalEnv('HOTEL_APP_PUBLIC_URL').replace(/\/+$/, '');
}

/** Optional CDN / S3 public prefix for hotel-app storage paths (no trailing slash). */
export function getHotelStoragePublicUrl(): string {
  return optionalEnv('HOTEL_STORAGE_PUBLIC_URL').replace(/\/+$/, '');
}
/** Shared secret for hotel-app → website webhook (Authorization: Bearer …). */
export function getHotelWebhookSecret(): string {
  return optionalEnv('HOTEL_WEBHOOK_SECRET');
}

/** Meta Messenger Page access token (server-only). */
export function getMessengerPageAccessToken(): string {
  return optionalEnv('MESSENGER_PAGE_ACCESS_TOKEN');
}

/** Meta webhook verify token — you choose this string; must match Meta dashboard. */
export function getMessengerVerifyToken(): string {
  return optionalEnv('MESSENGER_VERIFY_TOKEN');
}

/** Public website origin for "Book on website" links in Messenger. */
export function getMadyawPublicUrl(): string {
  const raw = optionalEnv('MADYAW_PUBLIC_URL');
  if (raw) return raw.replace(/\/+$/, '');
  const firstOrigin = CLIENT_ORIGINS[0];
  return firstOrigin ? firstOrigin.replace(/\/+$/, '') : 'https://madyaw.com';
}

/** Public booking API base (includes /api suffix) for proxied hotel media URLs. */
export function getMadyawApiPublicUrl(): string {
  const raw = optionalEnv('MADYAW_API_PUBLIC_URL');
  if (raw) return raw.replace(/\/+$/, '');
  return 'https://madyaw-api.onrender.com/api';
}

/**
 * Database name for Mongoose. Defaults to `hotel_hms` (shared with the hotel app)
 * so a cluster URL copied without a path does not silently use empty `test` DB.
 * Set MONGODB_DB_NAME=auto to use only the path in MONGODB_URI.
 */
export function getMongoDbName(): string | undefined {
  const raw = optionalEnv('MONGODB_DB_NAME');
  if (raw.toLowerCase() === 'auto') return undefined;
  if (raw) return raw;
  if (process.env.NODE_ENV === 'test') return undefined;
  return 'hotel_hms';
}

export function isMessengerEnabled(): boolean {
  return Boolean(getMessengerPageAccessToken() && getMessengerVerifyToken());
}

/**
 * Mongo change stream on external_reservations (Atlas replica set).
 * Default: on in production, off in test. Set ENABLE_EXTERNAL_RESERVATION_WATCHER=false to disable.
 */
export function isExternalReservationWatcherEnabled(): boolean {
  const raw = optionalEnv('ENABLE_EXTERNAL_RESERVATION_WATCHER').toLowerCase();
  if (raw === 'false' || raw === '0' || raw === 'off') return false;
  if (raw === 'true' || raw === '1' || raw === 'on') return true;
  return process.env.NODE_ENV !== 'test';
}

/**
 * Refuse to boot if someone mistakenly put server secrets under a VITE_ name
 * on this process (would indicate a misconfigured shared env file).
 */
const FORBIDDEN_CLIENT_SECRET_NAMES = [
  'VITE_JWT_SECRET',
  'VITE_MONGODB_URI',
  'VITE_XENDIT_SECRET_KEY',
  'VITE_RESEND_API_KEY',
  'VITE_XENDIT_SECRET',
  'VITE_API_SECRET',
];

for (const name of FORBIDDEN_CLIENT_SECRET_NAMES) {
  if (optionalEnv(name)) {
    throw new Error(
      `[CONFIG] Refusing to start: ${name} is set. ` +
        'Server secrets must never use the VITE_ prefix (that prefix is embedded in the public browser bundle).',
    );
  }
}