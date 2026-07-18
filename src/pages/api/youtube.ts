import type { APIRoute } from 'astro';
import { XMLParser } from 'fast-xml-parser';
import { getCached, setCache, edgeCacheHeaders } from '../../lib/cache';
import { BROWSER_UA, pMap } from '../../lib/rss';
import { fetchChannels } from '../../lib/channels';

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', parseTagValue: false, ignoreDeclaration: true });
const MAX_PER_CHANNEL = 10;

function todayChile(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
}

const CACHE_KEY = 'youtube:v3';

export const GET: APIRoute = async () => {
  const cached = await getCached<{ videos: any[]; channelStatuses: { id: string; name: string; status: string; count: number }[] }>(CACHE_KEY);
  if (cached) {
    return new Response(JSON.stringify(cached), {
      headers: edgeCacheHeaders(1800),
    });
  }

  const { channels } = await fetchChannels();
  const seen = new Set<string>();
  const targets = channels
    .filter((ch) => ch.youtube && !seen.has(ch.youtube) && seen.add(ch.youtube))
    .sort((a, b) => {
      if (a.category === 'news' && b.category !== 'news') return -1;
      if (a.category !== 'news' && b.category === 'news') return 1;
      return 0;
    })
    .slice(0, 40);

  const statusMap = new Map<string, { status: string; count: number; errorMessage?: string }>();
  for (const t of targets) {
    statusMap.set(t.youtube!, { status: 'error', count: 0 });
  }

  const today = todayChile();
  const fetchResults = await pMap(
    targets,
    async (ch) => {
      try {
        const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${ch.youtube!}`, {
          signal: AbortSignal.timeout(8000),
          headers: { 'User-Agent': BROWSER_UA },
        });
        if (!res.ok) return { ok: false as const, name: ch.name, channelId: ch.youtube!, error: `HTTP ${res.status}` };
        const xml = await res.text();
        return { ok: true as const, name: ch.name, channelId: ch.youtube!, xml };
      } catch (e: any) {
        const msg = e?.name === 'AbortError' ? 'Timeout' : 'Error de conexión';
        return { ok: false as const, name: ch.name, channelId: ch.youtube!, error: msg };
      }
    },
    8,
  );

  const videos: any[] = [];
  for (const result of fetchResults) {
    const yt = result.channelId;

    if (!result.ok) {
      statusMap.set(yt, { status: 'error', count: 0, errorMessage: result.error });
      continue;
    }

    try {
      const { xml, name } = result;
      const parsed = parser.parse(xml);
      const entries = parsed.feed?.entry;
      if (!entries) {
        statusMap.set(yt, { status: 'empty', count: 0 });
        continue;
      }
      const list = Array.isArray(entries) ? entries : [entries];
      const todayEntries = list.filter((e: any) => {
        const pub = e.published || '';
        return pub.startsWith(today);
      });

      if (todayEntries.length === 0) {
        statusMap.set(yt, { status: 'empty', count: 0 });
        continue;
      }

      const count = Math.min(todayEntries.length, MAX_PER_CHANNEL);
      statusMap.set(yt, { status: 'ok', count });

      for (let j = 0; j < count; j++) {
        const entry = todayEntries[j];
        videos.push({
          videoId: entry['yt:videoId'] || '',
          channelId: yt,
          title: entry.title || '',
          author: name,
          thumbnail: entry['media:group']?.['media:thumbnail']?.['@_url'] || `https://i.ytimg.com/vi/${entry['yt:videoId']}/hqdefault.jpg`,
          link: entry['yt:videoId'] ? `https://youtube.com/watch?v=${entry['yt:videoId']}` : '',
          published: entry.published || '',
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? `Error al procesar feed: ${e.message}` : 'Error desconocido al procesar feed';
      statusMap.set(yt, { status: 'error', count: 0, errorMessage: msg });
    }
  }

  videos.sort((a, b) => (a.published < b.published ? 1 : -1));

  const channelStatuses = targets.map((t) => {
    const s = statusMap.get(t.youtube!)!;
    return { id: t.youtube!, name: t.name, status: s.status, count: s.count, errorMessage: s.errorMessage };
  });

  const result = { videos, channelStatuses };
  await setCache(CACHE_KEY, result, 60 * 60 * 1000);

  return new Response(JSON.stringify(result), {
    headers: edgeCacheHeaders(3600),
  });
};
