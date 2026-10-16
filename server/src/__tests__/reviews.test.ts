/**
 * Review route tests — covers GET (with pagination) and POST (with validation).
 * ReviewModel is mocked — no live database required.
 */
import './testSetup'; // MUST be first
import request from 'supertest';
import app from '../app';
import jwt from 'jsonwebtoken';

// ─── Mock ReviewModel ─────────────────────────────────────────────────────────
jest.mock('../data/mongoModels', () => ({
  ReviewModel: {
    find: jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnValue({
        skip: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            lean: jest.fn().mockResolvedValue([]),
          }),
        }),
      }),
    }),
    countDocuments: jest.fn().mockResolvedValue(0),
    create: jest.fn(),
  },
  UserModel: {
    findOne: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
  },
  BookingModel: { find: jest.fn(), findById: jest.fn(), create: jest.fn(), countDocuments: jest.fn() },
  PropertyModel: {
    find: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      }),
    }),
    findById: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      }),
    }),
  },
  HotelModel: { find: jest.fn(), findById: jest.fn() },
  RoomCategoryModel: { find: jest.fn(), findById: jest.fn() },
}));

import { ReviewModel, BookingModel } from '../data/mongoModels';
const MockReviewModel = ReviewModel as jest.Mocked<typeof ReviewModel>;

/** Stub the guest's bookings for the reviewed room. */
function mockStays(stays: Array<Record<string, unknown>>) {
  (BookingModel.find as jest.Mock).mockReturnValue({
    select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(stays) }),
  });
}
const PAST_STAY = { _id: 'booking-1', guestName: 'Alice Santos', checkInDate: '2026-01-01', checkOutDate: '2026-01-03' };

/** Helper: build a valid signed auth cookie for tests. */
function makeAuthCookie(): string {
  const token = jwt.sign(
    { userId: 'user-001', email: 'tester@example.com', role: 'guest' },
    process.env.JWT_SECRET!,
    { expiresIn: '1h' },
  );
  return `madyaw_token=${token}`;
}

// ─── GET /api/reviews ─────────────────────────────────────────────────────────
describe('GET /api/reviews', () => {
  it('returns 400 when neither propertyId nor hotelId is provided', async () => {
    const res = await request(app).get('/api/reviews');
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/property or hotel/i);
  });

  it('returns 200 with paginated response shape when propertyId is provided', async () => {
    const res = await request(app).get('/api/reviews?propertyId=prop-001');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('total');
    expect(res.body).toHaveProperty('page');
    expect(res.body).toHaveProperty('totalPages');
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('filters by propertyId when provided', async () => {
    await request(app).get('/api/reviews?propertyId=prop-999');
    expect(MockReviewModel.find).toHaveBeenCalledWith({ propertyId: 'prop-999' });
  });
});

// ─── POST /api/reviews ────────────────────────────────────────────────────────
describe('POST /api/reviews', () => {
  const VALID_PAYLOAD = {
    propertyId: 'prop-001',
    authorName: 'Alice',
    rating: 5,
    title: 'Amazing stay',
    comment: 'Loved every moment of it.',
  };

  it('returns 401 when called without authentication', async () => {
    const res = await request(app)
      .post('/api/reviews')
      .send(VALID_PAYLOAD);

    expect(res.status).toBe(401);
  });

  it('creates a review for a completed stay, named from the booking', async () => {
    mockStays([PAST_STAY]);
    (MockReviewModel.countDocuments as jest.Mock).mockResolvedValue(0);
    MockReviewModel.create.mockResolvedValue({ _id: 'rev-001', ...VALID_PAYLOAD } as never);

    const res = await request(app)
      .post('/api/reviews')
      .set('Cookie', makeAuthCookie())
      .send({ ...VALID_PAYLOAD, authorName: 'Somebody Else' });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(MockReviewModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ authorName: 'Alice S.', booking_id: 'booking-1' }),
    );
  });

  it('returns 403 without a completed stay at the property', async () => {
    mockStays([{ ...PAST_STAY, checkInDate: '2099-01-01', checkOutDate: '2099-01-03' }]);
    MockReviewModel.create.mockClear();

    const res = await request(app)
      .post('/api/reviews')
      .set('Cookie', makeAuthCookie())
      .send(VALID_PAYLOAD);

    expect(res.status).toBe(403);
    expect(MockReviewModel.create).not.toHaveBeenCalled();
  });

  it('returns 403 when the stay was already reviewed', async () => {
    mockStays([PAST_STAY]);
    (MockReviewModel.countDocuments as jest.Mock).mockResolvedValue(1);

    const res = await request(app)
      .post('/api/reviews')
      .set('Cookie', makeAuthCookie())
      .send(VALID_PAYLOAD);

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/already reviewed/i);
  });

  it('returns 400 when rating is out of range', async () => {
    const res = await request(app)
      .post('/api/reviews')
      .set('Cookie', makeAuthCookie())
      .send({ ...VALID_PAYLOAD, rating: 6 });
    expect(res.status).toBe(400);
  });

  it('returns 400 when rating is not an integer', async () => {
    const res = await request(app)
      .post('/api/reviews')
      .set('Cookie', makeAuthCookie())
      .send({ ...VALID_PAYLOAD, rating: 4.5 });
    expect(res.status).toBe(400);
  });

  it('returns 400 when required fields are missing', async () => {
    const res = await request(app)
      .post('/api/reviews')
      .set('Cookie', makeAuthCookie())
      .send({ propertyId: 'prop-001' }); // missing authorName, rating, title, comment
    expect(res.status).toBe(400);
  });

  it('returns 400 when propertyId is empty', async () => {
    const res = await request(app)
      .post('/api/reviews')
      .set('Cookie', makeAuthCookie())
      .send({ ...VALID_PAYLOAD, propertyId: '   ' });
    expect(res.status).toBe(400);
  });
});

// ─── Serializer — sensitive field check ───────────────────────────────────────
describe('GET /api/reviews — never exposes internal fields', () => {
  it('serialized reviews do not contain MongoDB internal fields', async () => {
    (MockReviewModel.find as jest.Mock).mockReturnValue({
      sort: jest.fn().mockReturnValue({
        skip: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            lean: jest.fn().mockResolvedValue([
              { _id: 'rev-1', propertyId: 'p-1', authorName: 'Bob', rating: 4, title: 'Good', comment: 'Nice', __v: 0 },
            ]),
          }),
        }),
      }),
    });
    MockReviewModel.countDocuments.mockResolvedValue(1);

    const res = await request(app).get('/api/reviews?propertyId=p-1');
    expect(res.status).toBe(200);
    // __v (mongoose version key) must not be in response
    expect(res.body.data[0].__v).toBeUndefined();
  });
});
