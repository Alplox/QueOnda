import type { APIRoute } from 'astro';
import stopsDb from '../../lib/stops-database.json';
import { BROWSER_UA } from '../../lib/rss';
import { getCached, setCache } from '../../lib/cache';
import { LINE_COLORS, fetchStopPredictions } from '../../lib/transport';

interface StopsDB {
  routes: Record<string, string[]>;
  stops: Record<string, { stop_name: string; stop_lat: number | null; stop_lon: number | null }>;
}

let stopsDB: StopsDB | null = null;
function getStopsDB(): StopsDB {
  if (!stopsDB) {
    stopsDB = stopsDb as StopsDB;
  }
  return stopsDB;
}

async function fetchMetroCl(): Promise<{ lines: any[]; source: string } | null> {
  try {
    const res = await fetch('https://www.metro.cl/el-viaje/estado-red', {
      headers: { 'User-Agent': BROWSER_UA },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const html = await res.text();

    const iconRegex = /\/images\/ico-(l\d+[a-z]?)\.svg/g;
    const statusRegex = /Línea<br\s*\/?>(.+?)<\/p>/g;

    const lineIds: string[] = [];
    let match;
    while ((match = iconRegex.exec(html)) !== null) lineIds.push(match[1]);

    const statuses: string[] = [];
    while ((match = statusRegex.exec(html)) !== null) statuses.push(match[1].trim().toLowerCase());

    const lines = lineIds.map((id, i) => ({
      name: `L${id.replace('l', '').toUpperCase()}`,
      color: LINE_COLORS[id.toLowerCase()] || '#666',
      status: ({ disponible: 'Normal', detenido: 'Detenido', parcial: 'Parcial', demorado: 'Demorado' } as Record<string, string>)[statuses[i]] || statuses[i] || 'Normal',
    }));

    if (lines.length > 0) return { lines, source: 'metro.cl' };
    return null;
  } catch {
    return null;
  }
}

export const GET: APIRoute = async ({ url, request }) => {
  const cacheKey = `transport:${url.search}`;
  const cached = await getCached<any>(cacheKey);
  if (cached) {
    return new Response(JSON.stringify(cached), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
    });
  }

  const mode = url.searchParams.get('mode');
  const stopId = url.searchParams.get('stop')?.toUpperCase().trim();
  const routeId = url.searchParams.get('route')?.trim();
  const cityId = url.searchParams.get('city') || 'santiago';

  let metroResult = null;

  let stopInfo = null;
  let predictionError: string | null = null;
  let routeStops = null;

  // Route names list mode
  if (mode === 'route-names') {
    const db = getStopsDB();
    const data = { routes: Object.keys(db.routes).sort() };
    await setCache(cacheKey, data, 60 * 60 * 1000);
    return new Response(JSON.stringify(data), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' },
    });
  }

  // Route lookup mode
  if (routeId) {
    const db = getStopsDB();
    const stops = db.routes[routeId];
    if (stops) {
      routeStops = stops.map(sid => ({
        stop_id: sid,
        ...db.stops[sid] || { stop_name: sid, stop_lat: 0, stop_lon: 0 },
      }));
    }
  }

  const promises: Promise<void>[] = [];
  if (cityId === 'santiago' && !routeId) {
    promises.push(fetchMetroCl().then(r => { metroResult = r; }));
  }
  if (stopId) {
    promises.push(
      fetchStopPredictions(stopId)
        .then(r => { stopInfo = r; })
        .catch((e: any) => { predictionError = e.message?.includes('timeout') ? 'red.cl no responde' : (e.message || 'Error al consultar paradero'); }),
    );
  }
  await Promise.allSettled(promises);

  const data = {
    city: cityId,
    name: 'Santiago',
    metro: metroResult,

    stopInfo: stopInfo,
    predictionError: predictionError,
    routeStops: routeStops,
  };
  await setCache(cacheKey, data, 5 * 60 * 1000);

  return new Response(JSON.stringify(data), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=300',
    },
  });
};
