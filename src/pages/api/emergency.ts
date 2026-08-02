import type { APIRoute } from 'astro';
import { dedupeFetch, edgeCacheHeaders } from '../../lib/cache';
import { BROWSER_UA } from '../../lib/ua';

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

const MIN_MAGNITUDE = 1.0;

function getSeverity(mag: number): 'low' | 'moderate' | 'high' | 'critical' {
  if (mag >= 6) return 'critical';
  if (mag >= 5) return 'high';
  if (mag >= 4) return 'moderate';
  return 'low';
}

function parseDate(dateStr: string): number {
  return new Date(dateStr).getTime();
}

async function fetchGaelCloud(): Promise<EmergencyItem[]> {
  try {
    const chileRes = await fetch('https://api.gael.cloud/general/public/sismos', {
      signal: AbortSignal.timeout(10000),
    });
    if (!chileRes.ok) throw new Error(`API returned ${chileRes.status}`);
    const chileData = await chileRes.json() as ChileanEarthquake[];
    const filteredData = chileData.filter(eq => parseFloat(eq.Magnitud) >= MIN_MAGNITUDE);
    filteredData.sort((a, b) => parseDate(b.Fecha) - parseDate(a.Fecha));

    const items: EmergencyItem[] = [];
    for (const eq of filteredData.slice(0, 25)) {
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
        mag, place: eq.RefGeografica, depth,
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
        time, url: eq.info || '',
        severity: getSeverity(mag),
        mag, place: eq.place, depth,
      });
    }
    items.sort((a, b) => b.time - a.time);
    return items.slice(0, 25);
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

// Strip emoji, hashtags, and the repeated "SENAPREDInforma ¡ATENCIÓN!" boilerplate
function stripBoilerplate(text: string): string {
  return text
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/#?SENAPREDInforma|#\w+|¡ATENCIÓN!/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// Trim long post → readable model title
function compactAlert(text: string): string {
  const clean = stripBoilerplate(text);
  const region = clean.match(/(?:de la |del |de )?Regi[oó]n(?: del? | de la | )?[A-Za-z\s]+/i);
  const regionStr = region ? `. ${region[0].trim()}` : '';
  const core = clean.slice(0, 70).split(/(?=Regi[oó]n)/i)[0];
  return `${core}${regionStr}`.replace(/\s{2,}/g, ' ').trim().slice(0, 90);
}

// Keyword → severity: SAE alerts escalate by urgency
function senapredSeverity(text: string): 'low' | 'moderate' | 'high' | 'critical' {
  const t = text.toLowerCase();
  if (/desborde|aluvión|aluvin|\bevacuar\b|evacue|evacuación/i.test(t)) return 'critical';
  if (/crecida|incendio|sae|alerta/.test(t)) return 'high';
  if (/preventiv|revision|monitoreo/.test(t)) return 'moderate';
  return 'low';
}

async function fetchSenapred(): Promise<EmergencyItem[]> {
  try {
    const res = await fetch('https://t.me/s/SenapredChile', {
      headers: { 'user-agent': BROWSER_UA },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`Telegram returned ${res.status}`);
    const html = await res.text();

    // t.me web preview: each post is a <div class="tgme_widget_message_wrap"> wrapper
    const items: EmergencyItem[] = [];

    // ponytail: split on the post wrapper marker, then read its data-post/<time>/text
    const parts = html.split(/(?=<div class="tgme_widget_message_wrap js-widget_message_wrap">)/g).slice(1);
    for (const part of parts) {
      const postMatch = part.match(/data-post="SenapredChile\/(\d+)"/);
      if (!postMatch) continue;
      const timeMatch = part.match(/<time datetime="([^"]+)"/);
      const textMatch = part.match(/<div class="tgme_widget_message_text js-message_text"[^>]*>([\s\S]*?)<\/div>/);
      if (!timeMatch || !textMatch) continue;

      const time = Date.parse(timeMatch[1]);
      const raw = textMatch[1]
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&#\d+;/g, (m) => String.fromCharCode(Number(m.slice(2, -1))))
        .replace(/&(\w+);/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (!raw) continue;

      // only surface actionable emergency posts, not streams/links
      if (!/SENAPREDInforma|SAE|evacu|evite|desborde|crecida|atención|alerta/i.test(raw)) continue;

      items.push({
        id: `senapred-${postMatch[1]}`,
        type: 'alert',
        title: compactAlert(raw),
        description: stripBoilerplate(raw).slice(0, 240),
        time: time || Date.now(),
        url: `https://t.me/SenapredChile/${postMatch[1]}`,
        severity: senapredSeverity(raw),
      });
    }

    items.sort((a, b) => b.time - a.time);
    return items.slice(0, 12);
  } catch (err) {
    console.error('Emergency: SENAPRED Telegram fetch failed:', err);
    return [];
  }
}

export const GET: APIRoute = async () => {
  const { items, senapred } = await dedupeFetch<{ items: EmergencyItem[]; senapred: EmergencyItem[] }>('emergency', async () => {
    let result = await fetchGaelCloud();
    if (result.length === 0) result = await fetchBoostr();
    if (result.length === 0) result = await fetchUSGS();
    // Most recent first so the latest event is always visible (matches senapred ordering)
    result.sort((a, b) => b.time - a.time);
    return {
      items: result.slice(0, 10),
      senapred: await fetchSenapred(), // independent: SAE alerts (official telegram), not earthquakes
    };
  });

  return new Response(JSON.stringify({ items, senapred }), {
    headers: edgeCacheHeaders(300),
  });
};
