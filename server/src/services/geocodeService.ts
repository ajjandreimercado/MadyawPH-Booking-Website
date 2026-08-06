// Nominatim API allows open access geocoding (max 1 request per second)
// See: https://nominatim.org/release-docs/develop/api/Search/

export interface GeocodeResult {
  latitude: number;
  longitude: number;
  displayName: string;
}

const NOMINATIM_HEADERS = { 'User-Agent': 'MadyawBookingApp/1.0' };

async function nominatimSearch(query: string): Promise<GeocodeResult | null> {
  const params = new URLSearchParams({
    q: query,
    format: 'json',
    limit: '1',
    countrycodes: 'ph',
  });

  const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
    headers: NOMINATIM_HEADERS,
  });

  if (!response.ok) {
    console.warn(`[Geocode] Nominatim returned status ${response.status} for "${query}"`);
    return null;
  }

  const data = await response.json();
  if (!Array.isArray(data) || data.length === 0) return null;

  const firstResult = data[0];
  const latitude = parseFloat(firstResult.lat);
  const longitude = parseFloat(firstResult.lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  return {
    latitude,
    longitude,
    displayName: String(firstResult.display_name ?? query),
  };
}

function buildGeocodeCandidates(locationStr: string): string[] {
  const trimmed = locationStr.trim();
  if (!trimmed) return [];

  const candidates = new Set<string>();
  candidates.add(trimmed);

  const lower = trimmed.toLowerCase();
  if (!lower.includes('philippines') && !lower.includes('pilipinas')) {
    candidates.add(`${trimmed}, Philippines`);
  }

  // "FSUU Butuan" / "hotels near FSUU" — try the core landmark token.
  const nearMatch = trimmed.match(/(?:near|around)\s+(.+)$/i);
  if (nearMatch?.[1]) candidates.add(nearMatch[1].trim());

  const commaParts = trimmed.split(',').map((p) => p.trim()).filter(Boolean);
  if (commaParts.length > 1) {
    candidates.add(commaParts[0]);
    candidates.add(`${commaParts[0]}, ${commaParts.slice(1).join(', ')}`);
  }

  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    // Prefer landmark + city when user types "FSUU Butuan".
    candidates.add(`${words[0]}, ${words.slice(1).join(' ')}`);
    candidates.add(`${words[0]}, ${words.slice(1).join(' ')}, Philippines`);
  }

  return Array.from(candidates);
}

export async function geocodeLocation(locationStr: string): Promise<GeocodeResult | null> {
  if (!locationStr || !locationStr.trim()) return null;

  const candidates = buildGeocodeCandidates(locationStr);

  try {
    for (const candidate of candidates) {
      const result = await nominatimSearch(candidate);
      if (result) {
        if (candidate !== locationStr.trim()) {
          console.log(`[Geocode] Resolved "${locationStr}" via "${candidate}"`);
        }
        return result;
      }
    }

    return null;
  } catch (error) {
    console.error(`[Geocode] Error geocoding location "${locationStr}":`, error);
    return null;
  }
}
