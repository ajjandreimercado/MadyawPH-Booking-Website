// Nominatim API allows open access geocoding (max 1 request per second)
// See: https://nominatim.org/release-docs/develop/api/Search/

interface GeocodeResult {
  latitude: number;
  longitude: number;
  displayName: string;
}

export async function geocodeLocation(locationStr: string): Promise<GeocodeResult | null> {
  if (!locationStr || !locationStr.trim()) return null;

  try {
    const params = new URLSearchParams({
      q: locationStr,
      format: 'json',
      limit: '1'
    });

    // Nominatim requires a user-agent
    const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
      headers: {
        'User-Agent': 'MadyawBookingApp/1.0'
      }
    });

    if (!response.ok) {
      console.warn(`[Geocode] Nominatim returned status ${response.status}`);
      return null;
    }

    const data = await response.json();
    if (Array.isArray(data) && data.length > 0) {
      const firstResult = data[0];
      return {
        latitude: parseFloat(firstResult.lat),
        longitude: parseFloat(firstResult.lon),
        displayName: firstResult.display_name
      };
    }

    return null;
  } catch (error) {
    console.error(`[Geocode] Error geocoding location "${locationStr}":`, error);
    return null;
  }
}
