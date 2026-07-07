import type { APIRoute } from 'astro';
import { getCached, setCache } from '../../lib/cache';

interface ChileanEarthquake {
  Fecha: string;
  Profundidad: string;
  Magnitud: string;
  RefGeografica: string;
  FechaUpdate: string;
}

interface BoostrEarthquake {
  date: string;
  hour: string;
  place: string;
  magnitude: string;
  depth: string;
  latitude: string;
  longitude: string;
  image: string;
  info: string;
}

interface USGSEarthquake {
  id: string;
  properties: {
    mag: number;
    place: string;
    time: number;
    url: string;
  };
  geometry: {
    coordinates: [number, number, number];
  };
}

interface EmergencyItem {
  id: string;
  type: 'earthquake' | 'alert';
  title: string;
  description: string;
  time: number;
  url: string;
  severity: 'low' | 'moderate' | 'high' | 'critical';
  mag?: number;
  place?: string;
  depth?: number;
}

const CACHE_TTL = 5 * 60 * 1000;
const CACHE_KEY = 'emergency';

const MIN_MAGNITUDE = 5.0;

function getSeverity(mag: number): 'low' | 'moderate' | 'high' | 'critical' {
  if (mag >= 6) return 'critical';
  if (mag >= 5) return 'high';
  if (mag >= 4) return 'moderate';
  return 'low';
}

function parseDate(dateStr: string): number {
  // Format: "2026-06-07 00:18:22"
  return new Date(dateStr).getTime();
}

async function fetchGaelCloud(): Promise<EmergencyItem[]> {
  try {
    const chileRes = await fetch('https://api.gael.cloud/general/public/sismos', {
      signal: AbortSignal.timeout(10000),
    });
    
    if (!chileRes.ok) throw new Error(`API returned ${chileRes.status}`);
    
    const chileData = await chileRes.json() as ChileanEarthquake[];

    // Sort by date (most recent first)
    chileData.sort((a, b) => parseDate(b.Fecha) - parseDate(a.Fecha));

    // Filter by minimum magnitude
    const filteredData = chileData.filter(eq => parseFloat(eq.Magnitud) >= MIN_MAGNITUDE);

    const items: EmergencyItem[] = [];
    for (const eq of filteredData.slice(0, 10)) {
      const mag = parseFloat(eq.Magnitud);
      const depth = parseFloat(eq.Profundidad);
      items.push({
        id: `${eq.Fecha}-${eq.RefGeografica}`,
        type: 'earthquake',
        title: `M ${mag.toFixed(1)} — ${eq.RefGeografica}`,
        description: `${eq.RefGeografica}. Profundidad: ${depth} km.`,
        time: parseDate(eq.Fecha),
        url: 'https://www.csn.uchile.cl/',
        severity: getSeverity(mag),
        mag: mag,
        place: eq.RefGeografica,
        depth: depth,
      });
    }
    return items;
  } catch (err) {
    console.error('Emergency: Gael Cloud API fetch failed:', err);
    return [];
  }
}

async function fetchBoostr(): Promise<EmergencyItem[]> {
  try {
    const res = await fetch('https://api.boostr.cl/earthquakes/recent.json', {
      signal: AbortSignal.timeout(10000),
    });
    
    if (!res.ok) throw new Error(`API returned ${res.status}`);
    
    const json = await res.json();
    if (json.status !== 'success' || !Array.isArray(json.data)) throw new Error('Boostr: invalid response');
    
    const data = json.data as BoostrEarthquake[];
    
    const items: EmergencyItem[] = [];
    for (const eq of data) {
      const mag = parseFloat(eq.magnitude);
      if (isNaN(mag) || mag < MIN_MAGNITUDE) continue;
      const depth = parseFloat(eq.depth.replace(' km', ''));
      const time = new Date(`${eq.date} ${eq.hour}`).getTime();
      if (isNaN(time)) continue;
      items.push({
        id: `${eq.date}-${eq.hour}-${eq.place}`,
        type: 'earthquake',
        title: `M ${mag.toFixed(1)} — ${eq.place}`,
        description: `${eq.place}. Profundidad: ${depth} km.`,
        time: time,
        url: eq.info || '',
        severity: getSeverity(mag),
        mag: mag,
        place: eq.place,
        depth: depth,
      });
    }
    
    items.sort((a, b) => b.time - a.time);
    return items.slice(0, 10);
  } catch (err) {
    console.error('Emergency: Boostr API fetch failed:', err);
    return [];
  }
}

async function fetchUSGS(): Promise<EmergencyItem[]> {
  try {
    const res = await fetch(
      'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson',
      { signal: AbortSignal.timeout(10000) }
    );
    const data = await res.json() as { features: Array<{ properties: USGSEarthquake['properties']; geometry: USGSEarthquake['geometry']; id: string }> };

    return data.features
      .filter(f => {
        const place = f.properties.place || '';
        return (f.properties.mag >= MIN_MAGNITUDE) && 
               (place.toLowerCase().includes('chile') || place.toLowerCase().includes('south america'));
      })
      .slice(0, 20)
      .map(f => ({
        id: f.id,
        type: 'earthquake' as const,
        title: `M ${f.properties.mag.toFixed(1)} — ${f.properties.place}`,
        description: f.properties.place,
        time: f.properties.time,
        url: f.properties.url,
        severity: getSeverity(f.properties.mag),
        mag: f.properties.mag,
        place: f.properties.place,
        depth: f.geometry.coordinates[2],
      }));
  } catch (err) {
    console.error('Emergency: USGS API fetch failed:', err);
    return [];
  }
}

export const GET: APIRoute = async () => {
  const cached = await getCached<EmergencyItem[]>(CACHE_KEY);
  if (cached) {
    return new Response(JSON.stringify({ items: cached, cached: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let items: EmergencyItem[] = [];

  items = await fetchGaelCloud();

  if (items.length === 0) {
    items = await fetchBoostr();
  }

  if (items.length === 0) {
    items = await fetchUSGS();
  }

  items.sort((a, b) => b.time - a.time);

  await setCache(CACHE_KEY, items, CACHE_TTL);

  return new Response(JSON.stringify({ items, cached: false }), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=300',
    },
  });
};
