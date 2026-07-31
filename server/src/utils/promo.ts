import { PromoCodeModel } from '../data/mongoModels';

export interface ResolvedPromo {
  code: string;
  discountAmount: number;
}

/**
 * Resolves an optional promo code against the current booking subtotal.
 * Returns a zero discount when no code is supplied.
 * Throws an Error with an actionable message when the code is invalid.
 */
export async function resolvePromoDiscount(
  rawCode: string | undefined,
  bookingAmount: number,
  session?: import('mongoose').ClientSession | null,
): Promise<ResolvedPromo> {
  const code = rawCode?.trim().toUpperCase() ?? '';
  if (!code) {
    return { code: '', discountAmount: 0 };
  }

  const query = PromoCodeModel.findOne({ code, is_active: true });
  if (session) query.session(session);
  const promo = await query.lean();

  if (!promo) {
    throw new Error('Promo code not found or inactive.');
  }

  if (promo.expires_at && new Date(promo.expires_at) < new Date()) {
    throw new Error('This promo code has expired.');
  }

  if (promo.max_uses > 0 && promo.uses_count >= promo.max_uses) {
    throw new Error('This promo code has reached its usage limit.');
  }

  if (bookingAmount > 0 && promo.min_booking_amount > 0 && bookingAmount < promo.min_booking_amount) {
    throw new Error(`Minimum booking amount of ₱${promo.min_booking_amount.toLocaleString()} required.`);
  }

  let discountAmount = 0;
  if (promo.discount_type === 'percentage') {
    discountAmount = Math.round(bookingAmount * (promo.discount_value / 100));
  } else {
    discountAmount = Math.min(promo.discount_value, bookingAmount);
  }

  return {
    code: promo.code,
    discountAmount: Math.max(0, discountAmount),
  };
}

export async function incrementPromoUse(
  code: string,
  session?: import('mongoose').ClientSession | null,
) {
  if (!code) return;
  await PromoCodeModel.updateOne(
    { code, is_active: true },
    { $inc: { uses_count: 1 } },
    session ? { session } : undefined,
  );
}
