import { Router } from 'express';
import { PropertyModel } from '../data/mongoModels';
import { serializeProperty } from '../utils/serialize';
// OWASP A03/A04: public rate limiter + input validators
import { publicReadLimiter } from '../middleware/rateLimiters';
import { parseNumericParam, validateId } from '../utils/validators';
import { buildAmenityRoomClause, isSafeFilterValue } from '../utils/searchFilters';

const propertyRoutes = Router();

// ─── Allowlists (OWASP A03) ───────────────────────────────────────────────────

const ALLOWED_SORT_VALUES = ['price', 'rating', 'default'] as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseCsv(value: unknown) {
  if (typeof value !== 'string' || value.trim() === '') {
    return [] as string[];
  }

  return value
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

// ─── GET / ────────────────────────────────────────────────────────────────────
// Public endpoint — publicReadLimiter guards against data-scraping (OWASP A04)

propertyRoutes.get('/', publicReadLimiter, async (req, res) => {
  const { destination, priceMin, priceMax, types, rating, amenities, sort, limit, hotelId } = req.query;
  const filter: Record<string, unknown> = {};

  const normalizedHotelId = typeof hotelId === 'string' && hotelId.trim() ? hotelId.trim() : null;

  // Destination: length cap + regex escaping to prevent ReDoS (OWASP A03)
  if (typeof destination === 'string' && destination.trim().length > 100) {
    return res.status(400).json({ message: 'Destination search is too long.' });
  }

  if (typeof destination === 'string' && destination.trim()) {
    const escapedDestination = destination.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Allow matching even if spaces are missing or extra
    const flexiblePattern = escapedDestination.replace(/\s+/g, '').split('').join('\\s*');
    const searchRegex = new RegExp(flexiblePattern, 'i');
    const destinationFilter = [
      { room_number: searchRegex },
      { display_name: searchRegex },
      { category_name: searchRegex },
      { roomNumber: searchRegex },
      { name: searchRegex },
      { categoryName: searchRegex },
      { hotel_name: searchRegex },
      { hotel_location: searchRegex },
    ];

    if (Array.isArray(filter.$or)) {
      filter.$and = [{ $or: filter.$or }, { $or: destinationFilter }];
      delete filter.$or;
    } else {
      filter.$or = destinationFilter;
    }
  }

  // OWASP A03: NaN guard on numeric filters — undefined if invalid, never NaN in DB query
  const parsedPriceMin = parseNumericParam(priceMin, 0, 10_000_000);
  const parsedPriceMax = parseNumericParam(priceMax, 0, 10_000_000);

  if (parsedPriceMin !== undefined || parsedPriceMax !== undefined) {
    const priceFilter: Record<string, number> = {};

    if (parsedPriceMin !== undefined) priceFilter.$gte = parsedPriceMin;
    if (parsedPriceMax !== undefined) priceFilter.$lte = parsedPriceMax;

    filter.price_per_night = priceFilter;
  }

  // Accept hotel-app room types (Double/Single/Suite) with safe literal matching.
  if (typeof types === 'string' && types.trim() !== '') {
    const requestedTypes = types.split(',').map((item) => item.trim()).filter((item) => isSafeFilterValue(item));
    if (requestedTypes.length > 0) {
      filter.$and = [
        ...((filter.$and as Record<string, unknown>[] | undefined) ?? []),
        {
          $or: requestedTypes.flatMap((typeValue) => {
            const pattern = new RegExp(`^${typeValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
            return [
              { room_type: pattern },
              { category_name: pattern },
            ];
          }),
        },
      ];
    }
  }

  // rating field is a no-op in the current schema (frontend computes it from display data)
  if (rating !== undefined) {
    // Intentionally not applied — the new room collection does not persist a rating field.
  }

  // Amenity filters: match hotel-app amenity labels + boolean room flags.
  if (typeof amenities === 'string' && amenities.trim() !== '') {
    const requestedAmenities = amenities.split(',').map((item) => item.trim()).filter(Boolean);
    const amenityClauses = requestedAmenities
      .map((amenity) => buildAmenityRoomClause(amenity))
      .filter((clause): clause is Record<string, unknown> => Boolean(clause));
    if (amenityClauses.length > 0) {
      filter.$and = [
        ...((filter.$and as Record<string, unknown>[] | undefined) ?? []),
        ...amenityClauses,
      ];
    }
  }

  // OWASP A03: sort must be one of the explicit allowlist values
  const sortValue = ALLOWED_SORT_VALUES.includes(sort as typeof ALLOWED_SORT_VALUES[number])
    ? (sort as typeof ALLOWED_SORT_VALUES[number])
    : 'default';

  const sortStage: Record<string, 1 | -1> = sortValue === 'price'
    ? { price_per_night: 1 }
    : sortValue === 'rating'
      ? { room_number: 1 }
      : { status: 1, room_number: 1 };

  // Numeric limit: clamped to [1, 50]
  const numericLimit = Number(limit);
  const safeLimit = Number.isFinite(numericLimit) && numericLimit > 0 ? Math.min(numericLimit, 50) : 50;

  console.log(`[MongoDB Query] Collection: rooms, Query: ${JSON.stringify(filter)}, Sort: ${JSON.stringify(sortStage)}`);
  const query = PropertyModel.find(filter).sort(sortStage);

  if (!normalizedHotelId) {
    query.limit(safeLimit);
  }

  const filteredSample = await query.lean();
  console.log(`[MongoDB Results] Collection: rooms, Retrieved: ${filteredSample.length} documents`);
  const serialized = filteredSample.map(property => serializeProperty(property as never));
  const byHotel = normalizedHotelId
    ? serialized.filter((property) => property.hotelId === normalizedHotelId)
    : serialized;

  return res.json(byHotel.slice(0, safeLimit));
});

// ─── GET /:propertyId ─────────────────────────────────────────────────────────

propertyRoutes.get('/:propertyId', publicReadLimiter, async (req, res) => {
  // OWASP A03: validate propertyId length before DB lookup
  const idResult = validateId(req.params.propertyId, 'Property ID');
  if (!idResult.ok) {
    return res.status(400).json({ message: idResult.message });
  }

  console.log(`[MongoDB Query] Collection: rooms, Action: findById, ID: ${idResult.value}`);
  const property = await PropertyModel.findById(idResult.value).lean();
  console.log(`[MongoDB Results] Collection: rooms, Action: findById, Found: ${property ? 1 : 0}`);

  if (!property) {
    return res.status(404).json({ message: 'Property not found.' });
  }

  return res.json(serializeProperty(property as never));
});

export default propertyRoutes;