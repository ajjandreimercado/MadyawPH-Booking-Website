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
  destLat: number;
  destLng: number;
  originLat?: number | null;
  originLng?: number | null;
  label?: string;
}): string {
  const dest = `${input.destLat},${input.destLng}`;
  if (
    typeof input.originLat === 'number'
    && typeof input.originLng === 'number'
    && Number.isFinite(input.originLat)
    && Number.isFinite(input.originLng)
  ) {
    return `https://www.google.com/maps/dir/?api=1&origin=${input.originLat},${input.originLng}&destination=${dest}`;
  }
  const query = input.label
    ? encodeURIComponent(`${input.label} @${dest}`)
    : dest;
  return `https://www.google.com/maps/search/?api=1&query=${query}`;
}
