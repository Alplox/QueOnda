import type { APIRoute } from 'astro';
import { BROWSER_UA } from '../../lib/rss';
import { getCached, getStaleCached, setCache } from '../../lib/cache';

const TRENDS_SOURCES = [
  { url: 'https://trends.google.com/trending/rss?geo=CL', label: 'Google Trends RSS', daily: false },
  { url: 'https://trends.google.com/trends/trendingsearches/daily/rss?geo=CL', label: 'Google Trends Daily RSS', daily: true },
];

function parseTrendsRSS(xml: string, isDaily: boolean) {
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  return items.slice(0, 20).map((item) => {
    const title = item.match(/<title>(.*?)<\/title>/)?.[1] || '';
    const traffic = isDaily
      ? ''
      : item.match(/<ht:approx_traffic>(.*?)<\/ht:approx_traffic>/)?.[1] || '';
    const snippet = item.match(/<ht:news_item_snippet>[\s\S]*?<!\[CDATA\[(.*?)\]\]>/)?.[1] || '';
    return { title, traffic, snippet };
  });
}

async function fetchSource(source: typeof TRENDS_SOURCES[0]): Promise<{ trends: any[] } | null> {
  try {
    const res = await fetch(source.url, {
      headers: { 'User-Agent': BROWSER_UA },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const xml = await res.text();
    const trends = parseTrendsRSS(xml, source.daily);
    if (trends.length === 0) return null;
    return { trends };
  } catch {
    return null;
  }
}

export const GET: APIRoute = async () => {
  const cached = await getCached<{ trends: any[] }>('trends');
  if (cached) {
    return new Response(JSON.stringify(cached), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=1800' },
    });
  }

  for (const source of TRENDS_SOURCES) {
    const result = await fetchSource(source);
    if (result) {
      const data = { trends: result.trends };
      await setCache('trends', data, 30 * 60 * 1000);
      return new Response(JSON.stringify(data), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=1800' },
      });
    }
  }

  // All sources exhausted — serve stale cache if available
  const stale = await getStaleCached<{ trends: any[] }>('trends');
  if (stale) {
    return new Response(JSON.stringify(stale), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' },
    });
  }

  return new Response(JSON.stringify({ trends: [], error: 'No se pudo obtener tendencias de Google. Las fuentes no respondieron.' }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
