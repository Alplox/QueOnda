// SEC "clientes sin suministro" snapshot. Shared by /api/power (live request)
// and /api/cron (pre-warm) so both publish the exact same payload shape.
//
// Besides the national figure and the hourly series, it resolves the client
// base of each affected region (GetClientesRegional) so the widget can fill
// every bar with the real share of that region's clients instead of a rank
// against the largest outage.
import { getCached, setCache } from './cache';
import { comunaCoords } from './comunas-coords';
import { parseChileLocal } from './chile-time';

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

export interface PowerRegion {
  region: string;
  affected: number;
  /** Clientes totales de la región. 0 cuando la SEC no respondió por ella. */
  total: number;
  /** % de los clientes de la región sin suministro. */
  pct: number;
}

export interface PowerComuna {
  region: string;
  comuna: string;
  affected: number;
  lat: number;
  lon: number;
}

export interface PowerSnapshot {
  affected: number;
  total: number;
  pct: number;
  updatedAt: number;
  fetchedAt: number;
  stale: false;
  regions: PowerRegion[];
  comunas: PowerComuna[];
  series: Array<{ t: number; v: number }>;
}

// Client base per region: 16 extra POSTs, so it is cached far longer than the
// outage data — the number of regulated clients moves slowly (new connections).
const REGION_TOTALS_KEY = 'power:region-totals';
const REGION_TOTALS_TTL = 7 * 24 * 60 * 60 * 1000;
// Compiled snapshot (2026-10-19). Sums exactly to the national 8.156.814 that
// GetClientesNacional reports, and covers a cold start when SEC is unreachable.
const REGION_TOTALS_FALLBACK: Record<string, number> = {
  'Arica y Parinacota': 89120,
  Tarapaca: 122936,
  Antofagasta: 212959,
  Atacama: 122933,
  Coquimbo: 382107,
  Valparaiso: 1008676,
  Metropolitana: 2917149,
  'O`Higgins': 458943,
  Maule: 581839,
  Ñuble: 275528,
  Biobio: 733596,
  'La Araucania': 489967,
  'Los Rios': 195986,
  'Los Lagos': 436261,
  Aysén: 51770,
  Magallanes: 77044,
};

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

/** Client base of each region, long-cached; falls back to the compiled table. */
async function regionTotals(names: string[]): Promise<Record<string, number>> {
  const cached = await getCached<Record<string, number>>(REGION_TOTALS_KEY);
  if (cached) return { ...REGION_TOTALS_FALLBACK, ...cached };

  const entries = await Promise.all(
    names.map(async (name) => {
      try {
        const res = await postSec<Array<{ CLIENTES: number }>>('GetClientesRegional', { region: name });
        return [name, res[0]?.CLIENTES ?? 0] as const;
      } catch {
        return [name, 0] as const;
      }
    }),
  );

  const fetched: Record<string, number> = {};
  for (const [name, n] of entries) if (n > 0) fetched[name] = n;
  // Only persist a fully successful read: a partial answer would pin missing
  // regions to 0 % for a whole week.
  if (entries.length > 0 && entries.every(([, n]) => n > 0)) {
    await setCache(REGION_TOTALS_KEY, fetched, REGION_TOTALS_TTL);
  }
  return { ...REGION_TOTALS_FALLBACK, ...fetched };
}

/** Builds the snapshot from SEC. Throws when SEC itself is unreachable/empty. */
export async function fetchPowerSnapshot(): Promise<PowerSnapshot> {
  const [series, nacional] = await Promise.all([
    postSec<HourPoint[]>('Get'),
    postSec<Array<{ CLIENTES: number }>>('GetClientesNacional'),
  ]);
  const last = series[series.length - 1];
  if (!last) throw new Error('SEC: empty series');

  const byRegion = new Map<string, number>();
  const comunas: PowerComuna[] = [];
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

  const totals = await regionTotals([...byRegion.keys()]);
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
      .map(([region, n]) => {
        const base = totals[region] ?? 0;
        return {
          region,
          affected: n,
          total: base,
          pct: base > 0 ? (n * 100) / base : 0,
        };
      })
      .sort((a, b) => b.affected - a.affected),
    comunas: comunas.sort((a, b) => b.affected - a.affected),
    series: series.map((p) => ({ t: toMs(p), v: p.clientes_afectados })),
  };
}
