import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { PowerOutageWidget } from './PowerOutageWidget';
import { EmergencyMap } from './EmergencyMap';
import { play } from '@/lib/sound';
import { extractHost } from '@/lib/url';
import { idbGet, idbSet } from '@/lib/idb-cache';
import { subscribeAutoRefresh } from '@/lib/auto-refresh';
import { parseChileLocal } from '@/lib/chile-time';

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
// ok=false → the API itself was unreachable (keep last-good); ok=true → trust the payload even if empty
async function fetchEmergency() {
  try {
    const res = await fetch('/api/emergency', { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return { items: [], senapred: [], ok: false };
    const data = await res.json();
    return {
      items: (data.items || []) as EmergencyItem[],
      senapred: (data.senapred || []) as EmergencyItem[],
      ok: true,
    };
  } catch { return { items: [], senapred: [], ok: false }; }
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
    const exact = candidates.find((c) => c.time === it.time);
    let c = exact;
    if (!c) {
      c = candidates
        .filter((x) => Math.abs(x.time - it.time) <= COORD_TOL)
        .sort(
          (a, b) =>
            Math.abs(a.time - it.time) + Math.abs(a.mag - it.mag) * 60_000 -
            (Math.abs(b.time - it.time) + Math.abs(b.mag - it.mag) * 60_000),
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
  // senapred no se cachea en IDB (solo items), así que mantiene su propio flag de carga
  const [alertsLoaded, setAlertsLoaded] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);

  const openMap = (item: EmergencyItem) => {
    setShowMap(true);
    setFocusId(item.id);
    play('interaction.toggle');
  };

  const refresh = useCallback(async () => {
    const { items: eqs, senapred, ok } = await fetchEmergency();
    if (ok) {
      // Trust a reachable server: a genuinely empty day clears to the placeholder instead of
      // showing stale alerts forever. Only a failed fetch keeps last-known data.
      const enriched = await enrichWithBoostr(eqs);
      setItems(enriched);
      setAlerts(senapred);
      if (enriched.length) idbSet(IDB_KEY, enriched, IDB_TTL);
    }
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

  return (
    <>
      <section id="emergencia" className="scroll-mt-20 mb-8 md:mb-12">
        <div className="mb-4">
          <h2 className="text-2xl font-bold text-balance text-base-content">
            {'Emergencia'.split('').map((char, i) => (
              <span key={i} className="letter" style={{ transitionDelay: `${i * 30}ms` }}>{char === ' ' ? '\u00A0' : char}</span>
            ))}
          </h2>
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
          ) : alerts.length === 0 ? (
            <p className="text-xs text-base-content/50 pb-1">Sin alertas SENAPRED activas</p>
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
                      {new Date(a.time).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}
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
                    <span className="block text-[9px] text-base-content/50 mt-0.5">
                      {new Date(item.time).toLocaleDateString('es-CL', {
                        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                      })}
                    </span>
                  </div>
                  <p className="text-xs text-base-content leading-snug line-clamp-2">{item.place || item.title}</p>
                  <div className="mt-auto pt-1.5 flex items-center justify-between gap-1">
                    {item.depth !== undefined && (
                      <span className="text-[9px] text-base-content/70">{item.depth.toFixed(1)} km</span>
                    )}
                    {item.url && (
                      <span className="ml-auto text-[9px] text-base-content/40 truncate max-w-[70%]">{extractHost(item.url)}</span>
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
                className="text-[11px] font-medium text-primary hover:text-primary/80 border border-primary/30 rounded-full px-3 py-1 hover:bg-primary/5 transition-colors active:scale-[0.96]"
              >
                {showMap ? 'Ocultar mapa' : 'Ver mapa de sismos'}
              </button>
            </div>
            {showMap && (
              <div className="mt-2 rounded-lg border border-base-300 overflow-hidden bg-base-100 p-3 animate-[fadeInUp_0.3s_ease-out]">
                <EmergencyMap items={items} focusId={focusId} />
              </div>
            )}
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