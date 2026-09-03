import { formatHotelLocation } from './hotelImage';

const STORAGE_KEY = 'madyaw_recently_viewed';
const MAX_ITEMS = 8;

export type RecentlyViewedHotel = {
  id: string;
  name: string;
  location: string;
  imageUrl?: string;
};

function readRaw(): RecentlyViewedHotel[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is RecentlyViewedHotel =>
        Boolean(item && typeof item === 'object' && typeof (item as RecentlyViewedHotel).id === 'string'),
      )
      .map((item) => ({
        id: String(item.id),
        name: String(item.name ?? ''),
        location: String(item.location ?? ''),
        imageUrl: item.imageUrl ? String(item.imageUrl) : undefined,
      }));
  } catch {
    return [];
  }
}

function writeRaw(items: RecentlyViewedHotel[]) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX_ITEMS)));
  } catch {
    // ignore quota / private mode
  }
}

export function readRecentlyViewed(): RecentlyViewedHotel[] {
  return readRaw();
}

/** Keep only hotels that still exist on the live API (drops old Gloreto / Datest IDs). */
export function pruneRecentlyViewed(validHotelIds: Iterable<string>): RecentlyViewedHotel[] {
  const allow = new Set([...validHotelIds].map(String));
  const next = readRaw().filter((item) => allow.has(item.id));
  writeRaw(next);
  return next;
}

export function removeRecentlyViewed(hotelId: string): RecentlyViewedHotel[] {
  const next = readRaw().filter((item) => item.id !== hotelId);
  writeRaw(next);
  return next;
}

export function trackRecentlyViewed(hotel: {
  id: string;
  name: string;
  location?: string;
  city?: string;
  imageUrl?: string;
}): RecentlyViewedHotel[] {
  const entry: RecentlyViewedHotel = {
    id: String(hotel.id),
    name: hotel.name,
    location: formatHotelLocation(hotel.location, hotel.city) || hotel.location || '',
    imageUrl: hotel.imageUrl,
  };
  const next = [entry, ...readRaw().filter((item) => item.id !== entry.id)].slice(0, MAX_ITEMS);
  writeRaw(next);
  return next;
}
