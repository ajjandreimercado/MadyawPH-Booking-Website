import { Router } from 'express';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { UserModel } from '../data/mongoModels';
import { requireAuth } from '../middleware/auth';
import { authWriteLimiter } from '../middleware/rateLimiters';
import { serializeUser } from '../utils/serialize';
import { issueAuthCookie, COOKIE_NAME } from '../utils/issueAuthCookie';
import { GOOGLE_CLIENT_ID } from '../config/env';
// OWASP A03: schema-based field stripping and input validators
import { pickFields, validateString, validateEmail, validateId } from '../utils/validators';

const authRoutes = Router();

// ─── Constants ────────────────────────────────────────────────────────────────
const BCRYPT_ROUNDS = 12; // OWASP minimum for bcrypt

// Basic email regex — more permissive than RFC 5321 but catches obvious garbage.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Brute-force protection: max failed login attempts before account is soft-locked.
const MAX_FAILED_ATTEMPTS = 10;
const LOCKOUT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build the serialized user session and issue the auth cookie in one call.
 * This is the single code path for all auth methods (register/login/google).
 */
function buildAndIssueSession(
  res: Parameters<typeof issueAuthCookie>[0],
  user: {
    _id: unknown;
    email: string;
    name: string;
    role: 'guest' | 'partner' | 'admin' | 'staff' | 'super_admin';
    partner?: unknown;
    favorites?: unknown;
  },
) {
  issueAuthCookie(res, {
    userId: String(user._id),
    email: user.email,
    role: user.role === 'partner' ? 'partner' : 'guest',
  });
  return serializeUser(user as never);
}

/**
 * Verifies a Google ID token via Google's tokeninfo endpoint.
 * Returns the verified payload (email, sub, name, picture, email_verified).
 * Throws a typed error on any failure — the caller catches and maps to HTTP status.
 */
async function verifyGoogleIdToken(idToken: string): Promise<{
  email: string;
  sub: string;
  name: string;
  picture: string;
  email_verified: boolean;
}> {
  let payload: Record<string, string | undefined>;

  try {
    const response = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
    );

    if (!response.ok) {
      throw new GoogleTokenError('invalid_token', 'Invalid or expired Google token.');
    }

    payload = (await response.json()) as Record<string, string | undefined>;
  } catch (err) {
    if (err instanceof GoogleTokenError) throw err;
    // Network failure or JSON parse error
    throw new GoogleTokenError('invalid_token', 'Unable to verify Google token.');
  }

  if (!GOOGLE_CLIENT_ID) {
    throw new GoogleTokenError('server_error', 'GOOGLE_CLIENT_ID is not configured on the server.');
  }

  // Audience check — prevents tokens issued for other apps being accepted here.
  if (payload.aud !== GOOGLE_CLIENT_ID) {
    throw new GoogleTokenError('invalid_token', 'Google token audience does not match this application.');
  }

  // Email presence check
  if (!payload.email) {
    throw new GoogleTokenError('missing_email', 'Google account has no email address.');
  }

  // Google email verification check
  if (payload.email_verified !== 'true') {
    throw new GoogleTokenError('unverified_email', 'Google email is not verified.');
  }

  // Sub (Google user ID) presence check
  if (!payload.sub) {
    throw new GoogleTokenError('invalid_token', 'Google token is missing the user identifier (sub).');
  }

  return {
    email: payload.email.trim().toLowerCase(),
    sub: payload.sub,
    name: (payload.name ?? '').trim(),
    picture: payload.picture ?? '',
    email_verified: true,
  };
}

/** Typed error class so the Google route can distinguish failure modes. */
class GoogleTokenError extends Error {
  constructor(
    public readonly code: 'invalid_token' | 'missing_email' | 'unverified_email' | 'server_error',
    message: string,
  ) {
    super(message);
    this.name = 'GoogleTokenError';
  }
}

// ─── POST /register ────────────────────────────────────────────────────────────
authRoutes.post('/register', authWriteLimiter, async (req, res) => {
  // OWASP A03: strip unexpected fields (e.g. role, __proto__) before processing
  const body = pickFields(req.body, ['name', 'email', 'password'] as const);
  const { name, email, password } = body as {
    name?: string;
    email?: string;
    password?: string;
  };

  if (!name || typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 80) {
    return res.status(400).json({ message: 'Name must be between 2 and 80 characters.' });
  }

  if (!email || typeof email !== 'string' || !EMAIL_RE.test(email)) {
    return res.status(400).json({ message: 'A valid email address is required.' });
  }

  if (!password || typeof password !== 'string') {
    return res.status(400).json({ message: 'Password is required.' });
  }

  if (password.length < 8 || password.length > 128) {
    return res.status(400).json({ message: 'Password must be between 8 and 128 characters.' });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const existingUser = await UserModel.findOne({ email: normalizedEmail });

  if (existingUser) {
    return res.status(409).json({ message: 'An account with that email already exists.' });
  }

  // bcrypt with 12 rounds (OWASP minimum)
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const user = await UserModel.create({
    // _id must be set explicitly — the schema uses String type which disables auto-generation.
    _id: new mongoose.Types.ObjectId().toString(),
    name: name.trim(),
    email: normalizedEmail,
    password: passwordHash,
    role: 'guest',
    authProvider: 'local',
  });

  const serialized = buildAndIssueSession(res, user);
  return res.status(201).json({ user: serialized });
});

// ─── POST /login ───────────────────────────────────────────────────────────────
authRoutes.post('/login', authWriteLimiter, async (req, res) => {
  // OWASP A03: strip unexpected fields (e.g. rememberMe tokens, extra metadata)
  const body = pickFields(req.body, ['email', 'password'] as const);
  const { email, password } = body as { email?: string; password?: string };

  if (!email || typeof email !== 'string' || !EMAIL_RE.test(email)) {
    return res.status(400).json({ message: 'A valid email address is required.' });
  }

  if (!password || typeof password !== 'string') {
    return res.status(400).json({ message: 'Password is required.' });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const user = await UserModel.findOne({ email: normalizedEmail });

  // Use a constant-time compare regardless of whether the user exists to prevent timing attacks.
  // If user is null, or user has no password (OAuth-only account), compare against a dummy hash
  // so timing remains consistent and we don't leak which accounts exist.
  const DUMMY_HASH = '$2b$12$invalid.hash.for.timing.protection.xxxxxxxxxxxxxxxxxx';
  const hashToCompare = user?.password ?? DUMMY_HASH;
  const isValidPassword = await bcrypt.compare(password, hashToCompare);

  if (!user || !isValidPassword) {
    // Increment failed login counter if user exists
    if (user) {
      const now = Date.now();
      const windowStart = user.lockoutUntil ? (user.failedLoginAt ?? 0) : now;
      if (now - windowStart > LOCKOUT_WINDOW_MS) {
        user.failedLoginAttempts = 1;
        user.failedLoginAt = now;
      } else {
        user.failedLoginAttempts = (user.failedLoginAttempts ?? 0) + 1;
      }
      if ((user.failedLoginAttempts ?? 0) >= MAX_FAILED_ATTEMPTS) {
        user.lockoutUntil = now + LOCKOUT_WINDOW_MS;
      }
      await user.save();
    }
    return res.status(401).json({ message: 'Invalid email or password.' });
  }

  // Check if account is locked out
  if (user.lockoutUntil && user.lockoutUntil > Date.now()) {
    const minutesLeft = Math.ceil((user.lockoutUntil - Date.now()) / 60_000);
    return res.status(429).json({
      message: `Account is temporarily locked. Try again in ${minutesLeft} minute(s).`,
    });
  }

  // Reset failed attempts on successful login
  if (user.failedLoginAttempts) {
    user.failedLoginAttempts = 0;
    user.lockoutUntil = undefined;
    user.failedLoginAt = undefined;
    await user.save();
  }

  const serialized = buildAndIssueSession(res, user);
  return res.json({ user: serialized });
});

// ─── POST /google ───────────────────────────────────────────────────────────────
// Product decision: auto-create account on first Google sign-in. No extra step for the user.
authRoutes.post('/google', authWriteLimiter, async (req, res) => {
  // OWASP A03: strip unexpected fields; cap credential length (JWT max ~2048 chars)
  const body = pickFields(req.body, ['credential'] as const);
  const { credential } = body as { credential?: string };

  if (!credential || typeof credential !== 'string') {
    return res.status(400).json({ message: 'Google credential is required.' });
  }

  // Reject oversized credential to prevent DoS via large token string
  if (credential.length > 4096) {
    return res.status(400).json({ message: 'Google credential is invalid.' });
  }

  // ── Step 1: Verify the Google ID token ─────────────────────────────────────
  let googlePayload: Awaited<ReturnType<typeof verifyGoogleIdToken>>;
  try {
    googlePayload = await verifyGoogleIdToken(credential);
  } catch (error) {
    if (error instanceof GoogleTokenError) {
      // Map specific failure codes to correct HTTP statuses
      switch (error.code) {
        case 'missing_email':
          return res.status(400).json({ message: error.message });
        case 'unverified_email':
          return res.status(400).json({ message: error.message });
        case 'server_error':
          return res.status(500).json({ message: error.message });
        case 'invalid_token':
        default:
          return res.status(401).json({ message: error.message });
      }
    }
    return res.status(401).json({ message: 'Invalid Google token.' });
  }

  const { email, sub, name: googleName, picture } = googlePayload;

  // Derive a display name. Use what Google gave us, or fall back to the email prefix.
  const displayName = googleName || email.split('@')[0] || 'Google User';

  // ── Step 2: Look up existing user ──────────────────────────────────────────
  let user = await UserModel.findOne({ email });

  // ── Step 3: Handle each case ───────────────────────────────────────────────
  if (user) {
    // ── Case A: User exists — check for googleSub mismatch ─────────────────
    if (user.googleSub && user.googleSub !== sub) {
      // The email belongs to an account already linked to a DIFFERENT Google account.
      // This is a security violation — do not allow the sign-in.
      return res.status(409).json({
        message: 'This email is already registered with a different Google account. Please sign in with your original method.',
      });
    }

    // ── Case B: Existing user with no googleSub (account linking) ───────────
    // They previously registered with email/password; this is their first Google sign-in.
    let needsSave = false;

    if (!user.googleSub) {
      user.googleSub = sub;
      needsSave = true;
    }

    if (!user.avatar && picture) {
      user.avatar = picture;
      needsSave = true;
    }

    if (!user.emailVerified) {
      user.emailVerified = true;
      needsSave = true;
    }

    // Fill in the name if the account somehow has none
    if (!user.name) {
      user.name = displayName;
      needsSave = true;
    }

    if (needsSave) {
      await user.save();
    }
  } else {
    // ── Case C: New user — first-time Google sign-up ────────────────────────
    // Auto-create the account. No friction. No extra step.
    try {
      user = await UserModel.create({
        // _id must be set explicitly — the schema uses String type which disables auto-generation.
        _id: new mongoose.Types.ObjectId().toString(),
        name: displayName,
        email,
        // No password — this is an OAuth user. The schema now allows this (password is optional).
        googleSub: sub,
        emailVerified: true,
        avatar: picture || undefined,
        role: 'guest',
        authProvider: 'google',
      });
    } catch (createError: unknown) {
      // ── Race condition guard ────────────────────────────────────────────────
      // Two concurrent requests for the same email hit simultaneously; the second
      // one gets an E11000 duplicate-key error on the email unique index.
      // Fall back to fetching the document created by the winner and proceed.
      const mongoError = createError as { code?: number; message?: string };
      if (mongoError.code === 11000) {
        const fallbackUser = await UserModel.findOne({ email });
        if (fallbackUser) {
          user = fallbackUser;
        } else {
          // Should never happen — the duplicate key means the doc exists.
          return res.status(500).json({ message: 'Account creation conflict. Please try again.' });
        }
      } else {
        throw createError; // Re-throw non-duplicate errors to the global error handler
      }
    }
  }

  // ── Step 4: Issue JWT + cookie + return serialized user ────────────────────
  // Single code path regardless of whether the user was found or just created.
  const serialized = buildAndIssueSession(res, user);
  return res.json({ user: serialized });
});

// ─── POST /logout ──────────────────────────────────────────────────────────────
authRoutes.post('/logout', requireAuth, (_req, res) => {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: (process.env.NODE_ENV === 'production' ? 'strict' : 'lax') as 'strict' | 'lax',
    path: '/',
  });
  return res.json({ ok: true });
});

// ─── GET /me ───────────────────────────────────────────────────────────────────
authRoutes.get('/me', requireAuth, async (req, res) => {
  if (!req.auth) {
    return res.status(401).json({ message: 'Unauthorized.' });
  }

  const user = await UserModel.findById(req.auth.userId);

  if (!user) {
    return res.status(404).json({ message: 'User not found.' });
  }

  return res.json(serializeUser(user as never));
});

// ─── POST /favorites ───────────────────────────────────────────────────────────
authRoutes.post('/favorites', requireAuth, async (req, res) => {
  // OWASP A03: strip extra fields; validate propertyId length
  const body = pickFields(req.body, ['propertyId'] as const);
  const rawPropertyId = (body as { propertyId?: unknown }).propertyId;

  const idResult = validateId(rawPropertyId, 'Property ID');
  if (!idResult.ok) {
    return res.status(400).json({ message: idResult.message });
  }
  const propertyId = idResult.value;

  const user = await UserModel.findById(req.auth!.userId);
  if (!user) return res.status(404).json({ message: 'User not found.' });

  if (!user.favorites) user.favorites = [];

  // propertyId is already validated and trimmed above
  if (!user.favorites.includes(propertyId)) {
    user.favorites.push(propertyId);
    await user.save();
  }

  return res.json({ favorites: user.favorites });
});

// ─── DELETE /favorites/:propertyId ────────────────────────────────────────────
authRoutes.delete('/favorites/:propertyId', requireAuth, async (req, res) => {
  const { propertyId } = req.params;

  const user = await UserModel.findById(req.auth!.userId);
  if (!user) return res.status(404).json({ message: 'User not found.' });

  if (user.favorites) {
    user.favorites = user.favorites.filter((id) => id !== propertyId);
    await user.save();
  }

  return res.json({ favorites: user.favorites ?? [] });
});

export default authRoutes;