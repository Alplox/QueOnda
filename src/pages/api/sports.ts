import type { APIRoute } from 'astro';
import { fetchAllSports, deduplicateArticles } from '../../lib/rss';
import { getCached, setCache } from '../../lib/cache';
import type { SourceResult, Article } from '../../types';

interface SportArticle {
  title: string;
  link: string;
  description: string;
  source: string;
}

interface SportsResponse {
  articles: SportArticle[];
  sourceResults: SourceResult[];
  totalSources: number;
  displayedSources: number;
}

export const GET: APIRoute = async () => {
  const cached = await getCached<SportsResponse>('sports');
  if (cached) {
    return new Response(JSON.stringify(cached), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=600' },
    });
  }

  try {
    const { articles, sourceResults, totalSources, displayedSources } = await fetchAllSports();

    const deduped: SportArticle[] = (deduplicateArticles(articles, 25) as Article[]).map(a => ({
      title: a.title,
      link: a.link,
      description: a.description.slice(0, 180),
      source: a.source,
    }));

    const data: SportsResponse = { articles: deduped, sourceResults, totalSources, displayedSources };
    await setCache('sports', data, 10 * 60 * 1000);

    return new Response(JSON.stringify(data), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=600',
      },
    });
  } catch {
    return new Response(JSON.stringify({ articles: [], sourceResults: [], totalSources: 0, displayedSources: 0 }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
