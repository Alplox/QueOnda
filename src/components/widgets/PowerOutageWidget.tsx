import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { PowerOutageMap } from './PowerOutageMap';
import { PowerEvolutionChart } from './PowerEvolutionChart';
import { subscribeAutoRefresh } from '@/lib/auto-refresh';
import { play } from '@/lib/sound';
import { idbGet, idbSet } from '@/lib/idb-cache';
import { regionNsOrder, secRegionSlug } from '@/lib/regions';

interface Comuna {
  region: string;
  comuna: string;
  affected: number;
  lat: number;
  lon: number;
}

interface SeriesPoint {
  t: number;
  v: number;
}

interface PowerData {
  affected: number;
  total: number;
  pct: number;
  updatedAt: number;
  fetchedAt?: number;
  stale?: boolean;
  regions: Array<{ region: string; affected: number }>;
  comunas: Comuna[];
  series: SeriesPoint[];
}

async function fetchPower(fresh = false): Promise<{ data: PowerData | null; retryAfter: number | null }> {
  try {
    const res = await fetch(fresh ? '/api/power?fresh=1' : '/api/power', { signal: AbortSignal.timeout(15000) });
    if (res.status === 429) {
      const retry = Number(res.headers.get('Retry-After'));
      return { data: null, retryAfter: Number.isFinite(retry) && retry > 0 ? retry : 120 };
    }
    const data = await res.json().catch(() => null);
    if (!data) return { data: null, retryAfter: null };
    // 502 error payload has affected === null
    if (data.affected == null) return { data: null, retryAfter: null };
    return { data: data as PowerData, retryAfter: null };
  } catch { return { data: null, retryAfter: null }; }
}

const IDB_KEY = 'power';
const IDB_TTL = 10 * 60 * 1000;
// Cooldown between forced refreshes (?fresh=1 hits SEC directly) — mirrors the
// server's power-fresh rate limit so users get feedback before the 429 arrives.
const FORCE_COOLDOWN_MS = 2 * 60 * 1000;
const FORCE_AT_KEY = 'power-force-at';
const STALE_MS = 90 * 60 * 1000;
const WARN_MS = 60 * 60 * 1000;

function fmtRelative(ms: number): string {
  const diff = Date.now() - ms;
  const mins = Math.round(diff / 60000);
  if (mins < 60) return `hace ${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h < 24) return m ? `hace ${h}h ${m}min` : `hace ${h}h`;
  const d = Math.floor(h / 24);
  return `hace ${d}d`;
}

const miles = (n: number) => Number(n).toLocaleString('es-CL');
// SSR-safe layout effect (Astro prerenders islands on the server, where
// useLayoutEffect is a noop that warns — use useEffect there instead).
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;
// Índice norte → sur de un NOMBRE_REGION de la SEC (normaliza sus rarezas:
// "O`Higgins" con backtick, "Tarapaca"/"Biobio" sin tilde). Desconocidas al final.
const secNsIndex = (nombreRegion: string) => regionNsOrder(secRegionSlug(nombreRegion) ?? '');

export function PowerOutageWidget() {
  const [data, setData] = useState<PowerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [showChart, setShowChart] = useState(false);
  const [mapMounted, setMapMounted] = useState(false);
  const [chartMounted, setChartMounted] = useState(false);
  const [tab, setTab] = useState<'regiones' | 'comunas'>('regiones');
  const [regionSort, setRegionSort] = useState<'affected' | 'ns'>('affected');
  const [comunaRegion, setComunaRegion] = useState<string | null>(null);
  const [mapFocusRegion, setMapFocusRegion] = useState<string | null>(null);
  const [forcing, setForcing] = useState(false);
  const [cooldownLeft, setCooldownLeft] = useState(0);
  const [forceStatus, setForceStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const forceStatusTimer = useRef<number | null>(null);
  const showForceStatus = useCallback((ok: boolean, msg: string) => {
    setForceStatus({ ok, msg });
    if (forceStatusTimer.current) window.clearTimeout(forceStatusTimer.current);
    forceStatusTimer.current = window.setTimeout(() => setForceStatus(null), 6000);
  }, []);

  // Keep map/chart mounted through their 300ms collapse so the exit animates like the weather map
  useEffect(() => {
    if (showMap) setMapMounted(true);
    else { const t = setTimeout(() => setMapMounted(false), 300); return () => clearTimeout(t); }
  }, [showMap]);
  useEffect(() => {
    if (showChart) setChartMounted(true);
    else { const t = setTimeout(() => setChartMounted(false), 300); return () => clearTimeout(t); }
  }, [showChart]);

  const dataRef = useRef<PowerData | null>(null);
  // Newest-wins: after a force refresh the origin cache is fresh, but the CDN
  // edge key of plain /api/power (and IDB) can still serve the older snapshot
  // on the next auto-refresh — never let an older fetchedAt overwrite newer data.
  const adopt = useCallback((d: PowerData) => {
    const prev = dataRef.current;
    if (prev && (prev.fetchedAt ?? 0) > (d.fetchedAt ?? 0)) return false;
    dataRef.current = d;
    setData(d);
    idbSet(IDB_KEY, d, IDB_TTL);
    return true;
  }, []);

  const refresh = useCallback(async () => {
    const { data: d } = await fetchPower();
    if (d) {
      adopt(d);
      setError(false);
    } else {
      // keep stale data visible but mark error so banner/retry shows
      setError(true);
    }
    setLoading(false);
  }, [adopt]);

  // Pin on a region row: open the map flying to that region (sismo openMap pattern)
  const openRegionMap = useCallback((regionName: string) => {
    play('interaction.toggle');
    setMapFocusRegion(regionName);
    setShowMap(true);
  }, []);

  // Forced refresh: bypasses every server cache tier (?fresh=1 hits SEC
  // directly). Throttled to 1 attempt per 2 min, persisted across reloads.
  const forceRefresh = useCallback(async () => {
    if (forcing || cooldownLeft > 0) return;
    play('interaction.tap');
    setForcing(true);
    const { data: d, retryAfter } = await fetchPower(true);
    if (d) {
      adopt(d);
      setError(false);
      try { localStorage.setItem(FORCE_AT_KEY, String(Date.now())); } catch {}
      setCooldownLeft(Math.ceil(FORCE_COOLDOWN_MS / 1000));
      showForceStatus(true, `Datos actualizados a las ${new Date(d.fetchedAt ?? Date.now()).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}`);
    } else if (retryAfter != null) {
      try { localStorage.setItem(FORCE_AT_KEY, String(Date.now())); } catch {}
      setCooldownLeft(retryAfter);
      showForceStatus(false, `Límite alcanzado — reintenta en ${retryAfter}s`);
    } else {
      // keep stale data visible but mark error so banner/retry shows
      setError(true);
      showForceStatus(false, 'No se pudo actualizar — SEC no disponible');
    }
    setForcing(false);
  }, [forcing, cooldownLeft, adopt, showForceStatus]);

  // Restore force-refresh cooldown after reload
  useEffect(() => {
    try {
      const last = Number(localStorage.getItem(FORCE_AT_KEY) ?? 0);
      if (last > 0) setCooldownLeft(Math.max(0, Math.ceil((last + FORCE_COOLDOWN_MS - Date.now()) / 1000)));
    } catch { /* storage unavailable */ }
  }, []);

  // Tick the cooldown countdown once per second
  useEffect(() => {
    if (cooldownLeft <= 0) return;
    const t = setTimeout(() => setCooldownLeft(s => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(t);
  }, [cooldownLeft]);

  // Clear the force-status message timer on unmount
  useEffect(() => () => { if (forceStatusTimer.current) window.clearTimeout(forceStatusTimer.current); }, []);

  useEffect(() => {
    let cancelled = false;
    idbGet<PowerData>(IDB_KEY).then(cached => {
      if (cancelled || !cached?.data) return;
      if (cached.data.affected != null) {
        adopt(cached.data);
        setLoading(false);
      }
    });
    refresh();
    return () => { cancelled = true; };
  }, [refresh, adopt]);

  useEffect(() => subscribeAutoRefresh(refresh), [refresh]);

  // prefetch leaflet JS at idle so opening the map doesn't wait for the ~144 KB chunk
  useEffect(() => {
    const id = requestIdleCallback(() => { import('leaflet').catch(() => {}); });
    return () => cancelIdleCallback(id);
  }, []);

  // FLIP refs: glide region rows to their new positions on reorder instead of
  // replaying the entrance stagger (changing animation-delay restarts CSS anims)
  const listRef = useRef<HTMLDivElement>(null);
  const rowPosRef = useRef(new Map<string, number>());

  useIsoLayoutEffect(() => {
    const list = listRef.current;
    if (!list || tab !== 'regiones') {
      // clear stale positions so returning to the tab doesn't glide from them
      if (tab !== 'regiones') rowPosRef.current.clear();
      return;
    }
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
          { duration: 350, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
        );
      }
    });
    const next = new Map<string, number>();
    nodes.forEach((node) => next.set(node.getAttribute('data-row')!, (node as HTMLElement).offsetTop));
    rowPosRef.current = next;
  });

  // Imperative staggered entrance for region rows: a CSS animation-delay tied
  // to the row index restarts the animation on every reorder, so the cascade
  // is played via WAAPI only on mount / tab switch / new data hour instead.
  // (Sort toggles don't retrigger this effect, so only the FLIP glide runs.)
  useIsoLayoutEffect(() => {
    const list = listRef.current;
    if (!list || tab !== 'regiones') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const anims = Array.from(list.querySelectorAll('[data-row]')).map((node, i) =>
      (node as HTMLElement).animate(
        [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'translateY(0)' }],
        { duration: 300, delay: Math.min(i * 40, 400), easing: 'ease-out', fill: 'backwards' },
      ),
    );
    return () => anims.forEach((a) => { try { a.cancel(); } catch { /* already finished */ } });
  }, [tab, data?.updatedAt]);

  const visibleComunas = useMemo(() => {
    const list = data?.comunas ?? [];
    return comunaRegion ? list.filter(c => c.region === comunaRegion) : list;
  }, [data, comunaRegion]);

  // NOTE: hooks must stay above the early returns below — a useMemo placed
  // after `if (loading) return …` changes the hook count between renders
  // and crashes React ("Rendered more hooks than during the previous render").
  const sortedRegions = useMemo(() => {
    const list = data?.regions ?? [];
    if (regionSort !== 'ns') return list;
    return [...list].sort((a, b) => secNsIndex(a.region) - secNsIndex(b.region));
  }, [data, regionSort]);

  if (loading) {
    return (
      <div className="mt-4 rounded-xl p-4 border border-base-300 shadow-sm animate-[fadeInUp_0.3s_ease-out]">
        <div className="flex items-center gap-2 animate-pulse">
          <div className="h-5 w-5 rounded-full bg-base-300" />
          <div className="h-4 w-40 bg-base-300 rounded" />
        </div>
        <div className="h-8 w-28 bg-base-300 rounded mt-3 animate-pulse" />
        <div className="h-2.5 bg-base-300 rounded w-full mt-3 animate-pulse" />
        <div className="h-2.5 bg-base-300 rounded w-3/4 mt-1.5 animate-pulse" />
      </div>
    );
  }

  if (!data || data.total === 0) {
    if (error) {
      return (
        <div className="mt-4 rounded-xl p-4 border border-warning/30 bg-warning/10 shadow-sm animate-[fadeInUp_0.3s_ease-out]">
          <p className="text-xs text-base-content/80">No se pudo cargar el estado eléctrico (SEC no disponible).</p>
          <button type="button" onClick={() => { setLoading(true); setError(false); refresh(); }} className="mt-2 px-3 py-1.5 rounded-lg bg-primary text-primary-content text-xs font-semibold hover:opacity-90 active:scale-[0.97] transition-all cursor-pointer">Reintentar</button>
        </div>
      );
    }
    return null;
  }

  const rows = tab === 'regiones' ? sortedRegions : visibleComunas;
  // Bar denominator: global max of the dataset, NOT rows[0] — in N→S order
  // rows[0] is Arica, which would peg every bar near 100%.
  const barMax = tab === 'regiones'
    ? Math.max(1, ...sortedRegions.map((r) => r.affected))
    : (rows[0]?.affected ?? 1);
  const isStale = !!data.stale || (data.updatedAt != null && Date.now() - data.updatedAt > STALE_MS);
  const isWarn = !isStale && data.updatedAt != null && Date.now() - data.updatedAt > WARN_MS;
  const absTime = new Date(data.updatedAt).toLocaleString('es-CL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const rel = fmtRelative(data.updatedAt);
  // updatedAt = hora del bloque que publica la SEC (solo cambia cada hora);
  // fetchedAt = cuándo trajimos este snapshot (lo que actualiza un forzado).
  // Mostrar solo updatedAt confunde ("hace 52 min" con datos recién traídos).
  const relFetch = fmtRelative(data.fetchedAt ?? data.updatedAt);
  // Next expected publication hour — only shown mid-wait so newcomers learn
  // what the tint means without a detached legend.
  const nextHour = new Date(data.updatedAt + 3600000).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });

  return (
    <div className={`mt-4 rounded-xl p-4 border shadow-sm animate-[fadeInUp_0.3s_ease-out] ${isStale ? 'border-warning/40 bg-warning/10' : isWarn ? 'border-warning/25 bg-warning/5' : 'border-base-300 bg-base-200'}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="em-subhead !mb-0 !pb-1">
          <span><span className="mr-1.5" role="img" aria-label="rayo">⚡</span>Clientes sin suministro eléctrico</span>
        </p>
        <button
          type="button"
          onClick={forceRefresh}
          disabled={forcing || cooldownLeft > 0}
          title={cooldownLeft > 0 ? `Reintenta en ${cooldownLeft}s` : 'Pide datos frescos directo a la SEC (máx. 1 vez cada 2 min)'}
          aria-live="off"
          className="shrink-0 mt-0.5 px-2.5 py-1 min-w-[20ch] text-center rounded-md bg-base-100 border border-base-300 text-[11px] font-semibold hover:bg-base-200 transition-colors cursor-pointer active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {forcing ? 'Actualizando…' : cooldownLeft > 0 ? (<>Reintentar en <span className="inline-block w-[5ch] text-right tabular-nums">{cooldownLeft}s</span></>) : 'Forzar actualización'}
        </button>
      </div>
      <p className={`mt-0.5 text-[10px] ${isStale ? 'text-warning font-semibold' : 'text-base-content/50'}`} title={`Dato: ${new Date(data.updatedAt).toISOString()} · Obtenido: ${new Date(data.fetchedAt ?? data.updatedAt).toISOString()}`}>
        {absTime} · actualizado {relFetch}
        {isStale ? ' · desactualizado' : isWarn ? ` · esperando las ${nextHour}` : ''}
      </p>
      {forceStatus && (
        <p role="status" aria-live="polite" className={`mt-1 text-[11px] font-medium ${forceStatus.ok ? 'text-success' : 'text-error'}`}>
          {forceStatus.msg}
        </p>
      )}

      {isStale && (
        <div className="mt-2 rounded-lg px-3 py-2 text-xs bg-warning/15 border border-warning/30 text-warning" role="status" aria-live="polite">
          <span className="leading-snug">
            {`⚠️ Datos desactualizados — SEC sin actualizar ${rel} (último reporte ${absTime}). Este número puede no reflejar cortes actuales.`}
          </span>
        </div>
      )}

      {error && !isStale && (
        <div className="mt-2 text-[11px] text-warning flex items-center gap-2">No se pudo actualizar — mostrando último dato disponible.<button type="button" onClick={() => refresh()} className="underline hover:text-base-content cursor-pointer">Reintentar</button></div>
      )}

      <div className="flex items-baseline gap-3 mt-2 animate-[heroFadeUp_0.4s_ease-out]">
        <span className="text-3xl font-bold text-base-content tabular-nums">{miles(data.affected)}</span>
        <span className="text-base-content/70 text-sm font-normal"> de {miles(data.total)}</span>
        <span className={`text-sm font-medium ${data.pct >= 2 ? 'text-error' : 'text-base-content/70'}`}>
          ({data.pct.toFixed(2)}% del país)
        </span>
      </div>

      <div className="mt-3 text-[11px] text-base-content/70">
        ¿Corte de luz? Reporta:{' '}
        <a href="https://www.sec.cl/reclamo-por-corte-de-luz/" target="_blank" rel="noopener noreferrer"
          className="hover:text-base-content underline underline-offset-2 transition-colors">SEC</a>
        {' · '}
        <a href="https://sucursalvirtual.cge.cl/estas-sin-luz" target="_blank" rel="noopener noreferrer"
          className="hover:text-base-content underline underline-offset-2 transition-colors">CGE</a>
        {' · '}
        <a href="https://desconexiones.gruposaesa.cl/estoy-sin-luz" target="_blank" rel="noopener noreferrer"
          className="hover:text-base-content underline underline-offset-2 transition-colors">Grupo Saesa</a>
        {' · '}
        <a href="https://www.enel.cl/es/clientes/servicios-en-linea/solicitud-contacto.html" target="_blank" rel="noopener noreferrer"
          className="hover:text-base-content underline underline-offset-2 transition-colors">Enel</a>
        {' · '}
        <a href="https://www.chilquinta.cl/reportar-corte" target="_blank" rel="noopener noreferrer"
          className="hover:text-base-content underline underline-offset-2 transition-colors">Chilquinta</a>
      </div>

      <div className="mt-3">
        <div className="flex gap-1">
          <button
            onClick={() => setTab('regiones')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer active:scale-[0.96] ${
              tab === 'regiones'
                ? 'bg-primary text-primary-content'
                : 'bg-base-300 text-base-content/60 hover:text-base-content'
            }`}
          >
            Regiones
          </button>
          <button
            onClick={() => { setComunaRegion(null); setTab('comunas'); }}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer active:scale-[0.96] ${
              tab === 'comunas'
                ? 'bg-primary text-primary-content'
                : 'bg-base-300 text-base-content/60 hover:text-base-content'
            }`}
          >
            Comunas ({data.comunas.length})
          </button>
        </div>

        {tab === 'comunas' && (
          <div className="mt-2 flex items-center gap-2">
            <label htmlFor="power-comuna-region" className="text-[11px] text-base-content/60 shrink-0">Región:</label>
            <select
              id="power-comuna-region"
              value={comunaRegion ?? ''}
              onChange={(e) => setComunaRegion(e.target.value || null)}
              className="text-[11px] bg-base-100 border border-base-300 rounded-md px-1.5 py-1 text-base-content outline-none focus:border-primary/40 cursor-pointer min-w-0 flex-1"
            >
              <option value="">Todas ({data.comunas.length})</option>
              {data.regions.map(r => (
                <option key={r.region} value={r.region}>{r.region} · {miles(r.affected)}</option>
              ))}
            </select>
          </div>
        )}

        {tab === 'regiones' && (
          <div className="mt-2 flex items-center gap-1" role="group" aria-label="Orden de regiones">
            <span className="text-[10px] text-base-content/50">Orden:</span>
            {([['affected', 'Más afectados'], ['ns', 'Norte → sur']] as const).map(([v, label]) => (
              <button
                key={v}
                type="button"
                onClick={() => { play('interaction.tap'); setRegionSort(v); }}
                aria-pressed={regionSort === v}
                className={`text-[10px] px-2 py-1 rounded-md transition-colors cursor-pointer ${
                  regionSort === v ? 'bg-primary/15 text-primary font-medium' : 'text-base-content/50 hover:text-base-content/70'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        <div ref={listRef} className={tab === 'comunas' ? 'mt-2 space-y-1.5 max-h-72 overflow-y-auto pr-1' : 'mt-2 space-y-1.5'}>
          {rows.map((r, i) => {
            const name = tab === 'regiones' ? (r as { region: string }).region : (r as Comuna).comuna;
            const key = tab === 'regiones' ? name : `${(r as Comuna).region} — ${(r as Comuna).comuna}`;
            const bar = (
              <>
                <span className="text-base-content/80 w-28 shrink-0 truncate">
                  {name}
                </span>
                <div className="flex-1 h-1.5 rounded-full bg-base-300 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${Math.max(3, (r.affected / barMax) * 100)}%` }}
                  />
                </div>
                <span className="text-base-content/70 tabular-nums shrink-0">{miles(r.affected)}</span>
              </>
            );
            // Cap stagger delay: 248 comunas × 40ms would freeze the tail for ~10s
            const style = { animationDelay: `${Math.min(i * 40, 400)}ms` };
            return tab === 'regiones' ? (
              <div
                key={key}
                data-row={key}
                className="flex items-center gap-1"
              >
                <button
                  type="button"
                  onClick={() => { play('interaction.tap'); setComunaRegion((r as { region: string }).region); setTab('comunas'); }}
                  title={`Ver comunas de ${name}`}
                  aria-label={`Ver comunas de ${name}`}
                  className="flex items-center gap-2 flex-1 min-w-0 text-xs text-left cursor-pointer rounded-md px-1 -mx-1 py-0.5 hover:bg-base-300/50 active:scale-[0.99] transition-all"
                >
                  {bar}
                </button>
                <button
                  type="button"
                  onClick={() => openRegionMap((r as { region: string }).region)}
                  title={`Ver mapa de ${name}`}
                  aria-label={`Ver mapa de ${name}`}
                  aria-expanded={showMap && mapFocusRegion === (r as { region: string }).region}
                  className="shrink-0 p-1.5 rounded-md text-base-content/50 hover:text-primary hover:bg-primary/10 active:scale-95 transition-all cursor-pointer"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 21s-7-5.5-7-11a7 7 0 1 1 14 0c0 5.5-7 11-7 11z" />
                    <circle cx="12" cy="10" r="2.5" />
                  </svg>
                </button>
              </div>
            ) : (
              <div key={key} className="flex items-center gap-2 text-xs animate-[fadeInUp_0.3s_ease-out_both]"
                style={style}>
                {bar}
              </div>
            );
          })}
          {tab === 'comunas' && rows.length === 0 && (
            <p className="text-[11px] text-base-content/60 py-2">Sin comunas con cortes registrados en esta región.</p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3">
        <button
          type="button"
          onClick={() => { play('interaction.toggle'); if (!showMap) setMapFocusRegion(null); setShowMap(s => !s); }}
          aria-expanded={showMap}
          className="flex items-center gap-1 text-[10px] text-primary hover:text-base-content transition-[color,transform] active:scale-[0.96] cursor-pointer"
        >
          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
            className={`transition-transform duration-200 ${showMap ? 'rotate-90' : ''}`}>
            <path d="M9 18l6-6-6-6" />
          </svg>
          {showMap ? 'Ocultar mapa' : 'Ver mapa por comuna'}
        </button>
        <button
          type="button"
          onClick={() => { play('interaction.toggle'); setShowChart(s => !s); }}
          aria-expanded={showChart}
          className="flex items-center gap-1 text-[10px] text-primary hover:text-base-content transition-[color,transform] active:scale-[0.96] cursor-pointer"
        >
          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
            className={`transition-transform duration-200 ${showChart ? 'rotate-90' : ''}`}>
            <path d="M9 18l6-6-6-6" />
          </svg>
          {showChart ? 'Ocultar evolución' : 'Ver evolución'}
        </button>
      </div>

      <div className={`mt-2 grid transition-[grid-template-rows] duration-300 ease-out ${showMap ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
        <div className="overflow-hidden min-h-0">
          {mapMounted && (
            <div className="rounded-lg border border-base-300 overflow-hidden bg-base-100 p-3">
              <PowerOutageMap comunas={data.comunas} focusRegion={mapFocusRegion} />
            </div>
          )}
        </div>
      </div>

      <div className={`mt-2 grid transition-[grid-template-rows] duration-300 ease-out ${showChart ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
        <div className="overflow-hidden min-h-0">
          {chartMounted && (
            <div className="rounded-lg border border-base-300 overflow-hidden bg-base-100 p-3">
              <PowerEvolutionChart series={data.series} />
            </div>
          )}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-end justify-between gap-x-3 gap-y-1 text-[10px] text-base-content/50">
        <span className="max-w-[70%] leading-snug">
          La SEC publica por hora, pero puede corregir los datos de esa hora sin cambiar la hora publicada.
        </span>
        <span className="text-right">
          Fuente:{' '}
          <a
            href="https://apps.sec.cl/INTONLINEv1/index.aspx"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-base-content underline underline-offset-2 transition-colors"
          >
            SEC
          </a>
        </span>
      </div>
    </div>
  );
}
