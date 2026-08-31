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
