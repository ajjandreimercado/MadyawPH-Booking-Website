/**
 * Lightweight client cache for GET-style API data.
 * Memory + sessionStorage so revisiting pages feels instant (soft TTL + SWR).
 */

type CacheEntry = {
  data: unknown;
  cachedAt: number;
};

const memory = new Map<string, CacheEntry>();
const STORAGE_PREFIX = 'madyaw_qc:';
const DEFAULT_SOFT_TTL_MS = 45_000;
const DEFAULT_TTL_MS = 10 * 60_000;

function storageKey(key: string) {
  return `${STORAGE_PREFIX}${key}`;
}

function readPersist(key: string): CacheEntry | undefined {
  if (typeof sessionStorage === 'undefined') return undefined;
  try {
    const raw = sessionStorage.getItem(storageKey(key));
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as CacheEntry;
    if (!parsed || typeof parsed.cachedAt !== 'number') return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

function writePersist(key: string, entry: CacheEntry) {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(storageKey(key), JSON.stringify(entry));
  } catch {
    // quota / private mode — memory still works
  }
}

export function peekCache<T>(key: string): T | undefined {
  const mem = memory.get(key);
  if (mem) return mem.data as T;
  const persisted = readPersist(key);
  if (persisted) {
    memory.set(key, persisted);
    return persisted.data as T;
  }
  return undefined;
}

export function setCache<T>(key: string, data: T, persist = true) {
  const entry: CacheEntry = { data, cachedAt: Date.now() };
  memory.set(key, entry);
  if (persist) writePersist(key, entry);
}

export function invalidateCache(prefixOrKey?: string) {
  if (!prefixOrKey) {
    memory.clear();
    if (typeof sessionStorage !== 'undefined') {
      const keys: string[] = [];
      for (let i = 0; i < sessionStorage.length; i += 1) {
        const k = sessionStorage.key(i);
        if (k?.startsWith(STORAGE_PREFIX)) keys.push(k);
      }
      keys.forEach((k) => sessionStorage.removeItem(k));
    }
    return;
  }
  for (const key of [...memory.keys()]) {
    if (key === prefixOrKey || key.startsWith(prefixOrKey)) memory.delete(key);
  }
  if (typeof sessionStorage !== 'undefined') {
    const keys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const k = sessionStorage.key(i);
      if (k?.startsWith(STORAGE_PREFIX) && k.slice(STORAGE_PREFIX.length).startsWith(prefixOrKey)) {
        keys.push(k);
      }
    }
    keys.forEach((k) => sessionStorage.removeItem(k));
  }
}

export function cacheKey(parts: unknown[]): string {
  return parts
    .map((part) => {
      if (part == null) return '';
      if (typeof part === 'object') return JSON.stringify(part);
      return String(part);
    })
    .join('|');
}

type CachedQueryOptions = {
  /** Fresh window — return cache without network. Default 45s. */
  softTtlMs?: number;
  /** Max age before forced refetch. Default 10m. */
  ttlMs?: number;
  /** Persist to sessionStorage. Default true. */
  persist?: boolean;
  /** When true, always network-fetch but seed from cache for callers that peek first. */
  force?: boolean;
};

/**
 * Returns cached data when fresh; when soft-stale returns cache and refreshes in background;
 * when expired awaits a fresh fetch.
 */
export async function cachedQuery<T>(
  key: string,
  fetcher: () => Promise<T>,
  options: CachedQueryOptions = {},
): Promise<T> {
  const softTtlMs = options.softTtlMs ?? DEFAULT_SOFT_TTL_MS;
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const persist = options.persist !== false;

  const existing = (() => {
    const mem = memory.get(key);
    if (mem) return mem;
    return readPersist(key);
  })();

  if (existing && !options.force) {
    const age = Date.now() - existing.cachedAt;
    if (age < softTtlMs) {
      memory.set(key, existing);
      return existing.data as T;
    }
    if (age < ttlMs) {
      memory.set(key, existing);
      void fetcher()
        .then((data) => setCache(key, data, persist))
        .catch(() => undefined);
      return existing.data as T;
    }
  }

  const data = await fetcher();
  setCache(key, data, persist);
  return data;
}
