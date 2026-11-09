import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { subscribeAutoRefresh } from '@/lib/auto-refresh';
import { play } from '@/lib/sound';
import { idbGet, idbSet } from '@/lib/idb-cache';
import { regionNsOrder, secRegionSlug } from '@/lib/regions';
import { useErrorRetry } from '@/lib/retry';
import { RetryHint } from '@/components/RetryHint';
import { LoadSwap } from '@/components/LoadSwap';
import { SectionSources } from '../SectionSources';

type PowerMapProps = { comunas: Comuna[]; focusRegion?: string | null; focusRequest?: number };
type PowerChartProps = { series: SeriesPoint[] };

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

interface RegionRow {
  region: string;
  affected: number;
  /** Clientes totales de la región (la SEC no lo da por comuna). */
  total?: number;
  /** % de los clientes de la región sin suministro. */
  pct?: number;
}

interface PowerData {
  affected: number;
  total: number;
  pct: number;
  updatedAt: number;
  fetchedAt?: number;
  stale?: boolean;
  regions: RegionRow[];
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
const STALE_MS = 60 * 60 * 1000;
const WARN_MS = 45 * 60 * 1000;

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

// La barra siempre mide AQUÍ LO QUE ORDENA LA LISTA: con «Más afectados» (o
// «Norte → sur») mide clientes, y con «Mayor %» mide afectados ÷ los clientes
// de ESA región —así el largo baja de mayor a menor en ambos casos y una región
// nunca se mide contra otra.
// En modo % existen dos escalas:
//  - 'zoom' (por defecto): el track llega a un tope redondo ≥ la peor proporción
//    (0,5 %, 1 %, 2 %…), porque los cortes reales son 0,0x–0,x % y con 0–100 %
//    todas las barras quedan en 1–4 px.
//  - 'real': 0 → 100 % de los clientes de la región, sin ampliación.
// Comunas: la SEC no publica base de clientes por comuna, así que ahí la barra
// mide volumen contra la comuna más afectada.
// Piso en píxeles (no en %): 3 px para que la última fila no desaparezca sin
// exagerar su largo real.
const MIN_FILL_PX = 3;
const SCALE_KEY = 'power-scale';
// El desglose (pestañas Regiones/Comunas + filtros + listado) se puede colapsar
// para dejar sólo el número general. Arranca expandido; sólo se colapsa si el
// usuario lo pidió antes ('closed').
const BREAKDOWN_KEY = 'power-breakdown';
type PowerScale = 'zoom' | 'real';
// Topes "redondos": el primero ≥ la peor proporción. Evita el salto de década
// (con topes 1/10/100 una región al 8 % dejaría el resto de las barras en 1 px)
// y nunca usa a la región más afectada como 100 % exacto.
const PCT_CAPS = [0.01, 0.02, 0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 100];
const pctCap = (max: number) => PCT_CAPS.find((c) => max <= c) ?? 100;

function fmtPct(pct: number): string {
  const digits = pct >= 10 ? 0 : pct >= 1 ? 1 : pct >= 0.1 ? 2 : 3;
  return `${pct.toLocaleString('es-CL', { minimumFractionDigits: digits, maximumFractionDigits: digits })} %`;
}
// SSR-safe layout effect (Astro prerenders islands on the server, where
// useLayoutEffect is a noop that warns — use useEffect there instead).
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;
// Índice norte → sur de un NOMBRE_REGION de la SEC (normaliza sus rarezas:
// "O`Higgins" con backtick, "Tarapaca"/"Biobio" sin tilde). Desconocidas al final.
const secNsIndex = (nombreRegion: string) => regionNsOrder(secRegionSlug(nombreRegion) ?? '');

export function PowerOutageWidget({
  initialBreakdown,
  onSummary,
}: {
  initialBreakdown?: boolean;
  /** Notifica al contenedor (EmergencyWidget) el conteo/meta para el resumen compartible, evitando un fetch duplicado de /api/power. */
  onSummary?: (summary: { affected: number | null; updatedAt: number | null; stale: boolean } | null) => void;
} = {}) {
  const [data, setData] = useState<PowerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [showChart, setShowChart] = useState(false);
  const [mapMounted, setMapMounted] = useState(false);
  const [chartMounted, setChartMounted] = useState(false);
  const [PowerMapComp, setPowerMapComp] = useState<ComponentType<PowerMapProps> | null>(null);
  const [PowerChartComp, setPowerChartComp] = useState<ComponentType<PowerChartProps> | null>(null);
  const [tab, setTab] = useState<'regiones' | 'comunas'>('regiones');
  const [showBreakdown, setShowBreakdown] = useState(initialBreakdown ?? true);
  const [regionSort, setRegionSort] = useState<'pct' | 'affected' | 'ns'>('affected');
  const [scale, setScale] = useState<PowerScale>('zoom');
  const [comunaRegion, setComunaRegion] = useState<string | null>(null);
  const [mapFocusRegion, setMapFocusRegion] = useState<string | null>(null);
  const [mapFocusRequest, setMapFocusRequest] = useState(0);
  const [forcing, setForcing] = useState(false);
  const [cooldownLeft, setCooldownLeft] = useState(0);
  const [forceStatus, setForceStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const forceStatusTimer = useRef<number | null>(null);
  const showForceStatus = useCallback((ok: boolean, msg: string) => {
    setForceStatus({ ok, msg });
    if (forceStatusTimer.current) window.clearTimeout(forceStatusTimer.current);
    forceStatusTimer.current = window.setTimeout(() => setForceStatus(null), 6000);
  }, []);

  // Escala de las barras (Regiones): preferencia por navegador. Se lee después
  // del mount porque el servidor no tiene localStorage (evita el desajuste de
  // hidratación), pero en un layout effect: si no, el esqueleto se pinta
  // desplegado (918 px) y colapsa al siguiente frame cuando el usuario tenía
  // el desglose cerrado.
  useIsoLayoutEffect(() => {
    try {
      if (localStorage.getItem(SCALE_KEY) === 'real') setScale('real');
      // Si el servidor ya nos dio la preferencia (cookie), no la pisamos con
      // localStorage: evita el flash de esqueleto grande → pequeño en la carga.
      if (initialBreakdown === undefined && localStorage.getItem(BREAKDOWN_KEY) === 'closed') {
        setShowBreakdown(false);
      }
    } catch {}
  }, [initialBreakdown]);
  const chooseScale = (v: PowerScale) => {
    play('interaction.tap');
    setScale(v);
    try { localStorage.setItem(SCALE_KEY, v); } catch {}
  };
  // Colapsar el desglose (pestañas + filtros + listado) deja sólo el número
  // general del país. Arranca expandido y la preferencia persiste por navegador.
  const toggleBreakdown = () => {
    play('interaction.toggle');
    setShowBreakdown((v) => {
      const next = !v;
      try { localStorage.setItem(BREAKDOWN_KEY, next ? 'open' : 'closed'); } catch {}
      try { document.cookie = `power-breakdown=${next ? 'open' : 'closed'}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`; } catch {}
      return next;
    });
  };

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
  const inflight = useRef<Promise<void> | null>(null);
  // Ref para no depender de la identidad del callback del padre: un onSummary
  // inline recreaba adopt→refresh→efecto de montaje en cada render y disparaba
  // /api/power en bucle.
  const onSummaryRef = useRef(onSummary);
  onSummaryRef.current = onSummary;
  // Newest-wins: after a force refresh the origin cache is fresh, but the CDN
  // edge key of plain /api/power (and IDB) can still serve the older snapshot
  // on the next auto-refresh — never let an older fetchedAt overwrite newer data.
  const adopt = useCallback((d: PowerData) => {
    const prev = dataRef.current;
    if (prev && (prev.fetchedAt ?? 0) > (d.fetchedAt ?? 0)) return false;
    dataRef.current = d;
    setData(d);
    idbSet(IDB_KEY, d, IDB_TTL);
    const stale = !!d.stale || (d.updatedAt != null && Date.now() - d.updatedAt > STALE_MS);
    onSummaryRef.current?.({ affected: d.affected, updatedAt: d.updatedAt ?? null, stale });
    return true;
  }, []);

  const refresh = useCallback(async () => {
    // One in-flight request at a time: the retry timer, the manual button and the
    // shared auto-refresh can all land in the same second.
    if (inflight.current) return inflight.current;
    const run = (async () => {
      const { data: d } = await fetchPower();
      if (d) {
        adopt(d);
        setError(false);
      } else {
        // keep stale data visible but mark error so banner/retry shows
        setError(true);
        onSummaryRef.current?.(null);
      }
      setLoading(false);
    })();
    inflight.current = run;
    try { await run; } finally { if (inflight.current === run) inflight.current = null; }
  }, [adopt]);

  // Reintento (automático con backoff + manual) del bloque en error: mantiene el
  // bloque en pantalla y comparte el mismo contador entre el error y la franja.
  const { retrying, retryIn, retryNow } = useErrorRetry(error, refresh);

  // Pin on a region row: open the map flying to that region (sismo openMap pattern)
  const openRegionMap = useCallback((regionName: string) => {
    play('interaction.toggle');
    setMapFocusRegion(regionName);
    setMapFocusRequest((n) => n + 1);
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
      const dStale = !!d.stale || (d.updatedAt != null && Date.now() - d.updatedAt > STALE_MS);
      const at = new Date(d.fetchedAt ?? Date.now()).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
      showForceStatus(!dStale, dStale
        ? `Actualizado a las ${at} — la SEC aún no publica datos nuevos.`
        : `Datos actualizados a las ${at}`);
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

  const dataIsStale = !!data?.stale || (data?.updatedAt != null && Date.now() - data.updatedAt > STALE_MS);
  const staleAutoRef = useRef(false);
  useEffect(() => {
    if (dataIsStale && !staleAutoRef.current) {
      staleAutoRef.current = true;
      void forceRefresh();
    }
    if (!dataIsStale) staleAutoRef.current = false;
  }, [dataIsStale, forceRefresh]);

  // Carga diferida (sin React.lazy): Chart.js es import estático en el módulo
  // del gráfico y Leaflet/MapLibre son pesados; separarlos en chunks evita el
  // JS sin usar que marcaba PSI y mantiene el mapa funcional al abrirlo.
  useEffect(() => {
    if (!mapMounted || PowerMapComp) return;
    let on = true;
    import('./PowerOutageMap').then((m) => { if (on) setPowerMapComp(() => m.PowerOutageMap); }).catch(() => {});
    return () => { on = false; };
  }, [mapMounted, PowerMapComp]);

  useEffect(() => {
    if (!chartMounted || PowerChartComp) return;
    let on = true;
    import('./PowerEvolutionChart').then((m) => { if (on) setPowerChartComp(() => m.PowerEvolutionChart); }).catch(() => {});
    return () => { on = false; };
  }, [chartMounted, PowerChartComp]);

  // Prefetch en idle para que la primera apertura no espere el chunk.
  useEffect(() => {
    const ric = (window as any).requestIdleCallback as ((cb: () => void) => number) | undefined;
    const cic = (window as any).cancelIdleCallback as ((id: number) => void) | undefined;
    const prefetch = () => { void import('./PowerOutageMap'); void import('./PowerEvolutionChart'); };
    if (ric) {
      const id = ric(prefetch);
      return () => cic?.(id);
    }
    const id = window.setTimeout(prefetch, 1200);
    return () => window.clearTimeout(id);
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

  // Imperative staggered entrance for rows: a CSS animation-delay tied to the
  // row index restarts the animation on every reorder, so the cascade is
  // played via WAAPI only on mount / tab switch / new data hour (and comuna
  // filter) instead. (Region sort toggles don't retrigger this effect, so
  // only the FLIP glide runs.) Cap stagger delay: 248 comunas × 40ms would
  // freeze the tail for ~10s, so delay is clamped to 400ms.
  useIsoLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const anims = Array.from(list.querySelectorAll('[data-row]')).map((node, i) =>
      (node as HTMLElement).animate(
        [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'translateY(0)' }],
        { duration: 300, delay: Math.min(i * 40, 400), easing: 'ease-out', fill: 'backwards' },
      ),
    );
    return () => anims.forEach((a) => { try { a.cancel(); } catch { /* already finished */ } });
  }, [tab, data?.updatedAt, comunaRegion]);

  const visibleComunas = useMemo(() => {
    const list = data?.comunas ?? [];
    return comunaRegion ? list.filter(c => c.region === comunaRegion) : list;
  }, [data, comunaRegion]);

  // NOTE: hooks must stay above the early returns below — a useMemo placed
  // after `if (loading) return …` changes the hook count between renders
  // and crashes React ("Rendered more hooks than during the previous render").
  const sortedRegions = useMemo(() => {
    const list = data?.regions ?? [];
    if (regionSort === 'ns') return [...list].sort((a, b) => secNsIndex(a.region) - secNsIndex(b.region));
    if (regionSort === 'pct') {
      // Opt-in: responde "dónde está proporcionalmente peor", no "dónde hay
      // más gente sin luz" (el largo de la barra sigue siendo volumen).
      return [...list].sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0) || b.affected - a.affected);
    }
    return list;
  }, [data, regionSort]);

  /*
   * Esqueleto = el bloque real sin contenido: misma card (`rounded-xl p-4
   * border bg-base-200 shadow-sm`), mismo encabezado con su botón, misma cifra,
   * misma superficie de ayuda y, con el desglose desplegado, las mismas
   * pestañas y filas cebra. Antes era una card sin fondo (`transparent`) con
   * barras flotantes, así que al llegar los datos el bloque "aparecía" de la
   * nada en vez de rellenarse.
   *
   * La reserva sigue el estado del usuario (`power-breakdown`): desplegado
   * 1210/918 px, colapsado 306/277 px — medidos del bloque real, porque un
   * esqueleto desplegado colapsaba ~840 px al llegar los datos.
   */
  const skeleton = (
    <div
      className={`mt-4 flex flex-col rounded-xl p-4 border border-base-300 bg-base-200 shadow-sm ${
        showBreakdown ? 'min-h-[1210px] sm:min-h-[918px]' : 'min-h-[306px] sm:min-h-[277px]'
      }`}
    >
      <div aria-hidden="true" className="flex flex-1 flex-col">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <div className="h-4 w-4 rounded bg-base-300 skel-shimmer" />
            <div className="h-3.5 w-44 rounded bg-base-300 skel-shimmer" />
          </div>
          <div className="h-7 w-32 shrink-0 rounded-md border border-base-300 bg-base-100 skel-shimmer" />
        </div>
        <div className="mt-1.5 h-2.5 w-40 rounded bg-base-300/80 skel-shimmer" />

        <div className="mt-3 flex items-baseline gap-2">
          <div className="h-8 w-28 rounded bg-base-300 skel-shimmer" />
          <div className="h-3.5 w-20 rounded bg-base-300/70 skel-shimmer" />
          <div className="h-3.5 w-24 rounded bg-base-300/70 skel-shimmer" />
        </div>

        <div className="mt-3 border-t border-base-300/70 pt-2">
          <div className="rounded-lg border border-base-300 bg-base-content/[0.04] px-2.5 py-2">
            <div className="h-2.5 w-full rounded bg-base-300/80 skel-shimmer" />
            <div className="mt-1.5 h-2.5 w-2/3 rounded bg-base-300/80 skel-shimmer" />
          </div>
        </div>

        <div className="mt-3 h-3 w-56 rounded bg-base-300/80 skel-shimmer" />

        {showBreakdown && (
          <>
            <div className="mt-2 flex gap-1">
              <div className="h-7 w-20 rounded-lg bg-primary/30 skel-shimmer" />
              <div className="h-7 w-24 rounded-lg bg-base-300 skel-shimmer" />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
              <div className="h-3 w-12 rounded bg-base-300/70 skel-shimmer" />
              <div className="h-5 w-20 rounded-md bg-primary/15 skel-shimmer" />
              <div className="h-5 w-24 rounded-md bg-base-300/50 skel-shimmer" />
              <div className="h-5 w-20 rounded-md bg-base-300/50 skel-shimmer" />
              <div className="ml-auto h-5 w-16 rounded-md bg-base-300/50 skel-shimmer" />
            </div>
            <div className="mt-2 flex flex-1 flex-col gap-0.5">
              {Array.from({ length: 12 }).map((_, i) => (
                <div key={i} className="flex flex-1 items-center gap-2 rounded-md px-1.5 odd:bg-base-100/60">
                  <div className="h-2.5 w-24 shrink-0 rounded bg-base-300 skel-shimmer" />
                  <div className="h-2 w-full max-w-[55%] rounded bg-base-300/50 skel-shimmer" />
                  <div className="ml-auto h-2.5 w-10 shrink-0 rounded bg-base-300 skel-shimmer" />
                  <div className="h-2.5 w-9 shrink-0 rounded bg-base-300/70 skel-shimmer" />
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );

  /*
   * Sin datos (fallo de la SEC o cero cortes) el bloque CONSERVA el alto del
   * esqueleto. Antes el error pintaba una cajita de ~150 px y el cero cortes
   * devolvía `null`: en ambos casos el bloque colapsaba ~1.137 px y volvía a
   * crecer cuando el reintento traía datos, empujando toda la página dos veces
   * (CLS ~2,6 medido en Lighthouse). El primer /api/power puede tardar porque
   * la SEC en frío tarda más que el timeout del cliente; el reintento llega con
   * la caché caliente, así que ese colapso pasaba en cada carga real.
   */
  /*
   * `renderBody` existe para que `LoadSwap` pueda mantener el esqueleto
   * montado durante el fundido cruzado: si cada estado hiciera su propio
   * `return`, React desmontaría el esqueleto de golpe y se abriría un hueco
   * del color del fondo antes de que el contenido alcance opacidad 1.
   */
  const renderBody = () => {
  if (!data || data.total === 0) {
    return (
      <div
        className={`mt-4 flex min-h-[1210px] flex-col rounded-xl p-4 border shadow-sm sm:min-h-[918px] ${
          error ? 'border-warning/30 bg-warning/10' : 'border-base-300'
        }`}
      >
        {error ? (
          <>
            <p className="text-xs text-base-content/80">No se pudo cargar el estado eléctrico (SEC no disponible).</p>
            <p className="mt-1">
              <RetryHint retrying={retrying} retryIn={retryIn} />
            </p>
            <button
              type="button"
              onClick={retryNow}
              disabled={retrying}
              className="mt-2 self-start px-3 py-1.5 rounded-lg bg-primary text-primary-content text-xs font-semibold hover:opacity-90 active:scale-[0.97] transition-[opacity,transform] cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {retrying ? 'Reintentando…' : 'Reintentar ahora'}
            </button>
            {/* Fantasma del bloque real: mantiene la reserva sin fingir datos */}
            <div aria-hidden="true" className="mt-4 flex flex-1 flex-col opacity-20">
              <div className="h-8 w-28 rounded bg-base-300 skel-shimmer" />
              <div className="mt-3 h-2.5 w-full rounded bg-base-300 skel-shimmer" />
              <div className="mt-1.5 h-2.5 w-3/4 rounded bg-base-300 skel-shimmer" />
              <div className="mt-3 flex flex-1 flex-col gap-1.5">
                {Array.from({ length: 12 }).map((_, i) => (
                  <div key={i} className="flex flex-1 items-center gap-3 rounded-lg bg-base-300/40 skel-shimmer px-3">
                    <div className="h-3 w-24 rounded bg-base-300 skel-shimmer" />
                    <div className="ml-auto h-3 w-16 rounded bg-base-300 skel-shimmer" />
                    <div className="h-3 w-10 rounded bg-base-300 skel-shimmer" />
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
            <span className="text-3xl" aria-hidden="true">💡</span>
            <p className="text-2xl font-bold tabular-nums text-base-content">0</p>
            <p className="text-sm font-medium text-base-content">clientes sin suministro</p>
            <p className="max-w-[26ch] text-xs text-base-content/70">
              La SEC no reporta cortes activos en este momento.
            </p>
          </div>
        )}
      </div>
    );
  }

  const rows = tab === 'regiones' ? sortedRegions : visibleComunas;
  // Regiones: el relleno es afectados ÷ su propia base (el mismo % de la
  // columna derecha). Comunas: la SEC no publica base por comuna, así que ahí
  // la barra sigue midiendo volumen.
  const hasRegionPct = tab === 'regiones' && sortedRegions.some((r) => (r.total ?? 0) > 0);
  const activeSort = hasRegionPct ? regionSort : 'affected';
  // La barra sigue al orden: «Mayor %» ⇒ proporción sobre la base de cada
  // región; cualquier otro orden ⇒ clientes (así el largo siempre desciende).
  const barMetric: 'pct' | 'affected' = activeSort === 'pct' ? 'pct' : 'affected';
  const maxRegionPct = Math.max(0, ...sortedRegions.map((r) => r.pct ?? 0));
  const zoomCap = pctCap(maxRegionPct);
  const scaleCap = scale === 'zoom' ? zoomCap : 100;
  // Volume denominator: max of the visible list, NOT rows[0] — in N→S order
  // rows[0] is Arica, which would peg every bar near 100%.
  const barMax = Math.max(1, ...rows.map((r) => r.affected));
  const rowGrid = tab === 'comunas'
    ? 'grid-cols-[minmax(0,1.1fr)_minmax(0,1.9fr)_3rem]'
    // Regiones: en móvil el nombre ocupa la fila 1 completa y los números bajan
    // a la fila 2 (así no se trunca ningún nombre). Todas las columnas tienen
    // ancho fijo —nada de `auto`— para que el riel de la barra termine siempre en
    // la misma x y los números de cada fila arranquen/terminen alineados.
    : 'grid-cols-[minmax(0,1fr)_3rem_4.5rem_3rem_1.5rem] sm:grid-cols-[8rem_minmax(0,1fr)_4rem_5.25rem_3.5rem_1.5rem]';
  const isStale = dataIsStale;
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

  const refreshTitle = forcing
    ? 'Actualizando…'
    : cooldownLeft > 0
      ? `Reintenta en ${cooldownLeft}s`
      : 'Forzar actualización (SEC, máx. 1 vez cada 2 min)';
  const infoTip = [
    `Reporte SEC: ${absTime}.`,
    `Actualizado ${relFetch}.`,
    isStale ? `Desactualizado (sin actualizar ${rel}).` : isWarn ? `Esperando las ${nextHour}.` : 'Al día.',
    forceStatus?.msg ? forceStatus.msg : null,
    'La SEC publica por hora, pero puede corregir los datos de esa hora sin cambiar la hora publicada.',
  ].filter(Boolean).join(' ');

  return (
    <div className={`relative mt-4 rounded-xl p-4 border shadow-sm border-base-300 bg-base-200 ${
      showBreakdown ? 'min-h-[1210px] sm:min-h-[918px]' : 'min-h-[306px] sm:min-h-[277px]'
    }`}>
      <div className="flex items-start justify-between gap-2 pb-1.5 mb-1.5 border-b border-base-300">
        <p className="em-subhead !mb-0 !pb-0 !border-b-0">
          <span className="inline-flex items-center gap-1.5"><svg className="h-5 w-5" width="1em" height="1em" viewBox="0 0 512 512" aria-hidden="true"><title>power-supply</title><path fill="currentColor" fillRule="evenodd" d="M213.333 128V42.667h-42.666V128h-64v128c0 67.648 44.981 124.79 106.665 143.149l.001 70.184h85.333l.023-70.19C360.362 380.777 405.333 323.64 405.333 256V128h-64V42.667h-42.667V128zm64 106.667l25.817-64h-78.507L202.667 256h42.666l-32 106.667l117.333-128z" clipRule="evenodd"/></svg>Clientes sin suministro eléctrico</span>
        </p>
        <div className="flex items-center gap-1.5 shrink-0 pt-0.5">
          <span className="text-[11px] text-base-content/70 tabular-nums">{absTime}</span>
          <span className="group relative inline-flex">
            <button
              type="button"
              aria-label={infoTip}
              className="inline-flex h-4 w-4 items-center justify-center text-base-content/70 hover:text-base-content transition-colors cursor-help focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <svg className="h-4 w-4" viewBox="-0.0 -0.0 233.0 233.0" fill="currentColor" aria-hidden="true">
                <g transform="translate(0.000000,233.000000) scale(0.100000,-0.100000)">
                  <path d="M990 2139 c-93 -14 -246 -69 -336 -120 -97 -55 -222 -179 -301 -297 -152 -226 -205 -509 -148 -784 44 -215 197 -442 388 -578 77 -55 226 -125 323 -152 116 -32 381 -32 507 0 343 86 602 356 698 728 34 130 32 308 -5 457 -51 211 -109 319 -245 460 -123 127 -295 226 -465 268 -95 23 -317 33 -416 18z m248 -325 c74 -37 106 -93 100 -173 -11 -160 -194 -234 -315 -128 -99 87 -81 238 36 299 67 35 112 35 179 2z m47 -499 l25 -24 0 -281 c0 -267 1 -281 20 -300 11 -11 29 -20 41 -20 35 0 58 -19 68 -56 13 -47 -7 -100 -44 -114 -37 -14 -438 -13 -468 1 -65 29 -60 135 7 159 17 6 42 17 56 24 l25 12 3 197 c1 109 -2 205 -6 214 -5 8 -31 23 -58 32 -58 19 -80 53 -69 107 4 25 16 41 38 54 28 18 51 20 185 20 149 0 154 -1 177 -25z" />
                </g>
              </svg>
            </button>
            <span
              role="tooltip"
              className="pointer-events-none absolute right-0 top-full z-[800] mt-1.5 hidden w-72 rounded-lg border border-base-300 bg-base-100 p-2.5 text-left text-[11px] leading-snug text-base-content shadow-lg group-hover:block group-focus-within:block"
            >
              <span className="block"><b>Reporte SEC:</b> {absTime}</span>
              <span className="block mt-1"><b>Actualizado:</b> {relFetch}</span>
              <span className={`block mt-1 ${isStale ? 'text-warning' : ''}`}>
                {isStale ? `Desactualizado — sin actualizar ${rel}.` : isWarn ? `Esperando las ${nextHour}.` : 'Al día.'}
              </span>
              {forceStatus?.msg && <span className={`block mt-1 ${forceStatus.ok ? 'text-success' : 'text-error'}`}>{forceStatus.msg}</span>}
              <span className="block mt-1 text-base-content/70">La SEC publica por hora, pero puede corregir los datos de esa hora sin cambiar la hora publicada.</span>
            </span>
          </span>
          <button
            type="button"
            onClick={forceRefresh}
            disabled={forcing || cooldownLeft > 0}
            title={refreshTitle}
            aria-label={refreshTitle}
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-base-content/70 hover:text-base-content hover:bg-base-300 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={forcing ? 'animate-spin' : ''}>
              <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
              <path d="M21 3v5h-5" />
            </svg>
          </button>
        </div>
      </div>


      <div className="flex items-baseline gap-3 mt-2">
        <span className="text-3xl font-bold text-base-content tabular-nums">{miles(data.affected)}</span>
        <span className="text-base-content/70 text-sm font-normal"> de {miles(data.total)}</span>
        <span className={`text-sm font-medium ${data.pct >= 2 ? 'text-error' : 'text-base-content/70'}`}>
          ({data.pct.toFixed(2)}% del país)
        </span>
      </div>

      {/* Zona de utilidades: separada de los datos (cifra + timestamps) por una
          regla fina y una superficie propia, porque en este bloque convive mucho
          texto y sin jerarquía la ayuda competía con el número principal. */}
      <div className="mt-3 border-t border-base-300/70 pt-2">
        <p className="rounded-lg border border-base-300 bg-base-content/[0.04] px-2.5 py-2 text-[11px] leading-snug text-base-content/70">
          <span className="font-medium text-base-content/80">¿Corte de luz?</span>{' '}
          Reporta:{' '}
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
        </p>
      </div>

      {/* Desglose colapsable: pestañas + filtros + listado. El control vive
          arriba, encabezando el bloque que colapsa (no al final, donde quedaría
          lejos de las pestañas y saltaría de sitio al abrir/cerrar). Colapsado
          sólo queda el número general del país. */}
      <button
        type="button"
        onClick={toggleBreakdown}
        aria-expanded={showBreakdown}
        aria-controls="power-breakdown"
        className="mt-3 flex items-center gap-1 text-[11px] text-primary hover:text-base-content transition-[color,transform] active:scale-[0.96] cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
          aria-hidden="true"
          className={`transition-transform duration-200 ${showBreakdown ? 'rotate-90' : ''}`}>
          <path d="M9 18l6-6-6-6" />
        </svg>
        {showBreakdown ? 'Ocultar desglose' : 'Ver desglose por región y comuna'}
      </button>
      <div
        className={`grid transition-[grid-template-rows,margin] duration-300 ease-out ${
          showBreakdown ? 'mt-2 grid-rows-[1fr]' : 'mt-0 grid-rows-[0fr]'
        }`}
      >
        <div
          id="power-breakdown"
          inert={!showBreakdown}
          aria-hidden={!showBreakdown}
          className="min-h-0 overflow-hidden"
        >
          <div className="flex gap-1">
            <button
              onClick={() => setTab('regiones')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer active:scale-[0.96] ${
                tab === 'regiones'
                  ? 'bg-primary text-primary-content'
                  : 'bg-base-300 text-base-content/70 hover:text-base-content'
              }`}
            >
              Regiones
            </button>
            <button
              onClick={() => { setComunaRegion(null); setTab('comunas'); }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer active:scale-[0.96] ${
                tab === 'comunas'
                  ? 'bg-primary text-primary-content'
                  : 'bg-base-300 text-base-content/70 hover:text-base-content'
              }`}
            >
              Comunas ({data.comunas.length})
            </button>
          </div>

          {tab === 'comunas' && (
            <div className="mt-2 flex items-center gap-2">
              <label htmlFor="power-comuna-region" className="text-[11px] text-base-content/70 shrink-0">Región:</label>
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
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
              <div className="flex flex-wrap items-center gap-0.5" role="group" aria-label="Orden de regiones">
                <span className="mr-0.5 text-[11px] text-base-content/70">Orden:</span>
                {([['pct', 'Mayor %'], ['affected', 'Más afectados'], ['ns', 'Norte → sur']] as const)
                  .filter(([v]) => v !== 'pct' || hasRegionPct)
                  .map(([v, label]) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => { play('interaction.tap'); setRegionSort(v); }}
                      aria-pressed={activeSort === v}
                      className={`rounded-md px-2 py-1 text-[11px] transition-colors cursor-pointer ${
                        activeSort === v ? 'bg-primary/15 font-medium text-primary' : 'text-base-content/70 hover:text-base-content'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
              </div>
              {/* La escala sólo aplica a las barras de %: con «Más afectados» la
                  barra mide clientes y no hay nada que ampliar. */}
              {barMetric === 'pct' && (
                <div className="flex flex-wrap items-center gap-0.5" role="group" aria-label="Escala de las barras de porcentaje">
                  <span className="mr-0.5 text-[11px] text-base-content/70">Escala:</span>
                  {([['zoom', `Zoom · 0–${zoomCap.toLocaleString('es-CL')} %`], ['real', 'Real · 0–100 %']] as const).map(([v, label]) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => chooseScale(v)}
                      aria-pressed={scale === v}
                      title={v === 'zoom'
                        ? `La barra llega a ${zoomCap.toLocaleString('es-CL')} % de los clientes de cada región: los cortes de 0,0x–0,x % se distinguen`
                        : 'El 100 % de la barra equivale al 100 % de los clientes de esa región, sin ampliación'}
                      className={`rounded-md px-2 py-1 text-[11px] transition-colors cursor-pointer ${
                        scale === v ? 'bg-primary/15 font-medium text-primary' : 'text-base-content/70 hover:text-base-content'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div ref={listRef} className={tab === 'comunas' ? 'mt-2 max-h-72 overflow-y-auto pr-1' : 'mt-2'}>
            <div
              className={`${tab === 'regiones' ? 'hidden sm:grid' : 'grid'} ${rowGrid} items-center gap-x-2 px-1.5 pb-1 text-[11px] uppercase tracking-wider text-base-content/70`}
              aria-hidden="true"
            >
              <span>{tab === 'regiones' ? 'Región' : 'Comuna'}</span>
              <span />
              <span className="text-right">Sin luz</span>
              {tab === 'regiones' && <span className="text-right">Clientes</span>}
              {tab === 'regiones' && <span className="text-right">%</span>}
              {tab === 'regiones' && <span />}
            </div>
            {rows.map((r) => {
              const name = tab === 'regiones' ? (r as RegionRow).region : (r as Comuna).comuna;
              const key = tab === 'regiones' ? name : `${(r as Comuna).region} — ${(r as Comuna).comuna}`;
              const regionTotal = tab === 'regiones' ? ((r as RegionRow).total ?? 0) : 0;
              const regionPct = tab === 'regiones'
                ? ((r as RegionRow).pct ?? (regionTotal > 0 ? (r.affected * 100) / regionTotal : 0))
                : 0;
              const hasBase = tab === 'regiones' && hasRegionPct && regionTotal > 0;
              // Modo %: proporción sobre la base de cada región, contra el tope de
              // la escala elegida. Modo clientes: proporción contra la fila más
              // afectada (el largo coincide con el orden por defecto).
              const width = barMetric === 'pct'
                ? (hasBase ? (regionPct / scaleCap) * 100 : 0)
                : (r.affected / barMax) * 100;
              // Severidad: el % sube de color sólo cuando el corte pesa sobre la
              // región; en un día normal queda como dato secundario.
              const pctTone = regionPct >= 2 ? 'text-error' : regionPct >= 0.5 ? 'text-warning' : 'text-base-content/70';
              const barTrack = (
                <div className="relative h-1.5 overflow-hidden rounded-full bg-base-300/80" aria-hidden="true">
                  <div
                    className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
                    style={{ width: `${width}%`, minWidth: MIN_FILL_PX }}
                  />
                </div>
              );
              // Cap stagger delay: 248 comunas × 40ms would freeze the tail for ~10s
              return tab === 'regiones' ? (
                <div
                  key={key}
                  data-row={key}
                  className={`group grid ${rowGrid} items-center gap-x-2 gap-y-1 rounded-md px-1.5 py-1 text-xs odd:bg-base-100/60 transition-colors hover:bg-base-300/60`}
                >
                  <button
                    type="button"
                    onClick={() => { play('interaction.tap'); setComunaRegion((r as RegionRow).region); setTab('comunas'); }}
                    title={hasBase
                      ? `Ver comunas de ${name}: ${miles(r.affected)} clientes sin suministro, ${fmtPct(regionPct)} de ${miles(regionTotal)} clientes`
                      : `Ver comunas de ${name}: ${miles(r.affected)} clientes sin suministro`}
                    aria-label={hasBase
                      ? `Ver comunas de ${name}: ${miles(r.affected)} clientes sin suministro, ${fmtPct(regionPct)} de ${miles(regionTotal)} clientes`
                      : `Ver comunas de ${name}`}
                    className="col-span-4 row-start-1 min-w-0 cursor-pointer truncate rounded text-left text-base-content/80 transition-colors hover:text-primary group-hover:text-base-content focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:col-span-1 sm:row-start-auto"
                  >
                    {name}
                  </button>
                  <div className="pointer-events-none col-start-1 row-start-2 sm:col-start-auto sm:row-start-auto">{barTrack}</div>
                  <span className="pointer-events-none row-start-2 whitespace-nowrap text-right text-[11px] font-medium tabular-nums text-base-content/80 sm:row-start-auto">
                    {miles(r.affected)}
                  </span>
                  {/* Base de clientes: en su propia columna, después de «Sin luz»,
                      para contrastar los valores en vertical. */}
                  <span className="pointer-events-none row-start-2 whitespace-nowrap text-right text-[11px] tabular-nums text-base-content/70 sm:row-start-auto">
                    <span className="text-base-content/70 sm:hidden">de </span>{hasBase ? miles(regionTotal) : 's/d'}
                  </span>
                  <span className={`pointer-events-none row-start-2 whitespace-nowrap text-right text-[11px] tabular-nums sm:row-start-auto ${hasBase ? pctTone : 'text-base-content/70'}`}>
                    {hasBase ? fmtPct(regionPct) : 's/d'}
                  </span>
                  <button
                    type="button"
                    onClick={() => openRegionMap((r as RegionRow).region)}
                    title={`Ver mapa de ${name}`}
                    aria-label={`Ver mapa de ${name}`}
                    aria-expanded={showMap && mapFocusRegion === (r as RegionRow).region}
                    className="col-start-5 row-start-1 justify-self-end shrink-0 rounded-md p-1.5 text-base-content/45 transition-colors hover:bg-primary/10 hover:text-primary active:scale-95 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:col-start-auto sm:row-start-auto"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M12 21s-7-5.5-7-11a7 7 0 1 1 14 0c0 5.5-7 11-7 11z" />
                      <circle cx="12" cy="10" r="2.5" />
                    </svg>
                  </button>
                </div>
              ) : (
                <div
                  key={key}
                  data-row={key}
                  className={`grid ${rowGrid} items-center gap-x-2 rounded-md px-1.5 py-1 text-xs odd:bg-base-100/60`}
                >
                  <span className="truncate text-base-content/80">{name}</span>
                  {barTrack}
                  <span className="text-right tabular-nums text-base-content/70">{miles(r.affected)}</span>
                </div>
              );
            })}
            {tab === 'comunas' && rows.length === 0 && (
              <p className="text-[11px] text-base-content/70 py-2">Sin comunas con cortes registrados en esta región.</p>
            )}
          </div>
          {tab === 'comunas' && (
            <p className="mt-1.5 text-[11px] leading-snug text-base-content/70">
              La SEC no publica clientes por comuna: la barra compara con la comuna más afectada.
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-col">
        <button
          type="button"
          onClick={() => { play('interaction.toggle'); if (!showMap) setMapFocusRegion(null); setShowMap(s => !s); }}
          aria-expanded={showMap}
          className="mt-2 flex items-center gap-1 text-[11px] text-primary hover:text-base-content transition-[color,transform] cursor-pointer"
        >
          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
            className={`shrink-0 transition-transform duration-200 ${showMap ? 'rotate-90' : ''}`}>
            <path d="M9 18l6-6-6-6" />
          </svg>
          {showMap ? 'Ocultar mapa' : 'Ver mapa por comuna'}
        </button>

      <div className={`grid transition-[grid-template-rows] duration-300 ease-out ${showMap ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
        <div className="overflow-hidden min-h-0">
          {mapMounted && (
            <div className="rounded-lg border border-base-300 overflow-hidden bg-base-100 p-3">
              {PowerMapComp
                ? <PowerMapComp comunas={data.comunas} focusRegion={mapFocusRegion} focusRequest={mapFocusRequest} />
                : <div className="h-[340px] w-full rounded-xl skel-shimmer bg-base-300" aria-hidden="true" />}
            </div>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={() => { play('interaction.toggle'); setShowChart(s => !s); }}
        aria-expanded={showChart}
        className="mt-2 flex items-center gap-1 text-[11px] text-primary hover:text-base-content transition-[color,transform] cursor-pointer"
      >
        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
          className={`shrink-0 transition-transform duration-200 ${showChart ? 'rotate-90' : ''}`}>
          <path d="M9 18l6-6-6-6" />
        </svg>
        {showChart ? 'Ocultar evolución' : 'Ver evolución'}
      </button>
      <div className={`grid transition-[grid-template-rows] duration-300 ease-out ${showChart ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
        <div className="overflow-hidden min-h-0">
          {chartMounted && (
            <div className="rounded-lg border border-base-300 overflow-hidden bg-base-100 p-3">
              {PowerChartComp
                ? <PowerChartComp series={data.series} />
                : <div className="h-40 skel-shimmer bg-base-300 rounded" aria-hidden="true" />}
            </div>
          )}
        </div>
      </div>
      </div>

      <div className="mt-2 flex flex-wrap items-end justify-end gap-x-3 gap-y-1 text-[11px] text-base-content/70">
        <SectionSources section="power" inline />
      </div>

      <div className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${(forceStatus || isStale || error) ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
        <div className="overflow-hidden min-h-0" aria-live="polite">
          <div className="flex flex-col mt-3 border-t border-base-300/70 pt-2">
            {error ? (
              <div role="status" className="rounded-lg bg-warning/10 px-2.5 py-1.5 text-[11px] text-warning flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="leading-snug flex-1 min-w-[12rem]">
                  {isStale ? 'No se pudo actualizar — datos siguen desactualizados.' : 'No se pudo actualizar — mostrando último dato disponible.'}
                </span>
                <RetryHint retrying={retrying} retryIn={retryIn} />
                <button
                  type="button"
                  onClick={retryNow}
                  disabled={retrying}
                  className="underline underline-offset-2 hover:text-base-content transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  {retrying ? 'Reintentando…' : 'Reintentar ahora'}
                </button>
                {cooldownLeft > 0 && !forcing ? (
                  <span className="inline-flex h-6 min-w-6 shrink-0 items-center justify-center tabular-nums text-[11px] font-medium text-warning/80" aria-label={`Reintento disponible en ${cooldownLeft} segundos`} title={`Reintento disponible en ${cooldownLeft}s`}>{cooldownLeft}s</span>
                ) : (
                  <button
                    type="button"
                    onClick={forceRefresh}
                    disabled={forcing}
                    title={refreshTitle}
                    aria-label={refreshTitle}
                    className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-warning hover:bg-warning/15 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={forcing ? 'animate-spin' : ''}>
                      <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" />
                    </svg>
                  </button>
                )}
              </div>
            ) : forceStatus ? (
              <div role="status" className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[11px] leading-snug ${
                forceStatus.msg.includes('aún no publica') ? 'bg-warning/10 text-warning' : forceStatus.ok ? 'bg-success/10 text-success' : 'bg-error/10 text-error'
              }`}>
                <span className="flex-1">{forceStatus.msg}</span>
              </div>
            ) : isStale ? (
              <div role="status" className="flex items-center gap-2 rounded-lg bg-warning/10 px-2.5 py-1.5 text-[11px] leading-snug text-warning">
                <span className="flex-1">{`Desactualizado — sin actualizar ${rel} (${absTime}). Puede no reflejar cortes actuales.`}</span>
                {cooldownLeft > 0 && !forcing ? (
                  <span className="inline-flex h-6 min-w-6 shrink-0 items-center justify-center tabular-nums text-[11px] font-medium text-warning/80" aria-label={`Reintento disponible en ${cooldownLeft} segundos`} title={`Reintento disponible en ${cooldownLeft}s`}>{cooldownLeft}s</span>
                ) : (
                  <button
                    type="button"
                    onClick={forceRefresh}
                    disabled={forcing}
                    title={refreshTitle}
                    aria-label={refreshTitle}
                    className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-warning hover:bg-warning/20 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={forcing ? 'animate-spin' : ''}>
                      <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" />
                    </svg>
                  </button>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
  };

  return (
    <LoadSwap loading={loading} skeleton={skeleton}>
      {loading ? null : renderBody()}
    </LoadSwap>
  );
}
