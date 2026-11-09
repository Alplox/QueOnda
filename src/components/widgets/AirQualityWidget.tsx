import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;
import { AirQualityMap } from './AirQualityMap';
import { AIR_STATUS, airSeverity, orderedRegions } from '@/lib/air-quality';
import type { AirData, AirStation } from '@/lib/air-quality';
import { idbGet, idbSet } from '@/lib/idb-cache';
import { LoadSwap } from '@/components/LoadSwap';
import { SectionSources } from '../SectionSources';
import {
  distanceKm,
  geoErrorMessage,
  getUserLocation,
  onUserLocationChange,
  requestPosition,
  reverseGeocodeName,
  setUserLocation,
} from '@/lib/user-location';
import type { UserLocation } from '@/lib/user-location';

const IDB_KEY = 'air-quality';
const TTL = 30 * 60 * 1000;

async function fetchAir(): Promise<AirData | null> {
  try {
    const res = await fetch('/api/air-quality', { signal: AbortSignal.timeout(12000) });
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data.stations) && data.stations.length > 0 ? data : null;
  } catch { return null; }
}

const fmtWhen = (dt: string) => dt.replace('T', ' ').slice(5, 16);

// ponytail: neutral pill + color dot instead of tinted bg — SINCA's bright
// palette makes any text-on-color combo fail contrast on some themes
function StatusChip({ code, large }: { code: number; large?: boolean }) {
  const meta = AIR_STATUS[code];
  if (!meta) return null;
  return (
    <span
      className={`inline-flex items-center shrink-0 rounded-full bg-base-content/[0.07] text-base-content font-semibold ring-1 ring-inset ring-base-content/10 ${
        large ? 'gap-2 px-3 py-1 text-xs' : 'gap-1.5 px-2 py-0.5 text-[11px]'
      }`}
    >
      <span
        className={`rounded-full shrink-0 ring-1 ring-inset ring-black/25 ${large ? 'h-2.5 w-2.5' : 'h-2 w-2'}`}
        style={{ background: meta.color }}
        aria-hidden="true"
      />
      {meta.label}
    </span>
  );
}

export function AirQualityWidget() {
  const [data, setData] = useState<AirData | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [mapMounted, setMapMounted] = useState(false);
  const LIST_LIMIT = 15;
  const [region, setRegion] = useState('');
  const [listSort, setListSort] = useState<'severity' | 'ns'>('severity');
  const [listLimit, setListLimit] = useState(LIST_LIMIT);
  const [userLoc, setUserLoc] = useState<UserLocation | null>(() => getUserLocation());
  const [nearMe, setNearMe] = useState(() => !!getUserLocation());
  const [geoLoading, setGeoLoading] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);

  // Al cambiar el conjunto u orden, vuelve al recorte (evita listas largas).
  useEffect(() => { setListLimit(LIST_LIMIT); }, [region, nearMe, userLoc?.lat, userLoc?.lon, listSort, data?.updatedAt]);

  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => onUserLocationChange(loc => { setUserLoc(loc); setNearMe(true); }), []);

  async function requestUserLocation() {
    setGeoError(null);
    setGeoLoading(true);
    try {
      const pos = await requestPosition();
      const { latitude, longitude } = pos.coords;
      // Prefiere la comuna/estación SINCA más cercana como etiqueta (más útil que geocoding genérico).
      const stations = data?.stations ?? [];
      let name = 'Mi ubicación';
      if (stations.length > 0) {
        let best: AirStation | null = null;
        let bestD = Infinity;
        for (const s of stations) {
          const d = distanceKm(latitude, longitude, s.lat, s.lon);
          if (d < bestD) { bestD = d; best = s; }
        }
        if (best && bestD <= 30) name = best.comuna || best.nombre;
        else name = (await reverseGeocodeName(latitude, longitude)) ?? 'Mi ubicación';
      } else {
        name = (await reverseGeocodeName(latitude, longitude)) ?? 'Mi ubicación';
      }
      const loc = { name, lat: latitude, lon: longitude };
      setUserLoc(loc);
      setNearMe(true);
      setUserLocation(loc);
    } catch (err) {
      setGeoError(geoErrorMessage(err));
    } finally {
      setGeoLoading(false);
    }
  }

  useEffect(() => {
    if (showMap) setMapMounted(true);
    else { const t = setTimeout(() => setMapMounted(false), 300); return () => clearTimeout(t); }
  }, [showMap]);

  const refresh = useCallback(() => {
    fetchAir().then(d => {
      if (d) {
        setData(d);
        idbSet(IDB_KEY, d, TTL);
      }
      setFailed(!d);
      setLoading(false);
    });
  }, []);

  // Phase 0: instant render from IDB cache
  useEffect(() => {
    idbGet<AirData>(IDB_KEY).then(cached => {
      if (cached?.data) {
        setData(cached.data);
        setLoading(false);
      }
    });
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // prefetch leaflet JS at idle so opening the map doesn't wait for the ~144 KB chunk
  useEffect(() => {
    const id = requestIdleCallback(() => { import('leaflet').catch(() => {}); });
    return () => cancelIdleCallback(id);
  }, []);

  const regions = useMemo(
    () => orderedRegions(data?.stations ?? []),
    [data],
  );

  const sorted = useMemo(
    () => [...(data?.stations ?? [])].sort((a, b) => airSeverity(b) - airSeverity(a)),
    [data],
  );

  const nearActive = nearMe && !!userLoc;
  type NearStation = AirStation & { dist?: number };

  const nsSorted = useMemo(
    () => [...(data?.stations ?? [])].sort((a, b) => (a.regionIndex ?? 99) - (b.regionIndex ?? 99) || airSeverity(b) - airSeverity(a) || a.nombre.localeCompare(b.nombre, 'es')),
    [data],
  );

  const nearList = useMemo<NearStation[]>(() => {
    if (!nearActive || !userLoc) return [];
    const withDist = sorted
      .map(s => ({ ...s, dist: distanceKm(userLoc.lat, userLoc.lon, s.lat, s.lon) }))
      .sort((a, b) => a.dist - b.dist);
    const within = withDist.filter(s => s.dist <= 80);
    return within.length >= 5 ? within : withDist.slice(0, 15);
  }, [sorted, nearActive, userLoc]);

  // Región filtra (solo resultados de esa región). "Cerca de mí" acota por proximidad.
  const displayList = useMemo<NearStation[]>(() => {
    if (nearActive) return nearList;
    const base = listSort === 'ns' ? nsSorted : sorted;
    return region ? base.filter(s => s.region === region) : base;
  }, [nearActive, nearList, listSort, nsSorted, sorted, region]);

  const listRef = useRef<HTMLDivElement>(null);
  const rowPosRef = useRef(new Map<string, number>());
  const animsRef = useRef<Animation[]>([]);

  // Entrada escalonada cuando cambia el conjunto (región / cerca-de-mí / datos),
  // no al reordenar "Más críticas ↔ Norte→sur" (ahí el FLIP muestra el movimiento).
  // Va ANTES del FLIP: limpia posiciones para que el FLIP no use coords viejas.
  useIsoLayoutEffect(() => {
    rowPosRef.current.clear();
    const list = listRef.current;
    if (!list) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    animsRef.current.forEach(a => { try { a.cancel(); } catch {} });
    animsRef.current = Array.from(list.querySelectorAll('[data-row]')).map((node, i) =>
      (node as HTMLElement).animate(
        [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'translateY(0)' }],
        { duration: 260, delay: Math.min(i, 12) * 35, easing: 'ease-out', fill: 'both' },
      ),
    );
    return () => animsRef.current.forEach(a => { try { a.cancel(); } catch {} });
  }, [region, nearActive, userLoc?.lat, userLoc?.lon, data?.updatedAt]);

  // FLIP (patrón Cortes de luz): al reordenar, desliza filas desde su posición
  // anterior (sin deps = corre en cada render; en cambios de conjunto el efecto de
  // arriba ya limpió rowPosRef y su entrada escalonada manda).
  useIsoLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const prev = rowPosRef.current;
    const nodes = list.querySelectorAll('[data-row]');
    nodes.forEach((node) => {
      const k = node.getAttribute('data-row')!;
      const oldTop = prev.get(k);
      const newTop = (node as HTMLElement).offsetTop;
      if (oldTop != null && oldTop !== newTop) {
        (node as HTMLElement).animate(
          [{ transform: `translateY(${oldTop - newTop}px)` }, { transform: 'translateY(0)' }],
          { duration: 320, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
        );
      }
    });
    const next = new Map<string, number>();
    nodes.forEach((node) => next.set(node.getAttribute('data-row')!, (node as HTMLElement).offsetTop));
    rowPosRef.current = next;
  });

  const counts = useMemo(() => {
    const c: Record<number, number> = {};
    for (const s of displayList) {
      const code = s.pm25?.statusCode ?? s.pm10?.statusCode ?? 0;
      if (code >= 1) c[code] = (c[code] ?? 0) + 1;
    }
    return c;
  }, [displayList]);

  // Carga dinámica: al hacer scroll cerca del final, muestra más estaciones.
  useEffect(() => {
    const root = listRef.current;
    const target = sentinelRef.current;
    if (!root || !target || displayList.length <= listLimit) return;
    const io = new IntersectionObserver(
      (entries) => { if (entries[0]?.isIntersecting) setListLimit(n => Math.min(n + LIST_LIMIT, displayList.length)); },
      { root, rootMargin: '120px' },
    );
    io.observe(target);
    return () => io.disconnect();
  }, [displayList.length, listLimit, region, nearActive, userLoc?.lat, userLoc?.lon]);

  const skeleton = (
    <div className="mt-4 flex min-h-[624px] flex-col rounded-xl p-4 border border-base-300 shadow-sm bg-base-200">
      <div aria-hidden="true" className="flex flex-1 flex-col">
        <div className="flex items-center gap-2">
          <div className="h-5 w-5 rounded-full bg-base-300 skel-shimmer" />
          <div className="h-4 w-44 bg-base-300 rounded skel-shimmer" />
          <div className="ml-auto h-3 w-10 rounded bg-base-300 skel-shimmer" />
        </div>
        <div className="h-8 w-32 bg-base-300 rounded mt-3 skel-shimmer" />
        <div className="h-2.5 bg-base-300 rounded w-full mt-3 skel-shimmer" />
        <div className="flex gap-1.5 mt-3">
          <div className="h-6 w-20 rounded-full bg-base-300/70 skel-shimmer" />
          <div className="h-6 w-20 rounded-full bg-base-300/70 skel-shimmer" />
          <div className="h-6 w-24 rounded-full bg-base-300/70 skel-shimmer" />
        </div>
        <div className="flex flex-1 flex-col gap-1.5 mt-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex flex-1 items-center gap-3 rounded-lg bg-base-300/40 skel-shimmer px-3">
              <div className="h-3 w-32 rounded bg-base-300 skel-shimmer" />
              <div className="h-3 w-14 rounded bg-base-300 skel-shimmer" />
              <div className="ml-auto h-3 w-10 rounded bg-base-300 skel-shimmer" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const body = () => {
    if (failed && (!data || sorted.length === 0)) {
    return (
      <div className="mt-4 rounded-xl p-4 border border-base-300 shadow-sm">
        <p className="text-sm text-base-content/70">
          <span className="mr-1.5" role="img" aria-label="nube">🌫️</span>No hay datos de calidad del aire ahora mismo.
        </p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-xs">
          <button
            onClick={() => { setLoading(true); refresh(); }}
            className="btn btn-xs btn-outline"
          >
            Reintentar
          </button>
          <span className="text-base-content/70">o consulta en:</span>
          <a href="https://airechile.mma.gob.cl/" target="_blank" rel="noopener noreferrer" className="link link-hover text-primary underline underline-offset-2">Aire Chile · MMA</a>
          <a href="https://sinca.mma.gob.cl/" target="_blank" rel="noopener noreferrer" className="link link-hover text-primary underline underline-offset-2">SINCA</a>
        </div>
      </div>
    );
  }

  if (!data || sorted.length === 0) return null;

  const worst = displayList[0] ?? sorted[0];
  const worstRow = worst.pm25 ?? worst.pm10;
  const scopeLabel = nearActive && userLoc
    ? `Cerca de ${userLoc.name}`
    : region || 'Todas las regiones';
  const alertCount = (counts[3] ?? 0) + (counts[4] ?? 0) + (counts[5] ?? 0);

  return (
    <div className="mt-4 min-h-[624px] rounded-xl p-4 border border-base-300 shadow-sm bg-base-200 flex flex-col">
      <div className="flex h-[536px] shrink-0 flex-col">
        <div className="flex items-start justify-between gap-2 pb-1.5 mb-1.5 border-b border-base-300">
          <p className="em-subhead !mb-0 !pb-0 !border-b-0">
            <span className="inline-flex items-center gap-1.5 min-w-0">
              <span><span className="mr-1.5" role="img" aria-label="nube">🌫️</span>Calidad del aire (MP 2,5)</span>
              <span className="group/airinfo relative inline-flex shrink-0">
                <button
                  type="button"
                  aria-label="Cómo leer los datos: material particulado en µg/m³ (MP 2,5; MP10 si se indica). Bandas ICAP/SINCA: Bueno, Regular, Alerta, Preemergencia, Emergencia (el color indica el estado). El valor grande es la estación más crítica del alcance. ICAP es el índice por contaminante. Cerca de mí muestra estaciones próximas (~80 km). Fuente: SINCA (medición oficial) u Open-Meteo/CAMS (estimación por modelo)."
                  className="inline-flex h-5 w-5 items-center justify-center rounded-full text-base-content/60 hover:text-base-content hover:bg-base-300 transition-colors cursor-help focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  <svg className="h-5 w-5" viewBox="-0.0 -0.0 233.0 233.0" fill="currentColor" aria-hidden="true">
                    <g transform="translate(0.000000,233.000000) scale(0.100000,-0.100000)">
                      <path d="M990 2139 c-93 -14 -246 -69 -336 -120 -97 -55 -222 -179 -301 -297 -152 -226 -205 -509 -148 -784 44 -215 197 -442 388 -578 77 -55 226 -125 323 -152 116 -32 381 -32 507 0 343 86 602 356 698 728 34 130 32 308 -5 457 -51 211 -109 319 -245 460 -123 127 -295 226 -465 268 -95 23 -317 33 -416 18z m248 -325 c74 -37 106 -93 100 -173 -11 -160 -194 -234 -315 -128 -99 87 -81 238 36 299 67 35 112 35 179 2z m47 -499 l25 -24 0 -281 c0 -267 1 -281 20 -300 11 -11 29 -20 41 -20 35 0 58 -19 68 -56 13 -47 -7 -100 -44 -114 -37 -14 -438 -13 -468 1 -65 29 -60 135 7 159 17 6 42 17 56 24 l25 12 3 197 c1 109 -2 205 -6 214 -5 8 -31 23 -58 32 -58 19 -80 53 -69 107 4 25 16 41 38 54 28 18 51 20 185 20 149 0 154 -1 177 -25z" />
                    </g>
                  </svg>
                </button>
                <span
                  role="tooltip"
                  className="pointer-events-none absolute left-0 top-full z-20 mt-2 hidden w-72 rounded-lg border border-base-300 bg-base-100 p-3 text-[11px] leading-relaxed text-base-content shadow-lg group-hover/airinfo:block group-focus-within/airinfo:block sm:left-1/2 sm:-translate-x-1/2"
                >
                  <strong className="block text-xs text-base-content mb-1">Cómo leer los datos</strong>
                  <span className="block"><b>MP 2,5 / MP 10:</b> material particulado en µg/m³. La insignia <b>MP10</b> indica que esa estación reporta MP10 (no MP2,5).</span>
                  <span className="block mt-1"><b>Bandas ICAP (SINCA):</b> Bueno, Regular, Alerta, Preemergencia y Emergencia; el color muestra el estado.</span>
                  <span className="block mt-1"><b>Valor grande:</b> estación más crítica del alcance actual (región o “Cerca de mí”). <b>ICAP</b> es el índice por contaminante.</span>
                  <span className="block mt-1"><b>Cerca de mí:</b> estaciones próximas (~80 km o las 15 más cercanas). Puedes ordenar por severidad o norte → sur.</span>
                  <span className="block mt-1"><b>Fuente:</b> SINCA = medición oficial; Open-Meteo (CAMS) = estimación por modelo.</span>
                </span>
              </span>
            </span>
          </p>
          <span className="text-[11px] text-base-content/70 shrink-0 pt-0.5">
            {new Date(data.updatedAt).toLocaleString('es-CL', {
              day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
            })}
          </span>
        </div>

      <div className="flex items-baseline flex-wrap gap-x-3 gap-y-1 mt-2">
        <span className="text-3xl font-bold text-base-content tabular-nums">{worstRow?.value ?? '—'}</span>
        <span className="text-base-content/70 text-sm font-normal">µg/m³ · {worst.nombre}</span>
        <StatusChip code={worstRow?.statusCode ?? 0} large />
      </div>
      <p className="mt-1 text-xs text-base-content/70">
        {alertCount > 0
          ? `${alertCount} ${alertCount === 1 ? 'estación' : 'estaciones'} en alerta o peor · ${scopeLabel}`
          : `Sin alertas activas · ${scopeLabel}`}
      </p>

      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-[11px] text-base-content/70">
        {[1, 2, 3, 4, 5].filter(b => counts[b]).map(b => (
          <span key={b} className="inline-flex items-center gap-1">
            <span
              className="inline-block h-2 w-2 rounded-full ring-1 ring-inset ring-black/20"
              style={{ background: AIR_STATUS[b].color }}
              aria-hidden="true"
            />
            {AIR_STATUS[b].label}: <strong className="tabular-nums">{counts[b]}</strong>
          </span>
        ))}
      </div>

      {/* Ubicación compartida (Clima / Calidad del aire) + filtro por región */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={requestUserLocation}
          disabled={geoLoading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium rounded-lg bg-base-100 border border-base-300 text-base-content/70 hover:text-base-content hover:bg-base-300 transition-[color,background-color,transform] active:scale-[0.96] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
          </svg>
          {geoLoading ? 'Obteniendo ubicación…' : (userLoc ? 'Actualizar mi ubicación' : 'Usar mi ubicación')}
        </button>
        {userLoc && (
          <button
            type="button"
            onClick={() => { setNearMe(v => !v); if (nearMe) setRegion(''); }}
            aria-pressed={nearActive}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium rounded-lg border transition-[color,background-color,border-color,transform] active:scale-[0.96] cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
              nearActive
                ? 'bg-primary text-primary-content border-primary'
                : 'bg-base-100 border-base-300 text-base-content/70 hover:text-base-content hover:bg-base-300'
            }`}
          >
            Cerca de {userLoc.name}
          </button>
        )}
      </div>

      {geoError && (
        <div
          role="alert"
          className="mt-2 flex items-start gap-2 rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-[11px] leading-relaxed text-base-content"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0 text-error" aria-hidden="true">
            <circle cx="12" cy="12" r="9" /><path d="M12 8v4m0 3v.01" />
          </svg>
          <p className="flex-1">{geoError}</p>
          <button
            type="button"
            onClick={() => setGeoError(null)}
            className="-mr-1 -mt-1 flex min-w-[24px] min-h-[24px] items-center justify-center rounded text-base-content/70 hover:text-base-content transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            aria-label="Ocultar aviso"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {!nearActive && (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          {regions.length > 1 && (
            <select
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              className="select select-xs select-bordered w-full sm:w-auto sm:min-w-52 truncate"
              aria-label="Filtrar por región"
            >
              <option value="">Todas las regiones</option>
              {regions.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          )}
          <div className="flex flex-wrap items-center gap-0.5" role="group" aria-label="Orden del listado">
            <span className="mr-0.5 text-[11px] text-base-content/70">Orden:</span>
            {([['severity', 'Más críticas'], ['ns', 'Norte → sur']] as const).map(([v, label]) => (
              <button
                key={v}
                type="button"
                onClick={() => setListSort(v)}
                aria-pressed={listSort === v}
                className={`rounded-md px-2 py-1 text-[11px] transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
                  listSort === v ? 'bg-primary/15 font-medium text-primary' : 'text-base-content/70 hover:text-base-content'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div
        ref={listRef}
        key={nearActive ? `near:${userLoc?.lat},${userLoc?.lon}` : `region:${region || 'all'}`}
        className="mt-3 min-h-0 flex-1 space-y-1 overflow-y-auto pr-1"
      >
        {displayList.slice(0, listLimit).map((s) => {
          const row = s.pm25 ?? s.pm10!;
          const dist = (s as { dist?: number }).dist;
          return (
            <div
              key={s.key || s.nombre}
              data-row={s.key || s.nombre}
              className="flex items-center gap-2 rounded-md px-1.5 py-0.5 text-xs"
            >
              <span className="text-base-content/80 min-w-0 flex-1 truncate">
                {s.nombre}
                <span className="text-base-content/70"> · {s.comuna !== s.nombre ? s.comuna : s.region}</span>
                {typeof dist === 'number' && (
                  <span className="text-base-content/70"> · {dist < 1 ? `${Math.round(dist * 1000)} m` : `${dist.toFixed(1)} km`}</span>
                )}
                {s.param === 'PM10' && (
                  <span className="ml-1 rounded px-1 text-[11px] font-semibold bg-base-content/10 text-base-content/70" title="Esta estación mide MP10, no MP2.5">
                    MP10
                  </span>
                )}
              </span>
              {row.datetime && (
                <span className="text-[11px] text-base-content/70 tabular-nums shrink-0 hidden sm:inline">
                  {row.icap != null ? `ICAP ${row.icap} · ` : ''}{fmtWhen(row.datetime)}
                </span>
              )}
              <span className="tabular-nums shrink-0 min-w-[3.5ch] text-right">{row.value}</span>
              <StatusChip code={row.statusCode} />
            </div>
          );
        })}
        {displayList.length === 0 && (
          <p className="py-2 text-[11px] text-base-content/70">Sin estaciones para esta región.</p>
        )}
        {displayList.length > listLimit && <div ref={sentinelRef} aria-hidden="true" className="h-1" />}
      </div>
      </div>

      <div className="shrink-0">
        <button
          type="button"
          onClick={() => setShowMap(s => !s)}
          aria-expanded={showMap}
          className="flex items-center gap-1 mt-3 text-[11px] text-primary hover:text-base-content transition-[color,transform] active:scale-[0.96] cursor-pointer"
        >
          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
            className={`transition-transform duration-200 ${showMap ? 'rotate-90' : ''}`} aria-hidden="true">
            <path d="M9 18l6-6-6-6" />
          </svg>
          {showMap ? `Ocultar mapa (${displayList.length} estaciones)` : `Ver mapa (${displayList.length} estaciones)`}
        </button>

        <div className={`mt-2 grid transition-[grid-template-rows] duration-300 ease-out ${showMap ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
          <div className="overflow-hidden min-h-0">
            {mapMounted && (
              <div className="rounded-lg border border-base-300 overflow-hidden bg-base-100 p-3">
                <AirQualityMap stations={displayList} allStations={sorted} lockedRegion={nearActive ? undefined : region || undefined} center={nearActive ? userLoc : null} />
              </div>
            )}
          </div>
        </div>

        <SectionSources section="air-quality" only={[data.source === 'sinca' ? 'SINCA · MMA' : 'Open-Meteo (CAMS)']} />
      </div>
    </div>
  );
  };

  return (
    <LoadSwap loading={loading} skeleton={skeleton} label="Cargando calidad del aire…">
      {loading ? null : body()}
    </LoadSwap>
  );
}
