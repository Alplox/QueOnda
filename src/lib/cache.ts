interface CacheEntry<T> {
  data: T;
  expiry: number;
}

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
    const res = await caches.default.match(cacheReq(key));
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
    const res = await caches.default.match(cacheReq(key));
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
    await caches.default.put(cacheReq(key), new Response(JSON.stringify(entry), {
      headers: { 'Cache-Control': `max-age=${Math.ceil(ttlMs / 1000)}` },
    }));
  } catch { /* fail silently */ }
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
