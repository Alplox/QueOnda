import type { APIRoute } from 'astro';
import { fetchSingleSource } from '../../../lib/rss';
import type { SourceFeed } from '../../../types';
import type { Article, SourceResult } from '../../../types';
import { getCached, setCache } from '../../../lib/cache';
import { validateFetchUrl } from '../../../lib/url-validator';
import { checkRateLimit } from '../../../lib/rate-limit';

const SOURCE_CACHE_TTL = 15 * 60 * 1000;

function assembleResult(cached: Array<{ articles: Article[]; sourceResult: SourceResult }>) {
  const articles: Article[] = [];
  const sourceResults: SourceResult[] = [];
  for (const { articles: srcArticles, sourceResult } of cached) {
    sourceResults.push(sourceResult);
    articles.push(...srcArticles);
  }
  articles.sort((a, b) => (a.pubDate > b.pubDate ? -1 : a.pubDate < b.pubDate ? 1 : 0));
  const keptPerName = new Map<string, number>();
  for (const a of articles) keptPerName.set(a.source, (keptPerName.get(a.source) || 0) + 1);
  for (const sr of sourceResults) sr.articlesCount = keptPerName.get(sr.name) ?? 0;
  return { articles, sourceResults, totalSources: cached.length, displayedSources: new Set(articles.map(a => a.sourceKey)).size };
}

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

    // Hybrid cache: per-source for small batches (6 slots), combo for large batches (all-sources page)
    // ponytail: per-source writes N KV entries, combo writes 1 — cap writes at ~6 for normal use
    if (sources.length <= 6) {
      const results: Array<{ articles: Article[]; sourceResult: SourceResult }> = [];
      const uncached: SourceFeed[] = [];

      for (const src of sources) {
        const cached = await getCached<{ articles: Article[]; sourceResult: SourceResult }>(`rss:${src.url}`);
        if (cached) {
          results.push(cached);
        } else {
          uncached.push(src);
        }
      }

      if (uncached.length > 0) {
        const fresh = await Promise.all(uncached.map(src => fetchSingleSource(src)));
        for (let i = 0; i < uncached.length; i++) {
          const entry = fresh[i];
          results.push(entry);
          await setCache(`rss:${uncached[i].url}`, entry, SOURCE_CACHE_TTL);
        }
      }

      const assembled = assembleResult(results);
      return new Response(JSON.stringify(assembled), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=900' },
      });
    }

    // Large batch: combo cache key (1 KV write instead of N)
    const comboKey = `batch:${sources.map(s => s.url).sort().join('|')}`;
    const cached = await getCached<{ articles: Article[]; sourceResults: SourceResult[] }>(comboKey);
    if (cached) {
      return new Response(JSON.stringify(cached), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=900' },
      });
    }

    const fresh = await Promise.all(sources.map(src => fetchSingleSource(src)));
    const assembled = assembleResult(fresh);
    await setCache(comboKey, { articles: assembled.articles, sourceResults: assembled.sourceResults }, SOURCE_CACHE_TTL);

    return new Response(JSON.stringify(assembled), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=900' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Failed to fetch batch', articles: [], sourceResults: [] }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
