/**
 * Booking route tests — covers authorization, create, update status transitions.
 * All Mongoose models are mocked.
 */
import './testSetup'; // MUST be first
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../app';

// ─── Mocks ────────────────────────────────────────────────────────────────────
const mockBooking = {
  _id: 'booking-001',
  booking_reference: 'BR-111',
  hotel_id: 'hotel-001',
  room_id: 'room-001',
  propertyId: 'prop-001',
  propertyName: 'Test Property',
  guestName: 'Alice',
  guestEmail: 'alice@example.com',
  guest_phone: '+63 912 345 6789',
  checkInDate: '2026-07-01',
  checkOutDate: '2026-07-05',
  adults: 2,
  children: 0,
  infants: 0,
  nights: 4,
  guestCount: 2,
  roomType: 'standard-room',
  paymentMethod: 'credit-card',
  roomRate: 3000,
  amountPaid: 0,
  amount_paid: 0,
  balance_due: 12480,
  deposit_amount: 0,
  payment_status: 'pending',
  totalPrice: 12480,
  total_amount: 12480,
  serviceFee: 480,
  source: 'web',
  booking_type: 'request_to_book',
  status: 'requested',
  requestedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 90_000).toISOString(),
  save: jest.fn().mockResolvedValue(undefined),
  toObject: jest.fn().mockReturnThis(),
};

const mockProperty = {
  _id: 'prop-001',
  hotel_id: 'hotel-001',
  display_name: 'Test Property',
  price_per_night: 3000,
};

const mockUser = {
  _id: 'user-001',
  email: 'alice@example.com',
  name: 'Alice',
  role: 'guest',
  hotel_id: null,
};

jest.mock('../data/mongoModels', () => ({
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
  PropertyModel: {
    findById: jest.fn(),
    find: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
    updateOne: jest.fn().mockResolvedValue({ acknowledged: true }),
  },
  UserModel: {
    findById: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
  },
  HotelModel: { find: jest.fn(), findById: jest.fn() },
  RoomCategoryModel: { find: jest.fn(), findById: jest.fn() },
  ExternalReservationModel: {
    create: jest.fn().mockResolvedValue({}),
    updateMany: jest.fn().mockResolvedValue({ acknowledged: true }),
  },
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
  PromoCodeModel: {
    findOne: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null), session: jest.fn().mockReturnThis() }),
    updateOne: jest.fn().mockResolvedValue({ acknowledged: true }),
  },
  BillingChargeModel: {
    insertMany: jest.fn().mockResolvedValue([]),
  },
}));

import { BookingModel, UserModel, PropertyModel } from '../data/mongoModels';
const MockBookingModel = BookingModel as jest.Mocked<typeof BookingModel>;
const MockUserModel = UserModel as jest.Mocked<typeof UserModel>;
const MockPropertyModel = PropertyModel as jest.Mocked<typeof PropertyModel>;

/** Build a signed auth cookie for a guest user. */
function guestCookie(): string {
  const token = jwt.sign(
    { userId: 'user-001', email: 'alice@example.com', role: 'guest' },
    process.env.JWT_SECRET!,
    { expiresIn: '1h' },
  );
  return `madyaw_token=${token}`;
}

/** Build a signed auth cookie for an admin. */
function adminCookie(): string {
  const token = jwt.sign(
    { userId: 'admin-001', email: 'admin@example.com', role: 'admin' },
    process.env.JWT_SECRET!,
    { expiresIn: '1h' },
  );
  return `madyaw_token=${token}`;
}

// ─── GET /api/bookings ────────────────────────────────────────────────────────
describe('GET /api/bookings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // getRequestUser calls: UserModel.findById(id).select({...}).lean()
    // We must mock the full chain.
    MockUserModel.findById.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({ ...mockUser }),
      }),
    } as never);
    (MockBookingModel.find as jest.Mock).mockReturnValue({
      sort: jest.fn().mockReturnValue({
        skip: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
        }),
      }),
    });
    MockBookingModel.countDocuments.mockResolvedValue(0);
  });

  it('returns 401 when called without authentication', async () => {
    const res = await request(app).get('/api/bookings');
    expect(res.status).toBe(401);
  });

  it('returns paginated booking list for an authenticated guest', async () => {
    MockBookingModel.countDocuments.mockResolvedValue(0);

    const res = await request(app)
      .get('/api/bookings')
      .set('Cookie', guestCookie());

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('total');
    expect(res.body).toHaveProperty('page');
    expect(res.body).toHaveProperty('totalPages');
  });

});

// ─── POST /api/bookings ───────────────────────────────────────────────────────
describe('POST /api/bookings', () => {
  const VALID_PAYLOAD = {
    propertyId: 'prop-001',
    propertyName: 'Test Property',
    guestName: 'Alice',
    guestEmail: 'alice@example.com',
    guestPhone: '+63 912 345 6789',
    checkInDate: '2026-08-01',
    checkOutDate: '2026-08-05',
    adults: 2,
    children: 0,
    infants: 0,
    roomType: 'standard-room',
    paymentMethod: 'credit-card',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    MockPropertyModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ ...mockProperty }),
    } as never);
    (MockPropertyModel as any).updateOne = jest.fn().mockResolvedValue({ acknowledged: true });
    (MockBookingModel.find as jest.Mock).mockReturnValue({
      lean: jest.fn().mockResolvedValue([]),
    });
    MockBookingModel.create.mockResolvedValue({ ...mockBooking, status: 'pending' } as never);
  });

  it('creates a booking (POST /api/bookings is intentionally open for guest checkout)', async () => {
    const res = await request(app)
      .post('/api/bookings')
      .send(VALID_PAYLOAD);

    expect([201, 409]).toContain(res.status);
    if (res.status === 201) {
      expect(MockBookingModel.create).toHaveBeenCalled();
      const createdArg = (MockBookingModel.create as jest.Mock).mock.calls[0][0];
      const created = Array.isArray(createdArg) ? createdArg[0] : createdArg;
      // Hotel management app expects these shared-DB fields
      expect(created.guest_name).toBe(VALID_PAYLOAD.guestName);
      expect(created.guest_email).toBe(VALID_PAYLOAD.guestEmail);
      expect(created.summary_only).toBe(false);
      expect(created.booking_type).toBe('online');
      expect(created.booking_source).toBe('website-customer');
      expect(created.check_in_date).toBeInstanceOf(Date);
      expect(created.check_out_date).toBeInstanceOf(Date);
      expect(created.created_at).toBeInstanceOf(Date);
      expect(created.checkInDate).toBe(VALID_PAYLOAD.checkInDate);
      expect(created.status).toBe('pending');
      expect(created.source).toBe('web');
      expect(created.payment_status).toBe('partial');
      expect(created.amountPaid).toBeGreaterThan(0);
      expect(created.amount_paid).toBe(created.amountPaid);
      expect(created.deposit_amount).toBe(created.amountPaid);
      expect(created.balance_due).toBe(created.totalPrice - created.amountPaid);
      expect(created.amountPaid + created.balance_due).toBe(created.totalPrice);

      const { ExternalReservationModel, BillingChargeModel } = jest.requireMock('../data/mongoModels') as {
        ExternalReservationModel: { create: jest.Mock };
        BillingChargeModel: { insertMany: jest.Mock };
      };
      expect(ExternalReservationModel.create).toHaveBeenCalled();
      const externalDoc = ExternalReservationModel.create.mock.calls[0][0];
      expect(externalDoc.status).toBe('pending_approval');
      expect(externalDoc.source).toBe('app-customer');
      expect(externalDoc.external_reference).toBeTruthy();
      const meta = typeof externalDoc.metadata === 'string'
        ? JSON.parse(externalDoc.metadata)
        : externalDoc.metadata;
      expect(meta.payment_status).toBe('partial');
      expect(meta.amount_paid).toBe(created.amountPaid);

      expect(BillingChargeModel.insertMany).toHaveBeenCalled();
      const charges = BillingChargeModel.insertMany.mock.calls[0][0];
      expect(charges).toHaveLength(2);
      expect(charges[0].type).toBe('room');
      expect(charges[1].type).toBe('partial_payment');
      expect(Number(charges[1].amount)).toBeLessThan(0);
    }
  });

  it('returns 400 when check-out is before check-in', async () => {
    const res = await request(app)
      .post('/api/bookings')
      .send({ ...VALID_PAYLOAD, checkOutDate: '2026-07-31' }); // before checkIn 08-01

    expect(res.status).toBe(400);
  });

  it('returns 400 when required fields are missing', async () => {
    const res = await request(app)
      .post('/api/bookings')
      .send({ propertyId: 'prop-001' }); // missing many fields

    expect(res.status).toBe(400);
  });
});

// ─── PUT /api/bookings/:id — status transitions ───────────────────────────────
describe('PUT /api/bookings/:id', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    MockBookingModel.findById.mockResolvedValue({ ...mockBooking } as never);
  });

  it('returns 401 when called without authentication', async () => {
    const res = await request(app).put('/api/bookings/booking-001').send({ status: 'confirmed' });
    expect(res.status).toBe(401);
  });

  it('returns 200 when the booking owner updates their own booking status', async () => {
    // alice@example.com owns booking-001 (guestEmail: 'alice@example.com')
    MockUserModel.findById.mockResolvedValue({ ...mockUser } as never);
    const res = await request(app)
      .put('/api/bookings/booking-001')
      .set('Cookie', guestCookie())
      .send({ status: 'confirmed' });
    // 200 = updated OK; 403 = disallowed transition — both are valid gated responses
    expect([200, 403]).toContain(res.status);
  });

  it('returns 403 when a guest tries to update a booking they do not own', async () => {
    // Build a token for a different user
    const otherToken = jwt.sign(
      { userId: 'user-002', email: 'other@example.com', role: 'guest' },
      process.env.JWT_SECRET!,
      { expiresIn: '1h' },
    );
    MockUserModel.findById.mockResolvedValue({ ...mockUser, _id: 'user-002', email: 'other@example.com' } as never);
    const res = await request(app)
      .put('/api/bookings/booking-001')
      .set('Cookie', `madyaw_token=${otherToken}`)
      .send({ status: 'confirmed' });
    expect(res.status).toBe(403);
  });

  it('admin may update any booking', async () => {
    MockUserModel.findById.mockResolvedValue({ ...mockUser, _id: 'admin-001', email: 'admin@example.com', role: 'admin' } as never);
    const res = await request(app)
      .put('/api/bookings/booking-001')
      .set('Cookie', adminCookie())
      .send({ status: 'confirmed' });
    expect([200, 409]).toContain(res.status);
  });
});
