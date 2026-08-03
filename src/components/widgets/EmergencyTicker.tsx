import { useCallback, useEffect, useRef, useState } from 'react';
import type { EmergencyItem } from './EmergencyWidget';
import { EmergencyAlertBar } from './EmergencyAlertBar';
import { play } from '@/lib/sound';
import { idbGet, idbSet } from '@/lib/idb-cache';
import { subscribeAutoRefresh } from '@/lib/auto-refresh';

const IDB_KEY = 'emergency';
const IDB_TTL = 5 * 60 * 1000;
const LS_COLLAPSED = 'emergency-bar-collapsed';

async function fetchEmergency(): Promise<{ items: EmergencyItem[]; ok: boolean }> {
  try {
    const res = await fetch('/api/emergency', { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return { items: [], ok: false };
    const data = await res.json();
    return { items: (data.items || []) as EmergencyItem[], ok: true };
  } catch { return { items: [], ok: false }; }
}

export function EmergencyTicker() {
  const [items, setItems] = useState<EmergencyItem[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [navHidden, setNavHidden] = useState(false);
  const lastScrollY = useRef(0);

  useEffect(() => {
    if (localStorage.getItem(LS_COLLAPSED) === '1') setCollapsed(true);
  }, []);

  // Header auto-hides on scroll down; hug the top when it's gone to avoid a gap
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
      if (!ok) return; // API unreachable → keep last-known; a real empty day hides the ticker via items.length === 0
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

  return (
    <div className="sticky z-40 transition-[top] duration-300" style={{ top: navHidden ? 0 : 56 }}>
      <div
        id="emergency-alert-bar"
        inert={collapsed}
        aria-hidden={collapsed}
        className={`transition-all duration-300 ease-out ${
          collapsed ? 'max-h-0 opacity-0 overflow-hidden' : 'max-h-10 opacity-100'
        }`}
      >
        <EmergencyAlertBar items={items} onClose={toggle} />
      </div>
      <button
        onClick={toggle}
        inert={!collapsed}
        aria-hidden={!collapsed}
        aria-expanded={!collapsed}
        aria-controls="emergency-alert-bar"
        aria-label={collapsed ? 'Mostrar alertas de emergencia' : 'Ocultar alertas de emergencia'}
        className={`mx-auto flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-base-content/80 hover:text-base-content bg-base-200 border border-base-300 rounded-full px-3 py-1.5 shadow-sm transition-all duration-300 active:scale-[0.96] ${
          collapsed
            ? 'mt-2 max-h-10 opacity-100 translate-y-0'
            : 'mt-0 max-h-0 opacity-0 -translate-y-2 pointer-events-none overflow-hidden'
        }`}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-warning shrink-0" />
        <span>Ver alertas</span>
      </button>
    </div>
  );
}
