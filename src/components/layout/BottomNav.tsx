import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { SECTIONS } from '../../lib/sections';
import { play } from '@/lib/sound';

const DOCK_IDS = ['emergencia', 'noticias', 'tv', 'clima'];

// Swipe-to-dismiss: close when pulled past this distance, or flung downward
const DISMISS_PX = 110;
const FLING_PXMS = 0.5;

const ICONS: Record<string, ReactNode> = {
  emergencia: (
    <>
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </>
  ),
  noticias: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M8 9h8" />
      <path d="M8 13h8" />
      <path d="M8 17h5" />
    </>
  ),
  tv: (
    <>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="m8 2 4 4 4-4" />
    </>
  ),
  radios: (
    <>
      <path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9" />
      <path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5" />
      <circle cx="12" cy="12" r="2" />
      <path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5" />
      <path d="M19.1 4.9C23 8.8 23 15.1 19.1 19.1" />
    </>
  ),
  finanzas: (
    <>
      <line x1="12" y1="2" x2="12" y2="22" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </>
  ),
  youtube: (
    <>
      <rect x="2.5" y="5" width="19" height="14" rx="4" />
      <path d="m10 9 5 3-5 3Z" fill="currentColor" stroke="none" />
    </>
  ),
  spotify: (
    <>
      <path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5Zm18 0h-3a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-5Z" />
      <path d="M3 14v-3a9 9 0 0 1 18 0v3" />
    </>
  ),
  'tendencias-web': (
    <>
      <path d="M22 7 13.5 15.5 8.5 10.5 2 17" />
      <path d="M16 7h6v6" />
    </>
  ),
  clima: <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />,
  aire: (
    <>
      <path d="M17.7 7.7A2.5 2.5 0 1 1 19.5 12H2" />
      <path d="M9.6 4.6A2 2 0 1 1 11 8H2" />
      <path d="M12.6 19.4A2 2 0 1 0 14 16H2" />
    </>
  ),
  transporte: (
    <>
      <rect x="5" y="3" width="14" height="14" rx="2" />
      <path d="M5 10h14" />
      <path d="m9 21 1.5-4" />
      <path d="m15 21-1.5-4" />
      <circle cx="9" cy="13.5" r="1" />
      <circle cx="15" cy="13.5" r="1" />
    </>
  ),
  deportes: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m12 7.5 4.2 3-1.6 5H9.4l-1.6-5Z" />
    </>
  ),
  trabajos: (
    <>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </>
  ),
  feriados: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M16 3v4" />
      <path d="M8 3v4" />
      <path d="M3 10h18" />
    </>
  ),
  'fiestas-patrias': (
    <>
      <path d="M4 22V3" />
      <path d="M4 4h15l-3 4.5L19 13H4Z" />
    </>
  ),
};

function Icon({ id }: { id: string }) {
  return (
    <svg
      className="w-[22px] h-[22px]"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICONS[id]}
    </svg>
  );
}

export function BottomNav() {
  const [activeSection, setActiveSection] = useState('');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [lift, setLift] = useState(0);
  const [hidden, setHidden] = useState(false);
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const lastScrollY = useRef(0);
  const liftRef = useRef(0);
  const dragState = useRef({ active: false, startY: 0, lastY: 0, lastT: 0, velocity: 0, moved: false });
  const dragYRef = useRef(0);
  const suppressHandleClick = useRef(false);
  const slideOutTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (slideOutTimer.current !== null) window.clearTimeout(slideOutTimer.current);
    },
    [],
  );

  useEffect(() => {
    const sections = document.querySelectorAll('section[id]');
    if (!sections.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const intersecting = entries.filter((e) => e.isIntersecting);
        if (intersecting.length > 0) {
          setActiveSection(intersecting[0].target.id);
        }
      },
      { rootMargin: '-80px 0px -65% 0px', threshold: 0 },
    );

    sections.forEach((s) => observer.observe(s));
    return () => observer.disconnect();
  }, []);

  // Lift clear of the sticky radio player when it slides in (same pattern as BackToTop)
  // + auto-hide on scroll-down / reveal on scroll-up (same pattern as Header)
  useEffect(() => {
    let raf = false;
    const update = () => {
      const player = document.getElementById('sticky-radio-player');
      if (player) {
        const rect = player.getBoundingClientRect();
        const vh = window.innerHeight;
        const nextLift = rect.top < vh - 4 ? vh - rect.top : 0;
        liftRef.current = nextLift;
        setLift(nextLift);
      }
      const y = window.scrollY;
      let show = y < 56 || y < lastScrollY.current;
      // Never reveal over the footer credits — stay tucked away until they clear
      if (show) {
        const credits = document.getElementById('footer-credits');
        const nav = document.getElementById('bottom-nav');
        if (credits && nav) {
          const cr = credits.getBoundingClientRect();
          const bottomOffset = parseFloat(getComputedStyle(nav).bottom) || 12;
          const dockTop =
            window.innerHeight - liftRef.current - nav.offsetHeight - bottomOffset;
          if (cr.top < window.innerHeight && cr.bottom > dockTop) show = false;
        }
      }
      setHidden(!show);
      lastScrollY.current = y;
    };
    update();
    const onScroll = () => {
      if (raf) return;
      raf = true;
      requestAnimationFrame(() => {
        raf = false;
        update();
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', update);
    };
  }, []);

  useEffect(() => {
    if (!sheetOpen) return;
    document.body.style.overflow = 'hidden';
    const t = setTimeout(() => {
      sheetRef.current?.querySelector<HTMLElement>('a[href], button')?.focus();
    }, 80);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeSheet();
        return;
      }
      if (e.key !== 'Tab' || !sheetRef.current) return;
      const els = Array.from(
        sheetRef.current.querySelectorAll<HTMLElement>('a[href], button'),
      );
      if (!els.length) return;
      const first = els[0];
      const last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      document.body.style.overflow = '';
      document.removeEventListener('keydown', onKey);
    };
  }, [sheetOpen]);

  // Deferred so React commits first — the dock is inert while hidden/sheet-open,
  // and focus() silently fails on inert elements
  const restoreDockFocus = () => {
    window.setTimeout(() => moreRef.current?.focus({ preventScroll: true }), 60);
  };

  const onHandlePointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!sheetOpen || slideOutTimer.current !== null) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    suppressHandleClick.current = false;
    const st = dragState.current;
    st.active = true;
    st.startY = e.clientY;
    st.lastY = e.clientY;
    st.lastT = performance.now();
    st.velocity = 0;
    st.moved = false;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* pointer already gone */
    }
    setDragging(true);
  };

  const onHandlePointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const st = dragState.current;
    if (!st.active) return;
    const now = performance.now();
    const dt = now - st.lastT;
    if (dt > 0) st.velocity = st.velocity * 0.7 + ((e.clientY - st.lastY) / dt) * 0.3;
    st.lastY = e.clientY;
    st.lastT = now;
    if (!st.moved && Math.abs(e.clientY - st.startY) > 8) st.moved = true;
    const y = Math.max(0, e.clientY - st.startY);
    dragYRef.current = y;
    setDragY(y);
  };

  const endHandleDrag = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const st = dragState.current;
    if (!st.active) return;
    st.active = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    setDragging(false);
    const y = dragYRef.current;
    if (st.moved) suppressHandleClick.current = true; // dragged, not a tap: swallow the trailing click
    if (y > DISMISS_PX || (st.moved && st.velocity > FLING_PXMS)) {
      play('overlay.close');
      setSheetOpen(false); // unlocks scroll + fades backdrop immediately
      setDragY(window.innerHeight); // inline transform rides the transition off-screen
      slideOutTimer.current = window.setTimeout(() => {
        slideOutTimer.current = null;
        dragYRef.current = 0;
        setDragY(0);
      }, 320);
      restoreDockFocus();
    } else {
      setDragY(0); // spring back
    }
  };

  const onHandleClick = () => {
    if (suppressHandleClick.current) {
      suppressHandleClick.current = false;
      return;
    }
    closeSheet();
  };

  const closeSheet = () => {
    play('overlay.close');
    setSheetOpen(false);
    restoreDockFocus();
  };

  const handleNavClick = () => {
    play('navigation.forward');
    setSheetOpen(false);
  };

  const dock = SECTIONS.filter((s) => DOCK_IDS.includes(s.id));

  return (
    <>
      <nav
        id="bottom-nav"
        aria-label="Navegación de secciones"
        aria-hidden={sheetOpen || hidden}
        inert={sheetOpen || hidden}
        style={{ bottom: 'max(0.75rem, env(safe-area-inset-bottom))', transform: lift ? `translateY(-${lift}px)` : undefined }}
        className={`fixed left-3 right-3 z-40 lg:hidden rounded-2xl bg-base-100/90 backdrop-blur-lg shadow-[0_8px_30px_rgba(0,0,0,0.12),0_2px_8px_rgba(0,0,0,0.08)] transition-transform duration-300 ${
          sheetOpen
            ? '-translate-y-2 opacity-0 pointer-events-none'
            : hidden
              ? 'translate-y-[calc(100%_+_max(0.75rem,_env(safe-area-inset-bottom)))] pointer-events-none'
              : 'opacity-100'
        }`}
      >
        <div className="flex items-stretch px-1.5 py-1.5">
          {dock.map((section, i) => {
            const isActive = !sheetOpen && activeSection === section.id;
            return (
              <a
                key={section.id}
                href={`#${section.id}`}
                aria-label={section.label}
                aria-current={isActive ? 'true' : undefined}
                style={{ animationDelay: `${i * 45}ms` }}
                className={`min-w-0 flex-1 flex flex-col items-center justify-center gap-0.5 pt-1.5 pb-1 rounded-xl text-[10px] font-medium no-underline opacity-0 animate-[fadeInUp_0.35s_ease-out_forwards] transition-transform active:scale-[0.96] ${
                  isActive
                    ? 'text-primary'
                    : 'text-base-content/70 hover:text-base-content'
                }`}
              >
                <span
                  className={`flex items-center justify-center w-11 h-7 rounded-lg transition-colors duration-200 ${
                    isActive ? 'bg-primary/10' : ''
                  }`}
                >
                  <Icon id={section.id} />
                </span>
                <span className="truncate max-w-full">{section.label}</span>
              </a>
            );
          })}
          <button
            ref={moreRef}
            type="button"
            onClick={() => {
              if (slideOutTimer.current !== null) return; // still sliding out from a swipe dismiss
              play('overlay.open');
              setSheetOpen(true);
            }}
            aria-haspopup="dialog"
            aria-expanded={sheetOpen}
            aria-label="Todas las secciones"
            style={{ animationDelay: `${dock.length * 45}ms` }}
            className="min-w-0 flex-1 flex flex-col items-center justify-center gap-0.5 pt-1.5 pb-1 rounded-xl text-[10px] font-medium text-base-content/70 hover:text-base-content opacity-0 animate-[fadeInUp_0.35s_ease-out_forwards] transition-transform active:scale-[0.96]"
          >
            <span className="flex items-center justify-center w-11 h-7 rounded-lg">
              <svg className="w-[22px] h-[22px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="4" y="4" width="7" height="7" rx="1.5" />
                <rect x="13" y="4" width="7" height="7" rx="1.5" />
                <rect x="4" y="13" width="7" height="7" rx="1.5" />
                <rect x="13" y="13" width="7" height="7" rx="1.5" />
              </svg>
            </span>
            <span>Más</span>
          </button>
        </div>
      </nav>

      <div
        className={`fixed inset-0 z-[10000] bg-neutral/50 backdrop-blur-sm lg:hidden transition-opacity duration-300 ${
          sheetOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={closeSheet}
        aria-hidden="true"
      />

      <div
        ref={sheetRef}
        id="section-sheet"
        role="dialog"
        aria-modal={sheetOpen || undefined}
        aria-label="Todas las secciones"
        aria-hidden={!sheetOpen}
        inert={!sheetOpen}
        style={dragY ? { transform: `translateY(${dragY}px)` } : undefined}
        className={`fixed inset-x-0 bottom-0 z-[10001] lg:hidden bg-base-100 rounded-t-3xl shadow-[0_-8px_40px_rgba(0,0,0,0.25)] border-t border-base-300 max-h-[80vh] flex flex-col ease-out ${
          dragging ? '' : 'transition-transform duration-300'
        } ${sheetOpen ? 'translate-y-0' : 'translate-y-full'}`}
      >
        <button
          type="button"
          onClick={onHandleClick}
          onPointerDown={onHandlePointerDown}
          onPointerMove={onHandlePointerMove}
          onPointerUp={endHandleDrag}
          onPointerCancel={endHandleDrag}
          aria-label="Cerrar"
          className="shrink-0 w-full pt-3 pb-2 flex items-center justify-center cursor-grab active:cursor-grabbing touch-none select-none rounded-t-3xl focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
        >
          <span className="w-10 h-1 rounded-full bg-base-content/20" aria-hidden="true" />
        </button>
        <div className="flex items-center justify-between px-5 pt-1 pb-2 shrink-0">
          <span className="text-lg font-bold text-base-content">Secciones</span>
          <button
            type="button"
            onClick={closeSheet}
            aria-label="Cerrar"
            className="flex items-center justify-center w-9 h-9 text-base-content/70 hover:text-base-content rounded-lg hover:bg-base-200 transition-colors"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <line x1="5" y1="5" x2="15" y2="15" />
              <line x1="15" y1="5" x2="5" y2="15" />
            </svg>
          </button>
        </div>
        <nav aria-label="Todas las secciones" className="overflow-y-auto px-3 pb-[calc(1rem+env(safe-area-inset-bottom))] grid grid-cols-3 gap-1.5">
          {SECTIONS.map((section) => {
            const isActive = activeSection === section.id;
            return (
              <a
                key={section.id}
                href={`#${section.id}`}
                onClick={handleNavClick}
                aria-current={isActive ? 'true' : undefined}
                className={`flex flex-col items-center gap-1.5 px-1 py-3.5 rounded-xl text-xs font-medium no-underline text-center transition-colors transition-transform active:scale-[0.96] ${
                  isActive
                    ? 'text-primary bg-primary/10'
                    : 'text-base-content/70 hover:text-base-content hover:bg-base-200'
                }`}
              >
                <Icon id={section.id} />
                <span className="leading-tight">{section.label}</span>
              </a>
            );
          })}
        </nav>
      </div>
    </>
  );
}
