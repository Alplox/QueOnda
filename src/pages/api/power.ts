import type { APIRoute } from 'astro';
import { getCached, setCache, setLastGood, getStaleCached, dedupeFetch, edgeCacheHeaders, noStoreHeaders } from '../../lib/cache';
import { checkRateLimit } from '../../lib/rate-limit';
import { fetchPowerSnapshot } from '../../lib/power';

const CACHE_KEY = 'power';
const CACHE_TTL = 15 * 60 * 1000;
// SEC has no alternative public source, so the durable snapshot is what keeps
// the widget alive through an outage. 6h is still "today's picture" for a
// rolling hourly series and is short enough that a stale banner stays honest.
const LAST_GOOD_TTL = 6 * 60 * 60 * 1000;
// Forced refresh (bypass cache) budget: 1 request per IP per 2 min — SEC has no
// fallback chain, so unthrottled bypass would hammer their single endpoint.
const FRESH_WINDOW_MS = 2 * 60 * 1000;

export const GET: APIRoute = async ({ url, request }) => {
  if ([...url.searchParams.keys()].some(param => param !== 'fresh')) {
    return new Response(JSON.stringify({ error: 'Unsupported query parameter' }), { status: 400 });
  }
  // ?fresh=1 skips every cache tier and hits SEC directly. The distinct query
  // string also gives it a separate CDN edge-cache key, so the bypass is real.
  const fresh = url.searchParams.get('fresh') === '1';
  if (fresh) {
    const rateLimited = checkRateLimit(request, 'power-fresh', 1, FRESH_WINDOW_MS);
    if (rateLimited) return rateLimited;
  } else {
    const cached = await getCached<Record<string, unknown>>(CACHE_KEY);
    if (cached) {
      return new Response(JSON.stringify(cached), {
        headers: edgeCacheHeaders(300),
      });
    }
  }

  // The dedupe key must differ per path: a plain request already in flight (the
  // index.astro pre-warm fires /api/power on every page load) would otherwise
  // be joined by ?fresh=1, which would return the in-flight snapshot instead of
  // actually hitting SEC — defeating the forced refresh.
  const dedupeKey = fresh ? `${CACHE_KEY}:fresh` : CACHE_KEY;

  try {
    const data = await dedupeFetch(dedupeKey, fetchPowerSnapshot);

    await setCache(CACHE_KEY, data, CACHE_TTL);
    await setLastGood(CACHE_KEY, data, LAST_GOOD_TTL);

    // Fresh responses get a short edge TTL so a forced refresh isn't served
    // to the next user from the CDN for the full 5 minutes.
    return new Response(JSON.stringify(data), {
      headers: edgeCacheHeaders(fresh ? 60 : 300),
    });
  } catch {
    // Serves the previous snapshot (including the durable 6h one) rather than
    // a hard failure — the widgets already render stale data behind a banner.
    const stale = await getStaleCached<Record<string, unknown>>(CACHE_KEY);
    if (stale) {
      return new Response(JSON.stringify({ ...stale, stale: true }), {
        headers: edgeCacheHeaders(60),
      });
    }
    // no-store: an unreachable SEC for one second must not be cached and
    // replayed to every visitor in the colo.
    return new Response(
      JSON.stringify({ affected: null, total: 0, updatedAt: null, stale: true, error: 'SEC no disponible' }),
      { status: 502, headers: noStoreHeaders() },
    );
  }
};
