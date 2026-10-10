import type { APIRoute } from 'astro';
import { getCached, setCache, setLastGood, getStaleCached, dedupeFetch, edgeCacheHeaders, noStoreHeaders } from '../../lib/cache';
import { checkRateLimit } from '../../lib/rate-limit';
import { comunaCoords } from '../../lib/comunas-coords';
import { parseChileLocal } from '../../lib/chile-time';

const CACHE_KEY = 'power';
const CACHE_TTL = 15 * 60 * 1000;
// SEC has no alternative public source, so the durable snapshot is what keeps
// the widget alive through an outage. 6h is still "today's picture" for a
// rolling hourly series and is short enough that a stale banner stays honest.
const LAST_GOOD_TTL = 6 * 60 * 60 * 1000;
// Forced refresh (bypass cache) budget: 1 request per IP per 2 min — SEC has no
// fallback chain, so unthrottled bypass would hammer their single endpoint.
const FRESH_WINDOW_MS = 2 * 60 * 1000;

const BASE = 'https://apps.sec.cl/INTONLINEv1/ClientesAfectados/';

interface HourPoint {
  anho: number;
  mes: number;
  dia: number;
  hora: number;
  clientes_afectados: number;
}

interface RegionPoint {
  NOMBRE_REGION: string;
  NOMBRE_COMUNA: string;
  CLIENTES_AFECTADOS: number;
}

async function postSec<T>(endpoint: string, body: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(BASE + endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`SEC ${endpoint} returned ${res.status}`);
  return res.json() as Promise<T>;
}

const pad2 = (n: number) => String(n).padStart(2, '0');
const toMs = (p: HourPoint) =>
  parseChileLocal(`${p.anho}-${pad2(p.mes)}-${pad2(p.dia)} ${pad2(p.hora)}:00:00`);

export const GET: APIRoute = async ({ url, request }) => {
  if ([...url.searchParams.keys()].some(param => param !== 'fresh')) {
    return new Response(JSON.stringify({ error: 'Unsupported query parameter' }), { status: 400 });
  }
  // ?fresh=1 skips every cache tier and hits SEC directly. The distinct query
  // string also gives it a separate CDN edge-cache key, so the bypass is real.
  const fresh = url.searchParams.get('fresh') === '1';
  if (fresh) {
    const rateLimited = checkRateLimit(request, 'power-fresh', 1, FRESH_WINDOW_MS);
    if (rateLimited) return rateLimited;
  } else {
    const cached = await getCached<Record<string, unknown>>(CACHE_KEY);
    if (cached) {
      return new Response(JSON.stringify(cached), {
        headers: edgeCacheHeaders(300),
      });
    }
  }

  // The dedupe key must differ per path: a plain request already in flight (the
  // index.astro pre-warm fires /api/power on every page load) would otherwise
  // be joined by ?fresh=1, which would return the in-flight snapshot instead of
  // actually hitting SEC — defeating the forced refresh.
  const dedupeKey = fresh ? `${CACHE_KEY}:fresh` : CACHE_KEY;

  try {
    const data = await dedupeFetch(dedupeKey, async () => {
      const [series, nacional] = await Promise.all([
        postSec<HourPoint[]>('Get'),
        postSec<{ CLIENTES: number }[]>('GetClientesNacional'),
      ]);
      const last = series[series.length - 1];
      if (!last) throw new Error('SEC: empty series');

      const byRegion = new Map<string, number>();
      const comunas = [];
      // The regional breakdown is a third call on top of the two that already
      // succeeded — losing it must not throw away the national figure and the
      // hourly series with it.
      try {
        const regiones = await postSec<RegionPoint[]>('GetPorFecha', {
          anho: last.anho, mes: last.mes, dia: last.dia, hora: last.hora,
        });
        for (const r of regiones) {
          byRegion.set(r.NOMBRE_REGION, (byRegion.get(r.NOMBRE_REGION) ?? 0) + r.CLIENTES_AFECTADOS);
          const coords = comunaCoords(r.NOMBRE_COMUNA);
          if (coords) {
            comunas.push({
              region: r.NOMBRE_REGION,
              comuna: r.NOMBRE_COMUNA,
              affected: r.CLIENTES_AFECTADOS,
              lat: coords[0],
              lon: coords[1],
            });
          }
        }
      } catch { /* degrade: national + series are still current */ }

      const total = nacional[0]?.CLIENTES ?? 0;
      const affected = last.clientes_afectados;

      return {
        affected,
        total,
        pct: total > 0 ? (affected * 100) / total : 0,
        updatedAt: toMs(last),
        fetchedAt: Date.now(),
        stale: false,
        regions: [...byRegion.entries()]
          .map(([region, n]) => ({ region, affected: n }))
          .sort((a, b) => b.affected - a.affected),
        comunas: comunas.sort((a, b) => b.affected - a.affected),
        series: series.map((p) => ({ t: toMs(p), v: p.clientes_afectados })),
      };
    });

    await setCache(CACHE_KEY, data, CACHE_TTL);
    await setLastGood(CACHE_KEY, data, LAST_GOOD_TTL);

    // Fresh responses get a short edge TTL so a forced refresh isn't served
    // to the next user from the CDN for the full 5 minutes.
    return new Response(JSON.stringify(data), {
      headers: edgeCacheHeaders(fresh ? 60 : 300),
    });
  } catch {
    // Serves the previous snapshot (including the durable 6h one) rather than
    // a hard failure — the widgets already render stale data behind a banner.
    const stale = await getStaleCached<Record<string, unknown>>(CACHE_KEY);
    if (stale) {
      return new Response(JSON.stringify({ ...stale, stale: true }), {
        headers: edgeCacheHeaders(60),
      });
    }
    // no-store: an unreachable SEC for one second must not be cached and
    // replayed to every visitor in the colo.
    return new Response(
      JSON.stringify({ affected: null, total: 0, updatedAt: null, stale: true, error: 'SEC no disponible' }),
      { status: 502, headers: noStoreHeaders() },
    );
  }
};
