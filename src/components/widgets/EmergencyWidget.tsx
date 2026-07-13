import { useEffect, useState } from 'react';
import { EmergencyAlertBar } from './EmergencyAlertBar';
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
const MIN_MAGNITUDE = 5.0;

function getSeverity(mag: number): 'low' | 'moderate' | 'high' | 'critical' {
  if (mag >= 6) return 'critical';
  if (mag >= 5) return 'high';
  if (mag >= 4) return 'moderate';
  return 'low';
}

// ponytail: all 3 sources are CORS-enabled — no server proxy needed
async function fetchGaelCloud(): Promise<EmergencyItem[]> {
  try {
    const res = await fetch('https://api.gael.cloud/general/public/sismos', { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return [];
    const data = await res.json();
    return data
      .filter((eq: any) => parseFloat(eq.Magnitud) >= MIN_MAGNITUDE)
      .sort((a: any, b: any) => new Date(b.Fecha).getTime() - new Date(a.Fecha).getTime())
      .slice(0, 10)
      .map((eq: any) => {
        const mag = parseFloat(eq.Magnitud);
        const depth = parseFloat(eq.Profundidad);
        return {
          id: `${eq.Fecha}-${eq.RefGeografica}`, type: 'earthquake' as const,
          title: `M ${mag.toFixed(1)} — ${eq.RefGeografica}`,
          description: `${eq.RefGeografica}. Profundidad: ${depth} km.`,
          time: new Date(eq.Fecha).getTime(), url: 'https://www.csn.uchile.cl/',
          severity: getSeverity(mag), mag, place: eq.RefGeografica, depth,
        };
      });
  } catch { return []; }
}

async function fetchBoostr(): Promise<EmergencyItem[]> {
  try {
    const res = await fetch('https://api.boostr.cl/earthquakes/recent.json', { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return [];
    const json = await res.json();
    if (json.status !== 'success' || !Array.isArray(json.data)) return [];
    return json.data
      .map((eq: any) => {
        const mag = parseFloat(eq.magnitude);
        if (isNaN(mag) || mag < MIN_MAGNITUDE) return null;
        const depth = parseFloat(eq.depth.replace(' km', ''));
        const time = new Date(`${eq.date} ${eq.hour}`).getTime();
        if (isNaN(time)) return null;
        return {
          id: `${eq.date}-${eq.hour}-${eq.place}`, type: 'earthquake' as const,
          title: `M ${mag.toFixed(1)} — ${eq.place}`,
          description: `${eq.place}. Profundidad: ${depth} km.`,
          time, url: eq.info || '', severity: getSeverity(mag), mag, place: eq.place, depth,
        };
      })
      .filter(Boolean)
      .sort((a: any, b: any) => b.time - a.time)
      .slice(0, 10);
  } catch { return []; }
}

async function fetchUSGS(): Promise<EmergencyItem[]> {
  try {
    const res = await fetch('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson', { signal: AbortSignal.timeout(10000) });
    const data = await res.json();
    return data.features
      .filter((f: any) => {
        const place = f.properties.place || '';
        return f.properties.mag >= MIN_MAGNITUDE && (place.toLowerCase().includes('chile') || place.toLowerCase().includes('south america'));
      })
      .slice(0, 20)
      .map((f: any) => ({
        id: f.id, type: 'earthquake' as const,
        title: `M ${f.properties.mag.toFixed(1)} — ${f.properties.place}`,
        description: f.properties.place, time: f.properties.time, url: f.properties.url,
        severity: getSeverity(f.properties.mag), mag: f.properties.mag,
        place: f.properties.place, depth: f.geometry.coordinates[2],
      }));
  } catch { return []; }
}

const severityColors: Record<string, string> = {
  critical: 'bg-base-200 border border-base-300 border-t-2 border-t-error',
  high: 'bg-base-200 border border-base-300 border-t-2 border-t-warning',
  moderate: 'bg-base-200 border border-base-300 border-t-2 border-t-info',
  low: 'bg-base-200 border border-base-300 border-t-2 border-t-warning',
};

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

const MAX_ITEMS = 9;

export function EmergencyWidget() {
  const [items, setItems] = useState<EmergencyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [initialItems, setInitialItems] = useState(3);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    setInitialItems(mq.matches ? 4 : 3);
    const handler = (e: MediaQueryListEvent) => setInitialItems(e.matches ? 4 : 3);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    let cancelled = false;

    idbGet<EmergencyItem[]>(IDB_KEY).then(cached => {
      if (cancelled || !cached?.data) return;
      setItems(cached.data);
      setLoading(false);
    });

    async function load() {
      let eqs = await fetchGaelCloud();
      if (eqs.length === 0) eqs = await fetchBoostr();
      if (eqs.length === 0) eqs = await fetchUSGS();
      eqs.sort((a, b) => b.time - a.time);
      if (cancelled) return;
      setItems(eqs);
      setLoading(false);
      idbSet(IDB_KEY, eqs, IDB_TTL);
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const visibleItems = expanded ? items.slice(0, MAX_ITEMS) : items.slice(0, initialItems);

  return (
    <>
      <EmergencyAlertBar items={items} />
      <section id="emergencia" className="scroll-mt-20 max-w-7xl mx-auto px-4 pt-4">
        <div className="mb-4 flex items-start justify-between gap-2">
          <div>
            <h2 className="text-2xl font-bold text-balance text-base-content">
              {'Emergencia'.split('').map((char, i) => (
                <span key={i} className="letter" style={{ transitionDelay: `${i * 30}ms` }}>{char === ' ' ? '\u00A0' : char}</span>
              ))}
            </h2>
            <p className="text-sm text-base-content/70 mt-1">Sismos recientes en Chile (≥5.0)</p>
          </div>
          {!loading && items.length > initialItems && (
            <button
              onClick={() => {
                setExpanded(e => {
                  play(e ? 'overlay.close' : 'overlay.expand');
                  return !e;
                });
              }}
              className="shrink-0 mt-1 text-xs font-medium text-primary hover:text-primary/80 border border-primary/30 rounded-full px-3 py-1 hover:bg-primary/5 transition-colors active:scale-[0.96]"
            >
              {expanded ? 'Ocultar' : `Ver +${Math.min(items.length, MAX_ITEMS) - initialItems}`}
            </button>
          )}
        </div>

        {loading ? (
          <>
            <div className="flex sm:hidden gap-2 overflow-x-hidden pb-2 -mx-4 px-4">
              {Array.from({ length: initialItems }).map((_, i) => (
                <div key={i} className="snap-start shrink-0 w-[175px] rounded-xl p-3 shadow-sm border border-base-300">
                  <div className="flex items-center gap-1.5 animate-pulse">
                    <div className="h-4 w-12 bg-base-300 rounded-full" />
                    <div className="h-4 w-10 bg-base-300 rounded" />
                  </div>
                  <div className="h-2.5 bg-base-300 rounded w-20 mt-1.5 animate-pulse" />
                  <div className="h-3 bg-base-300 rounded w-full mt-2 animate-pulse" />
                  <div className="h-3 bg-base-300 rounded w-3/4 mt-1 animate-pulse" />
                  <div className="h-2.5 bg-base-300 rounded w-12 mt-1.5 animate-pulse" />
                </div>
              ))}
            </div>
            <div className="hidden sm:grid gap-2 grid-cols-3 lg:grid-cols-4">
              {Array.from({ length: initialItems }).map((_, i) => (
                <div key={i} className="rounded-xl p-3 shadow-sm border border-base-300">
                  <div className="flex items-center gap-1.5 animate-pulse">
                    <div className="h-4 w-12 bg-base-300 rounded-full" />
                    <div className="h-4 w-10 bg-base-300 rounded" />
                  </div>
                  <div className="h-2.5 bg-base-300 rounded w-20 mt-1.5 animate-pulse" />
                  <div className="h-3 bg-base-300 rounded w-full mt-2 animate-pulse" />
                  <div className="h-3 bg-base-300 rounded w-3/4 mt-1 animate-pulse" />
                  <div className="h-2.5 bg-base-300 rounded w-12 mt-1.5 animate-pulse" />
                </div>
              ))}
            </div>
          </>
        ) : items.length === 0 ? (
          <p className="text-xs text-base-content/40 pb-1 opacity-0 animate-[fadeSlideIn_0.3s_ease-out_forwards]">
            Sin sismos recientes (≥5.0) -{' '}
            <a
              href="https://www.sismologia.cl/"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-base-content transition-colors"
            >
              Sismología Chile
            </a>
          </p>
        ) : (
          <>
            <div className="flex sm:hidden gap-2 overflow-x-auto snap-x snap-mandatory pb-2 -mx-4 px-4">
              {visibleItems.map((item, i) => (
                <a
                  key={item.id}
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ animationDelay: `${i * 80}ms` }}
                  className={`snap-start shrink-0 w-[175px] rounded-xl p-3 shadow-sm hover:bg-base-300 hover:ring-1 hover:ring-inset hover:ring-base-content/5 transition-colors no-underline animate-[fadeInUp_0.3s_ease-out_forwards] opacity-0 ${severityColors[item.severity]}`}
                >
                  <div className="mb-1.5">
                    <div className="flex items-center gap-1.5">
                      <span className={severityBadges[item.severity] + ' shrink-0'}>
                        {severityLabels[item.severity]}
                      </span>
                      {item.mag !== undefined && (
                        <span className="text-sm font-bold text-base-content shrink-0">
                          M {item.mag.toFixed(1)}
                        </span>
                      )}
                    </div>
                    <span className="block text-[9px] text-base-content/40 mt-0.5">
                      {new Date(item.time).toLocaleDateString('es-CL', {
                        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                      })}
                    </span>
                  </div>
                  <p className="text-xs text-base-content leading-snug line-clamp-2">{item.place || item.title}</p>
                  {item.depth !== undefined && (
                    <div className="flex items-center gap-2 mt-1.5 text-[9px] text-base-content/70">
                      <span>{item.depth.toFixed(1)} km</span>
                    </div>
                  )}
                </a>
              ))}
            </div>

            <div className="hidden sm:grid gap-2 grid-cols-3 lg:grid-cols-4">
              {visibleItems.map((item, i) => (
                <a
                  key={item.id}
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ animationDelay: `${i * 80}ms` }}
                  className={`block rounded-xl p-3 shadow-sm hover:bg-base-300 hover:ring-1 hover:ring-inset hover:ring-base-content/5 transition-colors no-underline animate-[fadeInUp_0.3s_ease-out_forwards] opacity-0 ${severityColors[item.severity]}`}
                >
                  <div className="mb-1.5">
                    <div className="flex items-center gap-1.5">
                      <span className={severityBadges[item.severity] + ' shrink-0'}>
                        {severityLabels[item.severity]}
                      </span>
                      {item.mag !== undefined && (
                        <span className="text-sm font-bold text-base-content shrink-0">
                          M {item.mag.toFixed(1)}
                        </span>
                      )}
                    </div>
                    <span className="block text-[9px] text-base-content/40 mt-0.5">
                      {new Date(item.time).toLocaleDateString('es-CL', {
                        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                      })}
                    </span>
                  </div>
                  <p className="text-xs text-base-content leading-snug line-clamp-2">{item.place || item.title}</p>
                  {item.depth !== undefined && (
                    <div className="flex items-center gap-2 mt-1.5 text-[9px] text-base-content/70">
                      <span>{item.depth.toFixed(1)} km</span>
                    </div>
                  )}
                </a>
              ))}
            </div>
          </>
        )}

        <div className="mt-4 text-right text-[10px] text-base-content/70">
          <p>
            Fuentes:{' '}
            <a
              href="https://api.gael.cloud/#sismos"
              target="_blank"
              rel="noopener noreferrer"
              className="text-base-content/70 hover:text-base-content underline underline-offset-2 transition-colors"
            >
              Gael Cloud
            </a>
            {' · '}
            <a
              href="https://docs.boostr.cl/reference/earthquakes"
              target="_blank"
              rel="noopener noreferrer"
              className="text-base-content/70 hover:text-base-content underline underline-offset-2 transition-colors"
            >
              Boostr
            </a>
            {' · '}
            <a
              href="https://earthquake.usgs.gov/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-base-content/70 hover:text-base-content underline underline-offset-2 transition-colors"
            >
              USGS
            </a>
          </p>
        </div>
      </section>
    </>
  );
}
