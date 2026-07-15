import { Router } from 'express';
import { RoomCategoryModel } from '../data/mongoModels';
import { serializeRoomCategory } from '../utils/serialize';
// OWASP A03/A04: public rate limiter + ID param validation
import { publicReadLimiter } from '../middleware/rateLimiters';
import { validateId } from '../utils/validators';

const roomCategoryRoutes = Router();

// ─── GET / ────────────────────────────────────────────────────────────────────
// Public endpoint — publicReadLimiter guards against data-scraping (OWASP A04)

roomCategoryRoutes.get('/', publicReadLimiter, async (req, res) => {
  const { hotelId } = req.query;

  // OWASP A03: normalise hotelId — only accept non-empty strings within length limit
  const normalizedHotelId = typeof hotelId === 'string' && hotelId.trim() ? hotelId.trim() : null;

  // Guard against overly long hotelId query params before using in DB filter
  if (normalizedHotelId && normalizedHotelId.length > 100) {
    return res.status(400).json({ message: 'hotelId is invalid.' });
  }

  console.log('[MongoDB Query] Collection: roomcategories, Query: {}');
  const categories = await RoomCategoryModel.find().lean();
  console.log(`[MongoDB Results] Collection: roomcategories, Retrieved: ${categories.length} documents`);
  const serialized = categories.map(category => serializeRoomCategory(category as never));

  if (!normalizedHotelId) {
    return res.json(serialized);
  }

  return res.json(serialized.filter((category) => category.hotelId === normalizedHotelId));
});

// ─── GET /:categoryId ─────────────────────────────────────────────────────────

roomCategoryRoutes.get('/:categoryId', publicReadLimiter, async (req, res) => {
  // OWASP A03: validate categoryId param length before DB lookup
  const idResult = validateId(req.params.categoryId, 'Category ID');
  if (!idResult.ok) {
    return res.status(400).json({ message: idResult.message });
  }

  console.log(`[MongoDB Query] Collection: roomcategories, Action: findById, ID: ${req.params.categoryId}`);
  const category = await RoomCategoryModel.findById(req.params.categoryId).lean();
  console.log(`[MongoDB Results] Collection: roomcategories, Action: findById, Found: ${category ? 1 : 0}`);

  if (!category) {
    return res.status(404).json({ message: 'Room category not found.' });
  }

  return res.json(serializeRoomCategory(category as never));
});

export default roomCategoryRoutes;