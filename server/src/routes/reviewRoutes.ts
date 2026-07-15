import { Router } from 'express';
import { ReviewModel } from '../data/mongoModels';
import { requireAuth } from '../middleware/auth';
import { serializeReview } from '../utils/serialize';
// OWASP A03/A04: centralised limiters (no inline definition) + input validators
import { publicReadLimiter, reviewSubmitLimiter } from '../middleware/rateLimiters';
import { validateId, validateInteger, validateString } from '../utils/validators';

const reviewRoutes = Router();

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
 * Supports optional ?propertyId=, ?page=, ?limit= query params.
 * Returns paginated reviews.
 * publicReadLimiter: guards against scraping (OWASP A04)
 */
reviewRoutes.get('/', publicReadLimiter, async (req, res) => {
  const { propertyId, page, limit } = req.query;

  // OWASP A03: validate propertyId length before using in filter
  if (typeof propertyId === 'string' && propertyId.trim().length > 100) {
    return res.status(400).json({ message: 'propertyId is invalid.' });
  }

  const filter = typeof propertyId === 'string' && propertyId.trim()
    ? { propertyId: propertyId.trim() }
    : {};

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
  const { propertyId, authorName, rating, title, comment } = req.body as {
    propertyId?: string;
    authorName?: string;
    rating?: unknown;
    title?: string;
    comment?: string;
  };

  // Required field presence check
  if (!propertyId || !authorName || rating === undefined || !title || !comment) {
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

  // authorName: string 1–80 chars
  const authorResult = validateString(authorName, 'Author name', 1, 80);
  if (!authorResult.ok) {
    return res.status(400).json({ message: authorResult.message });
  }

  const review = await ReviewModel.create({
    propertyId: propertyIdResult.value,
    authorName: authorResult.value,
    rating: ratingResult.value,
    title: titleResult.value,
    comment: commentResult.value,
  });

  return res.status(201).json(serializeReview(review as never));
});

export default reviewRoutes;
