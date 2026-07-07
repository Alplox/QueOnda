import type { APIRoute } from 'astro';
import { fetchSources } from '../../../lib/rss';
import type { SourceFeed } from '../../../types';
import { getCached, setCache, dedupeFetch } from '../../../lib/cache';
import { validateFetchUrl } from '../../../lib/url-validator';
import { checkRateLimit } from '../../../lib/rate-limit';

const BATCH_CACHE_TTL = 15 * 60 * 1000;

export const POST: APIRoute = async ({ request }) => {
  const rateLimited = checkRateLimit(request, 'news-batch', 10);
  if (rateLimited) return rateLimited;

  try {
    const { sources } = await request.json() as { sources: SourceFeed[] };
    if (!sources || !Array.isArray(sources) || sources.length === 0) {
      return new Response(JSON.stringify({ error: 'Missing sources array', articles: [], sourceResults: [] }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    for (const src of sources) {
      const check = validateFetchUrl(src.url);
      if (!check.valid) {
        return new Response(JSON.stringify({
          error: `Fuente no permitida: ${src.name || src.url}`,
          articles: [],
          sourceResults: [],
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    const cacheKey = 'batch:' + sources.map(s => s.url).sort().join('|');
    const cached = await getCached<object>(cacheKey);
    if (cached) {
      return new Response(JSON.stringify(cached), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=900' },
      });
    }

    const result = await dedupeFetch(cacheKey, () => fetchSources(sources));
    await setCache(cacheKey, result, BATCH_CACHE_TTL);
    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=900' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Failed to fetch batch', articles: [], sourceResults: [] }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
