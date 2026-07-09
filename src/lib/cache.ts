interface CacheEntry<T> {
  data: T;
  expiry: number;
}

const store = new Map<string, CacheEntry<unknown>>();
const pending = new Map<string, Promise<unknown>>();

let kvBinding: any = null;
let kvPromise: Promise<any> | null = null;

async function getKV(): Promise<any> {
  if (kvBinding !== null) return kvBinding;
  if (kvPromise) return kvPromise;
  kvPromise = (async () => {
    try {
      const { env } = await import('cloudflare:workers');
      kvBinding = env.KV_CACHE;
      return kvBinding;
    } catch {
      kvBinding = undefined;
      return undefined;
    }
  })();
  return kvPromise;
}

export async function getCached<T>(key: string): Promise<T | null> {
  const entry = store.get(key);
  if (entry && Date.now() < entry.expiry) return entry.data as T;

  const kv = await getKV();
  if (kv) {
    try {
      const val = await kv.get(key, { type: 'json' });
      if (val && Date.now() < val.expiry) {
        store.set(key, val as CacheEntry<unknown>);
        return val.data as T;
      }
      if (val) store.delete(key);
    } catch { /* fall through */ }
  }
  if (entry) store.delete(key);
  return null;
}

export async function getStaleCached<T>(key: string): Promise<T | null> {
  const entry = store.get(key);
  if (entry) return entry.data as T;

  const kv = await getKV();
  if (kv) {
    try {
      const val = await kv.get(key, { type: 'json' });
      if (val) {
        store.set(key, val as CacheEntry<unknown>);
        return val.data as T;
      }
    } catch { /* fall through */ }
  }
  return null;
}

export async function setCache<T>(key: string, data: T, ttlMs: number): Promise<void> {
  const entry = { data, expiry: Date.now() + ttlMs };
  store.set(key, entry as CacheEntry<unknown>);
  const kv = await getKV();
  if (kv) {
    try {
      await kv.put(key, JSON.stringify(entry), { expirationTtl: Math.ceil(ttlMs / 1000) });
    } catch { /* fail silently */ }
  }
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
