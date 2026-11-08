import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { EmergencyItem } from './EmergencyWidget';
import { EmergencyAlertBar } from './EmergencyAlertBar';
import { play } from '@/lib/sound';
import { idbGet, idbSet } from '@/lib/idb-cache';
import { subscribeAutoRefresh } from '@/lib/auto-refresh';

const IDB_KEY = 'emergency';
const IDB_TTL = 5 * 60 * 1000;
const LS_COLLAPSED = 'emergency-bar-collapsed';
const LS_DOCKED = 'emergency-bar-docked';
const DOCK_EVENT = 'emergency:dock';

const CLIP_OPEN = 'inset(0 0 0 0 round 0px)';
const CLIP_PILL = 'inset(0 calc(50% - 60px) 0 calc(50% - 60px) round 18px)';
const EASE = 'cubic-bezier(0.22,1,0.36,1)';

async function fetchEmergency(): Promise<{ items: EmergencyItem[]; ok: boolean }> {
  try {
    const res = await fetch('/api/emergency', { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return { items: [], ok: false };
    const data = await res.json();
    return { items: (data.items || []) as EmergencyItem[], ok: true };
  } catch { return { items: [], ok: false }; }
}

const PILL_VISUAL_W = 120; // matches CLIP_PILL: calc(50% - 60px) each side

function morphToSlot(container: HTMLElement, collapsed: boolean): string | null {
  const slot = document.querySelector('[data-dock-slot]') as HTMLElement | null;
  if (!slot) return null;
  const prev = container.style.transform;
  container.style.transform = 'none';
  const s = container.getBoundingClientRect();
  container.style.transform = prev;
  const t = slot.getBoundingClientRect();
  const dx = (t.left + t.width / 2) - (s.left + s.width / 2);
  const dy = (t.top + t.height / 2) - (s.top + s.height / 2);
  // When collapsed, visible shape is a centered pill (PILL_VISUAL_W × container height)
  // When expanded, full width is visible
  const visualW = collapsed ? PILL_VISUAL_W : s.width;
  const visualH = s.height || 36;
  const sx = Math.max(0.05, t.width / visualW);
  const sy = Math.max(0.3, t.height / visualH);
  return `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
}

export function EmergencyTicker() {
  const [items, setItems] = useState<EmergencyItem[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [docked, setDocked] = useState(false);
  const [morph, setMorph] = useState<{ t: string; opacity: number; animate: boolean }>({ t: '', opacity: 1, animate: false });
  const containerRef = useRef<HTMLDivElement>(null);
  const [navHidden, setNavHidden] = useState(false);
  const lastScrollY = useRef(0);
  const morphTimer = useRef<number | null>(null);
  const animatingRef = useRef(false);

  // Init from localStorage (client-only, SSR-safe)
  useEffect(() => {
    try {
      if (localStorage.getItem(LS_COLLAPSED) === '1') setCollapsed(true);
      if (localStorage.getItem(LS_DOCKED) === '1') setDocked(true);
    } catch {}
  }, []);

  // When docked state changes, position ticker at slot (steady state, no animation)
  useLayoutEffect(() => {
    if (animatingRef.current) return;
    const el = containerRef.current;
    if (!el) return;
    if (docked) {
      const t = morphToSlot(el, true);
      if (t) {
        setMorph({ t, opacity: 0, animate: false });
      } else {
        // Slot not ready yet (widget island may not have hydrated) — retry briefly
        let tries = 0;
        const retry = () => {
          tries++;
          const t2 = el && morphToSlot(el, true);
          if (t2) setMorph({ t: t2, opacity: 0, animate: false });
          else if (tries < 12) requestAnimationFrame(retry);
        };
        requestAnimationFrame(retry);
      }
    } else {
      setMorph({ t: '', opacity: 1, animate: false });
    }
  }, [docked, items.length]);

  // Listen for dock events from EmergencyWidget
  useEffect(() => {
    const onDock = (e: Event) => {
      const detail = (e as CustomEvent).detail as { docked: boolean; silent?: boolean };
      const next = !!detail?.docked;
      const silent = !!detail?.silent;
      const el = containerRef.current;

      if (next && el) {
        if (silent) {
          setCollapsed(true);
          setDocked(true);
          return; // layout effect will snap to slot
        }
        // Dock: collapse to pill first if expanded, then morph to slot
        const doMorph = () => {
          const t = morphToSlot(el, true);
          if (!t) { setDocked(true); return; }
          animatingRef.current = true;
          setMorph({ t: '', opacity: 1, animate: false });
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              setMorph({ t, opacity: 0, animate: true });
              if (morphTimer.current) window.clearTimeout(morphTimer.current);
              morphTimer.current = window.setTimeout(() => {
                animatingRef.current = false;
                setDocked(true);
              }, 520);
            });
          });
        };
        setCollapsed(prev => {
          if (!prev) {
            if (morphTimer.current) window.clearTimeout(morphTimer.current);
            morphTimer.current = window.setTimeout(doMorph, 220);
            return true;
          }
          doMorph();
          return prev;
        });
        return;
      }

      if (!next && el) {
        // Undock: morph slot → floating pill, then expand pill → bar (preserve same-element illusion)
        const t = morphToSlot(el, true);
        animatingRef.current = true;
        setDocked(false);
        setCollapsed(true); // arrive as pill
        requestAnimationFrame(() => {
          setMorph({ t: t || '', opacity: 0, animate: false });
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              // 1) pill-at-slot → floating pill
              setMorph({ t: '', opacity: 1, animate: true });
              if (morphTimer.current) window.clearTimeout(morphTimer.current);
              morphTimer.current = window.setTimeout(() => {
                // 2) floating pill → expanded bar
                setCollapsed(false);
                morphTimer.current = window.setTimeout(() => { animatingRef.current = false; }, 340);
              }, 520);
            });
          });
        });
        return;
      }

      setDocked(next);
    };
    window.addEventListener(DOCK_EVENT, onDock);
    return () => {
      window.removeEventListener(DOCK_EVENT, onDock);
      if (morphTimer.current) window.clearTimeout(morphTimer.current);
    };
  }, []);

  // Header auto-hides on scroll down
  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY;
      if (y < 56 || y < lastScrollY.current) setNavHidden(false);
      else if (y > lastScrollY.current) setNavHidden(true);
      lastScrollY.current = y;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const refresh = useCallback(() => {
    fetchEmergency().then(({ items: eqs, ok }) => {
      if (!ok) return;
      setItems(eqs);
      if (eqs.length) idbSet(IDB_KEY, eqs, IDB_TTL);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    idbGet<EmergencyItem[]>(IDB_KEY).then(cached => {
      if (cancelled || !cached?.data) return;
      setItems(cached.data);
    });
    refresh();
    return () => { cancelled = true; };
  }, [refresh]);

  useEffect(() => subscribeAutoRefresh(refresh), [refresh]);

  if (items.length === 0) return null;

  const toggle = () => {
    play(collapsed ? 'overlay.expand' : 'overlay.close');
    setCollapsed(c => {
      localStorage.setItem(LS_COLLAPSED, c ? '0' : '1');
      return !c;
    });
  };

  const openSismoMap = (item: EmergencyItem) => {
    window.dispatchEvent(new CustomEvent('emergency:focus-sismo', { detail: item }));
  };

  const clip = collapsed ? CLIP_PILL : CLIP_OPEN;
  const clipTransition = `clip-path 300ms ${EASE}`;
  const morphTransition = morph.animate ? `transform 500ms ${EASE}, opacity 500ms ${EASE}, top 300ms` : 'top 300ms';

  return (
    <div
      ref={containerRef}
      role="region"
      aria-label="Alertas de emergencia"
      className={`fixed inset-x-0 z-40 ${collapsed ? 'pointer-events-none' : ''}`}
      style={{
        top: navHidden ? 0 : 56,
        transform: morph.t || undefined,
        opacity: morph.opacity,
        transition: morphTransition,
        pointerEvents: morph.opacity < 0.5 ? 'none' : undefined,
      }}
    >
      <div className="relative min-h-[36px]">
        <div
          aria-hidden="true"
          className="absolute inset-0 z-0 motion-reduce:!transition-none bg-base-200 border border-base-300"
          style={{ clipPath: clip, transition: clipTransition }}
        />
        <div
          id="emergency-alert-bar"
          aria-hidden={collapsed || docked}
          className={`relative z-[1] motion-reduce:!transition-none ${collapsed || docked ? 'pointer-events-none' : ''}`}
          style={{
            clipPath: clip,
            opacity: collapsed || docked ? 0 : 1,
            transition: collapsed || docked
              ? `clip-path 300ms ${EASE}, opacity 150ms ease-out`
              : `clip-path 300ms ${EASE}, opacity 200ms ease-out 100ms`,
          }}
        >
          <EmergencyAlertBar items={items} onClose={toggle} onOpenMap={openSismoMap} />
        </div>
        <div className="absolute inset-0 z-[2] flex items-center justify-center pointer-events-none">
          <button
            type="button"
            onClick={toggle}
            tabIndex={collapsed && !docked ? 0 : -1}
            aria-hidden={!collapsed || docked}
            inert={!collapsed || docked || undefined}
            aria-expanded={!collapsed}
            aria-controls="emergency-alert-bar"
            aria-label={collapsed ? 'Mostrar alertas de emergencia' : 'Ocultar alertas de emergencia'}
            className={`pointer-events-auto cursor-pointer flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-base-content/80 hover:text-base-content rounded-full px-3 py-1.5 active:scale-[0.96] motion-reduce:!transition-none ${collapsed && !docked ? '' : 'pointer-events-none'}`}
            style={{
              opacity: collapsed && !docked ? 1 : 0,
              transition: collapsed && !docked ? 'opacity 200ms ease-out 150ms' : 'opacity 100ms ease-out',
            }}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-warning shrink-0" />
            <span>Ver alertas</span>
          </button>
        </div>
      </div>
    </div>
  );
}
