import { useState, useEffect, useRef, useMemo } from 'react';
import { POPULAR_STOPS } from '../../lib/transport';
import type { StopPrediction, StopInfo, PopularStop } from '../../lib/transport';

interface MetroLine {
  name: string;
  color: string;
  status: string;
}

interface MetroStation {
  name: string;
  line: string;
  status: number;
}

interface TransportData {
  city: string;
  name: string;
  metro: { lines: MetroLine[]; source: string | null } | null;
  stations: { lines: MetroStation[]; issues: boolean } | null;
  stopInfo: StopInfo | null;
  predictionError: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  normal: 'badge badge-xs badge-success',
  detenido: 'badge badge-xs badge-error',
  parcial: 'badge badge-xs badge-warning',
  demorado: 'badge badge-xs badge-warning',
};

const STATION_STATUS: Record<number, { label: string; color: string }> = {
  0: { label: 'Operativa', color: 'badge badge-xs badge-success' },
  1: { label: 'Cerrada', color: 'badge badge-xs badge-error' },
  2: { label: 'No habilitada', color: 'badge badge-xs badge-ghost' },
  3: { label: 'Accesos cerrados', color: 'badge badge-xs badge-warning' },
};

const QUICK_PILLS = ['PA433', 'PA1', 'PA123', 'PA146'];

function MetroGrid({ lines, source }: { lines: MetroLine[]; source: string | null }) {
  if (lines.length === 0) {
    return (
      <div className="mb-4">
        <h4 className="text-sm font-semibold text-base-content mb-3">Metro de Santiago</h4>
        <div className="rounded-xl bg-base-200 border border-base-300 p-4">
          <p className="text-xs text-base-content/70 text-center">
            Información no disponible en este momento.{' '}
            <a href="https://www.metro.cl/el-viaje/estado-red" target="_blank" rel="noopener noreferrer"
              className="text-base-content/70 hover:text-base-content underline underline-offset-2 transition-colors">
              Ver en Metro.cl →
            </a>
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="mb-4">
      <h4 className="text-sm font-semibold text-base-content mb-3">Metro de Santiago</h4>
      <div className="rounded-xl bg-base-200 border border-base-300 p-4">
        <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
          {lines.map((line) => {
            const status = (line.status || 'Normal').toLowerCase();
            const colorClass = STATUS_COLORS[status] || 'text-base-content/70';
            return (
              <div key={line.name} className="flex flex-col items-center gap-1.5 p-2 rounded-xl bg-base-300">
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white [text-shadow:0_1px_2px_rgb(0_0_0/0.6)]"
                  style={{ backgroundColor: line.color }}
                >
                  {line.name.replace('L', '')}
                </div>
                <span className={colorClass}>
                  {line.status || 'Normal'}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      <div className="mt-2 text-right text-[10px] text-base-content/50">
        Fuentes:{' '}
        <a href="https://www.metro.cl/el-viaje/estado-red" target="_blank" rel="noopener noreferrer" className="hover:text-base-content underline underline-offset-2 transition-colors">
          Metro.cl
        </a>
        {(source && source !== 'metro.cl') && (
          <>
            {' · '}
            <a href={`https://${source}`} target="_blank" rel="noopener noreferrer" className="hover:text-base-content underline underline-offset-2 transition-colors">
              {source}
            </a>
          </>
        )}
      </div>
    </div>
  );
}

function StationAlerts({ stations }: { stations: MetroStation[] }) {
  const affected = stations.filter(s => s.status !== 0);
  if (affected.length === 0) return null;

  return (
    <div className="mb-4">
      <h4 className="text-sm font-semibold text-base-content mb-3">
        Estado de estaciones
        <span className="text-[10px] text-base-content/70 ml-2 font-normal">
          ({affected.length} con novedades)
        </span>
      </h4>
      <div className="flex flex-wrap gap-2">
        {affected.map((s, i) => {
          const info = STATION_STATUS[s.status] || STATION_STATUS[0];
          return (
            <div
              key={`${s.name}-${i}`}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-base-200 border border-base-300"
            >
              <span>{s.name}{s.line && <> ({s.line})</>}</span>
              <span className={info.color}>{info.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LiveDot({ isLive }: { isLive: boolean }) {
  if (!isLive) return null;
  return (
    <span className="inline-block w-1.5 h-1.5 rounded-full bg-success animate-pulse shrink-0" title="Dato en vivo" />
  );
}

function StopResult({ result }: { result: StopInfo }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-semibold text-base-content">{result.name}</span>
        <span className="text-[10px] text-base-content/70 font-mono">{result.id}</span>
      </div>

      <a
        href={`https://www.red.cl/planifica-tu-viaje/cuando-llega/?codsimt=${result.id}`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-[10px] text-base-content/70 hover:text-base-content underline underline-offset-2 transition-colors mb-3"
      >
        Ver en Red Movilidad →
      </a>

      <div className="rounded-xl bg-base-200 border border-base-300 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-base-300 text-base-content/70 text-[10px] uppercase tracking-wider">
                <th className="text-left px-3 py-2 font-medium">Recorrido</th>
                <th className="text-left px-3 py-2 font-medium">Dirección</th>
                <th className="text-left px-3 py-2 font-medium">Llegada</th>
                <th className="text-right px-3 py-2 font-medium">Enlace</th>
              </tr>
            </thead>
            <tbody>
              {result.predictions.map((p, i) => (
                <tr
                  key={i}
                  className={`border-b border-base-300/50 last:border-b-0 transition-colors ${
                    p.serviceMessage
                      ? 'bg-warning/10 hover:bg-warning/20'
                      : 'hover:bg-base-300/50'
                  }`}
                >
                  <td className="px-3 py-2.5 font-semibold text-base-content flex items-center gap-1.5">
                    {p.serviceMessage ? (
                      <span className="w-1.5 h-1.5 rounded-full bg-warning shrink-0" />
                    ) : (
                      <LiveDot isLive={p.is_live} />
                    )}
                    {p.route_id}
                    {p.isDetour && (
                      <span className="badge badge-xs badge-warning">[!] Desvío</span>
                    )}
                  </td>
                  <td className={`px-3 py-2.5 max-w-[160px] truncate ${
                    p.serviceMessage ? 'text-warning/80' : 'text-base-content/70'
                   }`}>
                     {p.direction || '-'}
                   </td>
                   <td className={`px-3 py-2.5 tabular-nums ${
                     p.serviceMessage ? 'text-warning/80' : 'text-base-content'
                  }`}>
                    {p.arrival_estimation}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <a
                      href={`https://www.red.cl/mapas-y-horarios/bus/recorrido?codser=${p.route_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] text-base-content/70 hover:text-base-content underline underline-offset-2 transition-colors whitespace-nowrap"
                    >
                      Ver recorrido →
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StopCombobox() {
  const [mode, setMode] = useState<'paradero' | 'recorrido'>('paradero');
  const [stopId, setStopId] = useState('');
  const [searching, setSearching] = useState(false);
  const [result, setResult] = useState<StopInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Route search state
  const [routeNames, setRouteNames] = useState<string[]>([]);
  const [routeInput, setRouteInput] = useState('');
  const [selectedRoute, setSelectedRoute] = useState('');
  const [routeStops, setRouteStops] = useState<{ stop_id: string; stop_name: string; stop_lat: number; stop_lon: number }[] | null>(null);
  const [loadingRoute, setLoadingRoute] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [RouteMapComponent, setRouteMapComponent] = useState<React.ComponentType<{ stops: any[]; routeName: string; onPickStop: (id: string) => void }> | null>(null);

  useEffect(() => {
    if (mode === 'recorrido' && routeNames.length === 0) {
      fetch('/api/transport?mode=route-names')
        .then(r => r.json())
        .then(d => setRouteNames(d.routes || []))
        .catch(() => {});
    }
  }, [mode, routeNames.length]);

  const filtered = useMemo(() => {
    if (mode === 'paradero') {
      if (!stopId) return POPULAR_STOPS;
      return POPULAR_STOPS.filter(s => s.code.includes(stopId));
    }
    if (!routeInput) return [];
    return routeNames.filter(r => r.startsWith(routeInput)).slice(0, 100);
  }, [mode, stopId, routeInput, routeNames]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      if (
        dropdownRef.current && !dropdownRef.current.contains(target) &&
        inputRef.current && !inputRef.current.contains(target)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  async function doSearch(q: string) {
    const trimmed = q.trim().toUpperCase();
    if (!trimmed) return;
    setSearching(true);
    setError(null);
    setResult(null);
    setIsOpen(false);
    try {
      const res = await fetch(`/api/transport?stop=${encodeURIComponent(trimmed)}`);
      const data = await res.json();
      if (data.stopInfo?.predictions?.length > 0) {
        setResult(data.stopInfo);
      } else if (data.predictionError) {
        setError(data.predictionError);
      } else {
        setError('Sin predicciones para ese paradero');
      }
    } catch {
      setError('Error de conexión');
    }
    setSearching(false);
  }

  async function loadRouteStops(route: string) {
    setLoadingRoute(true);
    setRouteStops(null);
    setError(null);
    setResult(null);
    setIsOpen(false);
    try {
      const res = await fetch(`/api/transport?route=${encodeURIComponent(route)}`);
      const data = await res.json();
      if (data.routeStops && data.routeStops.length > 0) {
        setRouteStops(data.routeStops);
      } else {
        setError('No se encontraron paraderos para esa ruta');
      }
    } catch {
      setError('Error de conexión');
    }
    setLoadingRoute(false);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (mode === 'paradero') doSearch(stopId);
    else if (routeInput.trim()) loadRouteStops(routeInput.trim());
  }

  function handleSelect(value: string) {
    if (mode === 'paradero') {
      setStopId(value);
      setHighlightIdx(-1);
      doSearch(value);
    } else {
      setRouteInput(value);
      setSelectedRoute(value);
      setHighlightIdx(-1);
      setIsOpen(false);
      loadRouteStops(value);
    }
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (mode === 'paradero') {
      const val = e.target.value.toUpperCase();
      setStopId(val);
      setIsOpen(true);
    } else {
      setRouteInput(e.target.value.toUpperCase());
      setIsOpen(true);
    }
    setHighlightIdx(-1);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!isOpen || filtered.length === 0) {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSubmit(e as unknown as React.FormEvent);
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightIdx(i => Math.min(i + 1, filtered.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightIdx(i => Math.max(i - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (highlightIdx >= 0) {
          if (mode === 'paradero') handleSelect((filtered[highlightIdx] as PopularStop).code);
          else handleSelect(filtered[highlightIdx] as string);
        } else {
          handleSubmit(e as unknown as React.FormEvent);
        }
        break;
      case 'Escape':
        setIsOpen(false);
        setHighlightIdx(-1);
        break;
    }
  }

  function pickStop(code: string) {
    setStopId(code);
    setResult(null);
    doSearch(code);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold text-base-content">
          Llegada de buses <span className="text-[10px] text-base-content/70 font-normal">(RED — Santiago)</span>
        </h4>
        <div className="flex bg-base-200 rounded-lg p-0.5 text-xs font-medium">
          <button
            type="button"
            onClick={() => { setMode('paradero'); setRouteStops(null); setRouteInput(''); }}
            className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
              mode === 'paradero' ? 'bg-base-100 text-base-content shadow-sm' : 'text-base-content/60 hover:text-base-content'
            }`}
          >
            Paradero
          </button>
          <button
            type="button"
            onClick={() => { setMode('recorrido'); setStopId(''); setResult(null); setError(null); }}
            className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
              mode === 'recorrido' ? 'bg-base-100 text-base-content shadow-sm' : 'text-base-content/60 hover:text-base-content'
            }`}
          >
            Recorrido
          </button>
        </div>
      </div>

      {mode === 'paradero' && (
        <>
          <form onSubmit={handleSubmit} className="relative mb-2">
            <div className="flex gap-2">
              <input
                ref={inputRef}
                type="text"
                value={stopId}
                onChange={handleInputChange}
                onFocus={() => { setIsOpen(true); }}
                onKeyDown={handleKeyDown}
                placeholder="Buscar paradero (PA433, PA1...)"
                className="flex-1 bg-base-100 border border-base-300 rounded-lg px-3 py-2 text-xs text-base-content placeholder-base-content/50 uppercase outline-none focus:border-primary/40 transition-colors"
              />
              <button
                type="submit"
                disabled={searching || !stopId.trim()}
                className="px-3 py-2 text-xs font-medium bg-primary text-primary-content rounded-lg hover:bg-primary/90 transition-all active:scale-[0.96] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap"
              >
                {searching ? '...' : 'Consultar'}
              </button>
            </div>

            {isOpen && filtered.length > 0 && (
              <div
                ref={dropdownRef}
                className="absolute z-50 left-0 right-16 top-full mt-1 bg-base-100 border border-base-300 rounded-lg shadow-xl max-h-56 overflow-y-auto animate-[fadeSlideIn_0.15s_ease-out]"
              >
                {filtered.slice(0, 100).map((s, i) => {
                  const stop = s as PopularStop;
                  return (
                  <button
                    key={stop.code}
                    type="button"
                    onClick={() => handleSelect(stop.code)}
                    onMouseEnter={() => setHighlightIdx(i)}
                    className={`w-full text-left px-3 py-2 flex items-center justify-between transition-colors cursor-pointer ${
                      i === highlightIdx ? 'bg-base-300' : 'hover:bg-base-200'
                    }`}
                  >
                    <span className="font-mono text-xs font-semibold text-base-content">{stop.code}</span>
                    {stop.comuna && <span className="text-[10px] text-base-content/70">{stop.comuna}</span>}
                  </button>
                  );
                })}
              </div>
            )}
          </form>

          <div className="flex gap-1.5 flex-wrap mb-3">
            {QUICK_PILLS.map((code, i) => (
              <button
                key={code}
                type="button"
                onClick={() => handleSelect(code)}
                style={{ animationDelay: `${i * 60}ms` }}
                className="px-2 py-1 text-[10px] font-medium bg-base-200 border border-base-300 rounded-lg hover:bg-base-300 hover:scale-105 transition-all active:scale-[0.96] cursor-pointer opacity-0 animate-[fadeSlideIn_0.25s_ease-out_forwards]"
              >
                {code}
              </button>
            ))}
          </div>

          {error && <p className="text-[10px] text-error mb-2">{error}</p>}
          {result && <StopResult result={result} />}
          {!result && !error && !searching && (
            <p className="text-[10px] text-base-content/70">
              Selecciona un paradero de la lista o escribe el código que ves en tu parada
            </p>
          )}
        </>
      )}

      {mode === 'recorrido' && (
        <>
          <form onSubmit={handleSubmit} className="relative mb-2">
            <div className="flex gap-2">
              <input
                ref={inputRef}
                type="text"
                value={routeInput}
                onChange={handleInputChange}
                onFocus={() => { setIsOpen(routeNames.length > 0); }}
                onKeyDown={handleKeyDown}
                placeholder="Buscar recorrido (506, 210, 424...)"
                className="flex-1 bg-base-100 border border-base-300 rounded-lg px-3 py-2 text-xs text-base-content placeholder-base-content/50 uppercase outline-none focus:border-primary/40 transition-colors"
              />
              <button
                type="submit"
                disabled={loadingRoute || !routeInput.trim()}
                className="px-3 py-2 text-xs font-medium bg-primary text-primary-content rounded-lg hover:bg-primary/90 transition-all active:scale-[0.96] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap"
              >
                {loadingRoute ? '...' : 'Ver ruta'}
              </button>
            </div>

            {isOpen && filtered.length > 0 && (
              <div
                ref={dropdownRef}
                className="absolute z-50 left-0 right-16 top-full mt-1 bg-base-100 border border-base-300 rounded-lg shadow-xl max-h-56 overflow-y-auto animate-[fadeSlideIn_0.15s_ease-out]"
              >
                {(filtered as string[]).map((r, i) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => handleSelect(r)}
                    onMouseEnter={() => setHighlightIdx(i)}
                    className={`w-full text-left px-3 py-2 transition-colors cursor-pointer text-xs ${
                      i === highlightIdx ? 'bg-base-300' : 'hover:bg-base-200'
                    }`}
                  >
                    <span className="font-semibold text-base-content">Recorrido {r}</span>
                  </button>
                ))}
              </div>
            )}
          </form>

          {loadingRoute && (
            <div className="flex items-center gap-2 text-[10px] text-base-content/70 pb-2">
              <span className="loading loading-spinner loading-xs" />
              Cargando paraderos...
            </div>
          )}

          {routeStops && (
            <div className="rounded-xl bg-base-200 border border-base-300 p-3 mb-2">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-base-content">Recorrido {selectedRoute}</span>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-base-content/70">{routeStops.length} paraderos</span>
                  {!showMap && (
                    <button
                      type="button"
                      onClick={async () => {
                        if (!RouteMapComponent) {
                          const mod = await import('./RouteMap');
                          setRouteMapComponent(() => mod.RouteMap);
                        }
                        setShowMap(true);
                      }}
                      className="px-2 py-0.5 text-[10px] font-medium bg-primary/10 text-primary rounded-md hover:bg-primary/20 transition-colors cursor-pointer"
                    >
                      Ver mapa
                    </button>
                  )}
                  {showMap && (
                    <button
                      type="button"
                      onClick={() => setShowMap(false)}
                      className="px-2 py-0.5 text-[10px] font-medium bg-base-300 text-base-content rounded-md hover:bg-base-300/70 transition-colors cursor-pointer"
                    >
                      Lista
                    </button>
                  )}
                </div>
              </div>
              {showMap && RouteMapComponent && (
                <RouteMapComponent
                  stops={routeStops}
                  routeName={selectedRoute}
                  onPickStop={pickStop}
                />
              )}
              {!showMap && (
                <div className="max-h-60 overflow-y-auto space-y-0.5">
                  {routeStops.map((s, i) => (
                    <button
                      key={s.stop_id}
                      type="button"
                      onClick={() => pickStop(s.stop_id)}
                      style={{ animationDelay: `${i * 20}ms` }}
                      className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs hover:bg-base-300 transition-colors cursor-pointer flex items-center gap-2 opacity-0 animate-[fadeSlideIn_0.2s_ease-out_forwards]"
                    >
                      <span className="font-mono font-semibold text-base-content">{s.stop_id}</span>
                      <span className="text-base-content/70 truncate">{s.stop_name?.replace(/^[A-Z0-9]+-/, '') || s.stop_id}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Inline paradero search + predictions from route view */}
          {routeStops && (
            <div className="relative mb-2">
              <form onSubmit={(e) => { e.preventDefault(); if (stopId.trim()) doSearch(stopId.trim()); }} className="flex gap-2">
                <input
                  type="text"
                  value={stopId}
                  onChange={(e) => setStopId(e.target.value.toUpperCase())}
                  placeholder="Consultar paradero (PA433...)"
                  className="flex-1 bg-base-100 border border-base-300 rounded-lg px-3 py-2 text-xs text-base-content placeholder-base-content/50 uppercase outline-none focus:border-primary/40 transition-colors"
                />
                <button
                  type="submit"
                  disabled={searching || !stopId.trim()}
                  className="px-3 py-2 text-xs font-medium bg-primary text-primary-content rounded-lg hover:bg-primary/90 transition-all active:scale-[0.96] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap"
                >
                  {searching ? '...' : 'Consultar'}
                </button>
              </form>
            </div>
          )}

          {result && <StopResult result={result} />}

          {error && <p className="text-[10px] text-error mb-2">{error}</p>}

          {!routeStops && !loadingRoute && !error && (
            <p className="text-[10px] text-base-content/70">
              Escribe un número de recorrido para ver todos sus paraderos
            </p>
          )}
        </>
      )}
    </div>
  );
}

export function TransportWidget() {
  const [data, setData] = useState<TransportData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/transport?city=santiago')
      .then(r => r.json())
      .then(d => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="rounded-xl bg-base-200 border border-base-300 p-4">
          <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="flex flex-col items-center gap-1.5 p-2 rounded-xl bg-base-300">
                <div className="w-8 h-8 rounded-full bg-base-200" />
                <div className="h-3 w-10 bg-base-200 rounded" />
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-xl bg-base-200 border border-base-300 p-4 space-y-2">
          <div className="h-3 bg-base-300 rounded w-32" />
          <div className="h-3 bg-base-300 rounded w-48" />
          <div className="h-3 bg-base-300 rounded w-40" />
        </div>
        <div className="rounded-xl bg-base-200 border border-base-300 p-4">
          <div className="h-10 bg-base-300 rounded-lg w-full" />
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-xl bg-base-200 border border-base-300 p-8 text-center text-base-content/70 text-sm">
        Información de transporte no disponible
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {data.metro && <MetroGrid lines={data.metro.lines} source={data.metro.source} />}
      <StopCombobox />
      <div className="mt-2 text-right text-[10px] text-base-content/50">
        Fuentes:{' '}
        <a href="https://www.red.cl/predictorPlus/prediccion" target="_blank" rel="noopener noreferrer" className="hover:text-base-content underline underline-offset-2 transition-colors">Red.cl</a>
        {' · '}
        <a href="https://www.metro.cl/el-viaje/estado-red" target="_blank" rel="noopener noreferrer" className="hover:text-base-content underline underline-offset-2 transition-colors">Metro.cl</a>
        {' · '}
        <a href="https://www.dtpm.cl/" target="_blank" rel="noopener noreferrer" className="hover:text-base-content underline underline-offset-2 transition-colors">DTPM</a>
      </div>
    </div>
  );
}
