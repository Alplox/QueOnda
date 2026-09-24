import type { APIRoute } from 'astro';
import { getAllNewsSources } from '../../../lib/rss';
import type { SourceFeed } from '../../../types';
import { getCached, setCache, edgeCacheHeaders } from '../../../lib/cache';

const CACHE_KEY = 'news:inventory';
const CACHE_TTL = 15 * 60 * 1000;

export const GET: APIRoute = async ({ url }) => {
  if ([...url.searchParams.keys()].some(param => param !== 'mode')) {
    return new Response(JSON.stringify({ error: 'Unsupported query parameter' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const mode = url.searchParams.get('mode') || 'inventory';
  if (mode !== 'inventory') {
    return new Response(JSON.stringify({ error: 'Unsupported mode' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const cacheKey = CACHE_KEY;
  const cached = await getCached<{ allSources: SourceFeed[] }>(cacheKey);
  if (cached) {
    return new Response(JSON.stringify(cached), {
      headers: edgeCacheHeaders(900),
    });
  }

  try {
    const allSources = await getAllNewsSources();
    const data = { allSources };
    await setCache(cacheKey, data, CACHE_TTL);
    return new Response(JSON.stringify(data), {
      headers: edgeCacheHeaders(900),
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Failed to fetch sources', allSources: [] }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
