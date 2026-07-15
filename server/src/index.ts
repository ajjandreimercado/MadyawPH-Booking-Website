import app from './app';
import { connectDatabase } from './config/db';
import { PORT } from './config/env';

// ─── Startup env validation (fail fast with a clear message) ──────────────────
const REQUIRED_ENV_VARS = ['PORT', 'JWT_SECRET', 'JWT_EXPIRES_IN', 'CLIENT_ORIGIN', 'MONGODB_URI'];

for (const key of REQUIRED_ENV_VARS) {
  if (!process.env[key]) {
    console.error(`[STARTUP ERROR] Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

// OWASP A02 (Cryptographic Failures): reject the known-weak placeholder in ALL environments.
// A developer who skips setting a real secret gets an immediate failure, not a silently insecure app.
const WEAK_JWT_SECRETS = new Set([
  'change-this-in-development',
  'CHANGE_THIS_TO_A_LONG_RANDOM_SECRET_AT_LEAST_64_CHARS',
  'secret',
  'jwt_secret',
]);

if (WEAK_JWT_SECRETS.has(process.env.JWT_SECRET ?? '')) {
  console.error(
    '[STARTUP ERROR] JWT_SECRET is set to a known-weak placeholder value.\n' +
    '  Generate a strong secret with: openssl rand -hex 64\n' +
    '  Then set it in server/.env before starting the server.',
  );
  process.exit(1);
}

// Additional check: JWT_SECRET should be at least 32 characters.
if ((process.env.JWT_SECRET ?? '').length < 32) {
  console.error(
    '[STARTUP ERROR] JWT_SECRET is too short (minimum 32 characters).\n' +
    '  Generate a strong secret with: openssl rand -hex 64',
  );
  process.exit(1);
}

// ─── MongoDB URI safety checks ────────────────────────────────────────────────
// Prevent the server from booting with a placeholder or localhost URI in production.
const mongoUri = process.env.MONGODB_URI ?? '';

// Block known placeholder values that ship in .env.example.
const PLACEHOLDER_MONGO_URIS = [
  'mongodb://localhost:27017/madyaw_booking',
  'mongodb://localhost:27017/madyaw',
  'mongodb://change-this',
  'REPLACE_WITH_YOUR_MONGODB_URI',
];
if (PLACEHOLDER_MONGO_URIS.some(p => mongoUri.startsWith(p.split('/').slice(0, 3).join('/')))) {
  // Only block localhost URIs in production — dev is fine with a local DB.
  if (process.env.NODE_ENV === 'production') {
    console.error(
      '[STARTUP ERROR] MONGODB_URI points to localhost but NODE_ENV=production.\n' +
      '  Set MONGODB_URI to your production Atlas connection string in server/.env.',
    );
    process.exit(1);
  }
}

// Log only the masked URI so credentials never appear in stdout/logs.
const safeMongo = mongoUri.replace(/:\/\/[^@]*@/, '://***:***@');
console.log(`[STARTUP] MongoDB target: ${safeMongo}`);


async function start() {
  await connectDatabase();

  const server = app.listen(PORT, () => {
    console.log(`[INFO] Madyaw API running on http://localhost:${PORT} (env: ${process.env.NODE_ENV ?? 'development'})`);
  });

  // ─── Graceful shutdown — drain connections before exiting ───────────────────
  function shutdown(signal: string) {
    console.log(`\n[INFO] ${signal} received. Closing HTTP server gracefully…`);
    server.close((err) => {
      if (err) {
        console.error('[ERROR] Error during graceful shutdown:', err);
        process.exit(1);
      }
      console.log('[INFO] HTTP server closed. Exiting.');
      process.exit(0);
    });

    // Force-kill if connections haven't drained within 10 seconds.
    setTimeout(() => {
      console.error('[ERROR] Forced shutdown: connections did not drain in 10 s.');
      process.exit(1);
    }, 10_000).unref();
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

void start().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Failed to start the API server.';
  console.error('[FATAL]', message);
  process.exit(1);
});