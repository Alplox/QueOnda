import type { APIRoute } from 'astro';
import { XMLParser } from 'fast-xml-parser';
import { getCached, setCache, edgeCacheHeaders } from '../../../lib/cache';
import { BROWSER_UA } from '../../../lib/rss';
import { fetchChannels } from '../../../lib/channels';
import { checkRateLimit } from '../../../lib/rate-limit';

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', parseTagValue: false });
const MAX_PER_CHANNEL = 10;
const CHANNEL_ID_PATTERN = /^UC[A-Za-z0-9_-]{22}$/;

function todayChile(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
}

function cacheKey(channelId: string): string {
  return `youtube:source:v2:${channelId}`;
}

export const GET: APIRoute = async ({ url, request }) => {
  if ([...url.searchParams.keys()].some(param => param !== 'channelId')) {
    return new Response(JSON.stringify({ error: 'Unsupported query parameter' }), { status: 400 });
  }

  const rateLimited = checkRateLimit(request, 'youtube-source', 20);
  if (rateLimited) return rateLimited;

  const channelId = url.searchParams.get('channelId')?.trim();
  if (!channelId) {
    return new Response(JSON.stringify({ error: 'channelId required' }), { status: 400 });
  }
  if (!CHANNEL_ID_PATTERN.test(channelId)) {
    return new Response(JSON.stringify({ error: 'Invalid channelId' }), { status: 400 });
  }

  let channelName: string;
  try {
    const { channels } = await fetchChannels();
    const channel = channels.find(item => item.youtube === channelId);
    if (!channel) {
      return new Response(JSON.stringify({ error: 'Unknown channelId' }), { status: 404 });
    }
    channelName = channel.name;
  } catch {
    return new Response(JSON.stringify({ error: 'Channel inventory unavailable' }), { status: 503 });
  }

  const cacheKeyValue = cacheKey(channelId);
  const cached = await getCached<{ videos: unknown[]; channelId: string; name: string; status: string; errorMessage?: string }>(cacheKeyValue);
  if (cached) {
    return new Response(JSON.stringify(cached), {
      headers: edgeCacheHeaders(300),
    });
  }

  let status = 'error';
  let errorMessage: string | undefined;
  const videos: Array<{
    videoId: string;
    channelId: string;
    title: string;
    author: string;
    thumbnail: string;
    link: string;
    published: string;
  }> = [];

  try {
    const response = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`, {
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': BROWSER_UA },
    });

    if (!response.ok) {
      errorMessage = `YouTube respondió con código HTTP ${response.status}`;
      throw new Error(errorMessage);
    }

    const xml = await response.text();
    const parsed = parser.parse(xml) as {
      feed?: { entry?: Record<string, any> | Array<Record<string, any>> };
    };
    const entries = parsed.feed?.entry;

    if (!entries) {
      status = 'empty';
    } else {
      const list = Array.isArray(entries) ? entries : [entries];
      const today = todayChile();
      const todayEntries = list.filter(entry => String(entry.published || '').startsWith(today));

      if (todayEntries.length === 0) {
        status = 'empty';
      } else {
        status = 'ok';
        const count = Math.min(todayEntries.length, MAX_PER_CHANNEL);
        for (let index = 0; index < count; index++) {
          const entry = todayEntries[index];
          const videoId = String(entry['yt:videoId'] || '');
          videos.push({
            videoId,
            channelId,
            title: String(entry.title || ''),
            author: channelName,
            thumbnail: String(entry['media:group']?.['media:thumbnail']?.['@_url'] || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`),
            link: videoId ? `https://youtube.com/watch?v=${videoId}` : '',
            published: String(entry.published || ''),
          });
        }
      }
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      errorMessage = 'Timeout al conectar con YouTube';
    } else if (!errorMessage) {
      errorMessage = error instanceof Error ? error.message : 'Error desconocido';
    }
    status = 'error';
  }

  const result = { videos, channelId, name: channelName, status, errorMessage };
  await setCache(cacheKeyValue, result, 5 * 60 * 1000);

  return new Response(JSON.stringify(result), {
    headers: edgeCacheHeaders(300),
  });
};
