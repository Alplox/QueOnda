import type { APIRoute } from 'astro';
import type { JobSource } from '../../../lib/jobs/types';
import { JOB_SOURCES } from '../../../lib/jobs/types';
import { fetchJobs } from '../../../lib/jobs';
import type { Job } from '../../../lib/jobs/types';
import { getCached, setCache, edgeCacheHeaders } from '../../../lib/cache';
import { checkRateLimit } from '../../../lib/rate-limit';

const CACHE_TTL = 60 * 60 * 1000;
const CACHE_KEY = 'jobs';

export const GET: APIRoute = async ({ url, request }) => {
  if ([...url.searchParams.keys()].some(param => param !== 'source')) {
    return new Response(JSON.stringify({ error: 'Unsupported query parameter' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const rateLimited = checkRateLimit(request, 'jobs', 30);
  if (rateLimited) return rateLimited;

  const rawSource = url.searchParams.get('source');
  if (rawSource && !JOB_SOURCES.some(source => source.key === rawSource)) {
    return new Response(JSON.stringify({ error: 'Invalid source' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const sourceParam = (rawSource || null) as JobSource | null;

  const cacheKey = sourceParam ? `jobs-${sourceParam}` : CACHE_KEY;
  const cached = await getCached<{ jobs: Job[]; sources: JobSource[] }>(cacheKey);
  if (cached) {
    return new Response(JSON.stringify(cached), {
      headers: edgeCacheHeaders(3600),
    });
  }

  try {
    const result = await fetchJobs(sourceParam || undefined);
    await setCache(cacheKey, result, CACHE_TTL);
    return new Response(JSON.stringify({ ...result, sourcesMeta: JOB_SOURCES }), {
      headers: edgeCacheHeaders(3600),
    });
  } catch (e) {
    return new Response(JSON.stringify({ jobs: [], sources: [], sourcesMeta: JOB_SOURCES, error: String(e) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
