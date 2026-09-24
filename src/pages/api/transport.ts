import type { APIRoute } from 'astro';
import stopsDb from '../../lib/stops-database.json';
import { BROWSER_UA } from '../../lib/rss';
import { getCached, setCache, edgeCacheHeaders } from '../../lib/cache';
import { LINE_COLORS, fetchStopPredictions } from '../../lib/transport';
import { checkRateLimit } from '../../lib/rate-limit';

interface StopsDB {
  routes: Record<string, string[]>;
  stops: Record<string, { stop_name: string; stop_lat: number | null; stop_lon: number | null }>;
}

interface MetroLine {
  name: string;
  color: string;
  status: string;
}

let stopsDB: StopsDB | null = null;
function getStopsDB(): StopsDB {
  if (!stopsDB) stopsDB = stopsDb as StopsDB;
  return stopsDB;
}

function jsonError(error: string, status: number): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function fetchMetroCl(): Promise<{ lines: MetroLine[]; source: string } | null> {
  try {
    const response = await fetch('https://www.metro.cl/el-viaje/estado-red', {
      headers: { 'User-Agent': BROWSER_UA },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return null;

    const html = await response.text();
    const iconRegex = /\/images\/ico-(l\d+[a-z]?)\.svg/g;
    const statusRegex = /Línea<br\s*\/?>(.+?)<\/p>/g;
    const lineIds: string[] = [];
    const statuses: string[] = [];
    let match: RegExpExecArray | null;

    while ((match = iconRegex.exec(html)) !== null) lineIds.push(match[1]);
    while ((match = statusRegex.exec(html)) !== null) statuses.push(match[1].trim().toLowerCase());

    const statusLabels: Record<string, string> = {
      disponible: 'Normal',
      detenido: 'Detenido',
      parcial: 'Parcial',
      demorado: 'Demorado',
    };
    const lines = lineIds.map((id, index) => ({
      name: `L${id.replace('l', '').toUpperCase()}`,
      color: LINE_COLORS[id.toLowerCase()] || '#666',
      status: statusLabels[statuses[index]] || statuses[index] || 'Normal',
    }));

    return lines.length > 0 ? { lines, source: 'metro.cl' } : null;
  } catch {
    return null;
  }
}

export const GET: APIRoute = async ({ url, request }) => {
  const rateLimited = checkRateLimit(request, 'transport', 60);
  if (rateLimited) return rateLimited;

  const allowedParams = new Set(['city', 'mode', 'route', 'stop']);
  if ([...url.searchParams.keys()].some(param => !allowedParams.has(param))) {
    return jsonError('Unsupported query parameter', 400);
  }

  const mode = url.searchParams.get('mode');
  if (mode && mode !== 'route-names') return jsonError('Invalid mode', 400);

  const stopId = url.searchParams.get('stop')?.toUpperCase().trim() || undefined;
  const routeId = url.searchParams.get('route')?.trim() || undefined;
  const cityId = (url.searchParams.get('city') || 'santiago').toLowerCase();
  if (cityId !== 'santiago') return jsonError('Only Santiago is supported', 400);
  if (stopId && routeId) return jsonError('Use either stop or route, not both', 400);

  const db = getStopsDB();
  if (stopId && !db.stops[stopId]) return jsonError('Unknown stop', 404);
  if (routeId && !db.routes[routeId]) return jsonError('Unknown route', 404);

  const cacheKey = mode === 'route-names'
    ? 'transport:route-names'
    : stopId
      ? `transport:stop=${stopId}`
      : routeId
        ? `transport:route=${routeId}`
        : `transport:city=${cityId}`;

  const cached = await getCached<Record<string, unknown>>(cacheKey);
  if (cached) {
    return new Response(JSON.stringify(cached), {
      headers: edgeCacheHeaders(mode === 'route-names' ? 3600 : 300),
    });
  }

  if (mode === 'route-names') {
    const data = { routes: Object.keys(db.routes).sort() };
    await setCache(cacheKey, data, 60 * 60 * 1000);
    return new Response(JSON.stringify(data), {
      headers: edgeCacheHeaders(3600),
    });
  }

  let metroResult: { lines: MetroLine[]; source: string } | null = null;
  let stopInfo: Awaited<ReturnType<typeof fetchStopPredictions>> | null = null;
  let predictionError: string | null = null;
  let routeStops: Array<{
    stop_id: string;
    stop_name: string;
    stop_lat: number;
    stop_lon: number;
  }> | null = null;

  if (routeId) {
    routeStops = db.routes[routeId]
      .map(stopId => {
        const stop = db.stops[stopId];
        if (!stop || stop.stop_lat == null || stop.stop_lon == null) return null;
        return {
          stop_id: stopId,
          stop_name: stop.stop_name,
          stop_lat: stop.stop_lat,
          stop_lon: stop.stop_lon,
        };
      })
      .filter((stop): stop is NonNullable<typeof stop> => stop !== null);
  }

  const promises: Promise<void>[] = [];
  if (!routeId && !stopId) promises.push(fetchMetroCl().then(result => { metroResult = result; }));
  if (stopId) {
    promises.push(
      fetchStopPredictions(stopId)
        .then(result => { stopInfo = result; })
        .catch((error: unknown) => {
          predictionError = error instanceof Error && error.message.includes('timeout')
            ? 'red.cl no responde'
            : error instanceof Error ? error.message : 'Error al consultar paradero';
        }),
    );
  }
  await Promise.allSettled(promises);

  const data = {
    city: cityId,
    name: 'Santiago',
    metro: metroResult,
    updatedAt: Date.now(),
    stopInfo,
    predictionError,
    routeStops,
  };
  await setCache(cacheKey, data, 5 * 60 * 1000);

  return new Response(JSON.stringify(data), {
    headers: edgeCacheHeaders(300),
  });
};
