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

// ─── CLIENT_ORIGIN: validate it is a proper URL to catch bad Render env values ──
const _rawOrigin = requireEnv('CLIENT_ORIGIN');
try {
  new URL(_rawOrigin);
} catch {
  throw new Error(
    `[CONFIG] CLIENT_ORIGIN is not a valid URL: "${_rawOrigin}"\n` +
    '  Set it to your frontend URL e.g. https://madyaw-frontend.onrender.com (no trailing slash)',
  );
}
export const CLIENT_ORIGIN = _rawOrigin;

// GOOGLE_CLIENT_ID is required for the POST /auth/google route.
// The server still boots without it (to support non-OAuth environments), but
// every Google sign-in will fail with a 500. Log a clear warning at startup.
const _googleClientId = (process.env.GOOGLE_CLIENT_ID ?? '').trim();
if (!_googleClientId) {
  console.warn('[CONFIG] GOOGLE_CLIENT_ID is not set. Google OAuth sign-in will be unavailable.');
}
export const GOOGLE_CLIENT_ID = _googleClientId;