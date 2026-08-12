/**
 * Madyaw member booking discount — reads hotel-app shared Mongo:
 * - member_subscription_requests (member_shid_id + points_balance)
 * - platform_settings.member_booking_discount_percent
 *
 * Guests enter their Membership ID (SHID-…). Discount applies only when the
 * membership is approved/valid and the points wallet has a positive balance.
 * Anti-abuse: each Membership ID may use the points wallet discount once per
 * Asia/Manila calendar day (website bookings with discount_type "member").
 * Website records the membership on the booking; the hotel app owns points ledger updates.
 */

import { BookingModel, MemberSubscriptionModel, PlatformSettingsModel } from '../data/mongoModels';

export interface MemberDiscountResult {
  valid: boolean;
  membershipId: string;
  memberName?: string;
  pointsBalance: number;
  discountPercent: number;
  discountAmount: number;
  message: string;
}

const MANILA_TZ = 'Asia/Manila';

function normalizeMembershipId(raw: string | undefined | null): string {
  return String(raw ?? '').trim().toUpperCase();
}

/** Start of the current calendar day in Asia/Manila, as a UTC Date. */
export function startOfManilaDay(now: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: MANILA_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const year = parts.find((p) => p.type === 'year')?.value ?? '1970';
  const month = parts.find((p) => p.type === 'month')?.value ?? '01';
  const day = parts.find((p) => p.type === 'day')?.value ?? '01';
  return new Date(`${year}-${month}-${day}T00:00:00+08:00`);
}

/** Exclusive end of the current Asia/Manila calendar day. */
export function endOfManilaDay(now: Date = new Date()): Date {
  const start = startOfManilaDay(now);
  return new Date(start.getTime() + 24 * 60 * 60 * 1000);
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

/**
 * True when this Membership ID already used a member points discount today
 * (Asia/Manila). Declined/cancelled bookings do not count.
 */
export async function hasMemberDiscountUsedToday(
  membershipId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const id = normalizeMembershipId(membershipId);
  if (!id) return false;

  const dayStart = startOfManilaDay(now);
  const dayEnd = endOfManilaDay(now);
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const existing = await BookingModel.exists({
    discount_type: 'member',
    member_shid_id: new RegExp(`^${escaped}$`, 'i'),
    created_at: { $gte: dayStart, $lt: dayEnd },
    status: { $nin: ['declined', 'cancelled'] },
  });

  return Boolean(existing);
}

export async function resolveMemberDiscount(
  rawMembershipId: string | undefined,
  bookingAmount: number,
  options?: { now?: Date },
): Promise<MemberDiscountResult> {
  const membershipId = normalizeMembershipId(rawMembershipId);
  const now = options?.now ?? new Date();
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

  const canonicalId = String(member.member_shid_id ?? membershipId).toUpperCase();
  const memberName = member.full_name ? String(member.full_name) : undefined;
  const pointsBalanceRaw = Math.max(0, Math.round(Number(member.points_balance ?? 0) || 0));

  const status = String(member.status ?? '').toLowerCase();
  if (status && status !== 'approved') {
    return {
      valid: false,
      membershipId: canonicalId,
      pointsBalance: pointsBalanceRaw,
      discountPercent: 0,
      discountAmount: 0,
      message: 'This membership is not active yet.',
    };
  }

  const validUntilRaw = member.member_valid_until;
  if (validUntilRaw) {
    const validUntil = new Date(validUntilRaw as string | Date);
    if (!Number.isNaN(validUntil.getTime()) && validUntil.getTime() < now.getTime()) {
      return {
        valid: false,
        membershipId: canonicalId,
        pointsBalance: pointsBalanceRaw,
        discountPercent: 0,
        discountAmount: 0,
        message: 'This membership has expired. Please renew to use member discounts.',
      };
    }
  }

  const pointsBalance = pointsBalanceRaw;
  if (pointsBalance <= 0) {
    return {
      valid: false,
      membershipId: canonicalId,
      memberName,
      pointsBalance: 0,
      discountPercent: 0,
      discountAmount: 0,
      message: 'No points in your wallet — member discount is unavailable until you have points.',
    };
  }

  // Once-per-day wallet use (Manila calendar day) to limit shared-ID abuse.
  if (await hasMemberDiscountUsedToday(canonicalId, now)) {
    return {
      valid: false,
      membershipId: canonicalId,
      memberName,
      pointsBalance,
      discountPercent: 0,
      discountAmount: 0,
      message: 'This membership already used its points discount today. Try again tomorrow.',
    };
  }

  const discountPercent = await getMemberDiscountPercent();
  if (discountPercent <= 0) {
    return {
      valid: false,
      membershipId: canonicalId,
      memberName,
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
      membershipId: canonicalId,
      memberName,
      pointsBalance,
      discountPercent,
      discountAmount: 0,
      message: 'Member discount could not be applied to this stay total.',
    };
  }

  return {
    valid: true,
    membershipId: canonicalId,
    memberName,
    pointsBalance,
    discountPercent,
    discountAmount,
    message: `Madyaw member ${discountPercent}% discount — you save ₱${discountAmount.toLocaleString()} (${pointsBalance.toLocaleString()} pts available). Once per day.`,
  };
}
