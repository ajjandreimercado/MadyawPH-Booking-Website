import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv, type Plugin } from 'vite';

/**
 * Fail the frontend build if any VITE_* env looks like a server secret.
 * Vite embeds every VITE_ variable into the public JS bundle — secrets must
 * never use that prefix.
 */
function blockSecretViteEnv(env: Record<string, string>): Plugin {
  const forbiddenPatterns = [
    /secret/i,
    /password/i,
    /private[_-]?key/i,
    /mongodb/i,
    /jwt/i,
    /xendit/i,
    /resend/i,
    /^VITE_.*_KEY$/i,
    /^VITE_API_KEY$/i,
  ];
  // Public-by-design identifiers that may contain "key"-like names are allowlisted.
  const allowlist = new Set([
    'VITE_API_URL',
    'VITE_API_PROXY_TARGET',
    'VITE_GOOGLE_CLIENT_ID',
    'VITE_GOOGLE_REDIRECT_URI',
    'VITE_DEBUG_API',
  ]);

  return {
    name: 'block-secret-vite-env',
    configResolved() {
      for (const [name, value] of Object.entries(env)) {
        if (!name.startsWith('VITE_') || !value) continue;
        if (allowlist.has(name)) continue;
        if (forbiddenPatterns.some((pattern) => pattern.test(name))) {
          throw new Error(
            `[SECURITY] Refusing to build: ${name} looks like a server secret.\n` +
              '  Vite embeds all VITE_* variables in the public browser bundle.\n' +
              '  Keep JWT / Mongo / Xendit / Resend keys in server/.env (or Render) only — never as VITE_*.',
          );
        }
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  // Only load VITE_* vars into this config object — never pull server secrets
  // from a shared root .env into the Vite process unnecessarily.
  const env = loadEnv(mode, '.', 'VITE_');

  return {
    plugins: [react(), tailwindcss(), blockSecretViteEnv(env)],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      proxy: {
        '/api': {
          target: env.VITE_API_PROXY_TARGET ?? 'http://localhost:5001',
          changeOrigin: true,
        },
      },
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
