import type { APIRoute } from 'astro';
import { getCached, setCache, dedupeFetch, edgeCacheHeaders } from '../../lib/cache';
import { fetchAllSports, deduplicateArticles } from '../../lib/rss';
import type { SourceResult } from '../../types';

const CACHE_TTL = 30 * 60 * 1000;

interface Article {
  title: string;
  link: string;
  description: string;
  source: string;
}

interface FutbolResponse {
  articles: Article[];
  sourceResults: SourceResult[];
  totalSources: number;
  displayedSources: number;
}

// ponytail: ESPN standings/matches moved client-side (FootballTable fetches directly)
// This endpoint now only serves sports RSS articles (CORS-blocked, must stay server)
export const GET: APIRoute = async () => {
  const cached = await getCached<FutbolResponse>('futbol');
  if (cached) {
    return new Response(JSON.stringify(cached), {
      headers: edgeCacheHeaders(600),
    });
  }

  let articles: Article[] = [];
  let sourceResults: SourceResult[] = [];
  let totalSources = 0;
  let displayedSources = 0;

  try {
    const sports = await dedupeFetch('sports-data', () => fetchAllSports());
    for (const a of deduplicateArticles(sports.articles, 25) as Article[]) {
      articles.push({
        title: a.title,
        link: a.link,
        description: a.description.slice(0, 180),
        source: a.source,
      });
    }
    sourceResults = sports.sourceResults;
    totalSources = sports.totalSources;
    displayedSources = sports.displayedSources;
  } catch {}

  const data: FutbolResponse = { articles, sourceResults, totalSources, displayedSources };
  await setCache('futbol', data, CACHE_TTL);

  return new Response(JSON.stringify(data), {
    headers: edgeCacheHeaders(600),
  });
};
