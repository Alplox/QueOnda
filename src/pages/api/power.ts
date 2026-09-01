import type { APIRoute } from 'astro';
import { getCached, setCache, getStaleCached, dedupeFetch, edgeCacheHeaders } from '../../lib/cache';
import { comunaCoords } from '../../lib/comunas-coords';
import { parseChileLocal } from '../../lib/chile-time';

const CACHE_KEY = 'power';
const CACHE_TTL = 15 * 60 * 1000;

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

export const GET: APIRoute = async () => {
  const cached = await getCached<Record<string, unknown>>(CACHE_KEY);
  if (cached) {
    return new Response(JSON.stringify(cached), {
      headers: edgeCacheHeaders(300),
    });
  }

  try {
    const data = await dedupeFetch(CACHE_KEY, async () => {
      const [series, nacional] = await Promise.all([
        postSec<HourPoint[]>('Get'),
        postSec<{ CLIENTES: number }[]>('GetClientesNacional'),
      ]);
      const last = series[series.length - 1];
      if (!last) throw new Error('SEC: empty series');

      const regiones = await postSec<RegionPoint[]>('GetPorFecha', {
        anho: last.anho, mes: last.mes, dia: last.dia, hora: last.hora,
      });

      const byRegion = new Map<string, number>();
      const comunas = [];
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

    return new Response(JSON.stringify(data), {
      headers: edgeCacheHeaders(300),
    });
  } catch (err) {
    const stale = await getStaleCached<Record<string, unknown>>(CACHE_KEY);
    if (stale) {
      return new Response(JSON.stringify({ ...stale, stale: true }), {
        headers: edgeCacheHeaders(60),
      });
    }
    return new Response(
      JSON.stringify({ affected: null, total: 0, updatedAt: null, stale: true, error: 'SEC no disponible' }),
      { status: 502, headers: edgeCacheHeaders(60) },
    );
  }
};
