/**
 * Member discount resolver tests — models are mocked.
 */
jest.mock('../data/mongoModels', () => ({
  MemberSubscriptionModel: {
    findOne: jest.fn(),
  },
  PlatformSettingsModel: {
    findOne: jest.fn(),
  },
}));

import { MemberSubscriptionModel, PlatformSettingsModel } from '../data/mongoModels';
import { resolveMemberDiscount } from '../utils/memberDiscount';

const mockMemberFind = MemberSubscriptionModel.findOne as jest.Mock;
const mockSettingsFind = PlatformSettingsModel.findOne as jest.Mock;

function leanResult<T>(value: T) {
  return { lean: jest.fn().mockResolvedValue(value) };
}

describe('resolveMemberDiscount', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSettingsFind.mockReturnValue(leanResult({
      key: 'global',
      member_booking_discount_percent: 10,
    }));
  });

  it('rejects unknown membership IDs', async () => {
    mockMemberFind.mockReturnValue(leanResult(null));
    const result = await resolveMemberDiscount('SHID-MISSING', 10000);
    expect(result.valid).toBe(false);
    expect(result.message).toMatch(/not found/i);
  });

  it('requires points in the wallet', async () => {
    mockMemberFind.mockReturnValue(leanResult({
      member_shid_id: 'SHID-ZXWPLCCW',
      full_name: 'Test Member',
      status: 'approved',
      member_valid_until: new Date(Date.now() + 86400000),
      points_balance: 0,
    }));
    const result = await resolveMemberDiscount('SHID-ZXWPLCCW', 10000);
    expect(result.valid).toBe(false);
    expect(result.message).toMatch(/points/i);
  });

  it('applies platform percent capped by points balance', async () => {
    mockMemberFind.mockReturnValue(leanResult({
      member_shid_id: 'SHID-ZXWPLCCW',
      full_name: 'Test Member',
      status: 'approved',
      member_valid_until: new Date(Date.now() + 86400000),
      points_balance: 500,
    }));
    const result = await resolveMemberDiscount('shid-zxwplccw', 10000);
    expect(result.valid).toBe(true);
    expect(result.discountPercent).toBe(10);
    // 10% of 10000 = 1000, but wallet only has 500 pts
    expect(result.discountAmount).toBe(500);
    expect(result.membershipId).toBe('SHID-ZXWPLCCW');
  });

  it('rejects expired memberships', async () => {
    mockMemberFind.mockReturnValue(leanResult({
      member_shid_id: 'SHID-OLD',
      status: 'approved',
      member_valid_until: new Date(Date.now() - 86400000),
      points_balance: 2000,
    }));
    const result = await resolveMemberDiscount('SHID-OLD', 8000);
    expect(result.valid).toBe(false);
    expect(result.message).toMatch(/expired/i);
  });
});
