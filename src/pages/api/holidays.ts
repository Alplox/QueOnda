import type { APIRoute } from 'astro';
import { getCached, setCache } from '../../lib/cache';
import fallbackData from '../../lib/holidays-fallback.json';

const BOOSTR_URL = 'https://api.boostr.cl/holidays.json';
const NAGER_URL = (year: number) => `https://date.nager.at/api/v3/publicholidays/${year}/CL`;
const CACHE_TTL = 30 * 60 * 1000;
const CACHE_KEY = 'holidays';

interface Holiday {
  date: string;
  title: string;
  type: string;
  inalienable: boolean;
  extra: string;
}

interface NagerHoliday {
  date: string;
  localName: string;
  name: string;
  countryCode: string;
  fixed: boolean;
  global: boolean;
  counties: string[] | null;
  launchYear: number | null;
  types: string[];
}

const INALIENABLE_DATES = new Set([
  '2026-01-01', '2026-05-01', '2026-09-18', '2026-09-19', '2026-12-25',
]);

function mapNagerHoliday(h: NagerHoliday): Holiday | null {
  if (!h.global) return null;
  const inalienable = INALIENABLE_DATES.has(h.date);
  return {
    date: h.date,
    title: h.localName,
    type: 'Civil',
    inalienable,
    extra: inalienable ? 'Civil e Irrenunciable' : 'Civil',
  };
}

export const GET: APIRoute = async () => {
  const cached = await getCached<Holiday[]>(CACHE_KEY);
  if (cached) {
    return new Response(JSON.stringify({ holidays: cached }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const year = new Date().getFullYear();

  for (const source of ['boostr', 'nager'] as const) {
    try {
      if (source === 'boostr') {
        const res = await fetch(BOOSTR_URL, { signal: AbortSignal.timeout(8000) });
        if (!res.ok) throw new Error(`Boostr returned ${res.status}`);
        const json = await res.json();
        if (json.status !== 'success' || !Array.isArray(json.data)) throw new Error('Boostr: invalid response');
        const data = json.data as Holiday[];
        await setCache(CACHE_KEY, data, CACHE_TTL);
        return new Response(JSON.stringify({ holidays: data }), {
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=1800' },
        });
      }

      if (source === 'nager') {
        const res = await fetch(NAGER_URL(year), { signal: AbortSignal.timeout(8000) });
        if (!res.ok) throw new Error(`Nager returned ${res.status}`);
        const json = await res.json();
        if (!Array.isArray(json)) throw new Error('Nager: invalid response');
        const data = json.map(mapNagerHoliday).filter(Boolean) as Holiday[];
        if (data.length === 0) throw new Error('Nager: empty result');
        await setCache(CACHE_KEY, data, CACHE_TTL);
        return new Response(JSON.stringify({ holidays: data }), {
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=1800' },
        });
      }
    } catch (err) {
      console.error(`Holidays fetch (${source}) failed:`, err);
    }
  }

  console.error('All holiday sources failed, using fallback JSON');
  return new Response(JSON.stringify({ holidays: fallbackData }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
