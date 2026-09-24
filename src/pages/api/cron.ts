import type { APIRoute } from 'astro';
import { getCached, setCache, getStaleCached } from '../../lib/cache';
import { fetchAllSports, deduplicateArticles, pMap, BROWSER_UA } from '../../lib/rss';
import { fetchChannels } from '../../lib/channels';
import { XMLParser } from 'fast-xml-parser';

// ponytail: external cron endpoint — call from cron-job.org or GitHub Actions
// Pre-warms the most expensive KV caches to eliminate cold-start CPU

const CRON_SECRET = import.meta.env.CRON_SECRET || '';

export const GET: APIRoute = async ({ request }) => {
  // Fail closed: an unset secret must never expose this expensive public warm-up route.
  if (!CRON_SECRET) {
    return new Response(JSON.stringify({ error: 'CRON_SECRET is not configured' }), { status: 503 });
  }

  const auth = request.headers.get('Authorization');
  if (auth !== `Bearer ${CRON_SECRET}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const warmed: string[] = [];
  const failed: string[] = [];
  const log: string[] = [];

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
      log.push(`sports: ${deduped.length} articles from ${sports.sourceResults.length} sources`);
    } else { log.push('sports: skipped (cached)'); }
  } catch (e: any) { failed.push('sports'); log.push(`sports: ${e?.message || e}`); }

  // 2. Pre-warm YouTube (N channel RSS feeds — parallel via pMap)
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

      const fetchResults = await pMap(targets.slice(0, 30), async (ch) => {
        try {
          const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${ch.youtube!}`, {
            signal: AbortSignal.timeout(8000),
            headers: { 'User-Agent': BROWSER_UA },
          });
          if (!res.ok) return { ok: false as const, name: ch.name, channelId: ch.youtube!, error: `HTTP ${res.status}` };
          const xml = await res.text();
          return { ok: true as const, name: ch.name, channelId: ch.youtube!, xml };
        } catch (e: any) {
          return { ok: false as const, name: ch.name, channelId: ch.youtube!, error: e?.name === 'AbortError' ? 'Timeout' : e?.message };
        }
      }, 8);

      for (const r of fetchResults) {
        if (!r.ok) { channelStatuses.push({ id: r.channelId, name: r.name, status: 'error', count: 0, errorMessage: r.error }); continue; }
        try {
          const parsed = parser.parse(r.xml);
          const entries = parsed.feed?.entry;
          if (!entries) { channelStatuses.push({ id: r.channelId, name: r.name, status: 'empty', count: 0 }); continue; }
          const list = Array.isArray(entries) ? entries : [entries];
          const todayEntries = list.filter((e: any) => (e.published || '').startsWith(today));
          const count = Math.min(todayEntries.length, 10);
          channelStatuses.push({ id: r.channelId, name: r.name, status: count > 0 ? 'ok' : 'empty', count });
          for (let j = 0; j < count; j++) {
            const e = todayEntries[j];
            videos.push({
              videoId: e['yt:videoId'] || '', channelId: r.channelId, title: e.title || '', author: r.name,
              thumbnail: e['media:group']?.['media:thumbnail']?.['@_url'] || `https://i.ytimg.com/vi/${e['yt:videoId']}/hqdefault.jpg`,
              link: e['yt:videoId'] ? `https://youtube.com/watch?v=${e['yt:videoId']}` : '', published: e.published || '',
            });
          }
        } catch { channelStatuses.push({ id: r.channelId, name: r.name, status: 'error', count: 0 }); }
      }
      videos.sort((a: any, b: any) => a.published < b.published ? 1 : -1);
      await setCache('youtube:v3', { videos, channelStatuses }, 60 * 60 * 1000);
      warmed.push('youtube');
      log.push(`youtube: ${videos.length} videos from ${channelStatuses.filter(s => s.status === 'ok').length}/${targets.length} channels`);
    } else { log.push('youtube: skipped (cached)'); }
  } catch (e: any) { failed.push('youtube'); log.push(`youtube: ${e?.message || e}`); }

  // 3. Pre-warm power (SEC clientes sin suministro — single source, hourly, no fallback)
  try {
    const existing = await getCached('power');
    if (!existing) {
      const stale = await getStaleCached('power');
      try {
        const BASE = 'https://apps.sec.cl/INTONLINEv1/ClientesAfectados/';
        const postSec = async (endpoint: string, body: Record<string, unknown> = {}) => {
          const r = await fetch(BASE + endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
          if (!r.ok) throw new Error(String(r.status));
          return r.json();
        };
        const parseChileLocal = (await import('../../lib/chile-time')).parseChileLocal;
        const comunaCoords = (await import('../../lib/comunas-coords')).comunaCoords;
        const pad2 = (n: number) => String(n).padStart(2, '0');
        const toMs = (p: { anho: number; mes: number; dia: number; hora: number }) =>
          parseChileLocal(`${p.anho}-${pad2(p.mes)}-${pad2(p.dia)} ${pad2(p.hora)}:00:00`);
        const [series, nacional] = await Promise.all([postSec('Get'), postSec('GetClientesNacional')]);
        const last = (series as any[])[series.length - 1];
        if (last) {
          const regiones = await postSec('GetPorFecha', { anho: last.anho, mes: last.mes, dia: last.dia, hora: last.hora });
          const byRegion = new Map<string, number>();
          const comunas: any[] = [];
          for (const r of regiones as any[]) {
            byRegion.set(r.NOMBRE_REGION, (byRegion.get(r.NOMBRE_REGION) ?? 0) + r.CLIENTES_AFECTADOS);
            const coords = comunaCoords(r.NOMBRE_COMUNA);
            if (coords) comunas.push({ region: r.NOMBRE_REGION, comuna: r.NOMBRE_COMUNA, affected: r.CLIENTES_AFECTADOS, lat: coords[0], lon: coords[1] });
          }
          const total = (nacional as any[])[0]?.CLIENTES ?? 0;
          const affected = last.clientes_afectados;
          const data = {
            affected,
            total,
            pct: total > 0 ? (affected * 100) / total : 0,
            updatedAt: toMs(last),
            fetchedAt: Date.now(),
            stale: false,
            regions: [...byRegion.entries()].map(([region, n]) => ({ region, affected: n })).sort((a: any, b: any) => b.affected - a.affected),
            comunas: comunas.sort((a: any, b: any) => b.affected - a.affected),
            series: (series as any[]).map((p: any) => ({ t: toMs(p), v: p.clientes_afectados })),
          };
          await setCache('power', data, 15 * 60 * 1000);
          warmed.push('power');
          log.push(`power: ${affected} afectados, ${comunas.length} comunas`);
        } else { throw new Error('SEC empty series'); }
      } catch (e: any) {
        if (stale) { warmed.push('power (stale)'); log.push('power: serving stale cache'); }
        else { failed.push('power'); log.push(`power: ${e?.message || e}`); }
      }
    } else { log.push('power: skipped (cached)'); }
  } catch (e: any) { failed.push('power'); log.push(`power: ${e?.message || e}`); }

  // 4. Pre-warm trends (Google Trends RSS — dual source, CORS-blocked)
  try {
    const existing = await getCached('trends');
    if (!existing) {
      const sources = [
        { url: 'https://trends.google.com/trending/rss?geo=CL', label: 'realtime' },
        { url: 'https://trends.google.com/trends/trendingsearches/daily/rss?geo=CL', label: 'daily' },
      ];
      let warmed_ok = false;
      for (const src of sources) {
        try {
          const res = await fetch(src.url, { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': BROWSER_UA } });
          if (!res.ok) { log.push(`trends:${src.label}: HTTP ${res.status}`); continue; }
          const xml = await res.text();
          const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
          const trends = items.slice(0, 20).map(item => {
            const title = item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/)?.[1] || item.match(/<title>(.*?)<\/title>/)?.[1] || '';
            const traffic = item.match(/<ht:approx_traffic>(.*?)<\/ht:approx_traffic>/)?.[1] || '';
            const newsUrl = item.match(/<ht:news_url><!\[CDATA\[(.*?)\]\]><\/ht:news_url>/)?.[1] || '';
            return { title: title.replace(/ - Google Search$/, ''), traffic, newsUrl };
          }).filter((t: any) => t.title);
          if (trends.length > 0) {
            await setCache('trends', { trends }, 30 * 60 * 1000);
            warmed.push('trends');
            log.push(`trends: ${trends.length} items from ${src.label}`);
            warmed_ok = true;
            break;
          }
          log.push(`trends:${src.label}: empty`);
        } catch (e: any) { log.push(`trends:${src.label}: ${e?.name || e?.message}`); }
      }
      if (!warmed_ok) {
        const stale = await getStaleCached('trends');
        if (stale) { warmed.push('trends (stale)'); log.push('trends: serving stale cache'); }
        else { failed.push('trends'); log.push('trends: all sources failed, no stale cache'); }
      }
    } else { log.push('trends: skipped (cached)'); }
  } catch (e: any) { failed.push('trends'); log.push(`trends: ${e?.message || e}`); }

  return new Response(JSON.stringify({ warmed, failed, log, timestamp: new Date().toISOString() }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
