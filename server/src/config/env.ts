import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env'), override: true });

function requireEnv(name: string): string {
	const raw = process.env[name];

	if (!raw || !raw.trim()) {
		throw new Error(`Missing ${name} in environment variables`);
	}

	// Trim whitespace/newlines that can sneak in from copy-paste in dashboards.
	return raw.trim();
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
const _googleClientId = (process.env.GOOGLE_CLIENT_ID ?? '').trim();
if (!_googleClientId) {
  console.warn('[CONFIG] GOOGLE_CLIENT_ID is not set. Google OAuth sign-in will be unavailable.');
}
export const GOOGLE_CLIENT_ID = _googleClientId;