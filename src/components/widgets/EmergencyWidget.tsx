import { Fragment, lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
const PowerOutageWidget = lazy(() => import('./PowerOutageWidget').then(m => ({ default: m.PowerOutageWidget })));
const EmergencyMap = lazy(() => import('./EmergencyMap').then(m => ({ default: m.EmergencyMap })));
import { play } from '@/lib/sound';
import { idbGet, idbSet } from '@/lib/idb-cache';
import { subscribeAutoRefresh } from '@/lib/auto-refresh';
import { parseChileLocal } from '@/lib/chile-time';
import { useErrorRetry } from '@/lib/retry';
import { RetryHint } from '@/components/RetryHint';
import { LoadSwap } from '@/components/LoadSwap';
import { SectionSources } from '../SectionSources';
import {
  buildEmergencySummary,
  canShareFiles,
  copyToClipboard,
  downloadBlob,
  shareOrCopy,
} from '@/lib/share';

export interface EmergencyItem {
  id: string;
  type: 'earthquake' | 'alert';
  title: string;
  description: string;
  time: number;
  url: string;
  severity: 'low' | 'moderate' | 'high' | 'critical';
  mag?: number;
  place?: string;
  depth?: number;
  lat?: number;
  lon?: number;
}

type EarthquakeSource = 'gael' | 'boostr' | 'usgs';
const EARTHQUAKE_SOURCE_ORDER: EarthquakeSource[] = ['gael', 'boostr', 'usgs'];
const EARTHQUAKE_SOURCE_NAMES: Record<EarthquakeSource, string> = {
  gael: 'Gael Cloud',
  boostr: 'Boostr',
  usgs: 'USGS',
};

function orderSources(sources: EarthquakeSource[]): EarthquakeSource[] {
  const used = new Set(sources);
  return EARTHQUAKE_SOURCE_ORDER.filter(source => used.has(source));
}

const IDB_KEY = 'emergency';
const IDB_TTL = 5 * 60 * 1000;

// ponytail: server-side /api/emergency aggregates Gael → Boostr → USGS (CORS + edge cache)
// error=true → sources failed (never render as "no quakes"); trust a reachable server otherwise
async function fetchEmergency() {
  try {
    const res = await fetch('/api/emergency', { signal: AbortSignal.timeout(10000) });
    // Si falla la petición no sabemos nada de NINGUNA fuente: marcar también las
    // alertas como error, si no el bloque diría «sin alertas» cuando en realidad
    // no se pudo consultar (una alerta real quedaría oculta).
    if (!res.ok) return {
      items: [], senapred: [], error: true, senapredError: true, source: null, coordinateSources: [],
    };
    const data = await res.json();
    return {
      items: (data.items || []) as EmergencyItem[],
      senapred: (data.senapred || []) as EmergencyItem[],
      error: !!data.error,
      senapredError: !!data.senapredError,
      source: (data.source ?? null) as EarthquakeSource | null,
      coordinateSources: (data.coordinateSources || []) as EarthquakeSource[],
    };
  } catch {
    return { items: [], senapred: [], error: true, senapredError: true, source: null, coordinateSources: [] };
  }
}

// Client-side coordinate enrichment. /api/emergency attaches lat/lon from Boostr,
// but Boostr can be unreachable from Cloudflare Workers (while still CORS-open to the
// user's browser, ACAO: *). So if any sismo came back without coordinates, refetch
// Boostr from the browser and match by the same Chile-local epoch, so pins always render.
const COORD_TOL = 10 * 60 * 1000;
async function enrichWithBoostr(items: EmergencyItem[]): Promise<{ items: EmergencyItem[]; coordinateSources: EarthquakeSource[] }> {
  const needsCoords = items.some(
    (i) => i.type === 'earthquake' && i.mag != null && i.lat == null,
  );
  if (!needsCoords) return { items, coordinateSources: [] };

  let candidates: Array<{ time: number; mag: number; lat: number; lon: number }> = [];
  try {
    const res = await fetch('https://api.boostr.cl/earthquakes/recent.json', {
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) {
      const json = await res.json();
      const data = Array.isArray(json?.data) ? json.data : [];
      for (const b of data) {
        const time = parseChileLocal(`${b.date} ${b.hour}`);
        const lat = parseFloat(b.latitude);
        const lon = parseFloat(b.longitude);
        if (isNaN(time) || isNaN(lat) || isNaN(lon)) continue;
        candidates.push({ time, mag: parseFloat(b.magnitude), lat, lon });
      }
    }
  } catch {
    /* Boostr unreachable from browser too — leave items as-is */
  }

  if (candidates.length === 0) return { items, coordinateSources: [] };

  let matched = false;
  const enriched = items.map((it) => {
    if (it.type !== 'earthquake' || it.mag == null || it.lat != null) return it;
    const mag = it.mag;
    const exact = candidates.find((c) => c.time === it.time);
    let c = exact;
    if (!c) {
      c = candidates
        .filter((x) => Math.abs(x.time - it.time) <= COORD_TOL)
        .sort(
          (a, b) =>
            Math.abs(a.time - it.time) + Math.abs(a.mag - mag) * 60_000 -
            (Math.abs(b.time - it.time) + Math.abs(b.mag - mag) * 60_000),
        )[0];
    }
    if (!c) return it;
    matched = true;
    return { ...it, lat: c.lat, lon: c.lon };
  });
  return { items: enriched, coordinateSources: matched ? ['boostr'] : [] };
}

const severityBadges: Record<string, string> = {
  critical: 'badge badge-xs badge-error',
  high: 'badge badge-xs badge-warning',
  moderate: 'badge badge-xs badge-info',
  low: 'badge badge-xs badge-success',
};

const severityLabels: Record<string, string> = {
  critical: 'Crítico',
  high: 'Alto',
  moderate: 'Moderado',
  low: 'Leve',
};

// Canales oficiales de SENAPRED, para el estado vacío de alertas.
const SENAPRED_LINKS = [
  { label: 'Sitio oficial', href: 'https://www.senapred.gov.cl/eventos/' },
  { label: 'X', href: 'https://x.com/senapred' },
  { label: 'Facebook', href: 'https://web.facebook.com/SenapredChile/' },
  { label: 'YouTube', href: 'https://www.youtube.com/@senapredchile' },
  { label: 'WhatsApp', href: 'https://www.whatsapp.com/channel/0029Va4UhwYEwEjuiauxoM09' },
  { label: 'Telegram', href: 'https://t.me/SenapredChile' },
] as const;

export function EmergencyWidget({ initialBreakdown }: { initialBreakdown?: boolean } = {}) {
  const [items, setItems] = useState<EmergencyItem[]>([]);
  const [sismosSources, setSismosSources] = useState<EarthquakeSource[]>([]);
  const [alerts, setAlerts] = useState<EmergencyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [sismosError, setSismosError] = useState(false);
  const [alertsError, setAlertsError] = useState(false);
  const [powerCount, setPowerCount] = useState<number | null>(null);
  const [powerMeta, setPowerMeta] = useState<{ updatedAt: number | null; stale: boolean } | null>(null);
  const handlePowerSummary = useCallback(
    (s: { affected: number | null; updatedAt: number | null; stale: boolean } | null) => {
      setPowerCount(s?.affected ?? null);
      setPowerMeta(s?.updatedAt != null ? { updatedAt: s.updatedAt, stale: !!s.stale } : null);
    },
    [],
  );
  // senapred no se cachea en IDB (solo items), así que mantiene su propio flag de carga
  const [alertsLoaded, setAlertsLoaded] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const [mapMounted, setMapMounted] = useState(false);
  const [liveMsg, setLiveMsg] = useState('');
  const [shareOpen, setShareOpen] = useState(false);
  const [shareMsg, setShareMsg] = useState<string | null>(null);
  const [shareMsgKey, setShareMsgKey] = useState(0);
  const [docked, setDocked] = useState(false);
  const shareRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      if (localStorage.getItem('emergency-bar-docked') === '1') {
        setDocked(true);
        window.dispatchEvent(new CustomEvent('emergency:dock', { detail: { docked: true, silent: true } }));
      }
    } catch {}
    const onDock = (e: Event) => {
      const detail = (e as CustomEvent).detail as { docked: boolean };
      setDocked(!!detail?.docked);
    };
    window.addEventListener('emergency:dock', onDock);
    return () => window.removeEventListener('emergency:dock', onDock);
  }, []);

  const toggleDock = useCallback(() => {
    setDocked((prev) => {
      const next = !prev;
      try { localStorage.setItem('emergency-bar-docked', next ? '1' : '0'); } catch {}
      window.dispatchEvent(new CustomEvent('emergency:dock', { detail: { docked: next } }));
      return next;
    });
  }, []);
  const seenRef = useRef<{ sismos: Set<string>; alerts: Set<string> }>({ sismos: new Set(), alerts: new Set() });
  const inflight = useRef<Promise<void> | null>(null);

  const hasShareData = items.length > 0 || alerts.length > 0 || (powerCount != null && powerCount > 0);
  const earthquakeCount = items.filter((item) => item.type === 'earthquake').length;
  const mappedCount = items.filter(
    (item) => item.type === 'earthquake' && item.lat != null && item.lon != null && item.mag !== undefined,
  ).length;
  const hasMapCoordinates = mappedCount > 0;

  const openMap = useCallback((item: EmergencyItem) => {
    setShowMap(true);
    setFocusId(item.id);
    setFocusRequest(request => request + 1);
    window.setTimeout(() => {
      const map = document.getElementById('sismos-map');
      if (!map) return;
      const rect = map.getBoundingClientRect();
      const top = window.scrollY + rect.top - (window.innerHeight - rect.height) / 2;
      const root = document.documentElement;
      const previousScrollBehavior = root.style.scrollBehavior;
      root.style.scrollBehavior = 'auto';
      window.scrollTo({ top: Math.max(0, top), behavior: 'auto' });
      root.style.scrollBehavior = previousScrollBehavior;
    }, 350);
    play('interaction.toggle');
  }, []);

  const refresh = useCallback(async () => {
    // Una sola petición en vuelo: el reintento automático, el botón y el
    // auto-refresh compartido pueden aterrizar en el mismo segundo.
    if (inflight.current) return inflight.current;
    const run = (async () => {
      const { items: eqs, senapred, error, senapredError, source, coordinateSources } = await fetchEmergency();
      if (!error) {
        // Trust a reachable server: a genuinely empty day clears to the placeholder instead of
        // showing stale alerts forever. Only a failed fetch keeps the error state.
        const clientEnrichment = await enrichWithBoostr(eqs);
        const enriched = clientEnrichment.items;
        setItems(enriched);
        setSismosSources(orderSources([
          ...(source ? [source] : []),
          ...coordinateSources,
          ...clientEnrichment.coordinateSources,
        ]));
        setAlerts(senapred);
        if (enriched.length) idbSet(IDB_KEY, enriched, IDB_TTL);

        // Announce genuinely new items to assistive tech (not the whole list)
        const sismoIds = new Set(enriched.filter((i) => i.type === 'earthquake').map((i) => i.id));
        const alertIds = new Set(senapred.map((i) => i.id));
        const newSismos = enriched.filter((i) => i.type === 'earthquake' && !seenRef.current.sismos.has(i.id));
        const newAlerts = senapred.filter((a) => !seenRef.current.alerts.has(a.id));
        seenRef.current = { sismos: sismoIds, alerts: alertIds };
        if (newSismos[0]) setLiveMsg(`Nuevo sismo: ${newSismos[0].mag != null ? `magnitud ${newSismos[0].mag.toFixed(1)} ` : ''}${newSismos[0].place || newSismos[0].title}`);
        else if (newAlerts[0]) setLiveMsg(`Nueva alerta SENAPRED: ${newAlerts[0].title}`);
      }
      setSismosError(error);
      setAlertsError(senapredError);

      // ponytail: a failed fetch must not leave stale quakes on screen — treat any in-flight
      // cached data as an error state. Retry via the buttons below re-runs refresh().
      // El conteo/meta de cortes de luz para el resumen compartible lo entrega
      // PowerOutageWidget vía onSummary (evita un fetch duplicado de /api/power,
      // que la SEC sirve lento y sumaba timeouts/errores en consola).

      setAlertsLoaded(true);
      setLoading(false);
    })();
    inflight.current = run;
    try { await run; } finally { if (inflight.current === run) inflight.current = null; }
  }, []);

  // Un fallo de /api/emergency (sismos o alertas) activa el reintento con backoff
  // y la cuenta atrás que muestran los dos bloques de error.
  const hasError = sismosError || alertsError;
  const { retrying, retryIn, retryNow } = useErrorRetry(hasError, refresh);

  useEffect(() => {
    let cancelled = false;

    idbGet<EmergencyItem[]>(IDB_KEY).then(cached => {
      if (cancelled || !cached?.data) return;
      if (Array.isArray(cached.data)) {
        // enrich cached (possibly coord-less) data in the background so pins appear
        // even while the fresh fetch is still in flight
        enrichWithBoostr(cached.data).then(({ items: enriched, coordinateSources }) => {
          if (!cancelled) {
            setItems(enriched);
            if (coordinateSources.length) {
              setSismosSources(previous => orderSources([...previous, ...coordinateSources]));
            }
          }
        });
      }
      setLoading(false);
    });

    refresh();
    return () => { cancelled = true; };
  }, [refresh]);

  useEffect(() => subscribeAutoRefresh(refresh), [refresh]);

  // Keep the map mounted through its 300ms collapse so the exit animates like the weather map
  useEffect(() => {
    if (showMap) setMapMounted(true);
    else { const t = setTimeout(() => setMapMounted(false), 300); return () => clearTimeout(t); }
  }, [showMap]);

  useEffect(() => {
    const handleFocusSismo = (event: Event) => {
      const requested = (event as CustomEvent<EmergencyItem>).detail;
      if (!requested || requested.lat == null || requested.lon == null) return;
      const existing = items.find(item => item.id === requested.id);
      const focusedItem = existing
        ? { ...requested, ...existing, lat: existing.lat ?? requested.lat, lon: existing.lon ?? requested.lon }
        : requested;
      setItems(previous => {
        const index = previous.findIndex(item => item.id === focusedItem.id);
        if (index >= 0) return previous.map((item, i) => i === index ? focusedItem : item);
        return [...previous, focusedItem].sort((a, b) => b.time - a.time).slice(0, 10);
      });
      openMap(focusedItem);
    };
    window.addEventListener('emergency:focus-sismo', handleFocusSismo);
    return () => window.removeEventListener('emergency:focus-sismo', handleFocusSismo);
  }, [items, openMap]);

  useEffect(() => {
    if (!hasMapCoordinates) setShowMap(false);
  }, [hasMapCoordinates]);

  const handleShare = async (action: 'link' | 'summary' | 'image') => {
    setShareOpen(false);
    setShareMsg(null);
    setShareMsgKey(k => k + 1);
    try {
      if (action === 'link') {
        const r = await shareOrCopy({
          title: 'Emergencias Chile — ¿Qué Onda?',
          text: 'Alertas SENAPRED, sismos y cortes de luz en Chile, en vivo.',
          url: `${window.location.origin}#emergencia`,
        });
        setShareMsg(r === 'copied' ? 'Enlace copiado' : r === 'shared' ? 'Compartido' : 'No se pudo compartir');
        play(r === 'copied' || r === 'shared' ? 'interaction.confirm' : 'notification.error');
      } else if (action === 'summary') {
        const r = await copyToClipboard(buildEmergencySummary(items, alerts, powerCount ?? undefined, powerMeta ?? undefined).text);
        setShareMsg(r === 'copied' ? 'Resumen copiado' : 'No se pudo copiar');
        play(r === 'copied' ? 'interaction.confirm' : 'notification.error');
      } else {
        // Carga diferida: el lienzo de la tarjeta compartible pesa ~6 KB y sólo
        // se usa al pulsar «Imagen»; traerlo en el bundle de la isla dejaba
        // 54 KB de JS sin ejecutar en la ruta crítica de Emergencia.
        const { renderEmergencyCard } = await import('@/lib/share-image');
        const blob = await renderEmergencyCard(items, alerts, powerCount ?? undefined, powerMeta ?? undefined);
        const d = new Date();
        const pad = (n: number) => String(n).padStart(2, '0');
        const imgName = `queonda-emergencia-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}.png`;
        if (canShareFiles() && navigator.share) {
          const file = new File([blob], imgName, { type: 'image/png' });
          await navigator.share({
            files: [file],
            title: 'Emergencias Chile — ¿Qué Onda?',
            text: 'Alertas SENAPRED y sismos en Chile, en vivo.',
          });
          setShareMsg('Imagen compartida');
        } else {
          downloadBlob(blob, imgName);
          setShareMsg('Imagen descargada');
        }
        play('interaction.confirm');
      }
    } catch {
      setShareMsg('No se pudo compartir');
      play('notification.error');
    }
  };

  // Close share menu on outside click / Escape; auto-clear transient feedback
  useEffect(() => {
    if (!shareOpen) return;
    const onDown = (e: MouseEvent) => {
      if (shareRef.current && !shareRef.current.contains(e.target as Node)) setShareOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShareOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [shareOpen]);

  useEffect(() => {
    if (!shareMsg) return;
    const t = setTimeout(() => setShareMsg(null), 2600);
    return () => clearTimeout(t);
  }, [shareMsg]);

  return (
    <>
      <section id="emergencia" className="scroll-mt-[104px] mb-8 md:mb-12">
        <div className="sr-only" aria-live="polite">{liveMsg}</div>
        <div className="mb-4">
          <div className="flex items-center gap-2 min-w-0">
            <h2 className="text-2xl font-bold text-balance text-base-content">
              {'Emergencia'.split('').map((char, i) => (
                <span key={i} className="letter" style={{ transitionDelay: `${i * 30}ms` }}>{char === ' ' ? '\u00A0' : char}</span>
              ))}
            </h2>
            <button
              type="button"
              data-section-share="emergencia"
              data-section-title="Emergencia"
              aria-label="Compartir sección Emergencia"
              title="Compartir sección Emergencia"
              className="relative flex items-center justify-center w-9 h-9 text-base-content/70 hover:text-base-content rounded-lg hover:bg-base-200 transition-colors shrink-0 cursor-pointer"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="18" cy="5" r="3" />
                <circle cx="6" cy="12" r="3" />
                <circle cx="18" cy="19" r="3" />
                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
              </svg>
            </button>
            <div ref={shareRef} className="relative shrink-0">
              <button
                type="button"
                onClick={() => { play(shareOpen ? 'overlay.close' : 'overlay.expand'); setShareOpen(!shareOpen); }}
                aria-expanded={shareOpen}
                aria-haspopup="menu"
                aria-label="Más opciones de compartir"
                title="Más opciones de compartir"
                className="flex items-center justify-center w-9 h-9 text-base-content/70 hover:text-base-content rounded-lg hover:bg-base-200 transition-colors shrink-0 cursor-pointer"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                  <circle cx="5" cy="12" r="1.5" />
                  <circle cx="12" cy="12" r="1.5" />
                  <circle cx="19" cy="12" r="1.5" />
                </svg>
              </button>
              {shareOpen && (
                <div role="menu" aria-label="Opciones de compartir emergencia" className="absolute top-full right-0 mt-1 w-48 bg-base-100 border border-base-300 rounded-xl shadow-2xl p-1.5 grid grid-cols-1 gap-0.5 z-50 animate-[fadeSlideIn_0.15s_ease-out]">
                  <button type="button" role="menuitem" disabled={!hasShareData} onClick={() => handleShare('summary')} className="flex items-center gap-2 px-3 py-2 text-xs rounded-lg text-left hover:bg-base-200 transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <path d="M14 2v6h6" />
                    </svg>
                    Copiar resumen
                  </button>
                  <button type="button" role="menuitem" disabled={!hasShareData} onClick={() => handleShare('image')} className="flex items-center gap-2 px-3 py-2 text-xs rounded-lg text-left hover:bg-base-200 transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <path d="M21 15l-5-5L5 21" />
                    </svg>
                    Compartir imagen
                  </button>
                </div>
              )}
              {shareMsg && (
                <span key={shareMsgKey} role="status" 
                    className="absolute -top-7 -right-2 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-primary text-primary-content shadow whitespace-nowrap queonda-toast-long">
                  {shareMsg}
                </span>
              )}
            </div>
          </div>
          <p className="section-subtitle text-sm text-base-content/70 mt-1 text-pretty">Alertas SENAPRED, sismos y cortes de suministro eléctrico</p>
        </div>

        <div className="mt-6 rounded-xl p-4 border border-base-300 shadow-sm bg-base-200 animate-[fadeInUp_0.3s_ease-out]">
          <p className="em-subhead">
            <span className="inline-flex items-center gap-1.5">
              <svg className="h-5 w-5" width="1em" height="1em" viewBox="0 0 24 24" aria-hidden="true">
                <title>alert</title>
                <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2">
                  <path strokeDasharray="60" d="M12 3l9 17h-18l9 -17Z">
                    <animate fill="freeze" attributeName="stroke-dashoffset" dur="0.6s" values="60;0" />
                  </path>
                  <path strokeDasharray="6" strokeDashoffset="6" d="M12 10v4">
                    <animate fill="freeze" attributeName="stroke-dashoffset" begin="0.7s" dur="0.2s" to="0" />
                  </path>
                  <path strokeDasharray="4" strokeDashoffset="4" d="M12 17v0.01">
                    <animate fill="freeze" attributeName="stroke-dashoffset" begin="0.7s" dur="0.2s" to="0" />
                  </path>
                </g>
              </svg>
              Alertas SENAPRED
            </span>
            {alerts.length > 0 && (
              <a href="https://www.senapred.gov.cl/eventos/" target="_blank" rel="noopener noreferrer">senapred.gov.cl</a>
            )}
          </p>
          <LoadSwap
            loading={!alertsLoaded}
            label="Cargando alertas SENAPRED…"
            className="min-h-[63px] sm:min-h-[44px]"
            skeleton={
              <div aria-hidden="true" className="flex flex-col gap-2 pb-1">
                <div className="h-[13px] w-3/4 max-w-[300px] rounded bg-base-300 skel-shimmer" />
                <div className="h-[13px] w-1/2 max-w-[220px] rounded bg-base-300 skel-shimmer" />
              </div>
            }
          >
            {alertsError ? (
              <LoadErrorBox retrying={retrying} retryIn={retryIn} onRetry={retryNow} />
            ) : alerts.length === 0 ? (
              <div className="pb-1">
                <p className="text-xs text-base-content/70">
                  Sin alertas SENAPRED activas en las últimas 24 horas.
                </p>
                {/* Segunda línea: el bloque de canales no compite con el mensaje
                    y puede envolver sin apretar los enlaces. */}
                <p className="mt-1.5 flex flex-wrap items-baseline gap-x-1.5 gap-y-1 text-[11px] text-base-content/70">
                  <span className="mr-0.5">Ver SENAPRED en:</span>
                  {SENAPRED_LINKS.map((l, i) => (
                    // El separador viaja pegado a su enlace (nowrap): al envolver
                    // nunca queda un «·» solo al principio de la línea.
                    <Fragment key={l.href}>
                      <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap">
                        {i > 0 && <span aria-hidden="true" className="text-base-content/30">·</span>}
                        <a
                          href={l.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline decoration-base-content/30 underline-offset-2 transition-colors hover:text-base-content hover:decoration-current"
                        >
                          {l.label}
                        </a>
                      </span>
                    </Fragment>
                  ))}
                </p>
              </div>
            ) : (
              <ScrollRow>
                {alerts.map((a) => (
                  <a
                    key={a.id}
                    href={a.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`card-curl sev-${a.severity} snap-start shrink-0 w-[260px] sm:w-[300px] flex flex-col rounded-lg p-3 bg-base-100 hover:bg-base-300 transition-colors no-underline`}
                  >
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <span className={severityBadges[a.severity] + ' shrink-0'}>{severityLabels[a.severity]}</span>
                      <span className="shrink-0 text-[11px] text-base-content">
                        {new Date(a.time).toLocaleDateString('es-CL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <p className="text-xs text-base-content leading-snug line-clamp-4">{a.description}</p>
                  </a>
                ))}
              </ScrollRow>
            )}
          </LoadSwap>
          {alerts.length > 0 && <SectionSources section="senapred" />}
        </div>

        <div className="relative mt-4 rounded-xl p-4 border border-base-300 shadow bg-base-200 animate-[fadeInUp_0.3s_ease-out]">
          <div className="flex items-center justify-between gap-2 pb-1.5 mb-1.5 border-b border-base-300">
            <p className="em-subhead !mb-0 !pb-0 !border-b-0">
              <span className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5">
                  <svg className="h-5 w-5 scale-125" width="1em" height="1em" viewBox="0 0 30 30" aria-hidden="true">
                    <title>earthquake</title>
                    <path fill="currentColor" d="M5.25 15.3c0 .16.06.29.17.4s.25.16.4.16H8.8c.14 0 .27-.04.38-.13s.17-.2.2-.34l.9-5.27L11.9 23.3c.02.14.09.26.19.36c.1.09.22.14.36.14c.15 0 .28-.05.38-.14s.17-.21.2-.36l1.25-9.67l1.04 2.8c.04.11.1.2.2.27s.2.1.32.1h.05c.12-.01.23-.05.32-.13c.1-.08.16-.18.19-.31l1.53-6.86l.71 13.18c.01.14.06.27.15.37s.21.16.36.17c.14.01.27-.02.38-.1a.6.6 0 0 0 .22-.33l1.65-6.94h2.77c.16 0 .29-.05.4-.16s.17-.24.17-.4s-.06-.29-.17-.4a.56.56 0 0 0-.4-.17h-3.23c-.13 0-.25.04-.35.12s-.17.18-.2.31l-.83 3.54l-.72-13.36a.57.57 0 0 0-.16-.37a.5.5 0 0 0-.36-.16c-.14-.01-.27.02-.39.11s-.19.2-.22.34l-2 8.97l-1.16-3.16c-.04-.12-.12-.21-.24-.28s-.24-.1-.36-.08c-.13.01-.24.07-.33.16s-.15.21-.17.34l-.98 7.51l-1.53-12.56a.64.64 0 0 0-.19-.35a.6.6 0 0 0-.36-.15a.53.53 0 0 0-.38.12c-.11.09.18.2-.2.35l-1.48 8.61H5.82c-.16 0-.29.06-.4.17s-.17.24-.17.4" />
                  </svg>
                  Sismos
                </span>
                <span className="group relative inline-flex">
                <button
                  type="button"
                  aria-label="Máximo 10 sismos más recientes"
                  className="inline-flex h-5 w-5 items-center justify-center text-base-content/70 hover:text-base-content transition-colors cursor-help"
                >
                  <svg className="h-5 w-5" viewBox="-0.0 -0.0 233.0 233.0" fill="currentColor" aria-hidden="true">
                    <g transform="translate(0.000000,233.000000) scale(0.100000,-0.100000)">
                      <path d="M990 2139 c-93 -14 -246 -69 -336 -120 -97 -55 -222 -179 -301 -297 -152 -226 -205 -509 -148 -784 44 -215 197 -442 388 -578 77 -55 226 -125 323 -152 116 -32 381 -32 507 0 343 86 602 356 698 728 34 130 32 308 -5 457 -51 211 -109 319 -245 460 -123 127 -295 226 -465 268 -95 23 -317 33 -416 18z m248 -325 c74 -37 106 -93 100 -173 -11 -160 -194 -234 -315 -128 -99 87 -81 238 36 299 67 35 112 35 179 2z m47 -499 l25 -24 0 -281 c0 -267 1 -281 20 -300 11 -11 29 -20 41 -20 35 0 58 -19 68 -56 13 -47 -7 -100 -44 -114 -37 -14 -438 -13 -468 1 -65 29 -60 135 7 159 17 6 42 17 56 24 l25 12 3 197 c1 109 -2 205 -6 214 -5 8 -31 23 -58 32 -58 19 -80 53 -69 107 4 25 16 41 38 54 28 18 51 20 185 20 149 0 154 -1 177 -25z" />
                    </g>
                  </svg>
                </button>
                <span className="pointer-events-none absolute left-0 top-full z-50 mt-1.5 max-w-[90vw] whitespace-nowrap rounded-lg border border-base-300 bg-base-100 px-2.5 py-1.5 text-left text-[11px] leading-snug text-base-content shadow-lg opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                  <span className="absolute -top-1.5 left-2 h-3 w-3 rotate-45 border-l border-t border-base-300 bg-base-100" aria-hidden="true" />
                  Máximo 10 sismos más recientes
                </span>
                </span>
              </span>
            </p>
            <button
              type="button"
              onClick={toggleDock}
              data-dock-slot
              aria-label={docked ? 'Devolver la barra al modo flotante' : 'Acoplar la barra a esta sección'}
              className={`inline-flex shrink-0 items-center gap-2 rounded-full border-2 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider transition-all duration-200 cursor-pointer active:scale-[0.96] ${
                docked
                  ? 'border-solid border-base-300 bg-base-100 text-base-content/80 shadow-sm'
                  : 'border-dashed border-warning/60 bg-base-300/55 text-base-content/70 shadow-[inset_0_1px_3px_rgba(0,0,0,0.08)] hover:border-warning/80 hover:text-base-content hover:bg-base-300/70'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${docked ? 'bg-warning' : 'bg-warning/35'}`} />
              <span>{docked ? 'Liberar alertas' : 'Acoplar alertas'}</span>
            </button>
          </div>
          <LoadSwap
            loading={loading}
            label="Cargando sismos…"
            skeleton={
              <>
                <div className="flex gap-2 overflow-x-hidden" aria-hidden="true">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="w-[200px] sm:w-[230px] shrink-0 rounded-xl p-3 border border-base-300 h-[158px]">
                      <div className="h-4 w-12 bg-base-300 rounded-full skel-shimmer" />
                      <div className="h-3 bg-base-300 rounded w-full mt-2 skel-shimmer" />
                      <div className="h-2.5 bg-base-300 rounded w-12 mt-1.5 skel-shimmer" />
                    </div>
                  ))}
                </div>
                {/* Fila del enlace "Ver mapa de sismos", que la card real siempre pinta */}
                <div className="mt-3 h-4 w-32 rounded bg-base-300 skel-shimmer" aria-hidden="true" />
              </>
            }
          >
            {sismosError ? (
              <LoadErrorBox retrying={retrying} retryIn={retryIn} onRetry={retryNow} />
            ) : items.length === 0 ? (
              <p className="text-xs text-base-content/70 pb-1">Sin sismos recientes -{' '}
                <a href="https://www.sismologia.cl/" target="_blank" rel="noopener noreferrer"
                  className="underline hover:text-base-content transition-colors">Sismología Chile</a>
              </p>
            ) : (
              <>
                <ScrollRow>
                  {items.map((item) => (
                  <div
                    key={item.id}
                    className={`card-curl sev-${item.severity} snap-start shrink-0 w-[200px] sm:w-[230px] flex flex-col rounded-xl p-3 bg-base-100`}
                  >
                    <div className="mb-1.5">
                      <div className="flex items-center gap-1.5">
                        <span className={severityBadges[item.severity] + ' shrink-0'}>{severityLabels[item.severity]}</span>
                        {item.mag !== undefined && (
                          <span className="text-sm font-bold text-base-content shrink-0">M {item.mag.toFixed(1)}</span>
                        )}
                        <button
                          type="button"
                          onClick={() => openMap(item)}
                          disabled={item.lat == null || item.lon == null}
                          aria-label={item.lat != null && item.lon != null
                            ? 'Ver dónde ocurrió en el mapa'
                            : 'Mapa no disponible: este sismo no tiene coordenadas'}
                          title={item.lat != null && item.lon != null
                            ? 'Ver en el mapa'
                            : 'Mapa no disponible: este sismo no tiene coordenadas'}
                          className="ml-auto w-6 h-6 shrink-0 flex items-center justify-center rounded-full bg-base-200 border border-base-300 text-base-content/70 hover:text-base-content hover:bg-base-300 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-base-200 disabled:hover:text-base-content/70"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
                            <circle cx="12" cy="10" r="3" />
                            {(item.lat == null || item.lon == null) && (
                              <path d="m9 9 6 6m0-6-6 6" />
                            )}
                          </svg>
                        </button>
                      </div>
                      <span className="block text-[11px] text-base-content/70 mt-0.5">
                        {new Date(item.time).toLocaleDateString('es-CL', {
                          day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                        })}
                      </span>
                    </div>
                    <p className="text-xs text-base-content leading-snug line-clamp-2" title={item.place || item.title}>{item.place || item.title}</p>
                    <div className="mt-auto pt-1.5 flex items-center justify-between gap-1">
                      {item.depth !== undefined && (
                        <span className="text-[11px] text-base-content/70">{item.depth.toFixed(1)} km</span>
                      )}
                    </div>
                  </div>
                ))}
                </ScrollRow>
                <div className="flex gap-2 mt-3">
                  <button
                    type="button"
                    disabled={!hasMapCoordinates}
                    onClick={() => {
                      const next = !showMap;
                      setShowMap(next);
                      if (next) setFocusId(null);
                      play('interaction.toggle');
                    }}
                    aria-expanded={showMap && hasMapCoordinates}
                    aria-controls="sismos-map"
                    title={hasMapCoordinates ? undefined : 'No hay coordenadas disponibles para estos sismos'}
                    className="mt-1 flex items-center gap-1 text-[11px] text-primary hover:text-base-content transition-[color,transform] active:scale-[0.96] cursor-pointer disabled:cursor-not-allowed disabled:text-base-content/50 disabled:hover:text-base-content/50 disabled:active:scale-100"
                  >
                    <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
                      className={`transition-transform duration-200 ${showMap && hasMapCoordinates ? 'rotate-90' : ''}`}>
                      <path d="M9 18l6-6-6-6" />
                    </svg>
                    {!hasMapCoordinates
                      ? 'Mapa no disponible: fuente cargada no ofrece coordenadas'
                      : `${showMap ? 'Ocultar mapa' : 'Ver mapa'} · ${mappedCount} de ${earthquakeCount} ubicados`}
                  </button>
                </div>
                <div className={`mt-2 grid transition-[grid-template-rows] duration-300 ease-out ${showMap && hasMapCoordinates ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
                  <div className="overflow-hidden min-h-0">
                    {mapMounted && (
                      <div id="sismos-map" className="relative isolate z-0 rounded-lg border border-base-300 overflow-hidden bg-base-100 p-3">
                        <p className="mb-2 text-[11px] text-base-content/70">
                          {mappedCount === earthquakeCount
                            ? `El mapa incluye todos los sismos (${mappedCount}).`
                            : `El mapa incluye ${mappedCount} de ${earthquakeCount} sismos; los demás no tienen coordenadas disponibles.`}
                        </p>
                        <Suspense fallback={<div className="h-40 skel-shimmer bg-base-300 rounded" />}>
                          <EmergencyMap items={items} focusId={focusId} focusRequest={focusRequest} />
                        </Suspense>
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </LoadSwap>
          {sismosSources.length > 0 && (
            <SectionSources
              section="emergency"
              only={sismosSources.map(source => EARTHQUAKE_SOURCE_NAMES[source])}
            />
          )}


        </div>

        <Suspense fallback={<div className={`mt-4 rounded-xl border border-base-300 shadow-sm ${initialBreakdown !== false ? 'min-h-[1210px] sm:min-h-[918px]' : 'min-h-[306px] sm:min-h-[277px]'}`} />}>
          <PowerOutageWidget
            initialBreakdown={initialBreakdown}
            onSummary={handlePowerSummary}
          />
        </Suspense>
      </section>
    </>
  );
}

// Shown when the emergency sources failed to load — never claim "no hay sismo/alertas".
// El reintento es automático (backoff 5 s → 60 s) y el botón mantiene el bloque
// montado: nada de volver al skeleton mientras se reintenta.
function LoadErrorBox({
  retrying,
  retryIn,
  onRetry,
}: {
  retrying: boolean;
  retryIn: number;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 text-xs text-base-content/70">
      <div className="min-w-0">
        <p>No se pudieron cargar los datos de emergencia en este momento.</p>
        <p className="mt-0.5"><RetryHint retrying={retrying} retryIn={retryIn} /></p>
      </div>
      <button
        type="button"
        onClick={onRetry}
        disabled={retrying}
        className="shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg bg-primary text-primary-content text-xs font-semibold hover:opacity-90 active:scale-[0.97] transition-[opacity,transform] cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 12a9 9 0 1 1-2.64-6.36" />
          <path d="M21 3v6h-6" />
        </svg>
        {retrying ? 'Reintentando…' : 'Reintentar ahora'}
      </button>
    </div>
  );
}

// Horizontal scroller with edge-fade arrow controls (shared by senapred + sismos)
function ScrollRow({ children }: { children: ReactNode }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 4);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    checkScroll();
    el.addEventListener('scroll', checkScroll, { passive: true });
    const ro = new ResizeObserver(checkScroll);
    ro.observe(el);
    window.addEventListener('resize', checkScroll);
    return () => {
      el.removeEventListener('scroll', checkScroll);
      ro.disconnect();
      window.removeEventListener('resize', checkScroll);
    };
  }, [checkScroll]);

  const scrollBy = useCallback((dir: number) => {
    scrollRef.current?.scrollBy({ left: dir * 280, behavior: 'smooth' });
  }, []);

  return (
    <div className="relative">
      {canScrollLeft && (
        <div className="absolute left-0 inset-y-0 z-10 flex items-center pointer-events-none"
          style={{ background: 'linear-gradient(to right, var(--color-base-100) 40%, transparent)' }}>
          <button onClick={() => { scrollBy(-1); play('interaction.subtle'); }} aria-label="Desplazar a la izquierda"
            className="pointer-events-auto w-7 h-7 flex items-center justify-center rounded-full bg-base-200 border border-base-300 text-base-content/70 hover:text-base-content hover:bg-base-300 transition-colors cursor-pointer ml-1">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
          </button>
        </div>
      )}

      <div ref={scrollRef} className="overflow-x-auto" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
        <div className="flex gap-2 py-1.5 px-1.5">{children}</div>
      </div>

      {canScrollRight && (
        <div className="absolute right-0 inset-y-0 z-10 flex items-center pointer-events-none"
          style={{ background: 'linear-gradient(to left, var(--color-base-100) 40%, transparent)' }}>
          <button onClick={() => { scrollBy(1); play('interaction.subtle'); }} aria-label="Desplazar a la derecha"
            className="pointer-events-auto w-7 h-7 flex items-center justify-center rounded-full bg-base-200 border border-base-300 text-base-content/70 hover:text-base-content hover:bg-base-300 transition-colors cursor-pointer mr-1">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
          </button>
        </div>
      )}
    </div>
  );
}