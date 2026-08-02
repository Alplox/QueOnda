import { useEffect, useRef, useState } from 'react';
import type { EmergencyItem } from './EmergencyWidget';
import { EmergencyAlertBar } from './EmergencyAlertBar';
import { play } from '@/lib/sound';
import { idbGet, idbSet } from '@/lib/idb-cache';

const IDB_KEY = 'emergency';
const IDB_TTL = 5 * 60 * 1000;
const LS_COLLAPSED = 'emergency-bar-collapsed';

async function fetchEmergency(): Promise<EmergencyItem[]> {
  try {
    const res = await fetch('/api/emergency', { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.items || []) as EmergencyItem[];
  } catch { return []; }
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

  useEffect(() => {
    let cancelled = false;

    idbGet<EmergencyItem[]>(IDB_KEY).then(cached => {
      if (cancelled || !cached?.data) return;
      setItems(cached.data);
    });

    fetchEmergency().then(eqs => {
      if (cancelled) return;
      setItems(eqs);
      idbSet(IDB_KEY, eqs, IDB_TTL);
    });
    return () => { cancelled = true; };
  }, []);

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
        className={`transition-all duration-300 ease-out ${
          collapsed ? 'max-h-0 opacity-0 overflow-hidden' : 'max-h-10 opacity-100'
        }`}
      >
        <EmergencyAlertBar items={items} onClose={toggle} />
      </div>
      <button
        onClick={toggle}
        aria-label="Mostrar alertas de emergencia"
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
