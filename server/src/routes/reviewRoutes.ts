import { Router } from 'express';
import { ReviewModel, PropertyModel, BookingModel } from '../data/mongoModels';
import { bookingStayRange } from '../utils/roomAvailability';
import { requireAuth } from '../middleware/auth';
import { serializeReview } from '../utils/serialize';
// OWASP A03/A04: centralised limiters (no inline definition) + input validators
import { publicReadLimiter, reviewSubmitLimiter } from '../middleware/rateLimiters';
import { validateId, validateInteger, validateString } from '../utils/validators';

const reviewRoutes = Router();

/** Booking statuses that mean the guest actually stayed (website + hotel-app vocabulary). */
const REVIEWABLE_STATUSES = [
  'confirmed', 'reserved', 'booked', 'paid', 'checked_in', 'checked-in', 'checked_out', 'checked-out', 'completed',
];

/** "Alice Santos" → "Alice S." — shown publicly, so never the full name. */
function publicGuestName(fullName: unknown): string {
  const parts = String(fullName ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'Guest';
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.` : parts[0];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Positive-integer helper for pagination params
function parsePositiveInt(value: unknown, defaultVal: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return defaultVal;
  return Math.min(Math.floor(n), max);
}

// ─── GET / ────────────────────────────────────────────────────────────────────
/**
 * GET /api/reviews
 * Supports optional ?propertyId=, ?hotelId=, ?page=, ?limit= query params.
 * Returns paginated reviews.
 * publicReadLimiter: guards against scraping (OWASP A04)
 */
reviewRoutes.get('/', publicReadLimiter, async (req, res) => {
  const { propertyId, hotelId, page, limit } = req.query;

  // OWASP A03: validate id lengths before using in filter
  if (typeof propertyId === 'string' && propertyId.trim().length > 100) {
    return res.status(400).json({ message: 'propertyId is invalid.' });
  }
  if (typeof hotelId === 'string' && hotelId.trim().length > 100) {
    return res.status(400).json({ message: 'hotelId is invalid.' });
  }

  const filter: Record<string, unknown> = {};
  const propertyIdTrimmed = typeof propertyId === 'string' ? propertyId.trim() : '';
  const hotelIdTrimmed = typeof hotelId === 'string' ? hotelId.trim() : '';

  if (propertyIdTrimmed) {
    filter.propertyId = propertyIdTrimmed;
  }
  if (hotelIdTrimmed) {
    // Match reviews stamped with hotel_id, plus legacy rows keyed only by propertyId.
    const rooms = await PropertyModel.find({ hotel_id: hotelIdTrimmed }).select({ _id: 1 }).lean();
    const propertyIds = rooms.map(room => String(room._id));
    const hotelClauses: Record<string, unknown>[] = [{ hotel_id: hotelIdTrimmed }];
    if (propertyIds.length > 0) {
      hotelClauses.push({ propertyId: { $in: propertyIds } });
    }
    if (propertyIdTrimmed) {
      // Both scopes: property must match AND belong to hotel (via $and with $or hotel clauses).
      filter.$and = [{ propertyId: propertyIdTrimmed }, { $or: hotelClauses }];
      delete filter.propertyId;
    } else {
      filter.$or = hotelClauses;
    }
  }

  // Require at least one scope — never return the global review dump.
  if (!propertyIdTrimmed && !hotelIdTrimmed) {
    return res.status(400).json({ message: 'Please provide a property or hotel to load reviews.' });
  }

  const safePage = parsePositiveInt(page, 1, 1_000);
  const safeLimit = parsePositiveInt(limit, 20, 100);
  const skip = (safePage - 1) * safeLimit;

  const [reviews, total] = await Promise.all([
    ReviewModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(safeLimit).lean(),
    ReviewModel.countDocuments(filter),
  ]);

  return res.json({
    data: reviews.map(review => serializeReview(review as never)),
    total,
    page: safePage,
    limit: safeLimit,
    totalPages: Math.ceil(total / safeLimit),
  });
});

// ─── POST / ───────────────────────────────────────────────────────────────────
/**
 * POST /api/reviews
 * Requires authentication. Validates all fields, sanitizes strings, enforces limits.
 * requireAuth: only authenticated users may submit a review (OWASP A07).
 * reviewSubmitLimiter (from rateLimiters.ts): prevents review spam/abuse (OWASP A04)
 */
reviewRoutes.post('/', requireAuth, reviewSubmitLimiter, async (req, res) => {
  const { propertyId, rating, title, comment } = req.body as {
    propertyId?: string;
    rating?: unknown;
    title?: string;
    comment?: string;
  };

  // Required field presence check (the author name comes from the verified booking)
  if (!propertyId || rating === undefined || !title || !comment) {
    return res.status(400).json({ message: 'Missing required review fields.' });
  }

  // OWASP A03: schema-based validation on each field

  // propertyId: string, non-empty, max 100 chars
  const propertyIdResult = validateId(propertyId, 'Property ID');
  if (!propertyIdResult.ok) {
    return res.status(400).json({ message: propertyIdResult.message });
  }

  // rating: integer 1–5
  const ratingResult = validateInteger(rating, 'Rating', 1, 5);
  if (!ratingResult.ok) {
    return res.status(400).json({ message: ratingResult.message });
  }

  // title: string 1–120 chars
  const titleResult = validateString(title, 'Title', 1, 120);
  if (!titleResult.ok) {
    return res.status(400).json({ message: titleResult.message });
  }

  // comment: string 1–2000 chars
  const commentResult = validateString(comment, 'Comment', 1, 2_000);
  if (!commentResult.ok) {
    return res.status(400).json({ message: commentResult.message });
  }

  // Only guests whose stay at this room has ended may review — once per stay.
  const email = String(req.auth?.email ?? '').trim();
  const escapedEmail = email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const stays = email
    ? ((await BookingModel.find({
      $or: [{ propertyId: propertyIdResult.value }, { room_id: propertyIdResult.value }],
      guestEmail: new RegExp(`^${escapedEmail}$`, 'i'),
      status: { $in: REVIEWABLE_STATUSES },
    }).select({ guestName: 1, checkInDate: 1, checkOutDate: 1, check_in_date: 1, check_out_date: 1 }).lean()) as Array<Record<string, unknown>>)
    : [];
  const finishedStays = stays
    .map((stay) => ({ stay, range: bookingStayRange(stay) }))
    .filter((entry) => entry.range && entry.range.end.getTime() <= Date.now())
    .sort((a, b) => b.range!.end.getTime() - a.range!.end.getTime());
  let reviewedStay: Record<string, unknown> | undefined;
  for (const { stay } of finishedStays) {
    if ((await ReviewModel.countDocuments({ booking_id: String(stay._id) })) === 0) {
      reviewedStay = stay;
      break;
    }
  }
  if (!reviewedStay) {
    return res.status(403).json({
      message: finishedStays.length > 0
        ? 'You have already reviewed your stay here.'
        : 'Only guests who have completed a stay at this property can leave a review.',
    });
  }

  const property = await PropertyModel.findById(propertyIdResult.value)
    .select({ hotel_id: 1 })
    .lean();
  const hotelIdForReview = property?.hotel_id ? String(property.hotel_id) : undefined;

  const review = await ReviewModel.create({
    propertyId: propertyIdResult.value,
    ...(hotelIdForReview ? { hotel_id: hotelIdForReview } : {}),
    booking_id: String(reviewedStay._id),
    authorName: publicGuestName(reviewedStay.guestName),
    rating: ratingResult.value,
    title: titleResult.value,
    comment: commentResult.value,
  });

  return res.status(201).json(serializeReview(review as never));
});

export default reviewRoutes;
