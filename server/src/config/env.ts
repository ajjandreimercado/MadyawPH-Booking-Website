import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env'), override: true });

function requireEnv(name: string): string {
	const value = process.env[name];

	if (!value) {
		throw new Error(`Missing ${name} in server/.env`);
	}

	return value;
}

export const PORT = Number(requireEnv('PORT'));
export const JWT_SECRET = requireEnv('JWT_SECRET');
export const JWT_EXPIRES_IN = requireEnv('JWT_EXPIRES_IN');
export const CLIENT_ORIGIN = requireEnv('CLIENT_ORIGIN');
export const MONGODB_URI = requireEnv('MONGODB_URI');
// GOOGLE_CLIENT_ID is required for the POST /auth/google route.
// The server still boots without it (to support non-OAuth environments), but
// every Google sign-in will fail with a 500. Log a clear warning at startup.
const _googleClientId = process.env.GOOGLE_CLIENT_ID ?? '';
if (!_googleClientId) {
  console.warn('[CONFIG] GOOGLE_CLIENT_ID is not set. Google OAuth sign-in will be unavailable.');
}
export const GOOGLE_CLIENT_ID = _googleClientId;