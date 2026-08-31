const TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 400;

type CachedImage = {
  body: Buffer;
  contentType: string;
  expires: number;
};

const cache = new Map<string, CachedImage>();

export function buildMediaCacheKey(
  storagePath: string,
  options?: { version?: string; width?: number },
): string {
  const version = options?.version?.trim() || '0';
  const width = options?.width && options.width > 0 ? String(options.width) : 'full';
  return `${storagePath}:v${version}:w${width}`;
}

export function getCachedMedia(key: string): { body: Buffer; contentType: string } | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expires) {
    cache.delete(key);
    return null;
  }
  return { body: hit.body, contentType: hit.contentType };
}

export function setCachedMedia(
  key: string,
  image: { body: Buffer; contentType: string },
): void {
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, {
    body: image.body,
    contentType: image.contentType,
    expires: Date.now() + TTL_MS,
  });
}

/** Drop cached bytes when the hotel app replaces an image at the same path. */
export function invalidateCachedMedia(storagePath: string): void {
  for (const key of [...cache.keys()]) {
    if (key === storagePath || key.startsWith(`${storagePath}:`)) {
      cache.delete(key);
    }
  }
}
