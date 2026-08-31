import { getHotelAppPublicUrl, getMadyawApiPublicUrl } from '../config/env';
import { sanitizeStoragePath } from './paymentQr';

const EXTERNAL_IMAGE_PATTERN = /unsplash\.com|googleusercontent|gravatar|cloudinary|imgix|placeholder/i;

type AnyRecord = Record<string, unknown>;

export function pickImageSource(record: unknown): string | undefined {
  if (!record || typeof record !== 'object') return undefined;
  const source = record as AnyRecord;
  const candidates = [
    source.image_url,
    source.imageUrl,
    source.image,
    Array.isArray(source.images) ? source.images[0] : undefined,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return undefined;
}

function hashString(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  }
  return String(Math.abs(hash));
}

function coerceRevision(raw: unknown): string | undefined {
  if (raw instanceof Date) return String(raw.getTime());
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(Math.floor(raw));
  if (typeof raw === 'string' && raw.trim()) {
    const parsed = Date.parse(raw);
    if (Number.isFinite(parsed)) return String(parsed);
    return raw.trim().slice(0, 40);
  }
  return undefined;
}

/**
 * Cache-bust token from Mongo timestamps or the stored image path.
 * When the hotel app uploads a new image, updated_at or image_url changes → new website URL.
 */
export function imageRevisionToken(record: unknown, rawImage?: string): string | undefined {
  if (record && typeof record === 'object') {
    const source = record as AnyRecord;
    for (const field of [
      source.updated_at,
      source.updatedAt,
      source.image_updated_at,
      source.imageUpdatedAt,
    ]) {
      const token = coerceRevision(field);
      if (token) return token;
    }
  }
  const imageRaw = rawImage ?? (record ? pickImageSource(record) : undefined);
  return imageRaw ? hashString(imageRaw) : undefined;
}

/** Pull a Laravel storage path from chat/media URLs, absolute hotel URLs, or relative paths. */
export function extractStoragePath(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith('data:')) return null;

  if (/chat\/media/i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      const file = url.searchParams.get('f');
      if (file) return sanitizeStoragePath(decodeURIComponent(file));
    } catch {
      // fall through
    }
  }

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    try {
      const parsed = new URL(trimmed);
      const pathname = parsed.pathname.replace(/^\/+/, '');
      const markers = [
        'uploads/',
        'storage/app/public/',
        'public/storage/',
        'storage/',
        'api/storage/',
        'api/files/',
        'rooms/',
        'categories/',
        'hotels/',
        'images/',
      ];
      for (const marker of markers) {
        const idx = pathname.indexOf(marker);
        if (idx < 0) continue;
        let slice = pathname.slice(idx);
        if (slice.startsWith('uploads/')) slice = slice.slice('uploads/'.length);
        if (slice.startsWith('storage/app/public/')) slice = slice.slice('storage/app/public/'.length);
        if (slice.startsWith('public/storage/')) slice = slice.slice('public/storage/'.length);
        if (slice.startsWith('storage/')) slice = slice.slice('storage/'.length);
        if (slice.startsWith('api/storage/')) slice = slice.slice('api/storage/'.length);
        if (slice.startsWith('api/files/')) slice = slice.slice('api/files/'.length);
        const path = sanitizeStoragePath(slice);
        if (path) return path;
      }
    } catch {
      // fall through
    }
  }

  return sanitizeStoragePath(trimmed);
}

export function shouldProxyHotelImage(raw: string): boolean {
  if (!raw || raw.startsWith('data:')) return false;
  if (EXTERNAL_IMAGE_PATTERN.test(raw)) return false;

  const app = getHotelAppPublicUrl();
  if (app && raw.startsWith(app)) return true;
  if (/chat\/media/i.test(raw)) return true;
  if (!raw.startsWith('http://') && !raw.startsWith('https://')) return true;

  try {
    const parsed = new URL(raw);
    const appHost = app ? new URL(app).host : '';
    const defaultHotelHost = 'madyawph.onrender.com';
    if (parsed.host === appHost || parsed.host === defaultHotelHost) return true;
  } catch {
    return true;
  }

  return false;
}

export function hotelMediaProxyUrl(
  storagePath: string,
  options?: { width?: number; version?: string },
): string {
  const apiBase = getMadyawApiPublicUrl().replace(/\/+$/, '');
  const params = new URLSearchParams({ f: storagePath });
  if (options?.width && options.width > 0) params.set('w', String(Math.min(options.width, 1200)));
  if (options?.version) params.set('v', options.version);
  return `${apiBase}/hotels/media?${params.toString()}`;
}

/**
 * Turn hotel-app image references into browser-loadable URLs.
 * Hotel uploads are proxied through the booking API so we can try multiple origins.
 */
export function resolveHotelImageUrl(
  raw: string | undefined | null,
  options?: { width?: number; version?: string },
): string | undefined {
  if (!raw?.trim()) return undefined;
  const value = raw.trim();
  if (value.startsWith('data:image/')) return value;
  if (!shouldProxyHotelImage(value)) return value;

  const storagePath = extractStoragePath(value);
  if (!storagePath) {
    return value.startsWith('http://') || value.startsWith('https://') ? value : undefined;
  }

  return hotelMediaProxyUrl(storagePath, options);
}

/** Resolve image URL from a Mongo hotel/room/category document (includes cache-bust version). */
export function resolveHotelImageUrlFromRecord(
  record: unknown,
  rawOverride?: string,
  options?: { width?: number },
): string | undefined {
  const raw = rawOverride ?? pickImageSource(record);
  if (!raw) return undefined;
  const version = imageRevisionToken(record, raw);
  return resolveHotelImageUrl(raw, { ...options, version });
}

export function decodeHotelMediaBase64(
  rawBase64: string,
  mime = 'image/jpeg',
): { body: Buffer; contentType: string } | null {
  const payload = rawBase64.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '').trim();
  if (!payload) return null;
  const body = Buffer.from(payload, 'base64');
  if (body.length < 32) return null;
  const contentType = mime.startsWith('image/') ? mime.split(';')[0] : 'image/jpeg';
  return { body, contentType };
}
