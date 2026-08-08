import { Router } from 'express';
import { publicReadLimiter } from '../middleware/rateLimiters';
import { validateOptionalString, validatePositiveNumber } from '../utils/validators';
import { resolveMemberDiscount } from '../utils/memberDiscount';

const memberRoutes = Router();

// ─── POST /validate ───────────────────────────────────────────────────────────
// Public: validate a Madyaw membership ID against hotel-app member records.

memberRoutes.post('/validate', publicReadLimiter, async (req, res) => {
  const membershipIdResult = validateOptionalString(req.body?.membershipId ?? req.body?.memberShidId, 'Membership ID', 40);
  if (!membershipIdResult.ok) {
    return res.status(400).json({ message: membershipIdResult.message });
  }

  const amountResult = validatePositiveNumber(req.body?.bookingAmount, 'Booking amount', 10_000_000);
  if (!amountResult.ok) {
    return res.status(400).json({ message: amountResult.message });
  }

  const membershipId = membershipIdResult.value?.trim() ?? '';
  if (!membershipId) {
    return res.status(400).json({ valid: false, message: 'Enter your Madyaw membership ID.' });
  }

  const result = await resolveMemberDiscount(membershipId, amountResult.value ?? 0);
  return res.json({
    valid: result.valid,
    membershipId: result.membershipId,
    memberName: result.memberName,
    pointsBalance: result.pointsBalance,
    discountPercent: result.discountPercent,
    discountAmount: result.discountAmount,
    message: result.message,
  });
});

export default memberRoutes;
