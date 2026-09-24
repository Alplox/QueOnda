import type { APIRoute } from 'astro';
import { fetchSingleSource, getAllNewsSources } from '../../../lib/rss';
import type { SourceFeed } from '../../../types';
import type { Article, SourceResult } from '../../../types';
import { getCached, setCache, edgeCacheHeaders } from '../../../lib/cache';
import { validateFetchUrl } from '../../../lib/url-validator';
import { checkRateLimit } from '../../../lib/rate-limit';

const SOURCE_CACHE_TTL = 15 * 60 * 1000;
const CF_SUBREQUEST_LIMIT = 40;
const MAX_BATCH_SOURCES = 40;
const MAX_REQUEST_BYTES = 128 * 1024;

interface CachedSourceResult {
  articles: Article[];
  sourceResult: SourceResult;
}

function jsonError(error: string, status: number): Response {
  return new Response(JSON.stringify({ error, articles: [], sourceResults: [] }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function assembleResult(cached: CachedSourceResult[]) {
  const articles: Article[] = [];
  const sourceResults: SourceResult[] = [];
  for (const { articles: sourceArticles, sourceResult } of cached) {
    sourceResults.push(sourceResult);
    articles.push(...sourceArticles);
  }
  articles.sort((a, b) => (a.pubDate > b.pubDate ? -1 : a.pubDate < b.pubDate ? 1 : 0));
  const keptPerName = new Map<string, number>();
  for (const article of articles) keptPerName.set(article.source, (keptPerName.get(article.source) || 0) + 1);
  for (const sourceResult of sourceResults) {
    sourceResult.articlesCount = keptPerName.get(sourceResult.name) ?? 0;
  }
  return {
    articles,
    sourceResults,
    totalSources: cached.length,
    displayedSources: new Set(articles.map(article => article.sourceKey)).size,
  };
}

async function resolveInventorySources(candidates: unknown[]): Promise<SourceFeed[]> {
  const inventory = await getAllNewsSources();
  const inventoryByUrl = new Map(inventory.map(source => [source.url, source]));
  const resolved: SourceFeed[] = [];
  const seenUrls = new Set<string>();

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object' || !('url' in candidate)) {
      throw new Error('invalid_source');
    }
    const rawUrl = (candidate as { url?: unknown }).url;
    if (typeof rawUrl !== 'string') throw new Error('invalid_source');

    const source = inventoryByUrl.get(rawUrl);
    if (!source || seenUrls.has(rawUrl)) throw new Error('unknown_source');

    const check = validateFetchUrl(source.url);
    if (!check.valid) throw new Error('unsafe_source');
    seenUrls.add(rawUrl);
    resolved.push(source);
  }

  return resolved;
}

export const POST: APIRoute = async ({ request }) => {
  const rateLimited = checkRateLimit(request, 'news-batch', 10);
  if (rateLimited) return rateLimited;

  const contentLength = Number(request.headers.get('Content-Length') || 0);
  if (contentLength > MAX_REQUEST_BYTES) return jsonError('Request body too large', 413);

  let candidates: unknown[];
  try {
    const payload = await request.json() as { sources?: unknown };
    if (!Array.isArray(payload.sources) || payload.sources.length === 0) {
      return jsonError('Missing sources array', 400);
    }
    candidates = payload.sources;
  } catch {
    return jsonError('Invalid JSON body', 400);
  }

  if (candidates.length > MAX_BATCH_SOURCES) {
    return jsonError(`A maximum of ${MAX_BATCH_SOURCES} sources is allowed`, 400);
  }

  let sources: SourceFeed[];
  try {
    sources = await resolveInventorySources(candidates);
  } catch (error) {
    const code = error instanceof Error ? error.message : 'invalid_source';
    const message = code === 'unknown_source'
      ? 'Una o más fuentes no pertenecen al inventario'
      : code === 'unsafe_source'
        ? 'Una o más fuentes no son permitidas'
        : 'Formato de fuente inválido';
    return jsonError(message, 400);
  }

  try {
    // Hybrid cache: per-source for small batches, combo for larger batches.
    if (sources.length <= 6) {
      const resultByUrl = new Map<string, CachedSourceResult>();
      const uncached: SourceFeed[] = [];

      for (const source of sources) {
        const cached = await getCached<CachedSourceResult>(`rss:v2:${source.url}`);
        if (cached) resultByUrl.set(source.url, cached);
        else uncached.push(source);
      }

      if (uncached.length > 0) {
        const fresh: CachedSourceResult[] = [];
        for (let index = 0; index < uncached.length; index += CF_SUBREQUEST_LIMIT) {
          const batch = uncached.slice(index, index + CF_SUBREQUEST_LIMIT);
          fresh.push(...await Promise.all(batch.map(source => fetchSingleSource(source))));
        }
        for (let index = 0; index < uncached.length; index++) {
          const source = uncached[index];
          const entry = fresh[index];
          resultByUrl.set(source.url, entry);
          await setCache(`rss:v2:${source.url}`, entry, SOURCE_CACHE_TTL);
        }
      }

      const orderedResults = sources
        .map(source => resultByUrl.get(source.url))
        .filter((result): result is CachedSourceResult => result !== undefined);
      return new Response(JSON.stringify(assembleResult(orderedResults)), {
        headers: edgeCacheHeaders(900),
      });
    }

    const comboKey = `batch:v2:${sources.map(source => source.url).sort().join('|')}`;
    const cached = await getCached<Omit<ReturnType<typeof assembleResult>, 'totalSources' | 'displayedSources'>>(comboKey);
    if (cached) {
      return new Response(JSON.stringify({ ...cached, totalSources: sources.length, displayedSources: new Set(cached.articles.map(article => article.sourceKey)).size }), {
        headers: edgeCacheHeaders(900),
      });
    }

    const fresh: CachedSourceResult[] = [];
    for (let index = 0; index < sources.length; index += CF_SUBREQUEST_LIMIT) {
      const batch = sources.slice(index, index + CF_SUBREQUEST_LIMIT);
      fresh.push(...await Promise.all(batch.map(source => fetchSingleSource(source))));
    }
    const assembled = assembleResult(fresh);
    await setCache(comboKey, { articles: assembled.articles, sourceResults: assembled.sourceResults }, SOURCE_CACHE_TTL);

    return new Response(JSON.stringify(assembled), {
      headers: edgeCacheHeaders(900),
    });
  } catch {
    return jsonError('Failed to fetch batch', 500);
  }
};
