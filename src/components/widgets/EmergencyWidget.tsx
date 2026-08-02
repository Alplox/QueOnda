import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { PowerOutageWidget } from './PowerOutageWidget';
import { play } from '@/lib/sound';
import { idbGet, idbSet } from '@/lib/idb-cache';

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
}

const IDB_KEY = 'emergency';
const IDB_TTL = 5 * 60 * 1000;

// ponytail: server-side /api/emergency aggregates Gael → Boostr → USGS (CORS + edge cache)
async function fetchEmergency() {
  try {
    const res = await fetch('/api/emergency', { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return { items: [], senapred: [] };
    const data = await res.json();
    return {
      items: (data.items || []) as EmergencyItem[],
      senapred: (data.senapred || []) as EmergencyItem[],
    };
  } catch { return { items: [], senapred: [] }; }
}

const severityBadges: Record<string, string> = {
  critical: 'badge badge-xs badge-error',
  high: 'badge badge-xs badge-warning',
  moderate: 'badge badge-xs badge-info',
  low: 'badge badge-xs badge-warning',
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

  useEffect(() => {
    let cancelled = false;

    idbGet<EmergencyItem[]>(IDB_KEY).then(cached => {
      if (cancelled || !cached?.data) return;
      if (Array.isArray(cached.data)) setItems(cached.data);
      setLoading(false);
    });

    async function load() {
      const { items: eqs, senapred } = await fetchEmergency();
      if (cancelled) return;
      setItems(eqs);
      setAlerts(senapred);
      setLoading(false);
      idbSet(IDB_KEY, eqs, IDB_TTL);
    }
    load();
    return () => { cancelled = true; };
  }, []);

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
            <ScrollRow>
              {items.map((item, i) => (
                <a
                  key={item.id}
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ animationDelay: `${i * 60}ms` }}
                  className={`card-curl sev-${item.severity} snap-start shrink-0 w-[200px] sm:w-[230px] flex flex-col rounded-xl p-3 bg-base-100 hover:bg-base-300 transition-colors no-underline animate-[fadeInUp_0.3s_ease-out_forwards] opacity-0`}
                >
                  <div className="mb-1.5">
                    <div className="flex items-center gap-1.5">
                      <span className={severityBadges[item.severity] + ' shrink-0'}>{severityLabels[item.severity]}</span>
                      {item.mag !== undefined && (
                        <span className="text-sm font-bold text-base-content shrink-0">M {item.mag.toFixed(1)}</span>
                      )}
                    </div>
                    <span className="block text-[9px] text-base-content/50 mt-0.5">
                      {new Date(item.time).toLocaleDateString('es-CL', {
                        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                      })}
                    </span>
                  </div>
                  <p className="text-xs text-base-content leading-snug line-clamp-2">{item.place || item.title}</p>
                  {item.depth !== undefined && (
                    <div className="mt-1.5 text-[9px] text-base-content/70">{item.depth.toFixed(1)} km</div>
                  )}
                </a>
              ))}
            </ScrollRow>
          )}
          <div className="mt-1 -mb-1 text-right text-[10px] text-base-content/50">
            Fuentes:{' '}
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