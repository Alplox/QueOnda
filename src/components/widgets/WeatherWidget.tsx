import { useState, useEffect } from 'react';
import { idbGet, idbSet } from '../../lib/idb-cache';

const IDB_KEY = 'weather-default';
const IDB_TTL = 10 * 60 * 1000; // 10 min

const DEFAULT_CITIES_COORDS = [
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

type CityWeatherData = { city: string; temp: number; feelsLike: number; humidity: number; weatherCode: number; wind: number };

async function fetchOpenMeteoDirect(cities: { name: string; lat: number; lon: number }[]): Promise<Record<string, CityWeatherData> | null> {
  try {
    const lats = cities.map(c => c.lat.toFixed(2)).join(',');
    const lons = cities.map(c => c.lon.toFixed(2)).join(',');
    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m&timezone=America/Santiago`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const results = Array.isArray(data) ? data : [data];
    const map: Record<string, CityWeatherData> = {};
    results.forEach((r: any, i: number) => {
      const city = cities[i];
      if (!city || !r.current) return;
      map[city.name] = {
        city: city.name,
        temp: Math.round(r.current.temperature_2m),
        feelsLike: Math.round(r.current.apparent_temperature),
        humidity: r.current.relative_humidity_2m,
        weatherCode: r.current.weather_code,
        wind: r.current.wind_speed_10m,
      };
    });
    return Object.keys(map).length > 0 ? map : null;
  } catch { return null; }
}

async function fetchServerWeather(qs: string): Promise<Record<string, CityWeatherData> | null> {
  try { const r = await fetch(`/api/weather?${qs}`); const d = await r.json(); return d.weather || null; } catch { return null; }
}

function WeatherIcon({ code }: { code: number }) {
  return <span className="text-primary">
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      {code === 0 ? (
        <>
          <path d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
        </>
      ) : code >= 95 ? (
        <>
          <path d="M8 16a4 4 0 018 0 4 4 0 01-8 0zm8 0h1a3 3 0 000-6h-1a5 5 0 00-9.9-1A3 3 0 005 16h1" />
          <path d="M12 13v3m0 3v.01" />
        </>
      ) : (
        <path d="M8 16a4 4 0 018 0 4 4 0 01-8 0zm8 0h1a3 3 0 000-6h-1a5 5 0 00-9.9-1A3 3 0 005 16h1" />
      )}
    </svg>
  </span>;
}

const WMO_LABELS: Record<number, string> = {
  0: 'Despejado', 1: 'Mayormente despejado', 2: 'Parcialmente nublado', 3: 'Nublado',
  45: 'Niebla', 48: 'Niebla con escarcha',
  51: 'Llovizna ligera', 53: 'Llovizna moderada', 55: 'Llovizna densa',
  61: 'Lluvia ligera', 63: 'Lluvia moderada', 65: 'Lluvia fuerte',
  71: 'Nevada ligera', 73: 'Nevada moderada', 75: 'Nevada fuerte',
  80: 'Chubascos ligeros', 81: 'Chubascos moderados', 82: 'Chubascos violentos',
  95: 'Tormenta', 96: 'Tormenta con granizo', 99: 'Tormenta con granizo fuerte',
};

interface CityWeather {
  city: string;
  temp: number;
  feelsLike: number;
  humidity: number;
  weatherCode: number;
  wind: number;
}

const DEFAULT_CITY_NAMES = DEFAULT_CITIES_COORDS.map(c => c.name);

const INITIAL = 6;
const LOAD_MORE = 6;

function normalize(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function WeatherCard({ data, isUser, onRemove }: { data: CityWeather; isUser?: boolean; onRemove?: () => void }) {
  const label = WMO_LABELS[data.weatherCode] || '—';
  return (
    <div className={`rounded-xl border p-4 relative ${isUser ? 'bg-primary/5 border-primary/30' : 'bg-base-200 border-base-300'}`}>
      {onRemove && (
        <button onClick={onRemove} className="absolute top-1.5 right-1.5 min-w-[24px] min-h-[24px] flex items-center justify-center p-0.5 rounded text-base-content/50 hover:text-base-content hover:bg-base-300 transition-colors cursor-pointer" title="Quitar ciudad">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
        </button>
      )}
      <div className="flex items-center justify-between">
        <p className="text-xs text-base-content/70 uppercase tracking-wider font-medium truncate pr-4">
          {data.city}
          {isUser && <span className="text-[10px] text-base-content/70 ml-1">(tu ubicacion)</span>}
        </p>
      </div>
      <div className="flex items-center gap-2 mt-1">
        <WeatherIcon code={data.weatherCode} />
        <span className="text-2xl font-bold text-base-content tabular-nums">{data.temp}°</span>
      </div>
      <p className="text-xs text-base-content/70 mt-0.5">{label}</p>
      <div className="flex gap-3 mt-2 text-[10px] text-base-content/70">
        <span>Humedad {data.humidity}%</span>
        <span>Viento {data.wind} km/h</span>
      </div>
    </div>
  );
}

export function WeatherWidget() {
  const [defaultMap, setDefaultMap] = useState<Record<string, CityWeather | null>>({});
  const [extraMap, setExtraMap] = useState<Record<string, CityWeather | null>>({});
  const [userCity, setUserCity] = useState<CityWeather | null>(null);
  const [loading, setLoading] = useState(true);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [limit, setLimit] = useState(INITIAL);
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [filterCity, setFilterCity] = useState<string | null>(null);

  const [savedNames, setSavedNames] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('weather-saved-cities') || '[]'); } catch { return []; }
  });

  function saveNames(names: string[]) {
    setSavedNames(names);
    localStorage.setItem('weather-saved-cities', JSON.stringify(names));
  }

  useEffect(() => {
    let cancelled = false;
    let resolved = false;

    // Phase 0: IDB cache → instant render
    idbGet<Record<string, CityWeather | null>>(IDB_KEY).then(cached => {
      if (cancelled || !cached?.data) return;
      resolved = true;
      setDefaultMap(cached.data);
      setLoading(false);
    });

    async function load() {
      const defaultWeather = await fetchOpenMeteoDirect(DEFAULT_CITIES_COORDS);
      if (cancelled) return;
      if (defaultWeather) {
        idbSet(IDB_KEY, defaultWeather, IDB_TTL);
        setDefaultMap(defaultWeather);
      } else if (!resolved) {
        const serverWeather = await fetchServerWeather('');
        if (!cancelled && serverWeather) setDefaultMap(serverWeather);
      }

      try {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000, enableHighAccuracy: false });
        });
        const { latitude, longitude } = pos.coords;
        const geoRes = await fetch(
          `https://geocoding-api.open-meteo.com/v1/reverse?latitude=${latitude}&longitude=${longitude}&language=es`
        ).then(r => r.json()).catch(() => null);
        const place = geoRes?.results?.[0];
        if (place && !cancelled) {
          const geo = DEFAULT_CITIES_COORDS.find(c => normalize(c.name) === normalize(place.name));
          const cities = geo ? [geo] : [{ name: place.name, lat: place.latitude, lon: place.longitude }];
          const userWeather = await fetchOpenMeteoDirect(cities);
          if (cancelled) return;
          if (userWeather) {
            const matchKey = Object.keys(userWeather).find(k => normalize(k) === normalize(place.name));
            if (matchKey) setUserCity(userWeather[matchKey]);
            else setGeoError('no se pudo obtener clima de tu ubicacion');
          } else {
            const serverRes = await fetchServerWeather(`cities=${encodeURIComponent(place.name)}`);
            if (!cancelled && serverRes) {
              const matchKey = Object.keys(serverRes).find(k => normalize(k) === normalize(place.name));
              const w = matchKey ? serverRes[matchKey] : null;
              if (w) setUserCity(w);
              else setGeoError('no se pudo obtener clima de tu ubicacion');
            }
          }
        }
      } catch {
        if (!cancelled) setGeoError('no se pudo obtener tu ubicacion');
      }

      if (!cancelled && !resolved) setLoading(false);
      resolved = true;
    }

    load();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (savedNames.length === 0) return;
    // Try Open-Meteo direct for saved cities
    const savedCityCoords = savedNames.map(name => {
      const existing = DEFAULT_CITIES_COORDS.find(c => c.name.toLowerCase() === name.toLowerCase());
      return existing || { name, lat: 0, lon: 0 }; // unknown cities get 0,0 → will fail → server fallback
    }).filter(c => c.lat !== 0 || c.lon !== 0);

    if (savedCityCoords.length > 0) {
      fetchOpenMeteoDirect(savedCityCoords)
        .then(data => { if (data) setExtraMap(data); })
        .catch(() => {});
    }
    // For unknown cities, use server
    const unknownCities = savedNames.filter(n => !DEFAULT_CITIES_COORDS.some(c => c.name.toLowerCase() === n.toLowerCase()));
    if (unknownCities.length > 0) {
      fetchServerWeather(`cities=${unknownCities.map(encodeURIComponent).join(',')}`)
        .then(data => { if (data) setExtraMap(prev => ({ ...prev, ...data })); })
        .catch(() => {});
    }
  }, [savedNames]);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = searchQuery.trim();
    if (!q) return;

    setSearchError(null);

    // Local match first — filter grid to that city
    const match = allCities.find(c => normalize(c.city).includes(normalize(q)));
    if (match) {
      setFilterCity(match.city);
      setSearchQuery('');
      return;
    }

    // Not found locally — geocode and add
    setSearching(true);
    try {
      // Geocode via Open-Meteo
      const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1&language=es&format=json`, { signal: AbortSignal.timeout(5000) });
      const geoData = await geoRes.json();
      const result = geoData.results?.[0];
      if (result) {
        const cities = [{ name: result.name, lat: result.latitude, lon: result.longitude }];
        const weather = await fetchOpenMeteoDirect(cities);
        if (weather && weather[result.name]) {
          saveNames([result.name, ...savedNames.filter(n => normalize(n) !== normalize(result.name))]);
          setFilterCity(result.name);
          setSearchQuery('');
        } else {
          // Try server fallback
          const serverWeather = await fetchServerWeather(`q=${encodeURIComponent(q)}`);
          if (serverWeather) {
            const cityName = Object.keys(serverWeather)[0];
            saveNames([cityName, ...savedNames.filter(n => normalize(n) !== normalize(cityName))]);
            setFilterCity(cityName);
            setSearchQuery('');
          } else {
            setSearchError('Ciudad no encontrada');
          }
        }
      } else {
        setSearchError('Ciudad no encontrada');
      }
    } catch {
      setSearchError('Error al buscar ciudad');
    }
    setSearching(false);
  }

  function handleRemove(name: string) {
    saveNames(savedNames.filter(n => n !== name));
    setExtraMap(prev => { const next = { ...prev }; delete next[name]; return next; });
  }

  const allCities: CityWeather[] = [];

  if (userCity) allCities.push(userCity);

  const defaultCities = DEFAULT_CITY_NAMES
    .map(name => defaultMap[name])
    .filter((w): w is CityWeather => w !== null && w !== undefined)
    .filter(w => !userCity || w.city !== userCity.city);

  const extraCities = savedNames
    .map(name => extraMap[name])
    .filter((w): w is CityWeather => w !== null && w !== undefined)
    .filter(w => !userCity || w.city !== userCity.city)
    .filter(w => !defaultCities.some(d => d.city === w.city));

  allCities.push(...extraCities, ...defaultCities);

  const localMatch = searchQuery.trim() && !filterCity
    ? allCities.find(c => normalize(c.city).includes(normalize(searchQuery.trim())))
    : null;

  const displayedCities = filterCity
    ? allCities.filter(c => normalize(c.city) === normalize(filterCity))
    : allCities;
  const visibleCities = filterCity ? displayedCities : displayedCities.slice(0, limit);
  const hasMore = !filterCity && allCities.length > limit;
  const hasExtra = !filterCity && limit > INITIAL;

  if (loading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-base-300 p-4 animate-pulse">
            <div className="h-3 bg-base-300 rounded w-20 mb-3" />
            <div className="flex items-center gap-2 mb-2">
              <div className="w-6 h-6 bg-base-300 rounded" />
              <div className="h-8 w-12 bg-base-300 rounded" />
            </div>
            <div className="h-3 bg-base-300 rounded w-24 mb-2" />
            <div className="flex gap-3">
              <div className="h-2.5 bg-base-300 rounded w-16" />
              <div className="h-2.5 bg-base-300 rounded w-20" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (allCities.length === 0) {
    return (
      <div className="rounded-xl bg-base-200 border border-base-300 p-8 text-center text-base-content/70 text-sm">
        Clima no disponible
      </div>
    );
  }

  return (
    <div>
      {/* Search / Filter bar */}
      <form onSubmit={handleSearch} className="flex gap-2 mb-3">
        <input
          type="text"
          value={searchQuery}
          onChange={e => { setSearchQuery(e.target.value); setSearchError(null); }}
          placeholder="Buscar ciudad en la grilla..."
          className="flex-1 bg-base-100 border border-base-300 rounded-lg px-3 py-2 text-xs text-base-content placeholder-base-content/50 outline-none focus:border-primary/40 transition-colors"
        />
        <button
          type="submit"
          disabled={searching || !searchQuery.trim()}
          className="px-3 py-2 text-xs font-medium bg-primary text-primary-content rounded-lg hover:bg-primary/90 transition-all active:scale-[0.96] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap"
        >
          {searching ? '...' : 'Ir'}
        </button>
      </form>
      {searchError && (
        <p className="text-[10px] text-error mb-2">{searchError}</p>
      )}

      {filterCity && (
        <div className="flex items-center gap-2 mb-3 text-xs">
          <span className="text-base-content/70">Filtrando: <strong className="text-base-content">{filterCity}</strong></span>
          <button
            onClick={() => { setFilterCity(null); setSearchQuery(''); }}
            className="px-2 py-0.5 text-[10px] rounded bg-base-200 border border-base-300 text-base-content/70 hover:text-base-content transition-colors cursor-pointer"
          >
            Limpiar filtro
          </button>
        </div>
      )}

      {/* If search active and no local match, show add prompt */}
      {!localMatch && !filterCity && searchQuery.trim() && !searching && !searchError && (
        <p className="text-[10px] text-base-content/70 mb-2">
          &ldquo;{searchQuery.trim()}&rdquo; no está en la grilla. Presiona Enter para agregarla.
        </p>
      )}

      {/* Weather grid */}
      {filterCity && visibleCities.length === 0 ? (
        <p className="text-xs text-base-content/70 py-4 text-center">No se encontró &ldquo;{filterCity}&rdquo; en la grilla.</p>
      ) : (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {visibleCities.map((w, i) => (
          <div key={w.city} style={{ animationDelay: `${i * 50}ms` }} className="opacity-0 animate-[fadeSlideIn_0.35s_ease-out_forwards]">
            <WeatherCard
              data={w}
              isUser={userCity?.city === w.city}
              onRemove={!defaultCities.includes(w) && userCity?.city !== w.city ? () => handleRemove(w.city) : undefined}
            />
          </div>
        ))}
      </div>
      )}

      {/* Load more / less */}
      <div className="flex items-center justify-center gap-3 mt-3">
        {hasMore && (
          <button
            onClick={() => setLimit(s => s + LOAD_MORE)}
            className="px-4 py-1.5 text-[10px] font-medium text-base-content bg-base-200 border border-base-300 rounded-lg hover:bg-base-300 hover:border-primary hover:ring-1 hover:ring-inset hover:ring-base-content/[0.04] transition-all duration-200 active:scale-[0.96] cursor-pointer"
          >
            Mostrar más ({allCities.length - limit} restantes)
          </button>
        )}
        {hasExtra && (
          <button
            onClick={() => setLimit(INITIAL)}
            className="px-4 py-1.5 text-[10px] font-medium text-base-content bg-base-200 border border-base-300 rounded-lg hover:bg-base-300 transition-all duration-200 active:scale-[0.96] cursor-pointer"
          >
            Mostrar menos
          </button>
        )}
      </div>

      {/* Footer */}
      <div className="mt-2 text-right text-[10px] text-base-content/50">
        {geoError && <><span>{geoError}</span><span className="mx-1">·</span></>}
        <span>
          Fuentes:{' '}
          <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer" className="hover:text-base-content underline underline-offset-2 transition-colors">Open-Meteo</a>
          {' · '}
          <a href="https://api.gael.cloud/#todos-los-climas" target="_blank" rel="noopener noreferrer" className="hover:text-base-content underline underline-offset-2 transition-colors">Gael Cloud</a>
          {' · '}
          <a href="https://docs.boostr.cl/reference/weather-code" target="_blank" rel="noopener noreferrer" className="hover:text-base-content underline underline-offset-2 transition-colors">Boostr.cl</a>
        </span>
      </div>
    </div>
  );
}
