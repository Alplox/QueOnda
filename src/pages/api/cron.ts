import type { APIRoute } from 'astro';
import { getCached, setCache } from '../../lib/cache';
import { fetchAllSports, deduplicateArticles } from '../../lib/rss';
import { fetchChannels } from '../../lib/channels';
import { XMLParser } from 'fast-xml-parser';
import { BROWSER_UA } from '../../lib/rss';

// ponytail: external cron endpoint — call from cron-job.org or GitHub Actions
// Pre-warms the most expensive KV caches to eliminate cold-start CPU

const CRON_SECRET = import.meta.env.CRON_SECRET || '';

export const GET: APIRoute = async ({ request }) => {
  // ponytail: simple shared-secret auth (set CRON_SECRET env var in Cloudflare dashboard)
  if (CRON_SECRET) {
    const auth = request.headers.get('Authorization');
    if (auth !== `Bearer ${CRON_SECRET}`) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }
  }

  const warmed: string[] = [];
  const failed: string[] = [];

  // 1. Pre-warm sports RSS (most expensive — XML parsing of N feeds)
  try {
    const existing = await getCached('sports');
    if (!existing) {
      const sports = await fetchAllSports();
      const deduped = deduplicateArticles(sports.articles, 25);
      await setCache('sports', {
        articles: deduped.slice(0, 50).map((a: any) => ({
          title: a.title, link: a.link, description: a.description?.slice(0, 180), source: a.source,
        })),
        sourceResults: sports.sourceResults,
        totalSources: sports.totalSources,
        displayedSources: sports.displayedSources,
      }, 30 * 60 * 1000);
      warmed.push('sports');
    }
  } catch { failed.push('sports'); }

  // 2. Pre-warm YouTube (N channel RSS feeds)
  try {
    const existing = await getCached('youtube:v3');
    if (!existing) {
      const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', parseTagValue: false, ignoreDeclaration: true });
      const { channels } = await fetchChannels();
      const seen = new Set<string>();
      const targets = channels.filter((ch) => ch.youtube && !seen.has(ch.youtube) && seen.add(ch.youtube));

      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
      const videos: any[] = [];
      const channelStatuses: any[] = [];

      for (const ch of targets.slice(0, 30)) {
        try {
          const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${ch.youtube!}`, {
            signal: AbortSignal.timeout(8000),
            headers: { 'User-Agent': BROWSER_UA },
          });
          if (!res.ok) { channelStatuses.push({ id: ch.youtube!, name: ch.name, status: 'error', count: 0 }); continue; }
          const xml = await res.text();
          const parsed = parser.parse(xml);
          const entries = parsed.feed?.entry;
          if (!entries) { channelStatuses.push({ id: ch.youtube!, name: ch.name, status: 'empty', count: 0 }); continue; }
          const list = Array.isArray(entries) ? entries : [entries];
          const todayEntries = list.filter((e: any) => (e.published || '').startsWith(today));
          const count = Math.min(todayEntries.length, 10);
          channelStatuses.push({ id: ch.youtube!, name: ch.name, status: count > 0 ? 'ok' : 'empty', count });
          for (let j = 0; j < count; j++) {
            const e = todayEntries[j];
            videos.push({
              videoId: e['yt:videoId'] || '', channelId: ch.youtube!, title: e.title || '', author: ch.name,
              thumbnail: e['media:group']?.['media:thumbnail']?.['@_url'] || `https://i.ytimg.com/vi/${e['yt:videoId']}/hqdefault.jpg`,
              link: e['yt:videoId'] ? `https://youtube.com/watch?v=${e['yt:videoId']}` : '', published: e.published || '',
            });
          }
        } catch { channelStatuses.push({ id: ch.youtube!, name: ch.name, status: 'error', count: 0 }); }
      }
      videos.sort((a: any, b: any) => a.published < b.published ? 1 : -1);
      await setCache('youtube:v3', { videos, channelStatuses }, 60 * 60 * 1000);
      warmed.push('youtube');
    }
  } catch { failed.push('youtube'); }

  // 3. Pre-warm trends (Google Trends RSS — small but CORS-blocked)
  try {
    const existing = await getCached('trends');
    if (!existing) {
      const res = await fetch('https://trends.google.com/trending/rss?geo=CL', { signal: AbortSignal.timeout(10000) });
      if (res.ok) {
        const xml = await res.text();
        const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
        const trends = items.slice(0, 20).map(item => {
          const title = item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/)?.[1] || item.match(/<title>(.*?)<\/title>/)?.[1] || '';
          const traffic = item.match(/<ht:approx_traffic>(.*?)<\/ht:approx_traffic>/)?.[1] || '';
          const newsUrl = item.match(/<ht:news_url><!\[CDATA\[(.*?)\]\]><\/ht:news_url>/)?.[1] || '';
          return { title: title.replace(/ - Google Search$/, ''), traffic, newsUrl };
        }).filter((t: any) => t.title);
        await setCache('trends', { trends }, 30 * 60 * 1000);
        warmed.push('trends');
      }
    }
  } catch { failed.push('trends'); }

  return new Response(JSON.stringify({ warmed, failed, timestamp: new Date().toISOString() }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
