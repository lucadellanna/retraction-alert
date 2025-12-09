import { CACHE_TTL_MS } from "./constants";

type CacheEntry<T> = { value: T; ts: number; ttl?: number };

const memoryCache = new Map<string, CacheEntry<unknown>>();

function isFresh(entry: CacheEntry<unknown> | undefined): boolean {
  if (!entry) return false;
  const ttl = entry.ttl ?? CACHE_TTL_MS;
  return Date.now() - entry.ts < ttl;
}

function hasChromeStorage(): boolean {
  return typeof chrome !== "undefined" && !!chrome.storage?.local;
}

function storageGet<T>(key: string): Promise<CacheEntry<T> | undefined> {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get([key], (result) => {
        if (chrome.runtime?.lastError) return resolve(undefined);
        resolve(result[key] as CacheEntry<T> | undefined);
      });
    } catch {
      resolve(undefined);
    }
  });
}

function storageSet<T>(key: string, entry: CacheEntry<T>): Promise<void> {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.set({ [key]: entry }, () => {
        resolve();
      });
    } catch {
      resolve();
    }
  });
}

export async function getCache<T>(key: string): Promise<T | null> {
  try {
    if (hasChromeStorage()) {
      const entry = await storageGet<T>(key);
      if (entry && isFresh(entry)) return entry.value;
    } else if (memoryCache.has(key)) {
      const entry = memoryCache.get(key) as CacheEntry<T> | undefined;
      if (isFresh(entry)) return entry?.value ?? null;
    }
  } catch {
    // swallow cache errors; callers will refetch
  }
  return null;
}

export async function setCache<T>(
  key: string,
  value: T,
  ttlMs?: number
): Promise<void> {
  const entry: CacheEntry<T> = { value, ts: Date.now(), ttl: ttlMs };
  try {
    if (hasChromeStorage()) {
      await storageSet(key, entry);
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
