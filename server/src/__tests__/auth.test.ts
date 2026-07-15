/**
 * Auth route tests — covers register, login, logout, and /me.
 *
 * Mongoose UserModel is mocked so no live database is required.
 * JWT signing uses the test secret defined in testSetup.ts.
 */
import './testSetup'; // MUST be first: sets process.env before any imports
import request from 'supertest';
import bcrypt from 'bcryptjs';
import app from '../app';

// ─── Mock Mongoose UserModel ──────────────────────────────────────────────────
const mockUser = {
  _id: 'user-123',
  email: 'test@example.com',
  name: 'Test User',
  role: 'guest' as const,
  password: '', // set in beforeAll
  authProvider: 'local',
  failedLoginAttempts: 0,
  lockoutUntil: undefined,
  failedLoginAt: undefined,
  save: jest.fn().mockResolvedValue(undefined),
};

jest.mock('../data/mongoModels', () => ({
  UserModel: {
    findOne: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
  },
}));

import { UserModel } from '../data/mongoModels';

const MockUserModel = UserModel as jest.Mocked<typeof UserModel>;

// ─── Tests ────────────────────────────────────────────────────────────────────
describe('POST /api/auth/register', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    MockUserModel.findOne.mockResolvedValue(null); // no existing user
    MockUserModel.create.mockResolvedValue({ ...mockUser } as never);
  });

  it('creates a new user and sets a cookie', async () => {
    const res = await request(app).post('/api/auth/register').send({
      name: 'Test User',
      email: 'newuser@example.com',
      password: 'securePassword123',
    });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('user');
    expect(res.body.user).not.toHaveProperty('password');
    // Cookie must be set
    expect(res.headers['set-cookie']).toBeDefined();
  });

  it('returns 400 when name is missing', async () => {
    const res = await request(app).post('/api/auth/register').send({
      email: 'newuser@example.com',
      password: 'securePassword123',
    });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('message');
  });

  it('returns 400 when email is invalid', async () => {
    const res = await request(app).post('/api/auth/register').send({
      name: 'Test',
      email: 'not-an-email',
      password: 'securePassword123',
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when password is too short', async () => {
    const res = await request(app).post('/api/auth/register').send({
      name: 'Test',
      email: 'test@example.com',
      password: 'short',
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when password exceeds 128 characters', async () => {
    const res = await request(app).post('/api/auth/register').send({
      name: 'Test',
      email: 'test@example.com',
      password: 'a'.repeat(129),
    });
    expect(res.status).toBe(400);
  });

  it('returns 409 when email already exists', async () => {
    MockUserModel.findOne.mockResolvedValue({ ...mockUser } as never);

    const res = await request(app).post('/api/auth/register').send({
      name: 'Test',
      email: 'test@example.com',
      password: 'securePassword123',
    });
    expect(res.status).toBe(409);
  });
});

describe('POST /api/auth/login', () => {
  beforeAll(async () => {
    // Hash a known password for login tests
    mockUser.password = await bcrypt.hash('securePassword123', 12);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('logs in a valid user and sets an auth cookie', async () => {
    MockUserModel.findOne.mockResolvedValue({ ...mockUser } as never);

    const res = await request(app).post('/api/auth/login').send({
      email: 'test@example.com',
      password: 'securePassword123',
    });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('user');
    expect(res.body.user).not.toHaveProperty('password');
    expect(res.headers['set-cookie']).toBeDefined();
  });

  it('returns 401 for wrong password', async () => {
    MockUserModel.findOne.mockResolvedValue({ ...mockUser } as never);

    const res = await request(app).post('/api/auth/login').send({
      email: 'test@example.com',
      password: 'wrongPassword',
    });

    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Invalid email or password.');
  });

  it('returns 401 for non-existent user without leaking which field failed', async () => {
    MockUserModel.findOne.mockResolvedValue(null);

    const res = await request(app).post('/api/auth/login').send({
      email: 'nobody@example.com',
      password: 'irrelevant',
    });

    expect(res.status).toBe(401);
    // Message must be identical to the wrong-password case (no user enumeration)
    expect(res.body.message).toBe('Invalid email or password.');
  });

  it('returns 400 when email is missing', async () => {
    const res = await request(app).post('/api/auth/login').send({ password: 'pw' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when password is missing', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'test@example.com' });
    expect(res.status).toBe(400);
  });

  it('returns 429 when account is locked out', async () => {
    MockUserModel.findOne.mockResolvedValue({
      ...mockUser,
      lockoutUntil: Date.now() + 60_000, // locked for 1 more minute
    } as never);

    const res = await request(app).post('/api/auth/login').send({
      email: 'test@example.com',
      password: 'securePassword123',
    });

    expect(res.status).toBe(429);
    expect(res.body.message).toMatch(/temporarily locked/i);
  });
});

describe('POST /api/auth/logout', () => {
  it('returns 401 if no token cookie is present', async () => {
    const res = await request(app).post('/api/auth/logout');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/auth/me', () => {
  it('returns 401 without an auth cookie', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/auth/register — serializer strips password', () => {
  it('never returns a password field in the user object', async () => {
    jest.clearAllMocks();
    MockUserModel.findOne.mockResolvedValue(null);
    MockUserModel.create.mockResolvedValue({ ...mockUser } as never);

    const res = await request(app).post('/api/auth/register').send({
      name: 'Alice',
      email: 'alice@example.com',
      password: 'Password1234!',
    });

    expect(res.status).toBe(201);
    expect(res.body.user.password).toBeUndefined();
    expect(res.body.user.passwordHash).toBeUndefined();
  });
});

describe('GET /api/health', () => {
  it('returns 200 with ok:true and uptime', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.uptime).toBe('number');
  });
});
