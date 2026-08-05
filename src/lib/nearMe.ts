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

  // Prefer a place-name destination. Stored hotel coordinates are often a shared
  // city-center pin (e.g. Guingona Park for all Butuan hotels), which misleads guests.
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

  // Search (not raw lat/lng) so Google Places can match the hotel business listing.
  return `https://www.google.com/maps/search/?api=1&query=${destination}`;
}

/**
 * Build a Maps query that prefers the hotel business name.
 * Avoid stuffing long street strings that geocode to city landmarks (e.g. Guingona Park).
 */
export function buildHotelMapsQuery(hotel: { name?: string; location?: string; city?: string }): string {
  const name = String(hotel.name ?? '').trim();
  const city = String(hotel.city ?? '').trim();

  // Extract a short city hint from location when city field is empty.
  let cityHint = city;
  if (!cityHint) {
    const loc = String(hotel.location ?? '');
    const butuan = loc.match(/\bButuan(?:\s+City)?\b/i);
    if (butuan) cityHint = 'Butuan City';
  }

  // Name + city only — Google resolves "Gloreto Luxury Hotel, Butuan City" far better
  // than "Villanueva Street, Brgy Golden Ribbon…" which lands on Guingona Park.
  if (name && cityHint) {
    return `${name}, ${cityHint}, Philippines`;
  }
  if (name) {
    return `${name}, Philippines`;
  }
  return String(hotel.location ?? cityHint ?? '').trim();
}
