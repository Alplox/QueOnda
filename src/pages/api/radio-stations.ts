import type { APIRoute } from 'astro';
import { fetchChannels } from '../../lib/channels';
import { extractRadios, fetchRadioBrowserStations, FALLBACK_RADIOS } from '../../lib/radios';
import type { RadioStation } from '../../lib/radios';
import { getCached, setCache } from '../../lib/cache';

const CACHE_TTL = 60 * 60 * 1000;
const CACHE_KEY = 'radio-stations';

interface CacheData {
  stations: RadioStation[];
  tags: string[];
  states: string[];
  stateCounts: Record<string, number>;
}

export const GET: APIRoute = async () => {
  const cached = await getCached<CacheData>(CACHE_KEY);
  if (cached) {
    return new Response(JSON.stringify({ ...cached, total: cached.stations.length }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let stations: RadioStation[] = [];
  let tags: string[] = [];
  let states: string[] = [];
  let stateCounts: Record<string, number> = {};

  try {
    const result = await fetchRadioBrowserStations();
    stations = result.stations;
    tags = result.tags;
    states = result.states;
    stateCounts = result.stateCounts;
  } catch {
    stations = [];
  }

  if (stations.length === 0) {
    try {
      const data = await fetchChannels();
      stations = extractRadios(data.channels || []);
    } catch {
      stations = [];
    }
  }

  if (stations.length === 0) {
    stations = FALLBACK_RADIOS;
  }

  await setCache(CACHE_KEY, { stations, tags, states, stateCounts }, CACHE_TTL);

  return new Response(JSON.stringify({ stations, tags, states, stateCounts, total: stations.length }), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600',
    },
  });
};
