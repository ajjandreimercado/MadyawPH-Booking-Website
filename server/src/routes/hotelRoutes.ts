import { Router } from 'express';
import { HotelModel, PropertyModel, RoomCategoryModel, ReviewModel } from '../data/mongoModels';
import { serializeHotel, serializeProperty, serializeRoomCategory } from '../utils/serialize';
import { fetchHotelPaymentQrImage, loadHotelSystemSettings, mergePaymentQrs, qrUrlForPaymentMethod, resolveDisplayablePaymentQr, cachePaymentQrImage, sanitizeStoragePath, fetchFirstPaymentQrImage, collectPaymentQrCandidates } from '../utils/paymentQr';
// OWASP A03/A04: public rate limiter + ID param validation
import { publicReadLimiter, hotelWebhookLimiter } from '../middleware/rateLimiters';
import { validateId } from '../utils/validators';
import { isHotelWebhookAuthorized } from '../middleware/hotelWebhookAuth';
import { getHotelWebhookSecret } from '../config/env';
import Fuse from 'fuse.js';
import { getDistance } from 'geolib';
import { geocodeLocation } from '../services/geocodeService';
import { parseCoordinate, roundDistanceKm } from '../utils/geo';
import { buildAnchorLabel, shouldSortByDistance } from '../utils/searchGeo';
import {
  buildAmenityRoomClause,
  collectAmenityValues,
  isSafeFilterValue,
  uniqueSortedLabels,
} from '../utils/searchFilters';

const hotelRoutes = Router();

const DEFAULT_NEAR_RADIUS_KM = 50;

function hotelHasCoordinates(hotel: { coordinates?: { latitude?: unknown; longitude?: unknown } }) {
  const lat = parseCoordinate(hotel.coordinates?.latitude);
  const lng = parseCoordinate(hotel.coordinates?.longitude);
  return lat != null && lng != null ? { latitude: lat, longitude: lng } : null;
}

// ─── GET / ────────────────────────────────────────────────────────────────────
// Public endpoint — publicReadLimiter guards against data-scraping (OWASP A04)

hotelRoutes.get('/', publicReadLimiter, async (_req, res) => {
  console.log('[MongoDB Query] Collection: hotels, Query: {}');
  const hotels = await HotelModel.find().lean();
  console.log(`[MongoDB Results] Collection: hotels, Retrieved: ${hotels.length} documents`);

  const settingsRows = await Promise.all(
    hotels.map((hotel) => loadHotelSystemSettings(String((hotel as { _id: unknown })._id))),
  );

  return res.json(
    hotels.map((hotel, index) => serializeHotel(hotel as never, {
      systemSettings: settingsRows[index] ?? undefined,
    })),
  );
});

// ─── GET /search ──────────────────────────────────────────────────────────────
// Supports: destination, lat/lng (near me), filters, sort, page, limit

hotelRoutes.get('/search', publicReadLimiter, async (req, res) => {
  const {
    destination, priceMin, priceMax, type, amenities,
    rating, freeCancellation, breakfastIncluded,
    sort = 'recommended', page = '1', limit = '10',
    lat, lng, radiusKm,
  } = req.query as Record<string, string | undefined>;

  const guestLat = parseCoordinate(lat);
  const guestLng = parseCoordinate(lng);
  const nearMode = guestLat != null && guestLng != null;
  const nearRadiusKm = Math.min(
    Math.max(parseCoordinate(radiusKm) ?? DEFAULT_NEAR_RADIUS_KM, 1),
    200,
  );

  if ((lat != null && guestLat == null) || (lng != null && guestLng == null)) {
    return res.status(400).json({ message: 'lat and lng must be valid numbers for near-me search.' });
  }
  if ((guestLat != null) !== (guestLng != null)) {
    return res.status(400).json({ message: 'Both lat and lng are required for near-me search.' });
  }

  const roomFilter: Record<string, unknown> = {};
  let hotelScores: Record<string, number> = {};
  const distanceByHotelId: Record<string, number> = {};
  let searchAnchor: { latitude: number; longitude: number; label: string } | null = null;

  if (nearMode) {
    const allHotels = await HotelModel.find().lean();
    const nearby: Array<{ id: string; meters: number }> = [];

    for (const hotel of allHotels) {
      const coords = hotelHasCoordinates(hotel as never);
      if (!coords) continue;
      const meters = getDistance(
        { latitude: guestLat!, longitude: guestLng! },
        coords,
      );
      const km = meters / 1000;
      if (km <= nearRadiusKm) {
        const id = String((hotel as { _id: unknown })._id);
        nearby.push({ id, meters });
        distanceByHotelId[id] = meters;
        hotelScores[id] = Math.max(0, nearRadiusKm - km);
      }
    }

    nearby.sort((a, b) => a.meters - b.meters);
    const nearHotelIds = nearby.map((h) => h.id);

    if (nearHotelIds.length === 0) {
      return res.json({
        data: [],
        total: 0,
        page: Math.max(parseInt(page ?? '1', 10) || 1, 1),
        limit: Math.min(Math.max(parseInt(limit ?? '12', 10) || 12, 1), 50),
        totalPages: 0,
        nearMe: true,
        radiusKm: nearRadiusKm,
      });
    }

    roomFilter.hotel_id = { $in: nearHotelIds };
  } else if (typeof destination === 'string' && destination.trim()) {
    const destStr = destination.trim();
    const geocodeParams = await geocodeLocation(destStr);
    const allHotels = await HotelModel.find().lean();
    const fuse = new Fuse(allHotels, {
      keys: ['name', 'location', 'city', 'neighborhood', 'landmarks'],
      threshold: 0.3,
      includeScore: true,
      ignoreLocation: true,
    });

    const fuseResults = fuse.search(destStr);
    const matchedHotelIds = new Set<string>();
    const escaped = destStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const flexiblePattern = escaped.replace(/\s+/g, '').split('').join('\\s*');
    const rx = new RegExp(flexiblePattern, 'i');
    const cityRx = new RegExp(`^${escaped}$`, 'i');

    // Exact city / location hits first so featured destination cards resolve reliably.
    for (const hotel of allHotels) {
      const h = hotel as {
        _id: unknown;
        city?: string;
        location?: string;
        name?: string;
        neighborhood?: string;
      };
      const hId = String(h._id);
      const city = String(h.city ?? '');
      const location = String(h.location ?? '');
      const name = String(h.name ?? '');
      const neighborhood = String(h.neighborhood ?? '');
      if (
        cityRx.test(city)
        || rx.test(city)
        || rx.test(location)
        || rx.test(name)
        || rx.test(neighborhood)
      ) {
        matchedHotelIds.add(hId);
        hotelScores[hId] = Math.max(hotelScores[hId] ?? 0, 100);
      }
    }

    fuseResults.forEach((result) => {
      const h = result.item as {
        _id: unknown;
        coordinates?: { latitude?: number; longitude?: number };
      };
      const hId = String(h._id);
      matchedHotelIds.add(hId);

      const relevanceScore = (1 - (result.score || 0)) * 100;
      let proximityScore = 0;
      let finalScore = relevanceScore;

      if (
        geocodeParams
        && h.coordinates
        && typeof h.coordinates.latitude === 'number'
        && typeof h.coordinates.longitude === 'number'
      ) {
        const distanceMeters = getDistance(
          { latitude: geocodeParams.latitude, longitude: geocodeParams.longitude },
          { latitude: h.coordinates.latitude, longitude: h.coordinates.longitude },
        );
        distanceByHotelId[hId] = distanceMeters;
        proximityScore = Math.max(0, 50 - (distanceMeters / 1000));
        finalScore = (relevanceScore * 0.6) + (proximityScore * 1.5);
      }

      hotelScores[hId] = Math.max(hotelScores[hId] ?? 0, finalScore);
    });

    if (geocodeParams) {
      searchAnchor = {
        latitude: geocodeParams.latitude,
        longitude: geocodeParams.longitude,
        label: buildAnchorLabel(destStr, geocodeParams.displayName),
      };

      for (const hotel of allHotels) {
        const coords = hotelHasCoordinates(hotel as never);
        if (!coords) continue;
        const hId = String((hotel as { _id: unknown })._id);
        const meters = getDistance(
          { latitude: geocodeParams.latitude, longitude: geocodeParams.longitude },
          coords,
        );
        distanceByHotelId[hId] = meters;
        if (meters / 1000 <= nearRadiusKm) {
          matchedHotelIds.add(hId);
          hotelScores[hId] = Math.max(hotelScores[hId] ?? 0, Math.max(0, nearRadiusKm - meters / 1000));
        }
      }
    }

    const matchedIds = Array.from(matchedHotelIds);

    if (matchedIds.length > 0) {
      // Prefer hotel-scoped results when we know which hotels match the destination.
      roomFilter.hotel_id = { $in: matchedIds };
    } else {
      roomFilter.$or = [
        { hotel_name: rx },
        { display_name: rx },
        { category_name: rx },
        { room_type: rx },
        { hotel_location: rx },
      ];
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

  // Accept hotel-app room types (Double / Single / Suite) — not only website slug names.
  if (typeof type === 'string' && type.trim() && isSafeFilterValue(type)) {
    const typePattern = new RegExp(`^${type.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
    roomFilter.$and = [
      ...((roomFilter.$and as Record<string, unknown>[] | undefined) ?? []),
      {
        $or: [
          { room_type: typePattern },
          { category_name: typePattern },
        ],
      },
    ];
  }

  if (typeof amenities === 'string' && amenities.trim()) {
    const selected = amenities.split(',').map((a) => a.trim()).filter(Boolean);
    const amenityClauses = selected
      .map((amenity) => buildAmenityRoomClause(amenity))
      .filter((clause): clause is Record<string, unknown> => Boolean(clause));
    if (amenityClauses.length > 0) {
      roomFilter.$and = [
        ...((roomFilter.$and as Record<string, unknown>[] | undefined) ?? []),
        ...amenityClauses,
      ];
    }
  }

  if (freeCancellation === 'true') roomFilter.free_cancellation = true;
  if (breakfastIncluded === 'true') roomFilter.breakfast_included = true;

  const safeLimit = Math.min(Math.max(parseInt(limit ?? '12', 10) || 12, 1), 50);
  const safePage = Math.max(parseInt(page ?? '1', 10) || 1, 1);

  const rooms = await PropertyModel.find(roomFilter).lean();

  const hotelStatsMap = new Map<string, {
    minPrice: number; availableRooms: number; totalRooms: number;
    images: string[]; types: Set<string>;
  }>();

  for (const room of rooms) {
    const hid = String(room.hotel_id ?? '');
    if (!hid) continue;
    const existing = hotelStatsMap.get(hid) ?? {
      minPrice: Infinity, availableRooms: 0, totalRooms: 0, images: [], types: new Set(),
    };
    existing.totalRooms += 1;
    if (room.status === 'available') existing.availableRooms += 1;
    const price = Number(room.price_per_night ?? 0);
    if (price > 0 && price < existing.minPrice) existing.minPrice = price;
    if (room.image_url && existing.images.length < 3) existing.images.push(String(room.image_url));
    if (room.room_type) existing.types.add(String(room.room_type));
    hotelStatsMap.set(hid, existing);
  }

  if (hotelStatsMap.size === 0) {
    return res.json({
      data: [],
      total: 0,
      page: safePage,
      limit: safeLimit,
      totalPages: 0,
      nearMe: nearMode,
      radiusKm: nearMode ? nearRadiusKm : undefined,
    });
  }

  const hotelIds = Array.from(hotelStatsMap.keys());
  const [hotels, allReviews] = await Promise.all([
    HotelModel.find({ _id: { $in: hotelIds } }).lean(),
    ReviewModel.find({ hotel_id: { $in: hotelIds } }).lean(),
  ]);

  const ratingMap = new Map<string, { sum: number; count: number }>();
  for (const review of allReviews) {
    const hid = String(review.hotel_id ?? '');
    const current = ratingMap.get(hid) ?? { sum: 0, count: 0 };
    current.sum += Number(review.rating ?? 0);
    current.count += 1;
    ratingMap.set(hid, current);
  }

  const parsedRating = Number(rating);
  let results = hotels.map((hotel) => {
    const hid = String((hotel as { _id: unknown })._id);
    const stats = hotelStatsMap.get(hid) ?? {
      minPrice: 0, availableRooms: 0, totalRooms: 0, images: [], types: new Set<string>(),
    };
    const ratingData = ratingMap.get(hid) ?? { sum: 0, count: 0 };
    const avgRating = ratingData.count > 0 ? Math.round((ratingData.sum / ratingData.count) * 10) / 10 : 0;
    let meters = distanceByHotelId[hid];

    if (searchAnchor && meters == null) {
      const coords = hotelHasCoordinates(hotel as never);
      if (coords) {
        meters = getDistance(
          { latitude: searchAnchor.latitude, longitude: searchAnchor.longitude },
          coords,
        );
        distanceByHotelId[hid] = meters;
      }
    }

    return {
      ...serializeHotel(hotel as never),
      minPrice: stats.minPrice === Infinity ? 0 : stats.minPrice,
      availableRooms: stats.availableRooms,
      totalRooms: stats.totalRooms,
      images: stats.images,
      avgRating,
      totalReviews: ratingData.count,
      roomTypes: Array.from(stats.types),
      distanceKm: typeof meters === 'number' ? roundDistanceKm(meters) : undefined,
    };
  }).filter((h) => h.minPrice > 0);

  if (Number.isFinite(parsedRating) && parsedRating > 0) {
    results = results.filter((h) => h.avgRating >= parsedRating);
  }

  const distanceSort = shouldSortByDistance(String(sort), nearMode, searchAnchor != null);
  if (distanceSort) {
    results.sort((a, b) => {
      const da = typeof a.distanceKm === 'number' ? a.distanceKm : Number.POSITIVE_INFINITY;
      const db = typeof b.distanceKm === 'number' ? b.distanceKm : Number.POSITIVE_INFINITY;
      return da - db;
    });
  } else if (sort === 'price') results.sort((a, b) => a.minPrice - b.minPrice);
  else if (sort === 'rating') results.sort((a, b) => b.avgRating - a.avgRating);
  else if (sort === 'popular') results.sort((a, b) => b.totalReviews - a.totalReviews);
  else if (Object.keys(hotelScores).length > 0) {
    results.sort((a, b) => (hotelScores[b.id] || 0) - (hotelScores[a.id] || 0));
  } else {
    results.sort((a, b) => b.totalReviews - a.totalReviews);
  }

  const total = results.length;
  const paginated = results.slice((safePage - 1) * safeLimit, safePage * safeLimit);

  return res.json({
    data: paginated,
    total,
    page: safePage,
    limit: safeLimit,
    totalPages: Math.ceil(total / safeLimit),
    nearMe: nearMode,
    radiusKm: nearMode || searchAnchor ? nearRadiusKm : undefined,
    searchAnchor: searchAnchor
      ? {
        lat: searchAnchor.latitude,
        lng: searchAnchor.longitude,
        label: searchAnchor.label,
      }
      : undefined,
    sortedByDistance: distanceSort,
  });
});

// ─── GET /destinations ──────────────────────────────────────────────────────────
// Aggregates distinct cities that have at least one bookable room (price > 0).
// Hotels with no inventory must not appear as featured destinations.

hotelRoutes.get('/destinations', publicReadLimiter, async (_req, res) => {
  try {
    const destinations = await HotelModel.aggregate([
      {
        $match: {
          city: { $exists: true, $nin: [null, ''] },
        },
      },
      {
        $addFields: {
          hotelIdStr: { $toString: '$_id' },
        },
      },
      {
        $lookup: {
          from: PropertyModel.collection.name,
          let: { hotelId: '$hotelIdStr' },
          pipeline: [
            {
              $match: {
                $expr: { $eq: [{ $toString: '$hotel_id' }, '$$hotelId'] },
                price_per_night: { $gt: 0 },
              },
            },
            { $limit: 1 },
          ],
          as: 'bookableRooms',
        },
      },
      { $match: { 'bookableRooms.0': { $exists: true } } },
      { $group: { _id: '$city', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 4 },
    ]);

    return res.json(destinations.map((d) => ({
      name: d._id,
      count: d.count,
      query: d._id,
    })));
  } catch (error) {
    console.error('Error fetching destinations:', error);
    return res.status(500).json({ message: 'Failed to fetch destinations' });
  }
});

// ─── GET /filters ─────────────────────────────────────────────────────────────
// Aggregates live room types / amenities / price range from hotel-app room data

hotelRoutes.get('/filters', publicReadLimiter, async (_req, res) => {
  try {
    const [rooms, hotels, categories, priceStats, freeCancelCount, breakfastCount] = await Promise.all([
      PropertyModel.find({}, {
        room_type: 1,
        category_name: 1,
        amenities: 1,
        facilities: 1,
        features: 1,
        hotel_amenities: 1,
        bed_configuration: 1,
        free_cancellation: 1,
        breakfast_included: 1,
        description: 1,
      }).lean(),
      HotelModel.find({}, {
        amenities: 1,
        facilities: 1,
        features: 1,
        hotel_amenities: 1,
        settings: 1,
      }).lean(),
      RoomCategoryModel.find({}, {
        name: 1,
        amenities: 1,
        facilities: 1,
        features: 1,
      }).lean(),
      PropertyModel.aggregate([
        { $match: { price_per_night: { $gt: 0 } } },
        {
          $group: {
            _id: null,
            minPrice: { $min: '$price_per_night' },
            maxPrice: { $max: '$price_per_night' },
          },
        },
      ]),
      PropertyModel.countDocuments({ free_cancellation: true }),
      PropertyModel.countDocuments({ breakfast_included: true }),
    ]);

    const roomTypes = uniqueSortedLabels(
      rooms.map((room) => room.room_type).filter(Boolean),
    );

    const categoryNames = uniqueSortedLabels(
      [
        ...rooms.map((room) => room.category_name),
        ...categories.map((category) => category.name),
      ].filter(Boolean),
    );

    const amenityValues = collectAmenityValues(
      ...rooms.map((room) => room.amenities),
      ...rooms.map((room) => room.facilities),
      ...rooms.map((room) => room.features),
      ...rooms.map((room) => room.hotel_amenities),
      ...hotels.map((hotel) => hotel.amenities),
      ...hotels.map((hotel) => hotel.facilities),
      ...hotels.map((hotel) => hotel.features),
      ...hotels.map((hotel) => hotel.hotel_amenities),
      ...hotels.map((hotel) => (hotel.settings as { amenities?: unknown } | undefined)?.amenities),
      ...categories.map((category) => category.amenities),
      ...categories.map((category) => category.facilities),
      ...categories.map((category) => category.features),
    );

    if (freeCancelCount > 0) amenityValues.push('Free Cancellation');
    if (breakfastCount > 0) amenityValues.push('Breakfast Included');

    // Dedicated checkboxes cover these — keep the amenity list for other hotel features.
    const amenities = uniqueSortedLabels(amenityValues).filter((label) => {
      const key = label.trim().toLowerCase().replace(/[\s_/]+/g, '-');
      return key !== 'free-cancellation'
        && key !== 'breakfast-included'
        && key !== 'breakfast'
        && key !== 'free-breakfast';
    });
    const bedConfigurations = uniqueSortedLabels(
      rooms.map((room) => room.bed_configuration).filter(Boolean),
    );

    const price = priceStats[0] as { minPrice?: number; maxPrice?: number } | undefined;

    return res.json({
      roomTypes,
      categoryNames,
      amenities,
      bedConfigurations,
      priceMin: Number(price?.minPrice ?? 0) || undefined,
      priceMax: Number(price?.maxPrice ?? 0) || undefined,
      supportsFreeCancellation: freeCancelCount > 0,
      supportsBreakfastIncluded: breakfastCount > 0,
    });
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

  const systemSettings = await loadHotelSystemSettings(String((hotel as { _id: unknown })._id));
  const paymentQrDataUrl = await resolveDisplayablePaymentQr(
    hotel,
    systemSettings,
    String((hotel as { _id: unknown })._id),
  );
  const serializedHotel = serializeHotel(hotel as never, {
    systemSettings,
    paymentQrDataUrl,
  });
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
    { totalCategories: categoriesWithAvailability.length, totalRooms: 0, availableRooms: 0, unavailableRooms: 0 },
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

  const systemSettings = await loadHotelSystemSettings(String((hotel as { _id: unknown })._id));
  const paymentQrDataUrl = await resolveDisplayablePaymentQr(
    hotel,
    systemSettings,
    String((hotel as { _id: unknown })._id),
  );
  return res.json(serializeHotel(hotel as never, { systemSettings, paymentQrDataUrl }));
});

hotelRoutes.post('/:hotelId/payment-qr/sync', hotelWebhookLimiter, async (req, res) => {
  if (!getHotelWebhookSecret()) {
    return res.status(503).json({ message: 'Hotel webhook is not configured. Set HOTEL_WEBHOOK_SECRET on the API.' });
  }
  if (!isHotelWebhookAuthorized(req)) {
    return res.status(401).json({ message: 'Invalid hotel webhook credentials.' });
  }

  const idResult = validateId(req.params.hotelId, 'Hotel ID');
  if (!idResult.ok) {
    return res.status(400).json({ message: idResult.message });
  }

  const hotel = await HotelModel.findById(req.params.hotelId).lean();
  if (!hotel) {
    return res.status(404).json({ message: 'Hotel not found.' });
  }

  const hotelId = String((hotel as { _id: unknown })._id);
  const systemSettings = await loadHotelSystemSettings(hotelId);
  const qrs = mergePaymentQrs(hotel, systemSettings);
  const rawPath = typeof req.body?.payment_qr_url === 'string' && req.body.payment_qr_url.trim()
    ? req.body.payment_qr_url.trim()
    : (qrs.generic || qrs.gcash || qrs.maya || qrs.bank || '');

  if (!rawPath) {
    return res.status(400).json({ message: 'No payment_qr_url on this hotel.' });
  }

  const storagePath = sanitizeStoragePath(rawPath);
  if (!storagePath) {
    return res.status(400).json({ message: 'Invalid payment_qr_url.' });
  }

  const rawBase64 = typeof req.body?.base64 === 'string' ? req.body.base64.trim() : '';
  if (rawBase64) {
    const payload = rawBase64.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '');
    const body = Buffer.from(payload, 'base64');
    if (body.length < 32) {
      return res.status(400).json({ message: 'Invalid QR image payload.' });
    }
    const mime = typeof req.body?.mime === 'string' && req.body.mime.startsWith('image/')
      ? req.body.mime.split(';')[0]
      : 'image/jpeg';
    await cachePaymentQrImage(hotelId, storagePath, { body, contentType: mime });
    return res.json({ ok: true, cached: true, hotelId, path: storagePath });
  }

  const image = await fetchFirstPaymentQrImage(hotel, systemSettings, hotelId, { skipCache: true });
  if (!image) {
    return res.status(404).json({
      message: 'Could not fetch payment QR from the hotel app. Re-upload the QR in MADYAWPH and run php artisan storage:link.',
    });
  }
  return res.json({ ok: true, cached: true, hotelId, path: image.path, bytes: image.body.length });
});

hotelRoutes.get('/:hotelId/payment-qr', publicReadLimiter, async (req, res) => {
  const idResult = validateId(req.params.hotelId, 'Hotel ID');
  if (!idResult.ok) {
    return res.status(400).json({ message: idResult.message });
  }

  const hotel = await HotelModel.findById(req.params.hotelId).lean();
  if (!hotel) {
    return res.status(404).json({ message: 'Hotel not found.' });
  }

  const systemSettings = await loadHotelSystemSettings(String((hotel as { _id: unknown })._id));
  const hotelId = String((hotel as { _id: unknown })._id);
  const method = typeof req.query.method === 'string' ? req.query.method : 'gcash';
  const skipCache = req.query.refresh === '1' || req.query.refresh === 'true';

  if (!collectPaymentQrCandidates(hotel, systemSettings).length) {
    return res.status(404).json({ message: 'No payment QR uploaded for this hotel.' });
  }

  const image = await fetchFirstPaymentQrImage(hotel, systemSettings, hotelId, {
    skipCache,
    preferredMethod: method,
  });
  if (!image) {
    console.warn('[PaymentQR] Unavailable for hotel', req.params.hotelId, 'candidates:', collectPaymentQrCandidates(hotel, systemSettings));
    return res.status(404).json({
      message: 'Payment QR is not available yet. The hotel may need to re-upload it after enabling persistent storage.',
    });
  }

  res.setHeader('Content-Type', image.contentType);
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  return res.send(image.body);
});

export default hotelRoutes;
