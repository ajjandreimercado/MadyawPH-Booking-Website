import { Router } from 'express';
import { PromoCodeModel } from '../data/mongoModels';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { validateString, validateEnum, validateId } from '../utils/validators';

const promoCodeRoutes = Router();

// ─── POST /validate ────────────────────────────────────────────────────────────
// Public: validate a promo code and return the discount details.

promoCodeRoutes.post('/validate', async (req, res) => {
  const { code, bookingAmount } = req.body as { code?: string; bookingAmount?: number };

  const codeResult = validateString(code, 'Promo code', 1, 50);
  if (!codeResult.ok) return res.status(400).json({ message: codeResult.message });

  const amount = Number(bookingAmount ?? 0);

  const promo = await PromoCodeModel.findOne({
    code: codeResult.value.toUpperCase().trim(),
    is_active: true,
  }).lean();

  if (!promo) {
    return res.status(404).json({ valid: false, message: 'Promo code not found or inactive.' });
  }

  if (promo.expires_at && new Date(promo.expires_at) < new Date()) {
    return res.status(400).json({ valid: false, message: 'This promo code has expired.' });
  }

  if (promo.max_uses > 0 && promo.uses_count >= promo.max_uses) {
    return res.status(400).json({ valid: false, message: 'This promo code has reached its usage limit.' });
  }

  if (amount > 0 && promo.min_booking_amount > 0 && amount < promo.min_booking_amount) {
    return res.status(400).json({
      valid: false,
      message: `Minimum booking amount of ₱${promo.min_booking_amount.toLocaleString()} required.`,
    });
  }

  let discountAmount = 0;
  if (promo.discount_type === 'percentage') {
    discountAmount = Math.round(amount * (promo.discount_value / 100));
  } else {
    discountAmount = Math.min(promo.discount_value, amount);
  }

  return res.json({
    valid: true,
    code: promo.code,
    discountType: promo.discount_type,
    discountValue: promo.discount_value,
    discountAmount,
    description: promo.description,
  });
});

// ─── GET /featured ─────────────────────────────────────────────────────────────
// Public: get a featured active promo code for marketing banners.

promoCodeRoutes.get('/featured', async (_req, res) => {
  const promo = await PromoCodeModel.findOne({
    is_active: true,
    $or: [{ expires_at: { $exists: false } }, { expires_at: { $gt: new Date() } }]
  }).sort({ discount_value: -1 }).lean();

  if (!promo) {
    return res.status(404).json({ message: 'No featured promo found.' });
  }

  return res.json({
    code: promo.code,
    discountType: promo.discount_type,
    discountValue: promo.discount_value,
    description: promo.description,
  });
});

// ─── GET / ─────────────────────────────────────────────────────────────────────
// Admin: list all promo codes

promoCodeRoutes.get('/', requireAuth, requireRole('admin', 'super_admin'), async (_req, res) => {
  const codes = await PromoCodeModel.find().sort({ createdAt: -1 }).lean();
  return res.json(codes);
});

// ─── POST / ────────────────────────────────────────────────────────────────────
// Admin: create a new promo code

promoCodeRoutes.post('/', requireAuth, requireRole('admin', 'super_admin'), async (req, res) => {
  const { code, discount_type, discount_value, min_booking_amount, max_uses, expires_at, description } = req.body;

  if (!code || !discount_type || discount_value === undefined) {
    return res.status(400).json({ message: 'code, discount_type, and discount_value are required.' });
  }

  // OWASP A03: validate discount_type against an explicit allowlist
  const discountTypeResult = validateEnum(discount_type, 'Discount type', ['percentage', 'fixed'] as const);
  if (!discountTypeResult.ok) return res.status(400).json({ message: discountTypeResult.message });

  const discountValue = Number(discount_value);
  if (!Number.isFinite(discountValue) || discountValue < 0) {
    return res.status(400).json({ message: 'discount_value must be a non-negative number.' });
  }

  const promo = await PromoCodeModel.create({
    code: String(code).toUpperCase().trim(),
    discount_type: discountTypeResult.value,
    discount_value: discountValue,
    min_booking_amount: Number(min_booking_amount ?? 0),
    max_uses: Number(max_uses ?? 0),
    expires_at: expires_at ? new Date(expires_at) : undefined,
    description: String(description ?? ''),
    is_active: true,
  });

  return res.status(201).json(promo);
});

// ─── DELETE /:id ───────────────────────────────────────────────────────────────

promoCodeRoutes.delete('/:id', requireAuth, requireRole('admin', 'super_admin'), async (req, res) => {
  // OWASP A03: validate ID param length before DB operation
  const idResult = validateId(req.params.id, 'Promo code ID');
  if (!idResult.ok) return res.status(400).json({ message: idResult.message });

  await PromoCodeModel.findByIdAndDelete(idResult.value);
  return res.json({ message: 'Promo code deleted.' });
});

export default promoCodeRoutes;
