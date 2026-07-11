import { useEffect, useState, useCallback } from 'react';
import { RadioPlayer } from './RadioPlayer';
import type { RadioStation } from '../../lib/radios';

function loadFavorites(): Record<string, true> {
  try {
    return JSON.parse(localStorage.getItem('radio-favorites') || '{}');
  } catch {
    return {};
  }
}

function saveFavorites(fav: Record<string, true>) {
  try {
    localStorage.setItem('radio-favorites', JSON.stringify(fav));
  } catch {}
}

export function ClientRadios() {
  const [stations, setStations] = useState<RadioStation[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [states, setStates] = useState<string[]>([]);
  const [stateCounts, setStateCounts] = useState<Record<string, number>>({});
  const [favorites, setFavorites] = useState<Record<string, true>>(loadFavorites);

  useEffect(() => {
    fetch('/api/radio-stations')
      .then((r) => r.json())
      .then((data) => {
        setStations(data.stations || []);
        setTags(data.tags || []);
        setStates(data.states || []);
        setStateCounts(data.stateCounts || {});
      })
      .catch(() => {});
  }, []);

  const handleToggleFavorite = useCallback((id: string) => {
    setFavorites(prev => {
      const next = { ...prev };
      if (next[id]) {
        delete next[id];
      } else {
        next[id] = true;
      }
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
