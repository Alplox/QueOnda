import type { APIRoute } from 'astro';
import { XMLParser } from 'fast-xml-parser';
import { getCached, setCache } from '../../lib/cache';
import { BROWSER_UA } from '../../lib/rss';
import { fetchChannels } from '../../lib/channels';

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
const MAX_PER_CHANNEL = 10;

function todayChile(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
}

const CACHE_KEY = 'youtube:v3';

export const GET: APIRoute = async () => {
  const cached = await getCached<{ videos: any[]; channelStatuses: { id: string; name: string; status: string; count: number }[] }>(CACHE_KEY);
  if (cached) {
    return new Response(JSON.stringify(cached), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=1800' },
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
    });

  const statusMap = new Map<string, { status: string; count: number }>();
  for (const t of targets) {
    statusMap.set(t.youtube!, { status: 'error', count: 0 });
  }

  const today = todayChile();
  const results = await Promise.allSettled(
    targets.map((ch) =>
      fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${ch.youtube!}`, {
        signal: AbortSignal.timeout(8000),
        headers: { 'User-Agent': BROWSER_UA },
      })
        .then((r) => (r.ok ? r.text() : Promise.reject(r.status)))
        .then((xml) => ({ name: ch.name, channelId: ch.youtube!, xml })),
    ),
  );

  const videos: any[] = [];
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const { youtube, name } = targets[i];
    const yt = youtube!;

    if (result.status !== 'fulfilled') {
      statusMap.set(yt, { status: 'error', count: 0 });
      continue;
    }

    try {
      const { xml } = result.value;
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
    } catch {
      statusMap.set(yt, { status: 'error', count: 0 });
    }
  }

  videos.sort((a, b) => (a.published < b.published ? 1 : -1));

  const channelStatuses = targets.map((t) => {
    const s = statusMap.get(t.youtube!)!;
    return { id: t.youtube!, name: t.name, status: s.status, count: s.count };
  });

  const result = { videos, channelStatuses };
  await setCache(CACHE_KEY, result, 30 * 60 * 1000);

  return new Response(JSON.stringify(result), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=1800' },
  });
};
