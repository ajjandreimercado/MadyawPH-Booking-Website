/**
 * Google OAuth route tests — covers all 8 cases:
 *  1. Existing user → 200 + cookie
 *  2. New user (first Google login) → creates account, 200 + cookie
 *  3. Existing email/password user with no googleSub → links sub, 200
 *  4. Missing email in payload → 400
 *  5. email_verified false → 400
 *  6. Invalid/expired token → 401
 *  7. googleSub mismatch on existing account → 409
 *  8. Race condition duplicate key → graceful fallback, 200
 *
 * Google's tokeninfo endpoint is mocked via global fetch so no network calls are made.
 */
import './testSetup'; // MUST be first: sets process.env before any other import
import request from 'supertest';
import app from '../app';

// ─── Types ────────────────────────────────────────────────────────────────────

interface MockUserDoc {
  _id: string;
  email: string;
  name: string;
  role: 'guest' | 'partner' | 'admin' | 'staff' | 'super_admin';
  googleSub?: string;
  avatar?: string;
  emailVerified?: boolean;
  authProvider?: string;
  password?: string;
  favorites?: string[];
  partner?: unknown;
  lockoutUntil?: number;
  failedLoginAttempts?: number;
  failedLoginAt?: number;
  save: jest.Mock;
}

// ─── Mock UserModel ───────────────────────────────────────────────────────────

jest.mock('../data/mongoModels', () => ({
  UserModel: {
    findOne: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
  },
  BookingModel: {
    find: jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnValue({
        skip: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
        }),
      }),
    }),
    countDocuments: jest.fn().mockResolvedValue(0),
    findById: jest.fn(),
    create: jest.fn(),
  },
  PropertyModel: { find: jest.fn(), findById: jest.fn() },
  HotelModel: { find: jest.fn(), findById: jest.fn() },
  RoomCategoryModel: { find: jest.fn(), findById: jest.fn() },
  ReviewModel: {
    find: jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnValue({
        skip: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
        }),
      }),
    }),
    countDocuments: jest.fn().mockResolvedValue(0),
    create: jest.fn(),
  },
}));

import { UserModel } from '../data/mongoModels';
const MockUserModel = UserModel as jest.Mocked<typeof UserModel>;

// ─── Mock fetch (Google tokeninfo endpoint) ────────────────────────────────────

/**
 * Replaces the global `fetch` with a mock that returns a controlled Google tokeninfo response.
 * Google's verifyIdToken uses: GET https://oauth2.googleapis.com/tokeninfo?id_token=...
 */
function mockGoogleTokenInfo(payload: Record<string, string>) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => payload,
  } as Response);
}

function mockGoogleTokenInfoFailure() {
  global.fetch = jest.fn().mockResolvedValue({
    ok: false,
    json: async () => ({ error: 'invalid_token' }),
  } as Response);
}

/** Returns a valid-looking Google tokeninfo payload. */
function validGooglePayload(overrides: Partial<Record<string, string>> = {}): Record<string, string> {
  return {
    aud: process.env.GOOGLE_CLIENT_ID!,
    email: 'alice@gmail.com',
    email_verified: 'true',
    sub: 'google-sub-abc123',
    name: 'Alice Example',
    picture: 'https://lh3.googleusercontent.com/photo.jpg',
    ...overrides,
  };
}

/** Builds a mock Mongoose document with a working .save() method. */
function makeMockUser(overrides: Partial<MockUserDoc> = {}): MockUserDoc {
  return {
    _id: 'user-google-001',
    email: 'alice@gmail.com',
    name: 'Alice Example',
    role: 'guest',
    authProvider: 'google',
    googleSub: 'google-sub-abc123',
    emailVerified: true,
    avatar: 'https://lh3.googleusercontent.com/photo.jpg',
    favorites: [],
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('POST /api/auth/google', () => {
  afterEach(() => {
    jest.clearAllMocks();
    // Restore global fetch after each test
    global.fetch = jest.fn();
  });

  // ── 1. Existing user → 200 + cookie ─────────────────────────────────────────
  it('returns 200 and sets a cookie when an existing Google user signs in', async () => {
    mockGoogleTokenInfo(validGooglePayload());
    MockUserModel.findOne.mockResolvedValue(makeMockUser() as never);

    const res = await request(app)
      .post('/api/auth/google')
      .send({ credential: 'valid-google-token' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('user');
    expect(res.body.user.email).toBe('alice@gmail.com');
    expect(res.body.user.password).toBeUndefined();
    // Auth cookie must be set
    const cookies = res.headers['set-cookie'] as string[] | string;
    const cookieList = Array.isArray(cookies) ? cookies : [cookies];
    expect(cookieList.some((c) => c.startsWith('madyaw_token='))).toBe(true);
  });

  // ── 2. New user → auto-creates account, 200 + cookie ────────────────────────
  it('creates a new account and returns 200 when no user exists for the Google email', async () => {
    mockGoogleTokenInfo(validGooglePayload());
    MockUserModel.findOne.mockResolvedValue(null); // no existing user
    MockUserModel.create.mockResolvedValue(makeMockUser() as never);

    const res = await request(app)
      .post('/api/auth/google')
      .send({ credential: 'valid-google-token-new-user' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('user');
    expect(MockUserModel.create).toHaveBeenCalledTimes(1);

    // Confirm create() was called with the correct shape for an OAuth user
    const createArgs = (MockUserModel.create as jest.Mock).mock.calls[0][0] as Record<string, unknown>;
    expect(createArgs.email).toBe('alice@gmail.com');
    expect(createArgs.googleSub).toBe('google-sub-abc123');
    expect(createArgs.role).toBe('guest');
    expect(createArgs.emailVerified).toBe(true);
    expect(createArgs.password).toBeUndefined(); // OAuth users have no password

    // Cookie must be set
    const cookies = res.headers['set-cookie'] as string[] | string;
    const cookieList = Array.isArray(cookies) ? cookies : [cookies];
    expect(cookieList.some((c) => c.startsWith('madyaw_token='))).toBe(true);
  });

  // ── 3. Email/password user, no googleSub → link sub, 200 ────────────────────
  it('links googleSub to an existing email/password account and returns 200', async () => {
    mockGoogleTokenInfo(validGooglePayload());

    // User exists but has no googleSub — they registered with email/password first
    const mockUser = makeMockUser({
      googleSub: undefined,
      authProvider: 'local',
      password: '$2b$12$hashedpassword',
    });
    MockUserModel.findOne.mockResolvedValue(mockUser as never);

    const res = await request(app)
      .post('/api/auth/google')
      .send({ credential: 'valid-google-token-linking' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('user');
    // save() must have been called to persist the linked googleSub
    expect(mockUser.save).toHaveBeenCalled();
    // googleSub must now be set on the in-memory document
    expect(mockUser.googleSub).toBe('google-sub-abc123');
  });

  // ── 4. Missing email in Google payload → 400 ─────────────────────────────────
  it('returns 400 when the Google token payload has no email', async () => {
    mockGoogleTokenInfo(validGooglePayload({ email: '' }));

    const res = await request(app)
      .post('/api/auth/google')
      .send({ credential: 'token-with-no-email' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/no email/i);
  });

  // ── 5. email_verified false → 400 ────────────────────────────────────────────
  it('returns 400 when the Google email is not verified', async () => {
    mockGoogleTokenInfo(validGooglePayload({ email_verified: 'false' }));

    const res = await request(app)
      .post('/api/auth/google')
      .send({ credential: 'token-unverified-email' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/not verified/i);
  });

  // ── 6. Invalid/expired token → 401 ───────────────────────────────────────────
  it('returns 401 when the Google tokeninfo endpoint rejects the token', async () => {
    mockGoogleTokenInfoFailure();

    const res = await request(app)
      .post('/api/auth/google')
      .send({ credential: 'expired-or-invalid-token' });

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('message');
  });

  // ── 6b. Missing credential body → 400 ────────────────────────────────────────
  it('returns 400 when no credential is provided', async () => {
    const res = await request(app)
      .post('/api/auth/google')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/credential is required/i);
  });

  // ── 7. googleSub mismatch → 409 ───────────────────────────────────────────────
  it('returns 409 when the email is already linked to a different Google account', async () => {
    mockGoogleTokenInfo(validGooglePayload({ sub: 'google-sub-NEW-different' }));

    // DB has the same email but a DIFFERENT googleSub
    MockUserModel.findOne.mockResolvedValue(
      makeMockUser({ googleSub: 'google-sub-ORIGINAL' }) as never,
    );

    const res = await request(app)
      .post('/api/auth/google')
      .send({ credential: 'token-for-different-google-account' });

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/different Google account/i);
  });

  // ── 8. Race condition — duplicate key E11000 → graceful fallback, 200 ─────────
  it('handles a duplicate-key race condition gracefully and returns 200', async () => {
    mockGoogleTokenInfo(validGooglePayload());
    MockUserModel.findOne.mockResolvedValueOnce(null); // first lookup: no user

    // create() throws E11000 (concurrent request already inserted the doc)
    const duplicateKeyError = Object.assign(new Error('duplicate key error'), { code: 11000 });
    MockUserModel.create.mockRejectedValue(duplicateKeyError);

    // Fallback findOne returns the document created by the winning request
    MockUserModel.findOne.mockResolvedValueOnce(makeMockUser() as never);

    const res = await request(app)
      .post('/api/auth/google')
      .send({ credential: 'valid-token-race-condition' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('user');
    // findOne called twice: initial lookup + race-condition fallback
    expect(MockUserModel.findOne).toHaveBeenCalledTimes(2);
  });

  // ── Serializer — password and sensitive fields must not appear in response ────
  it('never exposes password, googleSub, lockout fields in the response', async () => {
    mockGoogleTokenInfo(validGooglePayload());
    MockUserModel.findOne.mockResolvedValue(
      makeMockUser({ password: 'should-never-appear', lockoutUntil: 9999999 }) as never,
    );

    const res = await request(app)
      .post('/api/auth/google')
      .send({ credential: 'valid-token-serializer-check' });

    expect(res.status).toBe(200);
    expect(res.body.user.password).toBeUndefined();
    expect(res.body.user.googleSub).toBeUndefined();
    expect(res.body.user.lockoutUntil).toBeUndefined();
    expect(res.body.user.failedLoginAttempts).toBeUndefined();
    // emailVerified / authProvider are safe owner-facing fields (used for booking prefill).
    expect(typeof res.body.user.emailVerified).toBe('boolean');
  });
});
