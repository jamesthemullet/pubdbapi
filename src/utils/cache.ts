type CacheEntry<T> = {
  data: T;
  expiresAt: number;
};

const store = new Map<string, CacheEntry<unknown>>();

export const TTL_ONE_HOUR = 60 * 60 * 1000;

export function getFromCache<T>(key: string): T | null {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return null;
  }
  return entry.data as T;
}

export function setInCache<T>(key: string, data: T, ttlMs = TTL_ONE_HOUR): void {
  store.set(key, { data, expiresAt: Date.now() + ttlMs });
}

export function clearCache(key?: string): void {
  if (key) {
    store.delete(key);
  } else {
    store.clear();
  }
}
