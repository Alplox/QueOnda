import type { APIRoute } from 'astro';
import { XMLParser } from 'fast-xml-parser';
import { getCached, setCache } from '../../../lib/cache';
import { BROWSER_UA } from '../../../lib/rss';

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
const MAX_PER_CHANNEL = 10;

function todayChile(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
}

function cacheKey(channelId: string): string {
  return `youtube:source:${channelId}`;
}

export const GET: APIRoute = async ({ url }) => {
  const channelId = url.searchParams.get('channelId');
  const name = url.searchParams.get('name') || '';

  if (!channelId) {
    return new Response(JSON.stringify({ error: 'channelId required' }), { status: 400 });
  }

  const ck = cacheKey(channelId);
  const cached = await getCached<{ videos: any[]; status: string; errorMessage?: string }>(ck);
  if (cached) {
    return new Response(JSON.stringify(cached), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
    });
  }

  let status = 'error';
  let errorMessage: string | undefined;
  const videos: any[] = [];

  try {
    const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`, {
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': BROWSER_UA },
    });

    if (!res.ok) {
      errorMessage = `YouTube respondió con código HTTP ${res.status}`;
      throw new Error(errorMessage);
    }

    const xml = await res.text();
    const parsed = parser.parse(xml);
    const entries = parsed.feed?.entry;

    if (!entries) {
      status = 'empty';
    } else {
      const list = Array.isArray(entries) ? entries : [entries];
      const today = todayChile();
      const todayEntries = list.filter((e: any) => {
        const pub = e.published || '';
        return pub.startsWith(today);
      });

      if (todayEntries.length === 0) {
        status = 'empty';
      } else {
        status = 'ok';
        const count = Math.min(todayEntries.length, MAX_PER_CHANNEL);
        for (let j = 0; j < count; j++) {
          const entry = todayEntries[j];
          videos.push({
            videoId: entry['yt:videoId'] || '',
            channelId,
            title: entry.title || '',
            author: name,
            thumbnail: entry['media:group']?.['media:thumbnail']?.['@_url'] || `https://i.ytimg.com/vi/${entry['yt:videoId']}/hqdefault.jpg`,
            link: entry['yt:videoId'] ? `https://youtube.com/watch?v=${entry['yt:videoId']}` : '',
            published: entry.published || '',
          });
        }
      }
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      errorMessage = 'Timeout al conectar con YouTube';
    } else if (!errorMessage) {
      errorMessage = e instanceof Error ? e.message : 'Error desconocido';
    }
    status = 'error';
  }

  const result = { videos, channelId, name, status, errorMessage };
  await setCache(ck, result, 5 * 60 * 1000);

  return new Response(JSON.stringify(result), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
  });
};
