import { Router } from 'express';
import { HotelModel, PropertyModel, RoomCategoryModel, ReviewModel } from '../data/mongoModels';
import { resolveRecordImages, serializeHotel, serializeProperty, serializeRoomCategory } from '../utils/serialize';
import { resolveHotelImageUrlFromRecord, decodeHotelMediaBase64, extractStoragePath } from '../utils/hotelImageUrl';
import {
  buildMediaCacheKey,
  getCachedMedia,
  invalidateCachedMedia,
  setCachedMedia,
} from '../utils/mediaCache';
import {
  fetchHotelPaymentQrImage,
  loadHotelSystemSettings,
  mergePaymentQrs,
  resolveDisplayablePaymentQr,
  cachePaymentQrImage,
  sanitizeStoragePath,
  fetchFirstPaymentQrImage,
  collectPaymentQrCandidates,
  cachePaymentQrFromBase64,
  schedulePaymentQrWarm,
} from '../utils/paymentQr';
// OWASP A03/A04: public rate limiter + ID param validation
import { publicReadLimiter, hotelWebhookLimiter } from '../middleware/rateLimiters';
import { validateId } from '../utils/validators';
import { USER_MESSAGES } from '../utils/userMessages';
import { isHotelWebhookAuthorized } from '../middleware/hotelWebhookAuth';
import { getHotelWebhookSecret } from '../config/env';
import Fuse from 'fuse.js';
import { getDistance } from 'geolib';
import { geocodeLocation } from '../services/geocodeService';
import { parseCoordinate, roundDistanceKm } from '../utils/geo';
import { buildAnchorLabel, shouldSortByDistance } from '../utils/searchGeo';
import { compareRoomsForAssignment, findBookedRoomIds, isRoomBookable, parseStayQuery, roomListPrice } from '../utils/roomAvailability';
import { resolvePromoPricing } from '../utils/promoPricing';
import { computeStayCharge, isHourlyRoom, resolveStayWindow, surgeFor, hourlyConfig } from '../utils/hotelStayPricing';
import {
  buildAmenityRoomClause,
  collectAmenityValues,
  isSafeFilterValue,
  uniqueSortedLabels,
} from '../utils/searchFilters';

const hotelRoutes = Router();

function resolvePrimaryQrPath(
  systemSettings: Record<string, unknown> | null,
  qrs: ReturnType<typeof mergePaymentQrs>,
): string {
  if (typeof systemSettings?.payment_qr_url === 'string' && systemSettings.payment_qr_url.trim()) {
    return systemSettings.payment_qr_url.trim();
  }
  return qrs.maya || qrs.gcash || qrs.bank || qrs.generic || '';
}

// ─── POST /payment-qr-cache ───────────────────────────────────────────────────
// Hotel app calls this after saving a QR to persistent disk (no public URL needed).
// Auth: Authorization: Bearer <HOTEL_WEBHOOK_SECRET>

hotelRoutes.post('/payment-qr-cache', hotelWebhookLimiter, async (req, res) => {
  if (!getHotelWebhookSecret()) {
    return res.status(503).json({ message: USER_MESSAGES.serviceUnavailable });
  }
  if (!isHotelWebhookAuthorized(req)) {
    return res.status(401).json({ message: 'Unauthorized request.' });
  }

  const hotelId = String(req.body?.hotelId ?? req.body?.hotel_id ?? '').trim();
  const idResult = validateId(hotelId, 'Hotel ID');
  if (!idResult.ok) {
    return res.status(400).json({ message: idResult.message });
  }

  const hotel = await HotelModel.findById(hotelId).lean();
  if (!hotel) {
    return res.status(404).json({ message: 'Hotel not found.' });
  }

  const systemSettings = await loadHotelSystemSettings(hotelId);
  const qrs = mergePaymentQrs(hotel, systemSettings);
  const rawPath = typeof req.body?.payment_qr_url === 'string' && req.body.payment_qr_url.trim()
    ? req.body.payment_qr_url.trim()
    : resolvePrimaryQrPath(systemSettings, qrs);

  if (!rawPath || rawPath.startsWith('data:image/')) {
    return res.status(400).json({ message: 'payment_qr_url is required.' });
  }

  const storagePath = sanitizeStoragePath(rawPath);
  if (!storagePath) {
    return res.status(400).json({ message: 'Invalid payment_qr_url.' });
  }

  const rawBase64 = typeof req.body?.base64 === 'string' ? req.body.base64 : '';
  if (!rawBase64) {
    return res.status(400).json({ message: 'base64 image payload is required.' });
  }

  const mime = typeof req.body?.mime === 'string' ? req.body.mime : 'image/jpeg';
  const cached = await cachePaymentQrFromBase64(hotelId, storagePath, rawBase64, mime);
  if (!cached) {
    return res.status(400).json({ message: 'Invalid QR image payload.' });
  }

  return res.json({ ok: true, hotelId, path: storagePath, cached: true });
});

// ─── POST /media-cache ────────────────────────────────────────────────────────
// Hotel app calls after uploading a room/hotel/category image (optional instant push).
// Auth: Authorization: Bearer <HOTEL_WEBHOOK_SECRET>

hotelRoutes.post('/media-cache', hotelWebhookLimiter, async (req, res) => {
  if (!getHotelWebhookSecret()) {
    return res.status(503).json({ message: USER_MESSAGES.serviceUnavailable });
  }
  if (!isHotelWebhookAuthorized(req)) {
    return res.status(401).json({ message: 'Unauthorized request.' });
  }

  const rawPath = String(
    req.body?.image_url ?? req.body?.imageUrl ?? req.body?.path ?? req.body?.storage_path ?? '',
  ).trim();
  if (!rawPath) {
    return res.status(400).json({ message: 'image_url is required.' });
  }

  const storagePath = sanitizeStoragePath(extractStoragePath(rawPath) ?? rawPath);
  if (!storagePath) {
    return res.status(400).json({ message: 'Invalid image_url.' });
  }

  invalidateCachedMedia(storagePath);

  const rawBase64 = typeof req.body?.base64 === 'string' ? req.body.base64 : '';
  const version = typeof req.body?.version === 'string' && req.body.version.trim()
    ? req.body.version.trim()
    : typeof req.body?.updated_at === 'string' && req.body.updated_at.trim()
      ? req.body.updated_at.trim()
      : String(Date.now());

  if (rawBase64) {
    const mime = typeof req.body?.mime === 'string' ? req.body.mime : 'image/jpeg';
    const decoded = decodeHotelMediaBase64(rawBase64, mime);
    if (!decoded) {
      return res.status(400).json({ message: 'Invalid image payload.' });
    }
    const cacheKey = buildMediaCacheKey(storagePath, { version });
    setCachedMedia(cacheKey, decoded);
    setCachedMedia(buildMediaCacheKey(storagePath, { version, width: 640 }), decoded);
  }

  return res.json({ ok: true, path: storagePath, version, cached: Boolean(rawBase64) });
});

const DEFAULT_NEAR_RADIUS_KM = 50;

// Hotels are edited rarely (in the hotel app), so list/search share one 60s copy instead of
// a Mongo round trip per request. The in-flight promise is cached so concurrent calls share it.
const HOTEL_LIST_TTL_MS = 60_000;
let hotelListCache: { at: number; hotels: ReturnType<typeof loadAllHotels> } | null = null;

function loadAllHotels() {
  return HotelModel.find().lean().exec();
}

function findAllHotels() {
  if (!hotelListCache || Date.now() - hotelListCache.at > HOTEL_LIST_TTL_MS) {
    const entry = { at: Date.now(), hotels: loadAllHotels() };
    hotelListCache = entry;
    entry.hotels.catch(() => {
      if (hotelListCache === entry) hotelListCache = null; // don't keep serving a failed query
    });
  }
  return hotelListCache.hotels;
}

function hotelHasCoordinates(hotel: { coordinates?: { latitude?: unknown; longitude?: unknown } }) {
  const lat = parseCoordinate(hotel.coordinates?.latitude);
  const lng = parseCoordinate(hotel.coordinates?.longitude);
  return lat != null && lng != null ? { latitude: lat, longitude: lng } : null;
}

/** First room-category photo per hotel, shown as the hotel's photo (the hotel app stores none). */
async function firstCategoryImageByHotel(hotelIds: string[]): Promise<Map<string, string>> {
  const gallery = await categoryImagesByHotel(hotelIds);
  const images = new Map<string, string>();
  for (const [hid, urls] of gallery) {
    if (urls[0]) images.set(hid, urls[0]);
  }
  return images;
}

/**
 * All distinct room-category photos per hotel — the same gallery the hotel page shows.
 * Card slideshows use these: individual room photos are often dead files on the hotel
 * app's disk, while category photos resolve through the media proxy.
 */
async function categoryImagesByHotel(hotelIds: string[]): Promise<Map<string, string[]>> {
  const categories = await RoomCategoryModel.find({ hotel_id: { $in: hotelIds } }).lean();
  const gallery = new Map<string, string[]>();
  for (const category of categories) {
    const hid = String(category.hotel_id ?? '');
    const list = gallery.get(hid) ?? [];
    for (const url of resolveRecordImages(category)) {
      if (!list.includes(url) && list.length < 6) list.push(url);
    }
    if (list.length) gallery.set(hid, list);
  }
  return gallery;
}

// ─── GET / ────────────────────────────────────────────────────────────────────
// Public endpoint — publicReadLimiter guards against data-scraping (OWASP A04)

hotelRoutes.get('/', publicReadLimiter, async (_req, res) => {
  const hotels = await findAllHotels();
  const hotelIds = hotels.map((hotel) => String((hotel as { _id: unknown })._id));

  const [settingsRows, coverImages] = await Promise.all([
    Promise.all(hotelIds.map((id) => loadHotelSystemSettings(id))),
    firstCategoryImageByHotel(hotelIds),
  ]);

  return res.json(
    hotels.map((hotel, index) => serializeHotel(hotel as never, {
      systemSettings: settingsRows[index] ?? undefined,
      fallbackImageUrl: coverImages.get(hotelIds[index]),
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
    const allHotels = await findAllHotels();
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
    const allHotels = await findAllHotels();
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

  // With ?checkIn&checkOut, "rooms left" is for those dates; without, today's room status.
  const stay = parseStayQuery(req.query.checkIn, req.query.checkOut);
  const bookedIds = stay
    ? await findBookedRoomIds(rooms.map((room) => String(room._id)), stay.start, stay.end)
    : new Set<string>();

  const hotelStatsMap = new Map<string, {
    minPrice: number; availableRooms: number; totalRooms: number;
    images: string[]; types: Set<string>;
    hasPromo: boolean; promoPrice: number; promoRegularPrice: number;
  }>();

  for (const room of rooms) {
    const hid = String(room.hotel_id ?? '');
    if (!hid) continue;
    const existing = hotelStatsMap.get(hid) ?? {
      minPrice: Infinity, availableRooms: 0, totalRooms: 0, images: [], types: new Set(),
      hasPromo: false, promoPrice: Infinity, promoRegularPrice: 0,
    };
    existing.totalRooms += 1;
    if (stay ? isRoomBookable(room, bookedIds, stay.start) : room.status === 'available') existing.availableRooms += 1;
    const price = Number(room.price_per_night ?? 0);
    if (price > 0 && price < existing.minPrice) existing.minPrice = price;
    // Hotel-app promo pricing: cheapest promo room drives the "starts from" promo price.
    const promo = resolvePromoPricing(room as Record<string, unknown>, price);
    if (promo.hasPromo && promo.promoPrice > 0 && promo.promoPrice < existing.promoPrice) {
      existing.hasPromo = true;
      existing.promoPrice = promo.promoPrice;
      existing.promoRegularPrice = promo.regularPrice;
    }
    if (existing.images.length < 3) {
      const resolved = resolveHotelImageUrlFromRecord(room);
      if (resolved) existing.images.push(resolved);
    }
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
  const [hotels, allReviews, galleryByHotel] = await Promise.all([
    HotelModel.find({ _id: { $in: hotelIds } }).lean(),
    ReviewModel.find({ hotel_id: { $in: hotelIds } }).lean(),
    categoryImagesByHotel(hotelIds),
  ]);
  const coverImages = new Map<string, string>();
  for (const [hid, urls] of galleryByHotel) {
    if (urls[0]) coverImages.set(hid, urls[0]);
  }

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
      hasPromo: false, promoPrice: Infinity, promoRegularPrice: 0,
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

    const serialized = serializeHotel(hotel as never, { fallbackImageUrl: coverImages.get(hid) });
    return {
      ...serialized,
      minPrice: stats.minPrice === Infinity ? 0 : stats.minPrice,
      // Promo (hotel app): frontend shows a big "Starts from ₱{promoPrice}" when hasPromo.
      hasPromo: stats.hasPromo,
      promoPrice: stats.hasPromo && stats.promoPrice !== Infinity ? stats.promoPrice : undefined,
      promoRegularPrice: stats.hasPromo && stats.promoRegularPrice > 0 ? stats.promoRegularPrice : undefined,
      availableRooms: stats.availableRooms,
      totalRooms: stats.totalRooms,
      // Slideshow gallery: hotel cover + every room-category photo (the photos that
      // actually load), then any individual room photos, deduped. Same set as the
      // hotel page's "View N photos" gallery.
      images: [...new Set([
        serialized.imageUrl,
        ...(galleryByHotel.get(hid) ?? []),
        ...stats.images,
      ].filter(Boolean) as string[])].slice(0, 6),
      avgRating,
      totalReviews: ratingData.count,
      roomTypes: Array.from(stats.types),
      distanceKm: typeof meters === 'number' ? roundDistanceKm(meters) : undefined,
    };
  }).filter((h) => h.minPrice > 0);

  if (Number.isFinite(parsedRating) && parsedRating > 0) {
    results = results.filter((h) => h.avgRating >= parsedRating);
  }

  // Client rule: hotels with nothing free for the searched dates don't appear until a room frees up.
  if (stay) {
    results = results.filter((h) => h.availableRooms > 0);
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
    return res.status(500).json({ message: 'We could not load destinations right now. Please try again.' });
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
    return res.status(500).json({ message: 'We could not load search filters right now. Please try again.' });
  }
});

// ─── GET /media ───────────────────────────────────────────────────────────────
// Proxy hotel-app uploaded room/category images (tries multiple storage origins).

const MEDIA_MISS_TTL_MS = 10 * 60_000;
const mediaMisses = new Map<string, number>();

hotelRoutes.get('/media', publicReadLimiter, async (req, res) => {
  const raw = typeof req.query.f === 'string' ? req.query.f.trim() : '';
  const storagePath = sanitizeStoragePath(raw);
  if (!storagePath) {
    return res.status(400).json({ message: 'Invalid image path.' });
  }

  const widthParam = typeof req.query.w === 'string' ? Number.parseInt(req.query.w, 10) : 0;
  const version = typeof req.query.v === 'string' ? req.query.v.trim() : '';
  const cacheKey = buildMediaCacheKey(storagePath, {
    version: version || '0',
    width: widthParam > 0 ? widthParam : undefined,
  });
  const cached = getCachedMedia(cacheKey);
  if (cached) {
    res.setHeader('Content-Type', cached.contentType);
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    return res.send(cached.body);
  }

  // A missing file costs 2-3 s of failed fetches to the hotel app, so remember misses briefly.
  const missedAt = mediaMisses.get(cacheKey);
  if (missedAt && Date.now() - missedAt < MEDIA_MISS_TTL_MS) {
    res.setHeader('Cache-Control', 'public, max-age=600');
    return res.status(404).json({ message: 'Image not found.' });
  }

  const image = await fetchHotelPaymentQrImage(storagePath);
  if (!image) {
    if (mediaMisses.size > 1000) mediaMisses.clear(); // bound memory against junk paths
    mediaMisses.set(cacheKey, Date.now());
    res.setHeader('Cache-Control', 'public, max-age=600');
    return res.status(404).json({ message: 'Image not found.' });
  }

  mediaMisses.delete(cacheKey);
  setCachedMedia(cacheKey, image);
  res.setHeader('Content-Type', image.contentType);
  res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  return res.send(image.body);
});

// ─── GET /:hotelId/detail ─────────────────────────────────────────────────────

hotelRoutes.get('/:hotelId/detail', publicReadLimiter, async (req, res) => {
  // OWASP A03: validate hotelId param length before DB lookup
  const idResult = validateId(req.params.hotelId, 'Hotel ID');
  if (!idResult.ok) {
    return res.status(400).json({ message: idResult.message });
  }
  const hotelId = idResult.value;

  console.log(`[MongoDB Query] Collection: hotels, Action: findById, ID: ${hotelId}`);
  const hotel = await HotelModel.findById(hotelId).lean();
  console.log(`[MongoDB Results] Collection: hotels, Action: findById, Found: ${hotel ? 1 : 0}`);
  if (!hotel) {
    return res.status(404).json({ message: 'Hotel not found.' });
  }

  console.log(`[MongoDB Query] Collection: roomcategories, Query: { hotel_id: ${hotelId} }`);
  console.log(`[MongoDB Query] Collection: rooms, Query: { hotel_id: ${hotelId} }`);
  const [scopedCategories, scopedRooms, systemSettings] = await Promise.all([
    RoomCategoryModel.find({ hotel_id: hotelId }).lean(),
    PropertyModel.find({ hotel_id: hotelId }).lean(),
    loadHotelSystemSettings(hotelId),
  ]);
  console.log(`[MongoDB Results] Collection: roomcategories, Retrieved: ${scopedCategories.length} documents`);
  console.log(`[MongoDB Results] Collection: rooms, Retrieved: ${scopedRooms.length} documents`);

  // The page only needs the paymentQrs proxy URLs; the inline base64 QR (~140 KB) went unused.
  // Warm the QR cache in the background so the payment step stays fast.
  schedulePaymentQrWarm(hotelId, hotel, systemSettings);
  const serializedHotel = serializeHotel(hotel as never, {
    systemSettings,
    fallbackImageUrl: scopedCategories.map((category) => resolveHotelImageUrlFromRecord(category)).find(Boolean),
  });
  const serializedCategories = scopedCategories.map((category) => serializeRoomCategory(category as never));
  const serializedRooms = scopedRooms.map((room) => serializeProperty(room as never));

  // With ?checkIn&checkOut, availability is for those dates; without, today's room status.
  const stay = parseStayQuery(req.query.checkIn, req.query.checkOut);
  const bookedIds = stay
    ? await findBookedRoomIds(serializedRooms.map((room) => room.id), stay.start, stay.end)
    : new Set<string>();
  const surge = await surgeFor(hotelId);
  const rawRoomById = new Map(scopedRooms.map((room) => [String(room._id), room as Record<string, unknown>]));
  const rawCategoryById = new Map(scopedCategories.map((c) => [String(c._id), c as Record<string, unknown>]));
  const roomIsFree = (room: (typeof serializedRooms)[number]) => (stay
    ? isRoomBookable({ _id: room.id, status: room.roomStatus }, bookedIds, stay.start)
    : room.roomStatus === 'available');

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

    if (roomIsFree(room)) {
      current.availableRooms += 1;
      if (!firstAvailableRoomByCategory.has(room.categoryId)) {
        firstAvailableRoomByCategory.set(room.categoryId, room.id);
      }
    }

    categoryStats.set(room.categoryId, current);
  }

  const categoriesWithAvailability = serializedCategories.map((category) => {
    const stats = categoryStats.get(category.id) ?? { totalRooms: 0, availableRooms: 0 };
    const roomsInCategory = serializedRooms.filter((room) => room.categoryId === category.id);
    const sample = roomsInCategory[0];
    // Price the room a booking of this type is assigned (cheapest free, then lowest number —
    // same order as pickRoomForCategory), with the same formula as POST /bookings.
    // The room a booking of this type gets (same order as pickRoomForCategory), priced with
    // the hotel app's own formula so this page, checkout and the hotel all show one number.
    const rawOf = (room: { id: string }) => rawRoomById.get(room.id) ?? {};
    const bookRoom = roomsInCategory
      .filter(roomIsFree)
      .sort((a, b) => compareRoomsForAssignment(
        { price: roomListPrice(rawOf(a)), roomNumber: a.roomNumber },
        { price: roomListPrice(rawOf(b)), roomNumber: b.roomNumber },
      ))[0];
    const rawRoom = bookRoom ? rawOf(bookRoom) : null;
    const rawCategory = rawCategoryById.get(category.id) ?? null;
    let stayPrice: { nights: number; nightlyRate: number; total: number; regularTotal?: number; billingMode: string; stayHours: number | null; blockHours: number | null } | null = null;
    let hourly: { blockHours: number; blockPrice: number } | null = null;
    if (stay && rawRoom) {
      try {
        const charge = computeStayCharge(
          rawRoom,
          rawCategory,
          resolveStayWindow(rawRoom, rawCategory, String(req.query.checkIn), String(req.query.checkOut)),
          surge,
        );
        if (charge.amount > 0) {
          stayPrice = {
            nights: charge.nights,
            nightlyRate: charge.unitPrice,
            total: charge.amount,
            billingMode: charge.billingMode,
            stayHours: charge.stayHours,
            blockHours: charge.blockHours,
          };
        }
        if (isHourlyRoom(rawRoom)) {
          const { pricePerBlock, blockHours } = hourlyConfig(rawRoom, rawCategory);
          hourly = { blockHours, blockPrice: surge(pricePerBlock) };
        }
      } catch {
        stayPrice = null;
      }
    }
    // Regular (rack) stay total at the hotel app's regular rate, for the crossed-out
    // price beside the promo selling total — only when regular is actually higher.
    if (stayPrice && rawRoom) {
      const regularNight = Number(rawRoom.regular_price_per_night ?? rawCategory?.regular_price_per_night ?? 0);
      const regularBlock = Number(rawRoom.regular_price_per_block ?? rawCategory?.regular_price_per_block ?? 0);
      if (regularNight > 0 || regularBlock > 0) {
        try {
          const regularRoom = {
            ...rawRoom,
            ...(regularNight > 0 ? { price_per_night: regularNight } : {}),
            ...(regularBlock > 0 ? { price_per_block: regularBlock } : {}),
          };
          const regularCharge = computeStayCharge(
            regularRoom,
            rawCategory,
            resolveStayWindow(rawRoom, rawCategory, String(req.query.checkIn), String(req.query.checkOut)),
            surge,
          );
          if (regularCharge.amount > stayPrice.total) stayPrice.regularTotal = regularCharge.amount;
        } catch {
          // No regular total — the promo price simply shows without a strikethrough.
        }
      }
    }
    // Promo pricing for this room type (category record first, then its rooms).
    const promoCandidates = roomsInCategory
      .map((room) => resolvePromoPricing([rawCategory, rawRoomById.get(room.id)], Number(rawRoomById.get(room.id)?.price_per_night ?? category.defaultPrice ?? 0)))
      .filter((p) => p.hasPromo && p.promoPrice > 0)
      .sort((a, b) => a.promoPrice - b.promoPrice);
    const categoryPromo = promoCandidates[0]
      ?? resolvePromoPricing(rawCategory, Number(category.defaultPrice ?? 0));
    // Gallery for this room type: its own uploaded photos first, then photos of the
    // actual rooms in this type — never another type's or stock photos.
    const categoryImages = [...new Set([
      ...(category.images ?? []),
      category.imageUrl,
      ...roomsInCategory.flatMap((room) => (room.images?.length ? room.images : [room.image])),
    ].filter(Boolean) as string[])].slice(0, 8);
    // Extra-person / extra-bed charges, only when the hotel actually set them.
    const chargeOf = (...keys: string[]) => {
      for (const room of roomsInCategory) {
        const raw = rawRoomById.get(room.id) ?? {};
        for (const key of keys) {
          const value = Number(raw[key]);
          if (Number.isFinite(value) && value > 0) return value;
        }
      }
      for (const key of keys) {
        const value = Number((rawCategory ?? {})[key]);
        if (Number.isFinite(value) && value > 0) return value;
      }
      return undefined;
    };
    return {
      ...category,
      images: categoryImages,
      extraPersonCharge: chargeOf('extra_person_fee', 'extra_person_charge', 'extra_guest_fee', 'additional_person_fee'),
      extraBedCharge: chargeOf('extra_bed_fee', 'extra_bed_charge', 'additional_bed_fee'),
      stayPrice,
      // Hotel-app promo pricing for display ("Starts from ₱…" / PROMO badge).
      hasPromo: categoryPromo.hasPromo,
      promoPrice: categoryPromo.hasPromo ? categoryPromo.promoPrice : undefined,
      promoRegularPrice: categoryPromo.hasPromo ? categoryPromo.regularPrice : undefined,
      // Hourly room types: one block's length and price (guests can book a single block).
      hourly,
      // Room-type facts from the rooms themselves; badges only when every room has them.
      bedConfiguration: sample?.bedConfiguration,
      maxGuests: sample?.maxGuests,
      amenities: [...new Set(roomsInCategory.flatMap((room) => room.amenities))].slice(0, 12),
      freeCancellation: roomsInCategory.length > 0 && roomsInCategory.every((room) => room.freeCancellation),
      breakfastIncluded: roomsInCategory.length > 0 && roomsInCategory.every((room) => room.breakfastIncluded),
      totalRooms: stats.totalRooms,
      availableRooms: stats.availableRooms,
      unavailableRooms: Math.max(0, stats.totalRooms - stats.availableRooms),
      firstAvailableRoomId: firstAvailableRoomByCategory.get(category.id) ?? null,
      fallbackRoomId: firstRoomByCategory.get(category.id) ?? null,
    };
  }).filter((category) => category.totalRooms > 0); // room types with no rooms can't be booked

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
  const hotelId = String((hotel as { _id: unknown })._id);
  schedulePaymentQrWarm(hotelId, hotel, systemSettings);
  const paymentQrDataUrl = await resolveDisplayablePaymentQr(
    hotel,
    systemSettings,
    hotelId,
  );
  return res.json(serializeHotel(hotel as never, { systemSettings, paymentQrDataUrl }));
});

hotelRoutes.post('/:hotelId/payment-qr/sync', hotelWebhookLimiter, async (req, res) => {
  if (!getHotelWebhookSecret()) {
    return res.status(503).json({ message: USER_MESSAGES.serviceUnavailable });
  }
  if (!isHotelWebhookAuthorized(req)) {
    return res.status(401).json({ message: 'Unauthorized request.' });
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
    const mime = typeof req.body?.mime === 'string' && req.body.mime.startsWith('image/')
      ? req.body.mime.split(';')[0]
      : 'image/jpeg';
    const cached = await cachePaymentQrFromBase64(hotelId, storagePath, rawBase64, mime);
    if (!cached) {
      return res.status(400).json({ message: 'Invalid QR image payload.' });
    }
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
  const rawMethod = typeof req.query.method === 'string' ? req.query.method.trim().toLowerCase() : 'gcash';
  const method = rawMethod === 'paymaya' ? 'maya' : rawMethod;
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
    return res.status(404).json({ message: 'No payment QR is available for this method yet.' });
  }

  res.setHeader('Content-Type', image.contentType);
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  return res.send(image.body);
});

export default hotelRoutes;
