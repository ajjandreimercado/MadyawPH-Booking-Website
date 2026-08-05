/**
 * Detect "hotels near me" style queries for device-based proximity search.
 */
const NEAR_ME_PATTERNS = [
  /\bhotels?\s+near\s+(?:near\s+)?me\b/i,
  /\bnear\s+(?:near\s+)?me\b/i,
  /\bnearby\b/i,
  /\baround\s+me\b/i,
  /\bclose\s+to\s+me\b/i,
];

/** Names that are almost never real Google Maps place listings. */
const PLACEHOLDER_HOTEL_NAME =
  /^(test|demo|sample|dbg|datest|newtest|dummy|fake|xxx+|hotel\s*sample(?:\s*\d+)?|test\s*hotel|dbg\s*hourly(?:\s*\d+)?|hourly(?:\s*\d+)?)$/i;

export function isNearMeQuery(raw: string): boolean {
  const text = raw.trim().replace(/\s+/g, ' ');
  if (!text) return false;
  return NEAR_ME_PATTERNS.some((pattern) => pattern.test(text));
}

export function getCurrentPosition(options?: PositionOptions): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error('Geolocation is not supported on this device.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 12000,
      maximumAge: 60_000,
      ...options,
    });
  });
}

/**
 * True when the hotel name is likely a real Maps business listing
 * (e.g. "Gloreto Luxury Hotel"), not a sandbox label like "Test Hotel".
 */
export function looksLikeMappableHotelName(name: string): boolean {
  const n = String(name ?? '').trim();
  if (n.length < 5) return false;
  if (!/[a-zA-Z]/.test(n)) return false;
  if (PLACEHOLDER_HOTEL_NAME.test(n)) return false;
  // Short names that still contain test/demo/sample tokens
  if (/\b(test|demo|sample|dbg|debug|dummy|fake|hourly)\b/i.test(n) && n.split(/\s+/).length <= 3) {
    return false;
  }
  return true;
}

function usableAddress(location?: string): string {
  const loc = String(location ?? '').trim();
  if (!loc || loc.length < 3) return '';
  if (/^[xX.\-\s]+$/.test(loc)) return '';
  return loc;
}

function extractCityHint(hotel: { city?: string; location?: string }): string {
  const city = String(hotel.city ?? '').trim();
  if (city) return city;

  const loc = String(hotel.location ?? '');
  const cityMatch = loc.match(
    /\b([A-Za-z][A-Za-z.\s'-]*?(?:City|Municipality|Town))\b/i,
  );
  if (cityMatch) return cityMatch[1].trim();

  // Fallback: common PH city without the "City" suffix in free text
  const known = loc.match(/\b(Butuan|Cebu|Davao|Iloilo|Tagbilaran|Capalonga)\b/i);
  if (known) {
    const base = known[1];
    if (/capalonga/i.test(base)) return 'Capalonga';
    if (/city$/i.test(base)) return base;
    return `${base} City`;
  }
  return '';
}

function withPhilippines(query: string): string {
  const q = query.trim().replace(/,+\s*$/, '');
  if (!q) return '';
  if (/\bphilippines\b/i.test(q)) return q;
  return `${q}, Philippines`;
}

/** Free Google Maps deep link — no Maps Platform billing. */
export function buildGoogleMapsDirectionsUrl(input: {
  destLat?: number | null;
  destLng?: number | null;
  originLat?: number | null;
  originLng?: number | null;
  /** Prefer hotel business name — more accurate than street geocodes. */
  destinationQuery?: string;
  label?: string;
}): string {
  const query = (input.destinationQuery ?? input.label ?? '').trim();
  const hasCoords =
    typeof input.destLat === 'number'
    && typeof input.destLng === 'number'
    && Number.isFinite(input.destLat)
    && Number.isFinite(input.destLng);

  // Prefer a place/area query. Stored coordinates are only used when we have no
  // usable text (or as an explicit last resort for obscure hotels).
  const destination = query
    ? encodeURIComponent(query)
    : hasCoords
      ? `${input.destLat},${input.destLng}`
      : '';

  if (!destination) {
    return 'https://www.google.com/maps';
  }

  if (
    typeof input.originLat === 'number'
    && typeof input.originLng === 'number'
    && Number.isFinite(input.originLat)
    && Number.isFinite(input.originLng)
  ) {
    return `https://www.google.com/maps/dir/?api=1&origin=${input.originLat},${input.originLng}&destination=${destination}&travelmode=driving`;
  }

  // Search (not raw lat/lng) so Google Places can match the hotel / area listing.
  return `https://www.google.com/maps/search/?api=1&query=${destination}`;
}

export interface HotelMapsInput {
  name?: string;
  location?: string;
  city?: string;
  latitude?: number | null;
  longitude?: number | null;
}

/**
 * Build a Maps query for any hotel:
 * - Known businesses → hotel name + city (best pin)
 * - Test / unknown names → barangay/address or city (nearby area pin)
 */
export function buildHotelMapsQuery(hotel: HotelMapsInput): string {
  const name = String(hotel.name ?? '').trim();
  const location = usableAddress(hotel.location);
  const cityHint = extractCityHint(hotel);

  if (looksLikeMappableHotelName(name)) {
    if (cityHint) return withPhilippines(`${name}, ${cityHint}`);
    if (location) return withPhilippines(`${name}, ${location}`);
    return withPhilippines(name);
  }

  // Not on Google Maps as a business — send guests to the closest area we know.
  if (location) return withPhilippines(location);
  if (cityHint) return withPhilippines(cityHint);

  // Last text fallback before raw coordinates are used by the URL builder.
  if (name) return withPhilippines(name);
  return '';
}

/**
 * Resolve the best Maps destination for a hotel, including coord fallback
 * when the text query is empty (e.g. location was just "X").
 */
export function resolveHotelMapsDestination(hotel: HotelMapsInput): {
  destinationQuery: string;
  destLat?: number;
  destLng?: number;
} {
  const destinationQuery = buildHotelMapsQuery(hotel);
  const lat = typeof hotel.latitude === 'number' && Number.isFinite(hotel.latitude)
    ? hotel.latitude
    : undefined;
  const lng = typeof hotel.longitude === 'number' && Number.isFinite(hotel.longitude)
    ? hotel.longitude
    : undefined;

  if (destinationQuery) {
    return { destinationQuery };
  }

  if (lat != null && lng != null) {
    return { destinationQuery: '', destLat: lat, destLng: lng };
  }

  return { destinationQuery: '' };
}
