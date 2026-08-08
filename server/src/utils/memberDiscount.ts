/**
 * Madyaw member booking discount — reads hotel-app shared Mongo:
 * - member_subscription_requests (member_shid_id + points_balance)
 * - platform_settings.member_booking_discount_percent
 *
 * Guests enter their Membership ID (SHID-…). Discount applies only when the
 * membership is approved/valid and the points wallet has a positive balance.
 * Website records the membership on the booking; the hotel app owns points ledger updates.
 */

import { MemberSubscriptionModel, PlatformSettingsModel } from '../data/mongoModels';

export interface MemberDiscountResult {
  valid: boolean;
  membershipId: string;
  memberName?: string;
  pointsBalance: number;
  discountPercent: number;
  discountAmount: number;
  message: string;
}

function normalizeMembershipId(raw: string | undefined | null): string {
  return String(raw ?? '').trim().toUpperCase();
}

async function getMemberDiscountPercent(): Promise<number> {
  const settings = await PlatformSettingsModel.findOne({ key: 'global' }).lean()
    ?? await PlatformSettingsModel.findOne({}).lean();
  const percent = Number(
    (settings as { member_booking_discount_percent?: unknown } | null)?.member_booking_discount_percent
    ?? 0,
  );
  if (!Number.isFinite(percent) || percent <= 0) return 0;
  return Math.min(100, Math.max(0, percent));
}

export async function resolveMemberDiscount(
  rawMembershipId: string | undefined,
  bookingAmount: number,
): Promise<MemberDiscountResult> {
  const membershipId = normalizeMembershipId(rawMembershipId);
  if (!membershipId) {
    return {
      valid: false,
      membershipId: '',
      pointsBalance: 0,
      discountPercent: 0,
      discountAmount: 0,
      message: '',
    };
  }

  const member = await MemberSubscriptionModel.findOne({
    $or: [
      { member_shid_id: membershipId },
      { member_shid_id: new RegExp(`^${membershipId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
    ],
  }).lean();

  if (!member) {
    return {
      valid: false,
      membershipId,
      pointsBalance: 0,
      discountPercent: 0,
      discountAmount: 0,
      message: 'Membership ID not found.',
    };
  }

  const status = String(member.status ?? '').toLowerCase();
  if (status && status !== 'approved') {
    return {
      valid: false,
      membershipId: String(member.member_shid_id ?? membershipId).toUpperCase(),
      pointsBalance: Number(member.points_balance ?? 0) || 0,
      discountPercent: 0,
      discountAmount: 0,
      message: 'This membership is not active yet.',
    };
  }

  const validUntilRaw = member.member_valid_until;
  if (validUntilRaw) {
    const validUntil = new Date(validUntilRaw as string | Date);
    if (!Number.isNaN(validUntil.getTime()) && validUntil.getTime() < Date.now()) {
      return {
        valid: false,
        membershipId: String(member.member_shid_id ?? membershipId).toUpperCase(),
        pointsBalance: Number(member.points_balance ?? 0) || 0,
        discountPercent: 0,
        discountAmount: 0,
        message: 'This membership has expired. Please renew to use member discounts.',
      };
    }
  }

  const pointsBalance = Math.max(0, Math.round(Number(member.points_balance ?? 0) || 0));
  if (pointsBalance <= 0) {
    return {
      valid: false,
      membershipId: String(member.member_shid_id ?? membershipId).toUpperCase(),
      memberName: member.full_name ? String(member.full_name) : undefined,
      pointsBalance: 0,
      discountPercent: 0,
      discountAmount: 0,
      message: 'No points in your wallet — member discount is unavailable until you have points.',
    };
  }

  const discountPercent = await getMemberDiscountPercent();
  if (discountPercent <= 0) {
    return {
      valid: false,
      membershipId: String(member.member_shid_id ?? membershipId).toUpperCase(),
      memberName: member.full_name ? String(member.full_name) : undefined,
      pointsBalance,
      discountPercent: 0,
      discountAmount: 0,
      message: 'Member discounts are not configured right now.',
    };
  }

  const subtotal = Math.max(0, Math.round(Number(bookingAmount) || 0));
  // Percent from platform/hotel-app settings; never exceed points wallet (1 pt ≈ ₱1 redeemable cap).
  const percentAmount = Math.round(subtotal * (discountPercent / 100));
  const discountAmount = Math.min(subtotal, percentAmount, pointsBalance);

  if (discountAmount <= 0) {
    return {
      valid: false,
      membershipId: String(member.member_shid_id ?? membershipId).toUpperCase(),
      memberName: member.full_name ? String(member.full_name) : undefined,
      pointsBalance,
      discountPercent,
      discountAmount: 0,
      message: 'Member discount could not be applied to this stay total.',
    };
  }

  return {
    valid: true,
    membershipId: String(member.member_shid_id ?? membershipId).toUpperCase(),
    memberName: member.full_name ? String(member.full_name) : undefined,
    pointsBalance,
    discountPercent,
    discountAmount,
    message: `Madyaw member ${discountPercent}% discount — you save ₱${discountAmount.toLocaleString()} (${pointsBalance.toLocaleString()} pts available).`,
  };
}
