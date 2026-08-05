import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { PowerOutageWidget } from './PowerOutageWidget';
import { EmergencyMap } from './EmergencyMap';
import { play } from '@/lib/sound';
import { extractHost } from '@/lib/url';
import { idbGet, idbSet } from '@/lib/idb-cache';
import { subscribeAutoRefresh } from '@/lib/auto-refresh';
import { parseChileLocal } from '@/lib/chile-time';
import {
  buildEmergencySummary,
  canShareFiles,
  copyToClipboard,
  downloadBlob,
  shareOrCopy,
} from '@/lib/share';
import { renderEmergencyCard } from '@/lib/share-image';

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

const IDB_KEY = 'emergency';
const IDB_TTL = 5 * 60 * 1000;

// ponytail: server-side /api/emergency aggregates Gael → Boostr → USGS (CORS + edge cache)
// error=true → sources failed (never render as "no quakes"); trust a reachable server otherwise
async function fetchEmergency() {
  try {
    const res = await fetch('/api/emergency', { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return { items: [], senapred: [], error: true, senapredError: false };
    const data = await res.json();
    return {
      items: (data.items || []) as EmergencyItem[],
      senapred: (data.senapred || []) as EmergencyItem[],
      error: !!data.error,
      senapredError: !!data.senapredError,
    };
  } catch { return { items: [], senapred: [], error: true, senapredError: false }; }
}

// Client-side coordinate enrichment. /api/emergency attaches lat/lon from Boostr,
// but Boostr can be unreachable from Cloudflare Workers (while still CORS-open to the
// user's browser, ACAO: *). So if any sismo came back without coordinates, refetch
// Boostr from the browser and match by the same Chile-local epoch, so pins always render.
const COORD_TOL = 10 * 60 * 1000;
async function enrichWithBoostr(items: EmergencyItem[]): Promise<EmergencyItem[]> {
  const needsCoords = items.some(
    (i) => i.type === 'earthquake' && i.mag != null && i.lat == null,
  );
  if (!needsCoords) return items;

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

  if (candidates.length === 0) return items;

  return items.map((it) => {
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
    return c ? { ...it, lat: c.lat, lon: c.lon } : it;
  });
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

export function EmergencyWidget() {
  const [items, setItems] = useState<EmergencyItem[]>([]);
  const [alerts, setAlerts] = useState<EmergencyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [sismosError, setSismosError] = useState(false);
  const [alertsError, setAlertsError] = useState(false);
  const [powerCount, setPowerCount] = useState<number | null>(null);
  // senapred no se cachea en IDB (solo items), así que mantiene su propio flag de carga
  const [alertsLoaded, setAlertsLoaded] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [mapMounted, setMapMounted] = useState(false);
  const [liveMsg, setLiveMsg] = useState('');
  const [shareOpen, setShareOpen] = useState(false);
  const [shareMsg, setShareMsg] = useState<string | null>(null);
  const [shareMsgKey, setShareMsgKey] = useState(0);
  const shareRef = useRef<HTMLDivElement>(null);
  const seenRef = useRef<{ sismos: Set<string>; alerts: Set<string> }>({ sismos: new Set(), alerts: new Set() });

  const hasShareData = items.length > 0 || alerts.length > 0 || (powerCount != null && powerCount > 0);

  const openMap = (item: EmergencyItem) => {
    setShowMap(true);
    setFocusId(item.id);
    play('interaction.toggle');
  };

  const refresh = useCallback(async () => {
    const { items: eqs, senapred, error, senapredError } = await fetchEmergency();
    if (!error) {
      // Trust a reachable server: a genuinely empty day clears to the placeholder instead of
      // showing stale alerts forever. Only a failed fetch keeps the error state.
      const enriched = await enrichWithBoostr(eqs);
      setItems(enriched);
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
    try {
      const res = await fetch('/api/power', { signal: AbortSignal.timeout(10000) });
      if (res.ok) {
        const d = await res.json();
        setPowerCount(d?.affected != null ? d.affected : null);
      }
    } catch { /* power unavailable — omit from summary */ }

    setAlertsLoaded(true);
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;

    idbGet<EmergencyItem[]>(IDB_KEY).then(cached => {
      if (cancelled || !cached?.data) return;
      if (Array.isArray(cached.data)) {
        // enrich cached (possibly coord-less) data in the background so pins appear
        // even while the fresh fetch is still in flight
        enrichWithBoostr(cached.data).then(enriched => {
          if (!cancelled) setItems(enriched);
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
        const r = await copyToClipboard(buildEmergencySummary(items, alerts, powerCount ?? undefined).text);
        setShareMsg(r === 'copied' ? 'Resumen copiado' : 'No se pudo copiar');
        play(r === 'copied' ? 'interaction.confirm' : 'notification.error');
      } else {
        const blob = await renderEmergencyCard(items, alerts, powerCount ?? undefined);
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
                    className="absolute -top-7 -right-2 px-2.5 py-1 rounded-md text-[10px] font-semibold bg-primary text-primary-content shadow whitespace-nowrap queonda-toast-long">
                  {shareMsg}
                </span>
              )}
            </div>
          </div>
          <p className="section-subtitle text-sm text-base-content/70 mt-1 text-pretty">Alertas SENAPRED, sismos y cortes de suministro eléctrico</p>
        </div>

        <div className="mt-6 rounded-xl p-4 border border-base-300 shadow-sm bg-base-200 animate-[fadeInUp_0.3s_ease-out]">
          <p className="em-subhead">
            <span>🚨 Alertas SENAPRED</span>
            <a href="https://www.senapred.gov.cl/eventos/" target="_blank" rel="noopener noreferrer">senapred.gov.cl</a>
          </p>
          {!alertsLoaded ? (
            <div className="flex gap-2 overflow-x-hidden">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="w-[260px] sm:w-[300px] shrink-0 rounded-lg p-3 border border-base-300">
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <div className="h-4 w-16 bg-base-300 rounded-full animate-pulse" />
                    <div className="h-2.5 w-10 bg-base-300 rounded animate-pulse" />
                  </div>
                  <div className="h-3 bg-base-300 rounded w-full animate-pulse" />
                  <div className="h-3 bg-base-300 rounded w-4/5 mt-1.5 animate-pulse" />
                </div>
              ))}
            </div>
          ) : alertsError ? (
            <LoadErrorBox onRetry={() => { setAlertsLoaded(false); refresh(); }} />
          ) : alerts.length === 0 ? (
            <p className="text-xs text-base-content/60 pb-1">
              Sin alertas SENAPRED activas dentro de las últimas 24 horas. 
              Ver SENAPRED en: <a href="https://www.senapred.gov.cl/eventos/" target="_blank" rel="noopener noreferrer" className="underline hover:text-base-content transition-colors">Sitio oficial</a> - 
             <a href="https://x.com/senapred" target="_blank" rel="noopener noreferrer" className="underline hover:text-base-content transition-colors">X</a> - 
             <a href="https://web.facebook.com/SenapredChile/" target="_blank" rel="noopener noreferrer" className="underline hover:text-base-content transition-colors">Facebook</a> - 
             <a href="https://www.youtube.com/@senapredchile" target="_blank" rel="noopener noreferrer" className="underline hover:text-base-content transition-colors">YouTube</a> - 
             <a href="https://www.whatsapp.com/channel/0029Va4UhwYEwEjuiauxoM09" target="_blank" rel="noopener noreferrer" className="underline hover:text-base-content transition-colors">WhatsApp</a> - 
              <a href="https://t.me/SenapredChile" target="_blank" rel="noopener noreferrer" className="underline hover:text-base-content transition-colors">Telegram</a>
            </p>
          ) : (
            <ScrollRow>
              {alerts.map((a, i) => (
                <a
                  key={a.id}
                  href={a.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ animationDelay: `${i * 60}ms` }}
                  className={`card-curl sev-${a.severity} snap-start shrink-0 w-[260px] sm:w-[300px] flex flex-col rounded-lg p-3 bg-base-100 hover:bg-base-300 transition-colors no-underline animate-[fadeInUp_0.3s_ease-out_forwards] opacity-0`}
                >
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <span className={severityBadges[a.severity] + ' shrink-0'}>{severityLabels[a.severity]}</span>
                    <span className="shrink-0 text-[9px] text-base-content/50">
                      {new Date(a.time).toLocaleDateString('es-CL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <p className="text-xs text-base-content leading-snug line-clamp-4">{a.description}</p>
                </a>
              ))}
            </ScrollRow>
          )}
          <div className="mt-1 -mb-1 text-right text-[10px] text-base-content/50">
            Fuente:{' '}
            <a href="https://t.me/SenapredChile" target="_blank" rel="noopener noreferrer"
              className="hover:text-base-content underline underline-offset-2 transition-colors">Telegram SENAPRED</a>
          </div>
        </div>

        <div className="mt-4 rounded-xl p-4 border border-base-300 shadow bg-base-200 animate-[fadeInUp_0.3s_ease-out]">
          <p className="em-subhead"><span>🌐 Sismos</span></p>
          {loading ? (
            <div className="flex gap-2 overflow-x-hidden">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="w-[175px] shrink-0 rounded-xl p-3 border border-base-300">
                  <div className="h-4 w-12 bg-base-300 rounded-full animate-pulse" />
                  <div className="h-3 bg-base-300 rounded w-full mt-2 animate-pulse" />
                  <div className="h-2.5 bg-base-300 rounded w-12 mt-1.5 animate-pulse" />
                </div>
              ))}
            </div>
          ) : sismosError ? (
            <LoadErrorBox onRetry={() => { setLoading(true); refresh(); }} />
          ) : items.length === 0 ? (
            <p className="text-xs text-base-content/50 pb-1">Sin sismos recientes -{' '}
              <a href="https://www.sismologia.cl/" target="_blank" rel="noopener noreferrer"
                className="underline hover:text-base-content transition-colors">Sismología Chile</a>
            </p>
          ) : (
            <>
              <ScrollRow>
                {items.map((item, i) => (
                <div
                  key={item.id}
                  style={{ animationDelay: `${i * 60}ms` }}
                  className={`card-curl sev-${item.severity} snap-start shrink-0 w-[200px] sm:w-[230px] flex flex-col rounded-xl p-3 bg-base-100 animate-[fadeInUp_0.3s_ease-out_forwards] opacity-0`}
                >
                  <div className="mb-1.5">
                    <div className="flex items-center gap-1.5">
                      <span className={severityBadges[item.severity] + ' shrink-0'}>{severityLabels[item.severity]}</span>
                      {item.mag !== undefined && (
                        <span className="text-sm font-bold text-base-content shrink-0">M {item.mag.toFixed(1)}</span>
                      )}
                      {item.lat != null && item.lon != null && (
                        <button
                          type="button"
                          onClick={() => openMap(item)}
                          aria-label="Ver dónde ocurrió en el mapa"
                          title="Ver en el mapa"
                          className="ml-auto w-6 h-6 flex items-center justify-center rounded-full bg-base-200 border border-base-300 text-base-content/70 hover:text-base-content hover:bg-base-300 transition-all cursor-pointer"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
                            <circle cx="12" cy="10" r="3" />
                          </svg>
                        </button>
                      )}
                    </div>
                    <span className="block text-[10px] text-base-content/60 mt-0.5">
                      {new Date(item.time).toLocaleDateString('es-CL', {
                        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                      })}
                    </span>
                  </div>
                  <p className="text-xs text-base-content leading-snug line-clamp-2" title={item.place || item.title}>{item.place || item.title}</p>
                  <div className="mt-auto pt-1.5 flex items-center justify-between gap-1">
                    {item.depth !== undefined && (
                      <span className="text-[10px] text-base-content/70">{item.depth.toFixed(1)} km</span>
                    )}
                    {item.url && (
                      <span className="ml-auto text-[10px] text-base-content/60 truncate max-w-[70%]">{extractHost(item.url)}</span>
                    )}
                  </div>
                </div>
              ))}
            </ScrollRow>
            <div className="flex gap-2 mt-3">
              <button
                type="button"
                onClick={() => {
                  const next = !showMap;
                  setShowMap(next);
                  if (next) setFocusId(null);
                  play('interaction.toggle');
                }}
                aria-expanded={showMap}
                aria-controls="sismos-map"
                className="mt-1 flex items-center gap-1 text-[10px] text-primary hover:text-base-content transition-[color,transform] active:scale-[0.96] cursor-pointer"
              >
                <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
                  className={`transition-transform duration-200 ${showMap ? 'rotate-90' : ''}`}>
                  <path d="M9 18l6-6-6-6" />
                </svg>
                {showMap ? 'Ocultar mapa de sismos' : 'Ver mapa de sismos'}
              </button>
            </div>
            <div className={`mt-2 grid transition-[grid-template-rows] duration-300 ease-out ${showMap ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
              <div className="overflow-hidden min-h-0">
                {mapMounted && (
                  <div id="sismos-map" className="rounded-lg border border-base-300 overflow-hidden bg-base-100 p-3">
                    <EmergencyMap items={items} focusId={focusId} />
                  </div>
                )}
              </div>
            </div>
            </>
          )}
          <div className="mt-1 -mb-1 text-right text-[10px] text-base-content/50">
            Fuentes:{' '}
            <a href="https://www.csn.uchile.cl/" target="_blank" rel="noopener noreferrer"
              className="hover:text-base-content underline underline-offset-2 transition-colors">CSN (U. de Chile)</a>
            {' · '}
            <a href="https://api.gael.cloud/#sismos" target="_blank" rel="noopener noreferrer"
              className="hover:text-base-content underline underline-offset-2 transition-colors">Gael Cloud</a>
            {' · '}
            <a href="https://docs.boostr.cl/reference/earthquakes" target="_blank" rel="noopener noreferrer"
              className="hover:text-base-content underline underline-offset-2 transition-colors">Boostr</a>
            {' · '}
            <a href="https://earthquake.usgs.gov/" target="_blank" rel="noopener noreferrer"
              className="hover:text-base-content underline underline-offset-2 transition-colors">USGS</a>
          </div>
        </div>

        <PowerOutageWidget />
      </section>
    </>
  );
}

// Shown when the emergency sources failed to load — never claim "no hay sismo/alertas"
function LoadErrorBox({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs text-base-content/70">
      <span>No se pudieron cargar los datos de emergencia en este momento.</span>
      <button
        type="button"
        onClick={onRetry}
        className="shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg bg-primary text-primary-content text-xs font-semibold hover:opacity-90 active:scale-[0.97] transition-all cursor-pointer"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 12a9 9 0 1 1-2.64-6.36" />
          <path d="M21 3v6h-6" />
        </svg>
        Reintentar
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
            className="pointer-events-auto w-7 h-7 flex items-center justify-center rounded-full bg-base-200 border border-base-300 text-base-content/70 hover:text-base-content hover:bg-base-300 transition-all cursor-pointer ml-1">
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
            className="pointer-events-auto w-7 h-7 flex items-center justify-center rounded-full bg-base-200 border border-base-300 text-base-content/70 hover:text-base-content hover:bg-base-300 transition-all cursor-pointer mr-1">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
          </button>
        </div>
      )}
    </div>
  );
}