/** Short label for cards — prefers city over full street address. */
export function formatHotelLocation(location?: string, city?: string): string {
  if (city?.trim()) return city.trim();
  const trimmed = (location ?? '').trim();
  if (!trimmed) return '';

  const parts = trimmed.split(',').map((part) => part.trim()).filter(Boolean);
  const cityPart = parts.find((part) => /\bcity\b/i.test(part));
  if (cityPart) return cityPart.replace(/\s*\([^)]*\)/g, '').trim();

  if (parts.length >= 2) {
    const candidate = parts[parts.length - 2];
    if (candidate && candidate.length <= 40) return candidate;
  }

  if (trimmed.length <= 52) return trimmed;
  return `${trimmed.slice(0, 49)}…`;
}

/** Shown when a hotel or room has no photo, or its photo fails to load. */
export const NO_PHOTO_SRC = '/no-photo.svg';

/** img onError: swap in the placeholder once (no retry loop if the placeholder itself fails). */
export function showNoPhoto(event: { currentTarget: HTMLImageElement }) {
  const img = event.currentTarget;
  img.onerror = null;
  if (!img.src.endsWith(NO_PHOTO_SRC)) img.src = NO_PHOTO_SRC;
}

/** Prefer a smaller variant for list/card thumbnails. */
export function hotelCardImageSrc(url?: string): string | undefined {
  if (!url) return undefined;

  if (url.includes('/hotels/media?')) {
    try {
      const parsed = new URL(url);
      parsed.searchParams.set('w', '640');
      return parsed.toString();
    } catch {
      return url.includes('?') ? `${url}&w=640` : `${url}?w=640`;
    }
  }

  if (url.includes('images.unsplash.com')) {
    try {
      const parsed = new URL(url);
      parsed.searchParams.set('w', '640');
      parsed.searchParams.set('q', '75');
      parsed.searchParams.set('auto', 'format');
      return parsed.toString();
    } catch {
      return url;
    }
  }

  return url;
}
