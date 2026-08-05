/**
 * Hotel webhook + sync: when hotel approves, website booking confirms and emails guest.
 */
import './testSetup';
import request from 'supertest';
import app from '../app';

process.env.HOTEL_WEBHOOK_SECRET = 'test-hotel-webhook-secret-value-32chars!!';

const mockBookingDoc = {
  _id: 'booking-001',
  booking_reference: 'BR-111',
  hotel_id: 'hotel-001',
  guestEmail: 'alice@example.com',
  guestName: 'Alice',
  propertyName: 'Test Room',
  checkInDate: '2026-08-10',
  status: 'pending',
  summary_only: false,
  confirmationSendStatus: 'none',
  confirmationSentAt: null,
  confirmationSendError: '',
  save: jest.fn().mockResolvedValue(undefined),
};

jest.mock('../data/mongoModels', () => ({
  BookingModel: {
    findById: jest.fn(),
    findOne: jest.fn(),
    find: jest.fn(),
    create: jest.fn(),
    countDocuments: jest.fn(),
    updateOne: jest.fn().mockResolvedValue({ acknowledged: true, modifiedCount: 1 }),
  },
  PropertyModel: { findById: jest.fn(), find: jest.fn() },
  UserModel: { findById: jest.fn(), findOne: jest.fn() },
  HotelModel: { find: jest.fn(), findById: jest.fn() },
  RoomCategoryModel: { find: jest.fn(), findById: jest.fn() },
  ExternalReservationModel: {
    create: jest.fn(),
    updateMany: jest.fn(),
    watch: jest.fn(),
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
  },
  BillingChargeModel: { insertMany: jest.fn(), countDocuments: jest.fn() },
}));

jest.mock('../services/notificationService', () => ({
  sendBookingConfirmationNotification: jest.fn().mockResolvedValue(true),
  sendBookingDeclinedNotification: jest.fn().mockResolvedValue(true),
  sendBookingRequestReceivedNotification: jest.fn().mockResolvedValue(true),
  queueGuestNotification: jest.fn((_label: string, task: () => Promise<unknown>) => {
    void task();
  }),
  buildRebookUrl: jest.fn(),
}));

import { BookingModel } from '../data/mongoModels';
import {
  sendBookingConfirmationNotification,
  sendBookingDeclinedNotification,
} from '../services/notificationService';
import { applyHotelBookingDecision } from '../services/hotelBookingSync';
import { normalizeHotelDecisionStatus } from '../utils/externalReservation';

const MockBookingModel = BookingModel as jest.Mocked<typeof BookingModel>;
const mockSend = sendBookingConfirmationNotification as jest.MockedFunction<typeof sendBookingConfirmationNotification>;
const mockDeclineSend = sendBookingDeclinedNotification as jest.MockedFunction<typeof sendBookingDeclinedNotification>;

function mockFindBooking(booking: typeof mockBookingDoc) {
  const chain = { select: jest.fn().mockResolvedValue(booking) };
  (MockBookingModel.findById as jest.Mock).mockReturnValue(chain);
  (MockBookingModel.findOne as jest.Mock).mockReturnValue(chain);
  return chain;
}

describe('normalizeHotelDecisionStatus', () => {
  it('maps hotel approval statuses', () => {
    expect(normalizeHotelDecisionStatus('approved')).toBe('approved');
    expect(normalizeHotelDecisionStatus('reserved')).toBe('approved');
    expect(normalizeHotelDecisionStatus('reservation.approved')).toBe('approved');
  });

  it('maps hotel rejection statuses', () => {
    expect(normalizeHotelDecisionStatus('rejected')).toBe('rejected');
    expect(normalizeHotelDecisionStatus('declined')).toBe('rejected');
    expect(normalizeHotelDecisionStatus('reservation.rejected')).toBe('rejected');
  });

  it('ignores pending statuses', () => {
    expect(normalizeHotelDecisionStatus('pending_approval')).toBeNull();
  });
});

describe('applyHotelBookingDecision', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue(true);
    (MockBookingModel.updateOne as jest.Mock).mockResolvedValue({ acknowledged: true, modifiedCount: 1 });
  });

  it('confirms pending booking and sends email on approval', async () => {
    const booking = { ...mockBookingDoc };
    mockFindBooking(booking);

    const result = await applyHotelBookingDecision({
      bookingReference: 'BR-111',
      status: 'approved',
    });

    expect(result.ok).toBe(true);
    expect(result.kind).toBe('approved');
    expect(booking.status).toBe('confirmed');
    expect(MockBookingModel.updateOne).toHaveBeenCalled();
    expect(mockSend).toHaveBeenCalledWith(booking);
  });

  it('declines pending booking on rejection and emails guest', async () => {
    const booking = { ...mockBookingDoc };
    mockFindBooking(booking);

    const result = await applyHotelBookingDecision({
      bookingId: 'booking-001',
      status: 'rejected',
    });

    expect(result.ok).toBe(true);
    expect(result.kind).toBe('rejected');
    expect(booking.status).toBe('declined');
    expect(mockSend).not.toHaveBeenCalled();
    expect(mockDeclineSend).toHaveBeenCalledWith(booking);
  });
});

describe('POST /api/bookings/hotel-events', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue(true);
    (MockBookingModel.updateOne as jest.Mock).mockResolvedValue({ acknowledged: true, modifiedCount: 1 });
  });

  it('returns 503 when webhook secret is missing', async () => {
    const previous = process.env.HOTEL_WEBHOOK_SECRET;
    delete process.env.HOTEL_WEBHOOK_SECRET;
    const res = await request(app)
      .post('/api/bookings/hotel-events')
      .send({ bookingReference: 'BR-111', status: 'approved' });
    process.env.HOTEL_WEBHOOK_SECRET = previous;
    expect(res.status).toBe(503);
  });

  it('returns 401 without credentials', async () => {
    const res = await request(app)
      .post('/api/bookings/hotel-events')
      .send({ bookingReference: 'BR-111', status: 'approved' });
    expect(res.status).toBe(401);
  });

  it('confirms booking when hotel sends approved event', async () => {
    const booking = { ...mockBookingDoc };
    mockFindBooking(booking);

    const res = await request(app)
      .post('/api/bookings/hotel-events')
      .set('Authorization', `Bearer ${process.env.HOTEL_WEBHOOK_SECRET}`)
      .send({ bookingReference: 'BR-111', status: 'approved' });

    expect(res.status).toBe(200);
    expect(res.body.kind).toBe('approved');
    expect(res.body.newStatus).toBe('confirmed');
    expect(mockSend).toHaveBeenCalled();
  });
});
