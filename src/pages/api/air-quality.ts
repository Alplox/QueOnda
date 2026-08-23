import type { APIRoute } from 'astro';
import { dedupeFetch, edgeCacheHeaders } from '../../lib/cache';
import { BROWSER_UA } from '../../lib/ua';
import { airStatusFromPm25 } from '../../lib/air-quality';
import type { AirData, AirRow, AirStation } from '../../lib/air-quality';

const SINCA_URL = 'https://sinca.mma.gob.cl/index.php/json/listadomapa2k19/';

interface SincaRow {
  value?: number | string;
  status?: string;
  statuscode?: number;
  icap?: number;
  color?: string;
  datetime?: string;
}

interface SincaParam {
  code?: string;
  tableRow?: SincaRow;
}

interface SincaStation {
  key?: string | number;
  nombre?: string;
  comuna?: string;
  region?: string;
  regionindex?: number;
  latitud?: number;
  longitud?: number;
  realtime?: SincaParam[];
}

function parseSinca(raw: SincaStation[]): AirStation[] {
  const out: AirStation[] = [];
  for (const s of raw) {
    const lat = Number(s.latitud);
    const lon = Number(s.longitud);
    if (!s.nombre || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const st: AirStation = {
      key: String(s.key ?? ''),
      nombre: s.nombre,
      comuna: s.comuna || s.nombre,
      region: (s.region || '').trim(),
      regionIndex: s.regionindex,
      lat,
      lon,
    };
    for (const p of s.realtime ?? []) {
      const r = p.tableRow;
      const v = Number(r?.value);
      if (!r?.status || !r.color || !Number.isFinite(v)) continue;
      const row: AirRow = {
        value: v,
        status: r.status,
        statusCode: r.statuscode ?? 0,
        icap: r.icap,
        color: r.color,
        datetime: r.datetime ?? '',
      };
      if (p.code === 'PM25') st.pm25 = row;
      else if (p.code === 'PM10') st.pm10 = row;
    }
    if (st.pm25) st.param = 'PM25';
    else if (st.pm10) st.param = 'PM10';
    if (st.pm25 || st.pm10) out.push(st);
  }
  return out;
}

// Fallback cities (model CAMS via Open-Meteo) — one multi-coordinate request,
// ordered north → south (index doubles as regionIndex)
const CITIES: Array<[string, string, number, number]> = [
  ['Arica', 'Región de Arica y Parinacota', -18.48, -70.32],
  ['Iquique', 'Región de Tarapacá', -20.21, -70.15],
  ['Antofagasta', 'Región de Antofagasta', -23.65, -70.4],
  ['Copiapó', 'Región de Atacama', -27.37, -70.33],
  ['La Serena', 'Región de Coquimbo', -29.9, -71.25],
  ['Valparaíso', 'Región de Valparaíso', -33.05, -71.62],
  ['Santiago', 'Región Metropolitana', -33.45, -70.66],
  ['Rancagua', "Región del Libertador Bernardo O'Higgins", -34.17, -70.74],
  ['Talca', 'Región del Maule', -35.43, -71.66],
  ['Chillán', 'Región de Ñuble', -36.61, -72.1],
  ['Concepción', 'Región del Biobío', -36.83, -73.05],
  ['Los Ángeles', 'Región del Biobío', -37.47, -72.35],
  ['Temuco', 'Región de La Araucanía', -38.74, -72.6],
  ['Valdivia', 'Región de Los Ríos', -39.81, -73.25],
  ['Osorno', 'Región de Los Lagos', -40.57, -73.15],
  ['Puerto Montt', 'Región de Los Lagos', -41.47, -72.94],
  ['Coyhaique', 'Región de Aysén', -45.57, -72.07],
  ['Punta Arenas', 'Región de Magallanes', -53.16, -70.91],
];

async function fetchOpenMeteo(): Promise<AirStation[]> {
  const lat = CITIES.map((c) => c[2]).join(',');
  const lon = CITIES.map((c) => c[3]).join(',');
  const res = await fetch(
    `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&current=pm2_5&timezone=auto`,
    { signal: AbortSignal.timeout(10000) },
  );
  if (!res.ok) throw new Error(`open-meteo ${res.status}`);
  const json = await res.json();
  // Multi-coordinate responses come back as ONE object with space-separated
  // values per field ("11.1 6.1 13.4"), not as an array of objects.
  const entries: Array<Record<string, any>> = Array.isArray(json) ? json : [json];
  const out: AirStation[] = [];
  let cityIdx = 0;
  for (const entry of entries) {
    const values = String(entry?.current?.pm2_5 ?? '').trim().split(/\s+/).map(Number);
    const when = typeof entry?.current?.time === 'string' ? entry.current.time.split(' ')[0] : '';
    for (const v of values) {
      const [nombre, region, cLat, cLon] = CITIES[cityIdx++] ?? [];
      if (!nombre || !Number.isFinite(v)) continue;
      out.push({
        key: `om-${cityIdx}`,
        nombre,
        comuna: nombre,
        region,
        regionIndex: cityIdx,
        param: 'PM25',
        lat: cLat,
        lon: cLon,
        pm25: { value: Math.round(v * 10) / 10, ...airStatusFromPm25(v), datetime: when },
      });
    }
  }
  if (out.length === 0) throw new Error('open-meteo empty');
  return out;
}

export const GET: APIRoute = async () => {
  const data = await dedupeFetch('air-quality', async (): Promise<AirData> => {
    try {
      const res = await fetch(SINCA_URL, {
        headers: { 'User-Agent': BROWSER_UA },
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) throw new Error(`sinca ${res.status}`);
      const stations = parseSinca(await res.json());
      if (stations.length === 0) throw new Error('sinca empty');
      return { source: 'sinca', updatedAt: Date.now(), stations };
    } catch {
      // ponytail: SINCA down → Open-Meteo CAMS model for reference cities; stale CDN cache covers the gap between both
      return { source: 'open-meteo', updatedAt: Date.now(), stations: await fetchOpenMeteo() };
    }
  });

  return new Response(JSON.stringify(data), {
    headers: edgeCacheHeaders(1800),
  });
};
