import type { APIRoute } from 'astro';
import { dedupeFetch } from '../../lib/cache';

const DEFAULT_CITIES = [
  { name: 'Santiago', lat: -33.45, lon: -70.67 },
  { name: 'Valparaiso', lat: -33.05, lon: -71.61 },
  { name: 'Concepcion', lat: -36.83, lon: -73.05 },
  { name: 'Antofagasta', lat: -23.65, lon: -70.40 },
  { name: 'La Serena', lat: -29.90, lon: -71.25 },
  { name: 'Temuco', lat: -38.74, lon: -72.59 },
  { name: 'Rancagua', lat: -34.17, lon: -70.75 },
  { name: 'Talca', lat: -35.43, lon: -71.66 },
  { name: 'Chillan', lat: -36.61, lon: -72.10 },
  { name: 'Puerto Montt', lat: -41.47, lon: -72.94 },
  { name: 'Iquique', lat: -20.22, lon: -70.14 },
  { name: 'Punta Arenas', lat: -53.16, lon: -70.91 },
];

const ICAO_MAP: Record<string, string> = {
  'Santiago': 'SCEL',
  'Valparaiso': 'SCVM',
  'Concepcion': 'SCIE',
  'Antofagasta': 'SCFA',
  'La Serena': 'SCSE',
  'Temuco': 'SCQP',
  'Rancagua': 'SCRG',
  'Talca': 'SCCH',
  'Chillan': 'SCHR',
  'Puerto Montt': 'SCTE',
  'Iquique': 'SCDA',
  'Punta Arenas': 'SCCI',
};

async function fetchOpenMeteo(
  cities: { name: string; lat: number; lon: number }[]
): Promise<Record<string, any> | null> {
  const lats = cities.map(c => c.lat.toFixed(2)).join(',');
  const lons = cities.map(c => c.lon.toFixed(2)).join(',');

  const res = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}` +
    `&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m` +
    `&timezone=America/Santiago`,
    { signal: AbortSignal.timeout(8000) }
  );

  if (!res.ok) return null;

  const data = await res.json();
  const results = Array.isArray(data) ? data : [data];
  const weatherMap: Record<string, any> = {};

  results.forEach((r: any, i: number) => {
    const city = cities[i];
    if (!city || !r.current) return;
    weatherMap[city.name] = {
      city: city.name,
      temp: Math.round(r.current.temperature_2m),
      feelsLike: Math.round(r.current.apparent_temperature),
      humidity: r.current.relative_humidity_2m,
      weatherCode: r.current.weather_code,
      wind: r.current.wind_speed_10m,
    };
  });

  return Object.keys(weatherMap).length > 0 ? weatherMap : null;
}

async function fetchGaelCloud(cityName: string): Promise<any | null> {
  const icao = ICAO_MAP[cityName];
  if (!icao) return null;
  try {
    const res = await fetch(`https://api.gael.cloud/general/public/clima/${icao}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.Temp) return null;
    const temp = parseFloat(data.Temp);
    if (isNaN(temp)) return null;
    return {
      city: cityName,
      temp: Math.round(temp),
      feelsLike: Math.round(temp),
      humidity: parseInt(data.Humedad, 10) || 0,
      weatherCode: mapGaelEstado(data.Estado ?? ''),
      wind: 0,
    };
  } catch { return null; }
}

function mapGaelEstado(estado: string): number {
  const c = estado.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (c.includes('despejado') || c.includes('soleado')) return 0;
  if (c.includes('parcial') || c.includes('nubes') || c.includes('nubosidad')) return 2;
  if (c.includes('nublado') || c.includes('cubierto') || c.includes('nubla')) return 3;
  if (c.includes('niebla') || c.includes('bruma')) return 45;
  if (c.includes('llovizna') || c.includes('lluvia')) return 61;
  if (c.includes('tormenta') || c.includes('chubasco') || c.includes('temporal')) return 95;
  if (c.includes('nieve') || c.includes('nevada')) return 71;
  return 2;
}

async function fetchBoostr(cityName: string): Promise<any | null> {
  const icao = ICAO_MAP[cityName];
  if (!icao) return null;
  try {
    const res = await fetch(`https://api.boostr.cl/weather/${icao}.json`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.weather) return null;
    const w = data.weather;
    return {
      city: cityName,
      temp: Math.round(w.temp_c ?? w.temperature),
      feelsLike: Math.round(w.feelslike_c ?? w.feels_like ?? w.temp_c),
      humidity: w.humidity ?? 0,
      weatherCode: mapBoostrCode(w.condition ?? ''),
      wind: w.wind_kph ?? w.wind_speed ?? 0,
    };
  } catch { return null; }
}

function mapBoostrCode(condition: string): number {
  const c = condition.toLowerCase();
  if (c.includes('clear') || c.includes('despejado') || c.includes('sunny')) return 0;
  if (c.includes('partly') || c.includes('parcial') || c.includes('cloud')) return 2;
  if (c.includes('overcast') || c.includes('nublado') || c.includes('cloudy')) return 3;
  if (c.includes('fog') || c.includes('niebla')) return 45;
  if (c.includes('drizzle') || c.includes('llovizna')) return 51;
  if (c.includes('rain') || c.includes('lluvia') || c.includes('shower') || c.includes('chubasco')) return 61;
  if (c.includes('snow') || c.includes('nieve') || c.includes('nevada')) return 71;
  if (c.includes('thunder') || c.includes('tormenta') || c.includes('storm')) return 95;
  return 2;
}

async function geocode(query: string): Promise<{ name: string; lat: number; lon: number } | null> {
  try {
    const res = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1&language=es&format=json`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const result = data.results?.[0];
    if (!result) return null;
    return { name: result.name, lat: result.latitude, lon: result.longitude };
  } catch { return null; }
}

export const GET: APIRoute = async ({ url }) => {
  const searchQuery = url.searchParams.get('q');
  const citiesParam = url.searchParams.get('cities');
  const cacheKey = (searchQuery ?? citiesParam ?? '__default__').toLowerCase().trim();

  const weather = await dedupeFetch<Record<string, unknown> | null>(`weather:${cacheKey}`, async () => {
    try {
      if (searchQuery) {
        const geo = await geocode(searchQuery);
        if (!geo) return null;
        let weatherMap = await fetchOpenMeteo([geo]);
        if (!weatherMap) {
          const gael = await fetchGaelCloud(geo.name);
          if (gael) weatherMap = { [geo.name]: gael };
        }
        if (!weatherMap) {
          const boostr = await fetchBoostr(geo.name);
          if (boostr) weatherMap = { [geo.name]: boostr };
        }
        return weatherMap;
      }

      let cities = DEFAULT_CITIES;
      if (citiesParam) {
        const names = citiesParam.split(',').map(s => s.trim()).filter(Boolean);
        const resolved: { name: string; lat: number; lon: number }[] = [];
        for (const name of names) {
          const existing = DEFAULT_CITIES.find(c => c.name.toLowerCase() === name.toLowerCase());
          if (existing) { resolved.push(existing); }
          else { const geo = await geocode(name); if (geo) resolved.push(geo); }
        }
        if (resolved.length > 0) cities = resolved;
      }

      let weatherMap = await fetchOpenMeteo(cities);

      if (!weatherMap) {
        const gaelResults = await Promise.allSettled(cities.map(city => fetchGaelCloud(city.name)));
        weatherMap = {};
        gaelResults.forEach((r, i) => {
          if (r.status === 'fulfilled' && r.value) weatherMap![cities[i].name] = r.value;
        });
        if (Object.keys(weatherMap).length === 0) weatherMap = null;
      }

      if (!weatherMap || Object.keys(weatherMap).length === 0) {
        const boostrResults = await Promise.allSettled(cities.map(city => fetchBoostr(city.name)));
        weatherMap = {};
        boostrResults.forEach((r, i) => {
          if (r.status === 'fulfilled' && r.value) weatherMap![cities[i].name] = r.value;
        });
      }

      if (Object.keys(weatherMap).length === 0) return null;
      return weatherMap;
    } catch {
      return null;
    }
  });

  return new Response(JSON.stringify({ weather }), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=600' },
  });
};
