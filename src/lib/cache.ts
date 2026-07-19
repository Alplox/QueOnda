interface CacheEntry<T> {
  data: T;
  expiry: number;
}

const cache = (caches as CacheStorage & { default: Cache }).default;
const store = new Map<string, CacheEntry<unknown>>();
const pending = new Map<string, Promise<unknown>>();

// ponytail: Cache API replaces KV — free, unlimited, per-edge
// L1: in-memory Map (same isolate), L2: caches.default (same datacenter)

function cacheReq(key: string) {
  return new Request(`https://cache.internal/${key}`);
}

export async function getCached<T>(key: string): Promise<T | null> {
  const entry = store.get(key);
  if (entry && Date.now() < entry.expiry) return entry.data as T;

  try {
    const res = await cache.match(cacheReq(key));
    if (res) {
      const val = await res.json() as CacheEntry<unknown>;
      if (val && Date.now() < val.expiry) {
        store.set(key, val);
        return val.data as T;
      }
    }
  } catch { /* fall through */ }

  if (entry && Date.now() >= entry.expiry) store.delete(key);
  return null;
}

export async function getStaleCached<T>(key: string): Promise<T | null> {
  const entry = store.get(key);
  if (entry) return entry.data as T;

  try {
    const res = await cache.match(cacheReq(key));
    if (res) {
      const val = await res.json() as CacheEntry<unknown>;
      if (val) { store.set(key, val); return val.data as T; }
    }
  } catch { /* fall through */ }
  return null;
}

export async function setCache<T>(key: string, data: T, ttlMs: number): Promise<void> {
  const entry = { data, expiry: Date.now() + ttlMs };
  store.set(key, entry as CacheEntry<unknown>);
  try {
    const seconds = Math.ceil(ttlMs / 1000);
    await cache.put(cacheReq(key), new Response(JSON.stringify(entry), {
      headers: {
        'Content-Type': 'application/json',
        // ponytail: CDN-Cache-Control is what Cloudflare edge honors for caches.default writes
        'Cache-Control': `public, max-age=${seconds}`,
        'CDN-Cache-Control': `public, max-age=${seconds}, stale-while-revalidate=${seconds}`,
      },
    }));
  } catch { /* fail silently */ }
}

// Cache headers for an API JSON Response so the Cloudflare CDN edge (not just
// caches.default) serves subsequent hits without hitting the origin/worker.
export function edgeCacheHeaders(ttlSeconds: number): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Cache-Control': `public, max-age=${ttlSeconds}`,
    'CDN-Cache-Control': `public, max-age=${ttlSeconds}, stale-while-revalidate=${ttlSeconds}`,
  };
}

export function dedupeFetch<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const existing = pending.get(key);
  if (existing) return existing as Promise<T>;

  const promise = fetcher().finally(() => {
    if (pending.get(key) === promise) pending.delete(key);
  });
  pending.set(key, promise);
  return promise;
}
