import { Router } from 'express';
import { authWriteLimiter } from '../middleware/rateLimiters';
import { validateOptionalString, validatePositiveNumber } from '../utils/validators';
import { resolveMemberDiscount } from '../utils/memberDiscount';

const memberRoutes = Router();

// ─── POST /validate ────────────────────────────────────────────────────────────
// Public (the website has no accounts): guests check a membership ID at
// checkout. The response NEVER includes the member's name or points balance —
// only whether the ID earns a discount and how much — so guessing an ID
// cannot leak member PII. Rate-limited against ID enumeration.

memberRoutes.post('/validate', authWriteLimiter, async (req, res) => {
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
  // No memberName / pointsBalance anywhere in this response (public endpoint):
  // the resolver's success message embeds the points balance, so rebuild it.
  return res.json({
    valid: result.valid,
    membershipId: result.membershipId,
    discountPercent: result.discountPercent,
    discountAmount: result.discountAmount,
    message: result.valid
      ? `Madyaw member ${result.discountPercent}% discount — you save ₱${result.discountAmount.toLocaleString()}. Once per day.`
      : result.message,
  });
});

export default memberRoutes;
