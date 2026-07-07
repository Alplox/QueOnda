import type { APIRoute } from 'astro';
import type { JobSource } from '../../../lib/jobs/types';
import { JOB_SOURCES } from '../../../lib/jobs/types';
import { fetchJobs } from '../../../lib/jobs';
import type { Job } from '../../../lib/jobs/types';
import { getCached, setCache } from '../../../lib/cache';
import { checkRateLimit } from '../../../lib/rate-limit';

const CACHE_TTL = 30 * 60 * 1000;
const CACHE_KEY = 'jobs';

export const GET: APIRoute = async ({ url, request }) => {
  const sourceParam = url.searchParams.get('source') as JobSource | null;

  const cacheKey = sourceParam ? `jobs-${sourceParam}` : CACHE_KEY;
  const cached = await getCached<{ jobs: Job[]; sources: JobSource[] }>(cacheKey);
  if (cached) {
    return new Response(JSON.stringify(cached), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=1800' },
    });
  }

  try {
    const result = await fetchJobs(sourceParam || undefined);
    await setCache(cacheKey, result, CACHE_TTL);
    return new Response(JSON.stringify({ ...result, sourcesMeta: JOB_SOURCES }), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=1800' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ jobs: [], sources: [], sourcesMeta: JOB_SOURCES, error: String(e) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
