import type { APIRoute } from 'astro';
import { dedupeFetch, edgeCacheHeaders } from '../../lib/cache';
import { comunaCoords } from '../../lib/comunas-coords';

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

const toMs = (p: HourPoint) => new Date(p.anho, p.mes - 1, p.dia, p.hora).getTime();

export const GET: APIRoute = async () => {
  const data = await dedupeFetch('power', async () => {
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
      regions: [...byRegion.entries()]
        .map(([region, n]) => ({ region, affected: n }))
        .sort((a, b) => b.affected - a.affected),
      comunas: comunas.sort((a, b) => b.affected - a.affected),
      series: series.map((p) => ({ t: toMs(p), v: p.clientes_afectados })),
    };
  });

  return new Response(JSON.stringify(data), {
    headers: edgeCacheHeaders(900),
  });
};
