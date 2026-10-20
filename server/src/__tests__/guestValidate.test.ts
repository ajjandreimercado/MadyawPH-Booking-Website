/**
 * Guest promo/member validation — the website has no accounts, so both
 * /validate endpoints are public (rate-limited). The member response must
 * never leak the member's name or points balance.
 */
import './testSetup';
import express from 'express';
import request from 'supertest';

jest.mock('../data/mongoModels', () => ({
  PromoCodeModel: { findOne: jest.fn() },
  MemberSubscriptionModel: { findOne: jest.fn() },
  PlatformSettingsModel: { findOne: jest.fn() },
  BookingModel: { exists: jest.fn() },
}));

import promoCodeRoutes from '../routes/promoCodeRoutes';
import memberRoutes from '../routes/memberRoutes';
import {
  BookingModel,
  MemberSubscriptionModel,
  PlatformSettingsModel,
  PromoCodeModel,
} from '../data/mongoModels';

const app = express();
app.use(express.json());
app.use('/api/promo-codes', promoCodeRoutes);
app.use('/api/members', memberRoutes);

function leanResult<T>(value: T) {
  return { lean: jest.fn().mockResolvedValue(value) };
}

const mockPromoFind = PromoCodeModel.findOne as jest.Mock;
const mockMemberFind = MemberSubscriptionModel.findOne as jest.Mock;
const mockSettingsFind = PlatformSettingsModel.findOne as jest.Mock;
const mockBookingExists = BookingModel.exists as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockSettingsFind.mockReturnValue(leanResult({
    key: 'global',
    member_booking_discount_percent: 10,
  }));
  mockBookingExists.mockResolvedValue(null);
});

describe('POST /api/promo-codes/validate (guest)', () => {
  it('validates a code without sign-in', async () => {
    mockPromoFind.mockReturnValue(leanResult({
      code: 'SAVE10',
      discount_type: 'percentage',
      discount_value: 10,
      description: '10% off',
      expires_at: null,
      max_uses: 0,
      uses_count: 0,
      min_booking_amount: 0,
    }));

    const res = await request(app)
      .post('/api/promo-codes/validate')
      .send({ code: 'save10', bookingAmount: 10000 });

    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
    expect(res.body.discountAmount).toBe(1000);
  });

  it('reports unknown codes without sign-in', async () => {
    mockPromoFind.mockReturnValue(leanResult(null));

    const res = await request(app)
      .post('/api/promo-codes/validate')
      .send({ code: 'NOPE', bookingAmount: 10000 });

    expect(res.status).toBe(404);
    expect(res.body.valid).toBe(false);
  });
});

describe('POST /api/members/validate (guest)', () => {
  it('validates a membership ID without sign-in and leaks no member PII', async () => {
    mockMemberFind.mockReturnValue(leanResult({
      member_shid_id: 'SHID-ZXWPLCCW',
      full_name: 'Test Member',
      status: 'approved',
      member_valid_until: new Date(Date.now() + 86400000),
      points_balance: 500,
    }));

    const res = await request(app)
      .post('/api/members/validate')
      .send({ membershipId: 'SHID-ZXWPLCCW', bookingAmount: 10000 });

    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
    expect(res.body.discountPercent).toBe(10);
    // 10% of ₱10,000 = ₱1,000, capped by the 500-point wallet.
    expect(res.body.discountAmount).toBe(500);
    // Public response: no name, no points balance — in fields or in the message.
    expect(res.body.memberName).toBeUndefined();
    expect(res.body.pointsBalance).toBeUndefined();
    expect(String(res.body.message)).not.toMatch(/Test Member|pts|points balance/i);
  });

  it('rejects unknown membership IDs without sign-in', async () => {
    mockMemberFind.mockReturnValue(leanResult(null));

    const res = await request(app)
      .post('/api/members/validate')
      .send({ membershipId: 'SHID-MISSING', bookingAmount: 10000 });

    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(false);
    expect(res.body.memberName).toBeUndefined();
    expect(res.body.pointsBalance).toBeUndefined();
  });
});
