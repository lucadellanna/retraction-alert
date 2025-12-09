import { CACHE_TTL_MS } from "./constants";

type CacheEntry<T> = { value: T; ts: number };

const memoryCache = new Map<string, CacheEntry<unknown>>();

function isFresh(entry: CacheEntry<unknown> | undefined): boolean {
  if (!entry) return false;
  return Date.now() - entry.ts < CACHE_TTL_MS;
}

export async function getCache<T>(key: string): Promise<T | null> {
  try {
    if (chrome?.storage?.local) {
      const result = await chrome.storage.local.get([key]);
      const entry = result[key] as CacheEntry<T> | undefined;
      if (entry && isFresh(entry)) return entry.value;
    } else if (memoryCache.has(key)) {
      const entry = memoryCache.get(key) as CacheEntry<T> | undefined;
      if (isFresh(entry)) return entry?.value ?? null;
    }
  } catch (error) {
    // swallow cache errors; callers will refetch
  }
  return null;
}

export async function setCache<T>(key: string, value: T): Promise<void> {
  const entry: CacheEntry<T> = { value, ts: Date.now() };
  try {
    if (chrome?.storage?.local) {
      await chrome.storage.local.set({ [key]: entry });
    } else {
      memoryCache.set(key, entry);
    }
  } catch {
    // ignore cache set failures
  }
}

export function clearCaches(): void {
  memoryCache.clear();
  if (chrome?.storage?.local) {
    void chrome.storage.local.clear();
  }
}
