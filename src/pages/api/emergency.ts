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
  lat?: number;
  lon?: number;
}

const MIN_MAGNITUDE = 1.0;

function getSeverity(mag: number): 'low' | 'moderate' | 'high' | 'critical' {
  if (mag >= 6) return 'critical';
  if (mag >= 5) return 'high';
  if (mag >= 4) return 'moderate';
  return 'low';
}

// Gael/Boostr send "Fecha" as Chile local time with no offset; Workers run UTC,
// so a naive parse shifts every sismo by the TZ offset (looks "stale" by ~4h).
const CHILE_TZ = 'America/Santiago';
const chileParts = new Intl.DateTimeFormat('en-US', {
  timeZone: CHILE_TZ, hour12: false, hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
});
// ponytail: solve epoch = naive - offset(epoch); 2 passes converge (DST-safe)
function parseChileLocal(dateStr: string): number {
  // parse components manually so the result is host-TZ-independent (Workers run UTC)
  const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return Date.parse(dateStr);
  const naive = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  const offset = (epoch: number) => {
    const p = chileParts.formatToParts(new Date(epoch));
    const get = (t: string) => Number(p.find(x => x.type === t)?.value ?? 0);
    return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) - epoch;
  };
  let epoch = naive;
  for (let i = 0; i < 2; i++) epoch = naive - offset(epoch);
  return epoch;
}

async function fetchGaelCloud(): Promise<EmergencyItem[]> {
  let items: EmergencyItem[] = [];
  try {
    const chileRes = await fetch('https://api.gael.cloud/general/public/sismos', {
      signal: AbortSignal.timeout(10000),
    });
    if (!chileRes.ok) throw new Error(`API returned ${chileRes.status}`);
    const chileData = await chileRes.json() as ChileanEarthquake[];
    const filteredData = chileData.filter(eq => parseFloat(eq.Magnitud) >= MIN_MAGNITUDE);
    filteredData.sort((a, b) => parseChileLocal(b.Fecha) - parseChileLocal(a.Fecha));

    for (const eq of filteredData.slice(0, 25)) {
      const mag = parseFloat(eq.Magnitud);
      const depth = parseFloat(eq.Profundidad);
      items.push({
        id: `${eq.Fecha}-${eq.RefGeografica}`,
        type: 'earthquake',
        title: `M ${mag.toFixed(1)} — ${eq.RefGeografica}`,
        description: `${eq.RefGeografica}. Profundidad: ${depth} km.`,
        time: parseChileLocal(eq.Fecha),
        url: 'https://www.csn.uchile.cl/',
        severity: getSeverity(mag),
        mag, place: eq.RefGeografica, depth,
      });
    }
  } catch (err) {
    console.error('Emergency: Gael Cloud API fetch failed:', err);
    return [];
  }

  // Gael sends no coordinates; Boostr serves the same CSN data with lat/lon,
  // so attach them by matching the Chile-local timestamp.
  const candidates: Array<{ time: number; mag: number; lat: number; lon: number }> = [];
  for (const b of await fetchBoostr()) {
    if (b.lat != null && b.lon != null) {
      candidates.push({ time: b.time, mag: b.mag!, lat: b.lat, lon: b.lon });
    }
  }

  // Boostr keeps the site's CSN datacenter live, but if it's down or blocks the
  // Workers IP, fall back to USGS coords so at least the notable quakes get pins.
  if (candidates.length === 0) {
    try {
      for (const u of await fetchUSGS()) {
        if (u.lat != null && u.lon != null) {
          candidates.push({ time: u.time, mag: u.mag!, lat: u.lat, lon: u.lon });
        }
      }
    } catch {
      /* ignore — no coords available at all */
    }
  }

  // Match exactly by epoch first; otherwise pick the nearest event inside a
  // tolerance window (weighting magnitude distance) so one missing or slightly
  // mismatched record never drops coords for the rest of the list.
  const TOL = 10 * 60 * 1000;
  for (const it of items) {
    if (it.time == null) continue;
    const exact = candidates.find((c) => c.time === it.time);
    if (exact) {
      it.lat = exact.lat;
      it.lon = exact.lon;
      continue;
    }
    const near = candidates
      .filter((c) => Math.abs(c.time - it.time) <= TOL)
      .sort((a, b) => {
        const dist = (c: { time: number; mag: number }) =>
          Math.abs(c.time - it.time) + Math.abs(c.mag - (it.mag ?? 0)) * 60_000;
        return dist(a) - dist(b);
      })[0];
    if (near) {
      it.lat = near.lat;
      it.lon = near.lon;
    }
  }
  return items;
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
      const time = parseChileLocal(`${eq.date} ${eq.hour}`);
      if (isNaN(time)) continue;
      const lat = parseFloat(eq.latitude);
      const lon = parseFloat(eq.longitude);
      items.push({
        id: `${eq.date}-${eq.hour}-${eq.place}`,
        type: 'earthquake',
        title: `M ${mag.toFixed(1)} — ${eq.place}`,
        description: `${eq.place}. Profundidad: ${depth} km.`,
        time, url: eq.info || '',
        severity: getSeverity(mag),
        mag, place: eq.place, depth,
        ...(isNaN(lat) || isNaN(lon) ? {} : { lat, lon }),
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
        lat: f.geometry.coordinates[1],
        lon: f.geometry.coordinates[0],
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
  const run = async (): Promise<EmergencyItem[]> => {
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
  };

  // ponytail: a transient Telegram hiccup must not cache senapred: [] for 5 min — retry once
  const first = await run();
  return first.length > 0 ? first : run();
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
