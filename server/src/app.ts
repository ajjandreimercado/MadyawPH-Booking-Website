import 'express-async-errors';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { CLIENT_ORIGINS } from './config/env';
import authRoutes from './routes/authRoutes';
import hotelRoutes from './routes/hotelRoutes';
import bookingRoutes from './routes/bookingRoutes';
import propertyRoutes from './routes/propertyRoutes';
import roomCategoryRoutes from './routes/roomCategoryRoutes';
import reviewRoutes from './routes/reviewRoutes';
import promoCodeRoutes from './routes/promoCodeRoutes';
import memberRoutes from './routes/memberRoutes';
import messengerRoutes from './routes/messengerRoutes';
import { requestLogger, getUptimeMs } from './middleware/logger';
// Centralised rate limiters — user-keyed with graceful 429s (OWASP A04/A07)
import { apiLimiter } from './middleware/rateLimiters';

const app = express();

// ─── Trust proxy — required when running behind nginx/GoDaddy reverse proxy ────
// Without this, req.ip = '127.0.0.1' (the proxy) for ALL users, breaking rate
// limiting (every request shares one bucket instead of being keyed per client).
// '1' = trust exactly one hop (the nginx reverse proxy). Increase if behind
// multiple proxies (e.g. CDN → load-balancer → nginx).
app.set('trust proxy', 1);

// ─── Security headers (helmet with explicit CSP/HSTS) ─────────────────────────
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", 'https:'],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        frameSrc: ["'none'"],
      },
    },
    hsts: {
      maxAge: 31_536_000, // 1 year
      includeSubDomains: true,
      preload: true,
    },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    permittedCrossDomainPolicies: { permittedPolicies: 'none' },
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    // X-Frame-Options, X-Content-Type-Options, X-DNS-Prefetch-Control all on by default
  }),
);

// ─── CORS — explicit allowlist, never wildcard ────────────────────────────────
// CLIENT_ORIGINS is parsed from the comma-separated CLIENT_ORIGIN env var.
// Example: https://madyaw.com,https://madyaw-frontend.onrender.com
const allowedOriginSet = new Set(CLIENT_ORIGINS);
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (server-to-server, curl, Render health checks)
      if (!origin) return callback(null, true);
      if (allowedOriginSet.has(origin)) return callback(null, true);
      callback(new Error(`CORS: origin '${origin}' not in allowlist`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    optionsSuccessStatus: 200,
  }),
);

// ─── Cookie parser + body ─────────────────────────────────────────────────────
app.use(cookieParser());
app.use(express.json({ limit: '10kb' }));

// ─── Request logger ───────────────────────────────────────────────────────────
app.use(requestLogger);

// ─── Meta Messenger webhook (before apiLimiter — Meta verification must not 429) ─
app.use('/api/messenger', messengerRoutes);

// ─── Global rate limiter (protects all /api/* routes) ───────────────────────
// Imported from rateLimiters.ts — user-keyed (userId fallback to IP),
// graceful 429 with Retry-After header, never skipped (dev uses a high max).
app.use(apiLimiter);

// ─── Health check (no auth, before route handlers) ───────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'madyaw-booking-api',
    uptime: Math.round(getUptimeMs() / 1000),
    timestamp: new Date().toISOString(),
  });
});

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/hotels', hotelRoutes);
app.use('/api/room-categories', roomCategoryRoutes);
app.use('/api/properties', propertyRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/promo-codes', promoCodeRoutes);
app.use('/api/members', memberRoutes);

// ─── 404 handler ─────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ message: 'Route not found.' });
});

// ─── Global error handler ─────────────────────────────────────────────────────
// Structured error responses with status codes — no plain 500 with stack traces.
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  // Log full error server-side but never expose internals to the client.
  console.error('[ERROR]', error);

  if (res.headersSent) {
    return;
  }

  const isOperational = error instanceof Error && 'statusCode' in error;
  const statusCode = isOperational ? (error as Error & { statusCode: number }).statusCode : 500;
  const rawMessage = error instanceof Error ? error.message : 'Unexpected server error.';
  // In production, hide unexpected internal messages (may include provider noise).
  const message =
    process.env.NODE_ENV === 'production' && statusCode >= 500 && !isOperational
      ? 'Unexpected server error.'
      : rawMessage;

  // Never leak stack traces or internal details to clients.
  res.status(statusCode).json({ message, status: 'error' });
});

export default app;