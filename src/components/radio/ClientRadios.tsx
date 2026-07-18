import { useEffect, useState, useCallback } from 'react';
import { RadioPlayer } from './RadioPlayer';
import type { RadioStation } from '../../lib/radios';
import { FALLBACK_RADIOS } from '../../lib/radios';
import { idbGet, idbSet } from '../../lib/idb-cache';

const IDB_KEY = 'radio-stations';
const IDB_TTL = 24 * 60 * 60 * 1000; // 24 hours

function loadFavorites(): Record<string, true> {
  try { return JSON.parse(localStorage.getItem('radio-favorites') || '{}'); } catch { return {}; }
}

function saveFavorites(fav: Record<string, true>) {
  try { localStorage.setItem('radio-favorites', JSON.stringify(fav)); } catch {}
}

async function fetchStationsApi(): Promise<{ stations: RadioStation[]; tags: string[]; states: string[]; stateCounts: Record<string, number> } | null> {
  try {
    const res = await fetch('/api/radio-stations', { signal: AbortSignal.timeout(15000) });
    if (res.ok) return await res.json();
  } catch {}
  return null;
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

    // Phase 1: background fetch → update (server-cached endpoint)
    fetchStationsApi()
      .then(data => {
        if (cancelled || !data) return;
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
