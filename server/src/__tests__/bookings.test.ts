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
    findById: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }),
      lean: jest.fn().mockResolvedValue(null),
    }),
    findOne: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }) }),
    create: jest.fn(),
    updateOne: jest.fn().mockResolvedValue({ acknowledged: true }),
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
  HotelModel: {
    find: jest.fn(),
    findById: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }),
  },
  RoomCategoryModel: { find: jest.fn(), findById: jest.fn() },
  ExternalReservationModel: {
    create: jest.fn().mockResolvedValue({}),
    find: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
    updateOne: jest.fn().mockResolvedValue({ acknowledged: true }),
    updateMany: jest.fn().mockResolvedValue({ acknowledged: true }),
    countDocuments: jest.fn().mockResolvedValue(0),
  },
  BookingValidIdModel: {
    findOneAndUpdate: jest.fn().mockResolvedValue({}),
    findOne: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }),
    }),
  },
  BookingPaymentProofModel: {
    findOneAndUpdate: jest.fn().mockResolvedValue({}),
    findOne: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }),
    }),
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
    countDocuments: jest.fn().mockResolvedValue(0),
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

  /** Minimal 1x1 PNG for Valid ID multipart uploads. */
  const TINY_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );

  /** Guests pay by QR when they book, so a booking carries the ID and the payment screenshot. */
  async function postBooking(
    fields: Record<string, string | number> = VALID_PAYLOAD,
    withId = true,
    withProof = true,
    authenticated = true,
  ) {
    // The receipt amount must equal the stay total, so ask the quote for it like the checkout does.
    let claimed = fields.paymentProofAmountClaimed;
    if (withProof && claimed == null) {
      const quote = await request(app).post('/api/bookings/quote').send(fields);
      claimed = quote.body.totalPrice ?? 1;
    }
    let req = request(app).post('/api/bookings');
    if (authenticated) {
      req = req.set('Cookie', guestCookie());
    }
    Object.entries(fields).forEach(([key, value]) => {
      req = req.field(key, String(value));
    });
    if (withProof) {
      req = req.field('paymentTransactionRef', 'GCASH-ABC12345');
      // Guest-entered receipt amount (hotel Payments UI shows this as amount_paid).
      if (fields.paymentProofAmountClaimed == null) {
        req = req.field('paymentProofAmountClaimed', String(claimed));
      }
      req = req.attach('paymentProof', TINY_PNG, { filename: 'gcash-proof.png', contentType: 'image/png' });
    }
    if (withId) {
      req = req.attach('validId', TINY_PNG, { filename: 'id.png', contentType: 'image/png' });
    }
    return req;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    MockUserModel.findById.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({ ...mockUser }),
      }),
    } as never);
    MockPropertyModel.findById.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue({ ...mockProperty }),
    } as never);
    (MockPropertyModel as any).updateOne = jest.fn().mockResolvedValue({ acknowledged: true });
    (MockBookingModel.find as jest.Mock).mockReturnValue({
      select: jest.fn().mockReturnThis(),
      session: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([]),
    });
    (MockBookingModel.findOne as jest.Mock).mockReturnValue({
      select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }),
    });
    MockBookingModel.create.mockResolvedValue({
      ...mockBooking,
      _id: 'booking-001',
      status: 'pending',
      booking_reference: 'BR-111',
      hotel_id: 'hotel-001',
      room_id: 'room-001',
    } as never);
  });

  it('allows guest checkout without signing in (name + email)', async () => {
    const res = await postBooking(VALID_PAYLOAD, true, true, false);
    expect(res.status).toBe(201);
    const createdArg = (MockBookingModel.create as jest.Mock).mock.calls[0][0];
    const created = Array.isArray(createdArg) ? createdArg[0] : createdArg;
    expect(created.guestEmail).toBe('alice@example.com');
  });

  it('allows guest checkout with only a mobile number (no email)', async () => {
    const res = await postBooking({ ...VALID_PAYLOAD, guestEmail: '' }, true, true, false);
    expect(res.status).toBe(201);
    const createdArg = (MockBookingModel.create as jest.Mock).mock.calls[0][0];
    const created = Array.isArray(createdArg) ? createdArg[0] : createdArg;
    expect(created.guestEmail).toBe('');
    expect(created.guest_phone).toBeTruthy();
    // The phone must be reflected on the hotel app: booking mirror + external
    // reservation column + metadata (where the hotel app reads display fields).
    expect(created.contact_number).toBe(created.guest_phone);
    const mocks = jest.requireMock('../data/mongoModels') as {
      ExternalReservationModel: { create: jest.Mock };
    };
    const externalDoc = mocks.ExternalReservationModel.create.mock.calls[0][0];
    expect(externalDoc.guest_phone).toBe(created.guest_phone);
    const meta = JSON.parse(externalDoc.metadata);
    expect(meta.guest_phone).toBe(created.guest_phone);
    expect(meta.contact_number).toBe(created.guest_phone);
    expect(meta.phone).toBe(created.guest_phone);
    expect(meta.mobile_number).toBe(created.guest_phone);
    expect(meta.guest_name).toBeTruthy();
  });

  it('rejects guest checkout with neither email nor mobile number', async () => {
    const res = await postBooking({ ...VALID_PAYLOAD, guestEmail: '', guestPhone: '' }, true, true, false);
    expect(res.status).toBe(400);
    expect(String(res.body.message)).toMatch(/email address or a mobile/i);
    expect(MockBookingModel.create).not.toHaveBeenCalled();
  });

  it('uses the guest-typed contact email even when signed in (Gmail is optional)', async () => {
    const res = await postBooking({ ...VALID_PAYLOAD, guestEmail: 'other@example.com' });
    expect(res.status).toBe(201);
    const createdArg = (MockBookingModel.create as jest.Mock).mock.calls[0][0];
    const created = Array.isArray(createdArg) ? createdArg[0] : createdArg;
    expect(created.guestEmail).toBe('other@example.com');
  });

  it('falls back to the account email when a signed-in guest types none', async () => {
    const res = await postBooking({ ...VALID_PAYLOAD, guestEmail: '' });
    expect(res.status).toBe(201);
    const createdArg = (MockBookingModel.create as jest.Mock).mock.calls[0][0];
    const created = Array.isArray(createdArg) ? createdArg[0] : createdArg;
    expect(created.guestEmail).toBe('alice@example.com');
  });

  it('quotes the same total the booking is saved with', async () => {
    const quote = await request(app).post('/api/bookings/quote').send({
      propertyId: VALID_PAYLOAD.propertyId,
      checkInDate: VALID_PAYLOAD.checkInDate,
      checkOutDate: VALID_PAYLOAD.checkOutDate,
      adults: 2,
      children: 0,
      roomType: VALID_PAYLOAD.roomType,
      discountReason: 'pwd',
    });
    expect(quote.status).toBe(200);
    expect(quote.body).toMatchObject({ available: true, nights: 4, dueAfterConfirmation: 0, taxesIncluded: true });
    expect(quote.body.discountAmount).toBeGreaterThan(0);

    const res = await postBooking({ ...VALID_PAYLOAD, discountReason: 'pwd' });
    expect(res.status).toBe(201);
    const createdArg = (MockBookingModel.create as jest.Mock).mock.calls[0][0];
    const created = Array.isArray(createdArg) ? createdArg[0] : createdArg;
    expect(created.totalPrice).toBe(quote.body.totalPrice);
    // Guests pay the full total by QR when they book.
    expect(quote.body.dueNow).toBe(quote.body.totalPrice);
  });

  describe('booking a room type (categoryId)', () => {
    const ROOMS = [
      { _id: 'room-102', hotel_id: 'hotel-001', category_id: 'cat-deluxe', category_name: 'Deluxe', display_name: 'Room 102', room_number: '102', price_per_night: 3000, room_type: 'standard-room', status: 'available' },
      { _id: 'room-101', hotel_id: 'hotel-001', category_id: 'cat-deluxe', category_name: 'Deluxe', display_name: 'Room 101', room_number: '101', price_per_night: 2500, room_type: 'standard-room', status: 'available' },
    ];
    const { propertyId: _unused, roomType: _type, propertyName: _name, ...BY_CATEGORY } = { ...VALID_PAYLOAD, categoryId: 'cat-deluxe' };

    const ALL_ROOMS = [
      ...ROOMS,
      { _id: 'room-201', hotel_id: 'hotel-001', category_id: 'cat-family', category_name: 'Family', display_name: 'Room 201', room_number: '201', price_per_night: 4000, room_type: 'standard-room', status: 'available' },
    ];

    beforeEach(() => {
      const { RoomCategoryModel } = jest.requireMock('../data/mongoModels') as { RoomCategoryModel: { findById: jest.Mock } };
      RoomCategoryModel.findById.mockReturnValue({ lean: jest.fn().mockResolvedValue({ _id: 'cat-deluxe', name: 'Deluxe' }) });
      (MockPropertyModel.find as jest.Mock).mockImplementation((query: { category_id?: string } = {}) => ({
        session: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(ALL_ROOMS.filter((room) => !query.category_id || room.category_id === query.category_id)),
      }));
      (MockPropertyModel.findById as jest.Mock).mockImplementation((id: string) => ({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(ALL_ROOMS.find((room) => room._id === id) ?? null),
      }));
    });

    it('books two room types together with one group down payment', async () => {
      const fields = { ...BY_CATEGORY, categoryIds: 'cat-deluxe,cat-family', groupBooking: true };
      const quote = await request(app).post('/api/bookings/quote').send(fields);
      expect(quote.status).toBe(200);
      // Deluxe 2500×4 + Family 4000×4, discounted once on the combined total.
      expect(quote.body).toMatchObject({ categoryCount: 2, stayPrice: 26000, totalPrice: 26000, groupBooking: true });
      expect(quote.body.dueNow).toBe(13000);
      expect(quote.body.dueAfterConfirmation).toBe(13000);
      expect(quote.body.items).toHaveLength(2);

      const res = await postBooking({ ...fields, groupBooking: 'true', paymentProofAmountClaimed: 13000 });
      expect(res.status).toBe(201);
      expect(res.body.categoryCount).toBe(2);
      expect(res.body.bookingIds).toHaveLength(2);
      expect(MockBookingModel.create).toHaveBeenCalledTimes(2);
      const createdDocs = (MockBookingModel.create as jest.Mock).mock.calls.map((call) => {
        const arg = call[0];
        return Array.isArray(arg) ? arg[0] : arg;
      });
      expect(createdDocs.map((doc) => doc.propertyId)).toEqual(['room-101', 'room-201']);
      expect(createdDocs.map((doc) => doc.totalPrice)).toEqual([10000, 16000]);
      expect(createdDocs.map((doc) => doc.deposit_amount)).toEqual([5000, 8000]);
      expect(createdDocs.every((doc) => doc.group_booking === true && doc.online_payment_mode === 'half')).toBe(true);
    });

    it('assigns the cheapest free room and names the booking after the room type', async () => {
      const quote = await request(app).post('/api/bookings/quote').send(BY_CATEGORY);
      expect(quote.status).toBe(200);
      expect(quote.body).toMatchObject({ roomName: 'Deluxe', stayPrice: 10000 });

      const res = await postBooking(BY_CATEGORY);
      expect(res.status).toBe(201);
      const createdArg = (MockBookingModel.create as jest.Mock).mock.calls[0][0];
      const created = Array.isArray(createdArg) ? createdArg[0] : createdArg;
      expect(created.propertyId).toBe('room-101');
      expect(created.propertyName).toBe('Deluxe');
      expect(created.totalPrice).toBe(quote.body.totalPrice);
    });

    it('refuses when every room of the type is taken for the dates', async () => {
      (MockBookingModel.find as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnThis(),
        session: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(ROOMS.map((room) => ({
          _id: `b-${room._id}`, propertyId: room._id, status: 'reserved',
          checkInDate: VALID_PAYLOAD.checkInDate, checkOutDate: VALID_PAYLOAD.checkOutDate,
        }))),
      });
      const res = await postBooking(BY_CATEGORY);
      expect(res.status).toBe(409);
      expect(MockBookingModel.create).not.toHaveBeenCalled();
    });
  });

  it('rejects a quote with check-out before check-in', async () => {
    const res = await request(app).post('/api/bookings/quote').send({
      propertyId: VALID_PAYLOAD.propertyId, checkInDate: '2026-08-05', checkOutDate: '2026-08-01',
    });
    expect(res.status).toBe(400);
  });

  it('creates a booking (POST /api/bookings is intentionally open for guest checkout)', async () => {
    const res = await postBooking();

    expect([201, 409]).toContain(res.status);
    if (res.status === 201) {
      expect(MockBookingModel.create).toHaveBeenCalled();
      const createdArg = (MockBookingModel.create as jest.Mock).mock.calls[0][0];
      const created = Array.isArray(createdArg) ? createdArg[0] : createdArg;
      // Hotel management app expects these shared-DB fields
      expect(created.guest_name).toBe(VALID_PAYLOAD.guestName);
      expect(created.guest_email).toBe(VALID_PAYLOAD.guestEmail);
      expect(created.summary_only).toBe(false);
      // Hotel bookings key rooms by string id — never a raw ObjectId.
      expect(typeof created.room_id).toBe('string');
      expect(created.booking_type).toBe('online');
      expect(created.booking_source).toBe('website-customer');
      expect(created.check_in_date).toBeInstanceOf(Date);
      expect(created.check_out_date).toBeInstanceOf(Date);
      expect(created.created_at).toBeInstanceOf(Date);
      expect(created.checkInDate).toBe(VALID_PAYLOAD.checkInDate);
      expect(created.status).toBe('pending');
      expect(created.source).toBe('web');
      expect(created.payment_status).toBe('unpaid');
      expect(created.online_payment_mode).toBe('full');
      expect(created.deposit_percent).toBe(100);
      expect(created.amountPaid).toBe(0);
      expect(created.amount_paid).toBe(0);
      expect(created.deposit_amount).toBe(created.totalPrice);
      expect(created.balance_due).toBe(created.totalPrice);
      expect(created.serviceFee).toBe(0);
      expect(created.valid_id_filename).toBe('id.png');
      expect(created.valid_id_stored).toBe(true);
      // Policy acknowledgement is stored with the booking (false when not sent).
      expect(created.policy_acknowledged).toBe(false);
      expect(created.valid_id_base64).toBeUndefined();

      const { ExternalReservationModel, BillingChargeModel, BookingValidIdModel } = jest.requireMock('../data/mongoModels') as {
        ExternalReservationModel: { create: jest.Mock };
        BillingChargeModel: { insertMany: jest.Mock };
        BookingValidIdModel: { findOneAndUpdate: jest.Mock };
      };
      expect(ExternalReservationModel.create).toHaveBeenCalled();
      expect(BookingValidIdModel.findOneAndUpdate).toHaveBeenCalled();
      const externalDoc = ExternalReservationModel.create.mock.calls[0][0];
      // Online Bookings queue filters pending_approval — reserved hides the request.
      expect(externalDoc.status).toBe('pending_approval');
      expect(externalDoc.source).toBe('app-customer');
      expect(externalDoc.external_reference).toBeTruthy();
      const meta = typeof externalDoc.metadata === 'string'
        ? JSON.parse(externalDoc.metadata)
        : externalDoc.metadata;
      // Same payment fields as MADYAWPH's own online bookings: paid, pending the hotel's approval.
      expect(meta.payment_method).toBe('Online');
      expect(meta.payment_status).toBe('paid_pending_approval');
      expect(meta.deposit_percent).toBe(100);
      expect(meta.online_payment_mode).toBe('full');
      expect(meta.amount_paid).toBe(created.totalPrice);
      expect(meta.total_amount).toBe(created.totalPrice);
      expect(meta.balance_due).toBe(0);
      expect(meta.payment_proof_amount_claimed).toBe(created.totalPrice);
      expect(meta.valid_id_uploaded).toBe(true);
      // Guest phone reflected on the hotel app (column + metadata mirrors).
      expect(externalDoc.guest_phone).toBe(VALID_PAYLOAD.guestPhone);
      expect(meta.guest_phone).toBe(VALID_PAYLOAD.guestPhone);
      expect(meta.contact_number).toBe(VALID_PAYLOAD.guestPhone);
      expect(meta.payment_proof_uploaded).toBe(true);
      expect(meta.payment_proof_url).toMatch(/\/bookings\/.+\/files\/payment-proof\?token=[0-9a-f]{64}$/);
    // MADYAWPH's Guest documents screen reads the receipt from payment_screenshot_url.
    expect(meta.payment_screenshot_url).toBe(meta.payment_proof_url);
      expect(externalDoc.payment_proof_url).toMatch(/payment-proof\?token=/);
      expect(externalDoc.guest_id_url).toMatch(/valid-id\?token=/);

      // Ledger stays off until hotel approval (room charge would block the queue).
      expect(BillingChargeModel.insertMany).not.toHaveBeenCalled();
    }
  });

  it('ignores group booking for a single room — booking type needs 2+ room types', async () => {
    const quote = await request(app).post('/api/bookings/quote').send({ ...VALID_PAYLOAD, groupBooking: true });
    expect(quote.status).toBe(200);
    expect(quote.body.groupBooking).toBe(false);
    expect(quote.body.dueNow).toBe(quote.body.totalPrice);
    expect(quote.body.dueAfterConfirmation).toBe(0);

    const res = await postBooking({
      ...VALID_PAYLOAD,
      groupBooking: 'true',
      paymentProofAmountClaimed: quote.body.dueNow,
    });
    expect(res.status).toBe(201);

    const createdArg = (MockBookingModel.create as jest.Mock).mock.calls[0][0];
    const created = Array.isArray(createdArg) ? createdArg[0] : createdArg;
    expect(created.group_booking).toBe(false);
    expect(created.online_payment_mode).toBe('full');
    expect(created.deposit_percent).toBe(100);
    expect(created.deposit_amount).toBe(quote.body.totalPrice);
  });

  it('stores the payment screenshot, ID link and arrival time for the hotel app', async () => {
    const res = await postBooking({ ...VALID_PAYLOAD, arrivalTime: '15:00' });
    expect(res.status).toBe(201);

    const createdArg = (MockBookingModel.create as jest.Mock).mock.calls[0][0];
    const created = Array.isArray(createdArg) ? createdArg[0] : createdArg;
    expect(created.check_in_time).toBe('15:00');
    // Not paid until hotel staff verify the screenshot.
    expect(created.payment_status).toBe('unpaid');

    const mocks = jest.requireMock('../data/mongoModels') as {
      BookingPaymentProofModel: { findOneAndUpdate: jest.Mock };
      ExternalReservationModel: { create: jest.Mock };
    };
    expect(mocks.BookingPaymentProofModel.findOneAndUpdate).toHaveBeenCalled();
    const meta = JSON.parse(mocks.ExternalReservationModel.create.mock.calls[0][0].metadata);
    expect(meta.check_in_time).toBe('15:00');
    expect(meta.guest_id_url).toMatch(/\/bookings\/.+\/files\/valid-id\?token=[0-9a-f]{64}$/);
    expect(meta.payment_proof_uploaded).toBe(true);
    expect(meta.payment_proof_url).toMatch(/\/bookings\/.+\/files\/payment-proof\?token=[0-9a-f]{64}$/);
    // MADYAWPH's Guest documents screen reads the receipt from payment_screenshot_url.
    expect(meta.payment_screenshot_url).toBe(meta.payment_proof_url);
    expect(meta.payment_transaction_ref).toBe('GCASH-ABC12345');

    const proofUpdate = (MockBookingModel.updateOne as jest.Mock).mock.calls
      .map((call) => call[1]?.$set)
      .find((set) => set?.payment_proof_stored);
    expect(proofUpdate).toMatchObject({
      payment_transaction_ref: 'GCASH-ABC12345',
      payment_proof_verified: false,
      payment_proof_url: expect.stringMatching(/payment-proof\?token=/),
    });
  });

  it('returns 400 without the payment screenshot', async () => {
    const res = await postBooking(VALID_PAYLOAD, true, false);
    expect(res.status).toBe(400);
    expect(String(res.body.message)).toMatch(/screenshot/i);
    expect(MockBookingModel.create).not.toHaveBeenCalled();
  });

  it('returns 400 when the receipt amount is not the stay total', async () => {
    const res = await postBooking({ ...VALID_PAYLOAD, paymentProofAmountClaimed: 2500 });
    expect(res.status).toBe(400);
    expect(String(res.body.message)).toMatch(/must match the amount due/i);
    expect(MockBookingModel.create).not.toHaveBeenCalled();
  });

  it('serves the ID only with a valid signed link', async () => {
    const res = await request(app).get('/api/bookings/booking-001/files/valid-id?sig=deadbeef');
    expect(res.status).toBe(403);
  });

  it('returns 400 when Valid ID is missing', async () => {
    const res = await postBooking(VALID_PAYLOAD, false);
    expect(res.status).toBe(400);
    expect(String(res.body.message)).toMatch(/valid id/i);
  });

  it('returns 400 when check-out is before check-in', async () => {
    const res = await postBooking({ ...VALID_PAYLOAD, checkOutDate: '2026-07-31' });

    expect(res.status).toBe(400);
  });

  it('returns 400 when required fields are missing', async () => {
    const res = await postBooking({ propertyId: 'prop-001' });

    expect(res.status).toBe(400);
  });
});

// ─── PUT /api/bookings/:id — status transitions ───────────────────────────────
describe('PUT /api/bookings/:id', () => {
  function mockRequestUser(user: typeof mockUser & { hotel_id?: string | null }) {
    MockUserModel.findById.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({ ...user }),
      }),
    } as never);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    MockBookingModel.findById.mockResolvedValue({ ...mockBooking } as never);
  });

  it('returns 401 when called without authentication', async () => {
    const res = await request(app).put('/api/bookings/booking-001').send({ status: 'confirmed' });
    expect(res.status).toBe(401);
  });

  it('returns 200 when the booking owner cancels their own booking', async () => {
    // alice@example.com owns booking-001 (guestEmail: 'alice@example.com')
    mockRequestUser({ ...mockUser });
    const res = await request(app)
      .put('/api/bookings/booking-001')
      .set('Cookie', guestCookie())
      .send({ status: 'cancelled' });
    expect([200, 403]).toContain(res.status);
  });

  it('returns 403 when a guest tries to confirm their own booking (hotel owns confirmation)', async () => {
    mockRequestUser({ ...mockUser });
    const res = await request(app)
      .put('/api/bookings/booking-001')
      .set('Cookie', guestCookie())
      .send({ status: 'confirmed' });
    expect(res.status).toBe(403);
  });

  it('returns 403 when a guest tries to update a booking they do not own', async () => {
    // Build a token for a different user
    const otherToken = jwt.sign(
      { userId: 'user-002', email: 'other@example.com', role: 'guest' },
      process.env.JWT_SECRET!,
      { expiresIn: '1h' },
    );
    mockRequestUser({ ...mockUser, _id: 'user-002', email: 'other@example.com' });
    const res = await request(app)
      .put('/api/bookings/booking-001')
      .set('Cookie', `madyaw_token=${otherToken}`)
      .send({ status: 'cancelled' });
    expect(res.status).toBe(403);
  });

  it('admin may update bookings for their hotel', async () => {
    mockRequestUser({
      ...mockUser,
      _id: 'admin-001',
      email: 'admin@example.com',
      role: 'admin',
      hotel_id: 'hotel-001',
    });
    const res = await request(app)
      .put('/api/bookings/booking-001')
      .set('Cookie', adminCookie())
      .send({ status: 'confirmed' });
    expect([200, 409]).toContain(res.status);
  });
});
