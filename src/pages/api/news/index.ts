import type { APIRoute } from 'astro';
import { getAllNewsSources } from '../../../lib/rss';
import type { SourceFeed } from '../../../types';
import { getCached, setCache } from '../../../lib/cache';

export const GET: APIRoute = async ({ url }) => {
  const mode = url.searchParams.get('mode') || 'inventory';
  const cacheKey = `news:${mode}`;
  const cached = await getCached<{ allSources: SourceFeed[] }>(cacheKey);
  if (cached) {
    return new Response(JSON.stringify(cached), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=900' },
    });
  }

  try {
    const allSources = await getAllNewsSources();
    const data = { allSources };
    await setCache(cacheKey, data, 30 * 60 * 1000);
    return new Response(JSON.stringify(data), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=1800' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Failed to fetch sources', allSources: [] }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
