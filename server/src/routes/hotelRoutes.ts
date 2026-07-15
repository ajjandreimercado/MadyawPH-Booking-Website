import { Router } from 'express';
import { HotelModel, PropertyModel, RoomCategoryModel, ReviewModel } from '../data/mongoModels';
import { serializeHotel, serializeProperty, serializeRoomCategory } from '../utils/serialize';
// OWASP A03/A04: public rate limiter + ID param validation
import { publicReadLimiter } from '../middleware/rateLimiters';
import { validateId } from '../utils/validators';
import Fuse from 'fuse.js';
import { getDistance } from 'geolib';
import { geocodeLocation } from '../services/geocodeService';

const hotelRoutes = Router();

// ─── GET / ────────────────────────────────────────────────────────────────────
// Public endpoint — publicReadLimiter guards against data-scraping (OWASP A04)

hotelRoutes.get('/', publicReadLimiter, async (_req, res) => {
  console.log('[MongoDB Query] Collection: hotels, Query: {}');
  const hotels = await HotelModel.find().lean();
  console.log(`[MongoDB Results] Collection: hotels, Retrieved: ${hotels.length} documents`);
  return res.json(hotels.map(hotel => serializeHotel(hotel as never)));
});

// ─── GET /search ──────────────────────────────────────────────────────────────
// Full-featured search endpoint powering the SearchResultsPage.
// Supports: destination, priceMin/Max, type, amenities, rating, freeCancellation, breakfastIncluded, sort, page, limit

hotelRoutes.get('/search', publicReadLimiter, async (req, res) => {
  const {
    destination, priceMin, priceMax, type, amenities,
    rating, freeCancellation, breakfastIncluded,
    sort = 'recommended', page = '1', limit = '10',
  } = req.query as Record<string, string | undefined>;

  // Build room filter
  const roomFilter: Record<string, unknown> = {};

  let hotelScores: Record<string, number> = {};

  if (typeof destination === 'string' && destination.trim()) {
    const destStr = destination.trim();
    
    // Geocode to get coordinates
    const geocodeParams = await geocodeLocation(destStr);
    
    // Fetch all hotels to perform fuzzy search
    const allHotels = await HotelModel.find().lean();
    const fuse = new Fuse(allHotels, {
      keys: ['name', 'location', 'city', 'neighborhood', 'landmarks'],
      threshold: 0.3,
      includeScore: true,
      ignoreLocation: true,
    });
    
    const fuseResults = fuse.search(destStr);
    const matchedHotelIds: string[] = [];
    
    fuseResults.forEach(result => {
      const h = result.item as any;
      const hId = String(h._id);
      matchedHotelIds.push(hId);
      
      const relevanceScore = (1 - (result.score || 0)) * 100;
      let proximityScore = 0;
      let finalScore = relevanceScore;
      
      if (geocodeParams && h.coordinates && typeof h.coordinates.latitude === 'number' && typeof h.coordinates.longitude === 'number') {
        const distanceMeters = getDistance(
          { latitude: geocodeParams.latitude, longitude: geocodeParams.longitude },
          { latitude: h.coordinates.latitude, longitude: h.coordinates.longitude }
        );
        
        // Closer gets higher score, up to 50km
        proximityScore = Math.max(0, 50 - (distanceMeters / 1000));
        finalScore = (relevanceScore * 0.6) + (proximityScore * 1.5);
      }
      
      hotelScores[hId] = finalScore;
    });

    const escaped = destStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const flexiblePattern = escaped.replace(/\s+/g, '').split('').join('\\s*');
    const rx = new RegExp(flexiblePattern, 'i');

    roomFilter.$or = [
      { hotel_name: rx }, 
      { display_name: rx },
      { category_name: rx }, 
      { room_type: rx },
    ];

    if (matchedHotelIds.length > 0 && Array.isArray(roomFilter.$or)) {
      roomFilter.$or.push({ hotel_id: { $in: matchedHotelIds } });
    }
  }

  const parsedMin = Number(priceMin);
  const parsedMax = Number(priceMax);
  if (Number.isFinite(parsedMin) && parsedMin > 0) {
    roomFilter.price_per_night = { ...(roomFilter.price_per_night as object ?? {}), $gte: parsedMin };
  }
  if (Number.isFinite(parsedMax) && parsedMax > 0) {
    roomFilter.price_per_night = { ...(roomFilter.price_per_night as object ?? {}), $lte: parsedMax };
  }

  const ALLOWED_TYPES = ['standard-room', 'deluxe-suite', 'family-suite', 'villa-retreat'];
  if (typeof type === 'string' && ALLOWED_TYPES.includes(type)) {
    roomFilter.room_type = type;
  }

  const ALLOWED_AMENITIES = ['wifi', 'pool', 'gym', 'spa', 'parking', 'restaurant', 'bar', 'beach-access', 'air-conditioning', 'kitchen', 'laundry', 'pet-friendly', 'breakfast-included', 'airport-shuttle', 'concierge'];
  if (typeof amenities === 'string' && amenities.trim()) {
    const list = amenities.split(',').map(a => a.trim()).filter(a => ALLOWED_AMENITIES.includes(a));
    if (list.length > 0) roomFilter.amenities = { $all: list };
  }

  if (freeCancellation === 'true') roomFilter.free_cancellation = true;
  if (breakfastIncluded === 'true') roomFilter.breakfast_included = true;

  const safeLimit = Math.min(Math.max(parseInt(limit ?? '12', 10) || 12, 1), 50);
  const safePage = Math.max(parseInt(page ?? '1', 10) || 1, 1);

  // Fetch matching rooms
  const rooms = await PropertyModel.find(roomFilter).lean();

  // Group rooms by hotel_id to get per-hotel stats
  const hotelStatsMap = new Map<string, {
    minPrice: number; availableRooms: number; totalRooms: number;
    images: string[]; types: Set<string>;
  }>();

  for (const room of rooms) {
    const hid = String(room.hotel_id ?? '');
    if (!hid) continue;
    const existing = hotelStatsMap.get(hid) ?? { minPrice: Infinity, availableRooms: 0, totalRooms: 0, images: [], types: new Set() };
    existing.totalRooms += 1;
    if (room.status === 'available') existing.availableRooms += 1;
    const price = Number(room.price_per_night ?? 0);
    if (price > 0 && price < existing.minPrice) existing.minPrice = price;
    if (room.image_url && existing.images.length < 3) existing.images.push(String(room.image_url));
    if (room.room_type) existing.types.add(String(room.room_type));
    hotelStatsMap.set(hid, existing);
  }

  if (hotelStatsMap.size === 0) {
    return res.json({ data: [], total: 0, page: safePage, limit: safeLimit, totalPages: 0 });
  }

  const hotelIds = Array.from(hotelStatsMap.keys());
  const [hotels, allReviews] = await Promise.all([
    HotelModel.find({ _id: { $in: hotelIds } }).lean(),
    ReviewModel.find({ hotel_id: { $in: hotelIds } }).lean(),
  ]);

  // Compute avg rating per hotel from reviews
  const ratingMap = new Map<string, { sum: number; count: number }>();
  for (const review of allReviews) {
    const hid = String(review.hotel_id ?? '');
    const current = ratingMap.get(hid) ?? { sum: 0, count: 0 };
    current.sum += Number(review.rating ?? 0);
    current.count += 1;
    ratingMap.set(hid, current);
  }

  const parsedRating = Number(rating);
  let results = hotels.map(hotel => {
    const hid = String((hotel as any)._id);
    const stats = hotelStatsMap.get(hid) ?? { minPrice: 0, availableRooms: 0, totalRooms: 0, images: [], types: new Set() };
    const ratingData = ratingMap.get(hid) ?? { sum: 0, count: 0 };
    const avgRating = ratingData.count > 0 ? Math.round((ratingData.sum / ratingData.count) * 10) / 10 : 0;
    return {
      ...serializeHotel(hotel as never),
      minPrice: stats.minPrice === Infinity ? 0 : stats.minPrice,
      availableRooms: stats.availableRooms,
      totalRooms: stats.totalRooms,
      images: stats.images,
      avgRating,
      totalReviews: ratingData.count,
      roomTypes: Array.from(stats.types),
    };
  }).filter(h => h.minPrice > 0);

  // Rating filter
  if (Number.isFinite(parsedRating) && parsedRating > 0) {
    results = results.filter(h => h.avgRating >= parsedRating);
  }

  // Sort
  if (sort === 'price') results.sort((a, b) => a.minPrice - b.minPrice);
  else if (sort === 'rating') results.sort((a, b) => b.avgRating - a.avgRating);
  else if (sort === 'popular') results.sort((a, b) => b.totalReviews - a.totalReviews);
  else {
    // 'recommended' — default order
    if (Object.keys(hotelScores).length > 0) {
      results.sort((a, b) => (hotelScores[b.id] || 0) - (hotelScores[a.id] || 0));
    } else {
      results.sort((a, b) => b.totalReviews - a.totalReviews);
    }
  }

  const total = results.length;
  const paginated = results.slice((safePage - 1) * safeLimit, safePage * safeLimit);

  return res.json({
    data: paginated,
    total,
    page: safePage,
    limit: safeLimit,
    totalPages: Math.ceil(total / safeLimit),
  });
});

// ─── GET /destinations ──────────────────────────────────────────────────────────
// Aggregates distinct cities from hotels to power the dynamic homepage destinations

hotelRoutes.get('/destinations', publicReadLimiter, async (_req, res) => {
  try {
    const destinations = await HotelModel.aggregate([
      { $match: { city: { $exists: true, $ne: '' } } },
      { $group: { _id: '$city', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 4 }
    ]);
    
    return res.json(destinations.map(d => ({
      name: d._id,
      count: d.count,
      query: d._id
    })));
  } catch (error) {
    console.error('Error fetching destinations:', error);
    return res.status(500).json({ message: 'Failed to fetch destinations' });
  }
});

// ─── GET /filters ─────────────────────────────────────────────────────────────
// Aggregates active room types and amenities from properties

hotelRoutes.get('/filters', publicReadLimiter, async (_req, res) => {
  try {
    const [roomTypes, amenities] = await Promise.all([
      PropertyModel.distinct('room_type'),
      PropertyModel.distinct('amenities')
    ]);
    return res.json({ roomTypes, amenities });
  } catch (error) {
    console.error('Error fetching filters:', error);
    return res.status(500).json({ message: 'Failed to fetch filters' });
  }
});

// ─── GET /:hotelId/detail ─────────────────────────────────────────────────────

hotelRoutes.get('/:hotelId/detail', publicReadLimiter, async (req, res) => {
  // OWASP A03: validate hotelId param length before DB lookup
  const idResult = validateId(req.params.hotelId, 'Hotel ID');
  if (!idResult.ok) {
    return res.status(400).json({ message: idResult.message });
  }
  const { hotelId } = req.params;

  console.log(`[MongoDB Query] Collection: hotels, Action: findById, ID: ${hotelId}`);
  const hotel = await HotelModel.findById(hotelId).lean();
  console.log(`[MongoDB Results] Collection: hotels, Action: findById, Found: ${hotel ? 1 : 0}`);
  if (!hotel) {
    return res.status(404).json({ message: 'Hotel not found.' });
  }

  console.log(`[MongoDB Query] Collection: roomcategories, Query: { hotel_id: ${hotelId} }`);
  console.log(`[MongoDB Query] Collection: rooms, Query: { hotel_id: ${hotelId} }`);
  const [scopedCategories, scopedRooms] = await Promise.all([
    RoomCategoryModel.find({ hotel_id: hotelId }).lean(),
    PropertyModel.find({ hotel_id: hotelId }).lean(),
  ]);
  console.log(`[MongoDB Results] Collection: roomcategories, Retrieved: ${scopedCategories.length} documents`);
  console.log(`[MongoDB Results] Collection: rooms, Retrieved: ${scopedRooms.length} documents`);

  const serializedHotel = serializeHotel(hotel as never);
  const serializedCategories = scopedCategories.map((category) => serializeRoomCategory(category as never));
  const serializedRooms = scopedRooms.map((room) => serializeProperty(room as never));

  const categoryStats = new Map<string, { totalRooms: number; availableRooms: number }>();
  const firstRoomByCategory = new Map<string, string>();
  const firstAvailableRoomByCategory = new Map<string, string>();

  for (const category of serializedCategories) {
    categoryStats.set(category.id, { totalRooms: 0, availableRooms: 0 });
  }

  for (const room of serializedRooms) {
    if (!room.categoryId) continue;

    const current = categoryStats.get(room.categoryId) ?? { totalRooms: 0, availableRooms: 0 };
    current.totalRooms += 1;

    if (!firstRoomByCategory.has(room.categoryId)) {
      firstRoomByCategory.set(room.categoryId, room.id);
    }

    if (room.roomStatus === 'available') {
      current.availableRooms += 1;
      if (!firstAvailableRoomByCategory.has(room.categoryId)) {
        firstAvailableRoomByCategory.set(room.categoryId, room.id);
      }
    }

    categoryStats.set(room.categoryId, current);
  }

  const categoriesWithAvailability = serializedCategories.map((category) => {
    const stats = categoryStats.get(category.id) ?? { totalRooms: 0, availableRooms: 0 };
    return {
      ...category,
      totalRooms: stats.totalRooms,
      availableRooms: stats.availableRooms,
      unavailableRooms: Math.max(0, stats.totalRooms - stats.availableRooms),
      firstAvailableRoomId: firstAvailableRoomByCategory.get(category.id) ?? null,
      fallbackRoomId: firstRoomByCategory.get(category.id) ?? null,
    };
  });

  const totals = categoriesWithAvailability.reduce(
    (accumulator, category) => {
      accumulator.totalRooms += category.totalRooms;
      accumulator.availableRooms += category.availableRooms;
      accumulator.unavailableRooms += category.unavailableRooms;
      return accumulator;
    },
    { totalCategories: categoriesWithAvailability.length, totalRooms: 0, availableRooms: 0, unavailableRooms: 0 }
  );

  return res.json({
    hotel: serializedHotel,
    categories: categoriesWithAvailability,
    totals,
  });
});

// ─── GET /:hotelId ────────────────────────────────────────────────────────────

hotelRoutes.get('/:hotelId', publicReadLimiter, async (req, res) => {
  // OWASP A03: validate hotelId param length before DB lookup
  const idResult = validateId(req.params.hotelId, 'Hotel ID');
  if (!idResult.ok) {
    return res.status(400).json({ message: idResult.message });
  }

  console.log(`[MongoDB Query] Collection: hotels, Action: findById, ID: ${req.params.hotelId}`);
  const hotel = await HotelModel.findById(req.params.hotelId).lean();
  console.log(`[MongoDB Results] Collection: hotels, Action: findById, Found: ${hotel ? 1 : 0}`);

  if (!hotel) {
    return res.status(404).json({ message: 'Hotel not found.' });
  }

  return res.json(serializeHotel(hotel as never));
});

export default hotelRoutes;
