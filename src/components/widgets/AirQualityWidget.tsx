import { useCallback, useEffect, useMemo, useState } from 'react';
import { AirQualityMap } from './AirQualityMap';
import { AIR_STATUS, airSeverity, orderedRegions } from '@/lib/air-quality';
import type { AirData, AirStation } from '@/lib/air-quality';
import { idbGet, idbSet } from '@/lib/idb-cache';

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
  const [region, setRegion] = useState('');

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

  const filtered = useMemo(
    () => (region ? sorted.filter((s) => s.region === region) : sorted),
    [sorted, region],
  );

  const counts = useMemo(() => {
    const c: Record<number, number> = {};
    for (const s of sorted) {
      const code = s.pm25?.statusCode ?? s.pm10?.statusCode ?? 0;
      if (code >= 1) c[code] = (c[code] ?? 0) + 1;
    }
    return c;
  }, [sorted]);

  if (loading) {
    return (
      <div className="mt-4 rounded-xl p-4 border border-base-300 shadow-sm animate-[fadeInUp_0.3s_ease-out]">
        <div className="flex items-center gap-2 animate-pulse">
          <div className="h-5 w-5 rounded-full bg-base-300" />
          <div className="h-4 w-44 bg-base-300 rounded" />
        </div>
        <div className="h-8 w-32 bg-base-300 rounded mt-3 animate-pulse" />
        <div className="h-2.5 bg-base-300 rounded w-full mt-3 animate-pulse" />
        <div className="h-2.5 bg-base-300 rounded w-2/3 mt-1.5 animate-pulse" />
      </div>
    );
  }

  if (failed && (!data || sorted.length === 0)) {
    return (
      <div className="mt-4 rounded-xl p-4 border border-base-300 shadow-sm animate-[fadeInUp_0.3s_ease-out]">
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
          <span className="text-base-content/50">o consulta en:</span>
          <a href="https://airechile.mma.gob.cl/" target="_blank" rel="noopener noreferrer" className="link link-hover text-primary underline underline-offset-2">Aire Chile · MMA</a>
          <a href="https://sinca.mma.gob.cl/" target="_blank" rel="noopener noreferrer" className="link link-hover text-primary underline underline-offset-2">SINCA</a>
        </div>
      </div>
    );
  }

  if (!data || sorted.length === 0) return null;

  const worst = sorted[0];
  const worstRow = worst.pm25 ?? worst.pm10;

  return (
    <div className="mt-4 rounded-xl p-4 border border-base-300 shadow-sm bg-base-200 animate-[fadeInUp_0.3s_ease-out]">
      <div className="flex items-center justify-between gap-2">
        <p className="em-subhead !mb-0 !pb-1">
          <span><span className="mr-1.5" role="img" aria-label="nube">🌫️</span>Calidad del aire (MP 2,5)</span>
          <span className="text-[10px] text-base-content/50">
            {new Date(data.updatedAt).toLocaleString('es-CL', {
              day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
            })}
          </span>
        </p>
      </div>

      <div className="flex items-baseline gap-3 mt-2 animate-[heroFadeUp_0.4s_ease-out]">
        <span className="text-3xl font-bold text-base-content tabular-nums">{worstRow?.value ?? '—'}</span>
        <span className="text-base-content/70 text-sm font-normal">µg/m³ en {worst.nombre}</span>
        <StatusChip code={worstRow?.statusCode ?? 0} large />
      </div>

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

      {regions.length > 1 && (
        <select
          value={region}
          onChange={(e) => setRegion(e.target.value)}
          className="select select-xs select-bordered mt-3 w-full sm:w-auto sm:min-w-52 truncate"
          aria-label="Filtrar estaciones por región"
        >
          <option value="">Todas las regiones</option>
          {regions.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
      )}

      <div className="mt-3 space-y-1.5">
        {filtered.slice(0, 15).map((s: AirStation, i: number) => {
          const row = s.pm25 ?? s.pm10!;
          return (
            <div key={s.key || s.nombre} className="flex items-center gap-2 text-xs animate-[fadeInUp_0.3s_ease-out_both]"
              style={{ animationDelay: `${i * 40}ms` }}>
              <span className="text-base-content/80 min-w-0 flex-1 truncate">
                {s.nombre}
                <span className="text-base-content/50"> · {s.comuna !== s.nombre ? s.comuna : s.region}</span>
                {s.param === 'PM10' && (
                  <span className="ml-1 rounded px-1 text-[9px] font-semibold bg-base-content/10 text-base-content/70" title="Esta estación mide MP10, no MP2.5">
                    MP10
                  </span>
                )}
              </span>
              {row.icap != null && (
                <span className="text-[10px] text-base-content/50 tabular-nums shrink-0 hidden sm:inline">
                  ICAP {row.icap} · {fmtWhen(row.datetime)}
                </span>
              )}
              <span className="tabular-nums shrink-0">{row.value}</span>
              <StatusChip code={row.statusCode} />
            </div>
          );
        })}
        {filtered.length > 15 && (
          <p className="text-[10px] text-base-content/50 pt-1">
            y {filtered.length - 15} estaciones más en el mapa ↓
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={() => setShowMap(s => !s)}
        aria-expanded={showMap}
        className="flex items-center gap-1 mt-3 text-[10px] text-primary hover:text-base-content transition-[color,transform] active:scale-[0.96] cursor-pointer"
      >
        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
          className={`transition-transform duration-200 ${showMap ? 'rotate-90' : ''}`} aria-hidden="true">
          <path d="M9 18l6-6-6-6" />
        </svg>
        {showMap ? `Ocultar mapa (${filtered.length} estaciones)` : `Ver mapa (${filtered.length} estaciones)`}
      </button>

      <div className={`mt-2 grid transition-[grid-template-rows] duration-300 ease-out ${showMap ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
        <div className="overflow-hidden min-h-0">
          {mapMounted && (
            <div className="rounded-lg border border-base-300 overflow-hidden bg-base-100 p-3">
              <AirQualityMap stations={filtered} />
            </div>
          )}
        </div>
      </div>

      <div className="mt-2 text-right text-[10px] text-base-content/50">
        Fuente:{' '}
        {data.source === 'sinca' ? (
          <a
            href="https://sinca.mma.gob.cl/"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-base-content underline underline-offset-2 transition-colors"
          >
            SINCA · MMA
          </a>
        ) : (
          <a
            href="https://open-meteo.com/en/docs/air-quality-api"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-base-content underline underline-offset-2 transition-colors"
          >
            Open-Meteo (CAMS)
          </a>
        )}
      </div>
    </div>
  );
}
