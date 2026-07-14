import { useEffect, useState, useCallback } from 'react';
import { RadioPlayer } from './RadioPlayer';
import type { RadioStation } from '../../lib/radios';
import { FALLBACK_RADIOS } from '../../lib/radios';
import { idbGet, idbSet } from '../../lib/idb-cache';

const IDB_KEY = 'radio-stations';
const IDB_TTL = 24 * 60 * 60 * 1000; // 24 hours

const RADIO_BROWSER_URL = 'https://de1.api.radio-browser.info/json/stations/search?limit=500&countrycode=CL&lastcheckok=1&hidebroken=true&order=clickcount&reverse=true';

const STATE_NORMALIZE: Record<string, string> = {
  'santiago': 'Santiago', 'santiago de chile': 'Santiago', 'santiago, región metropolitana': 'Santiago',
  'viña del mar': 'Viña del Mar', 'concepción': 'Concepción', 'temuco': 'Temuco', 'temuco, araucanía': 'Temuco',
  'chillán': 'Chillán', 'chillán, ñuble': 'Chillán', 'región del maule': 'Maule', 'biobío': 'Biobío',
  'tarapaca': 'Tarapacá', 'ohiggins': "O'Higgins", 'región de los ríos': 'Los Ríos', 'aysén': 'Aysén',
  'la araucanía': 'Araucanía', 'araucanía': 'Araucanía', 'valparaíso': 'Valparaíso', 'atacama': 'Atacama',
  'antofagasta': 'Antofagasta', 'arica': 'Arica', 'coquimbo': 'Coquimbo', 'iquique': 'Iquique',
  'talca': 'Talca', 'curicó': 'Curicó', 'oval': 'Ovalle', 'lautaro': 'Lautaro',
  'san felipe': 'San Felipe', 'quillota': 'Quillota',
};

const STATE_ORDER = [
  'Arica', 'Tarapacá', 'Iquique', 'Antofagasta', 'Atacama', 'Coquimbo',
  'Valparaíso', 'Viña del Mar', 'Quillota', 'San Felipe', 'Santiago',
  "O'Higgins", 'Maule', 'Curicó', 'Talca', 'Ñuble', 'Chillán',
  'Biobío', 'Concepción', 'Araucanía', 'Temuco', 'Lautaro', 'Los Ríos', 'Aysén',
];
const STATE_ORDER_IDX = Object.fromEntries(STATE_ORDER.map((s, i) => [s, i]));

function normalizeState(state: string): string {
  const key = state.trim().toLowerCase();
  return STATE_NORMALIZE[key] || state.replace(/\b\w/g, c => c.toUpperCase());
}

function stateSortKey(state: string): [number, string] {
  const idx = STATE_ORDER_IDX[state];
  return idx !== undefined ? [0, String(idx).padStart(2, '0')] : [1, state];
}

function loadFavorites(): Record<string, true> {
  try { return JSON.parse(localStorage.getItem('radio-favorites') || '{}'); } catch { return {}; }
}

function saveFavorites(fav: Record<string, true>) {
  try { localStorage.setItem('radio-favorites', JSON.stringify(fav)); } catch {}
}

async function fetchStationsDirectly(): Promise<{ stations: RadioStation[]; tags: string[]; states: string[]; stateCounts: Record<string, number> }> {
  const res = await fetch(RADIO_BROWSER_URL, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`radio-browser ${res.status}`);
  const raw: Array<{ stationuuid: string; name: string; url_resolved: string; homepage: string; favicon: string; codec: string; hls: number; tags: string; state: string }> = await res.json();

  const stations: RadioStation[] = raw
    .filter(s => s.url_resolved)
    .map(s => ({
      id: s.stationuuid,
      name: s.name.trim(),
      logo: s.favicon ? s.favicon.replace(/^http:\/\//, 'https://') : null,
      signals: [{ type: (s.hls === 1 ? 'hls' : 'audio') as 'hls' | 'audio', url: s.url_resolved, label: s.codec || (s.hls === 1 ? 'HLS' : 'AUDIO') }],
      streamUrl: s.url_resolved,
      website: s.homepage || '',
      tags: s.tags ? s.tags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean) : [],
      state: s.state ? normalizeState(s.state) : undefined,
    }));

  const tagCount = new Map<string, number>();
  const stateCount = new Map<string, number>();
  for (const s of stations) {
    for (const tag of s.tags) tagCount.set(tag, (tagCount.get(tag) || 0) + 1);
    if (s.state) stateCount.set(s.state, (stateCount.get(s.state) || 0) + 1);
  }

  const tags = [...tagCount.entries()].filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]).map(([t]) => t).slice(0, 20);
  const sortedStates = [...stateCount.entries()].filter(([, c]) => c >= 2).sort((a, b) => {
    const ka = stateSortKey(a[0]), kb = stateSortKey(b[0]);
    return ka[0] - kb[0] || ka[1].localeCompare(kb[1]);
  });
  const stateCounts: Record<string, number> = {};
  for (const [s, c] of sortedStates) stateCounts[s] = c;

  return { stations, tags, states: sortedStates.map(([s]) => s), stateCounts };
}

export function ClientRadios() {
  const [stations, setStations] = useState<RadioStation[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [states, setStates] = useState<string[]>([]);
  const [stateCounts, setStateCounts] = useState<Record<string, number>>({});
  const [favorites, setFavorites] = useState<Record<string, true>>(loadFavorites);

  useEffect(() => {
    let cancelled = false;
    let resolved = false;

    type RadioCache = { stations: RadioStation[]; tags: string[]; states: string[]; stateCounts: Record<string, number> };

    // Phase 0: IDB cache → instant render
    idbGet<RadioCache>(IDB_KEY).then(cached => {
      if (cancelled || !cached?.data?.stations?.length) return;
      resolved = true;
      setStations(cached.data.stations);
      setTags(cached.data.tags);
      setStates(cached.data.states);
      setStateCounts(cached.data.stateCounts);
    });

    // Phase 1: background fetch → update
    fetchStationsDirectly()
      .then(data => {
        if (cancelled) return;
        idbSet(IDB_KEY, data, IDB_TTL);
        setStations(data.stations);
        setTags(data.tags);
        setStates(data.states);
        setStateCounts(data.stateCounts);
      })
      .catch(() => {
        if (!cancelled && !resolved) setStations(FALLBACK_RADIOS);
      });
    return () => { cancelled = true; };
  }, []);

  const handleToggleFavorite = useCallback((id: string) => {
    setFavorites(prev => {
      const next = { ...prev };
      if (next[id]) delete next[id]; else next[id] = true;
      saveFavorites(next);
      return next;
    });
  }, []);

  return (
    <RadioPlayer
      stations={stations}
      tags={tags}
      states={states}
      stateCounts={stateCounts}
      favorites={favorites}
      onToggleFavorite={handleToggleFavorite}
    />
  );
}
