import { useEffect, useRef, useState } from 'react';
import type { EmergencyItem } from './EmergencyWidget';

interface Props {
  items: EmergencyItem[];
  onClose?: () => void;
  onOpenMap: (item: EmergencyItem) => void;
}

const severityColors: Record<string, string> = {
  critical: 'bg-error',
  high: 'bg-warning',
  moderate: 'bg-info',
  low: 'bg-success',
};

export function EmergencyAlertBar({ items, onClose, onOpenMap }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const posRef = useRef(0);
  const pausedRef = useRef(false);
  const rafRef = useRef(0);
  const [repeats, setRepeats] = useState(2);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || items.length === 0) return;

    // Respect reduced motion: show the first items statically instead of animating
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      el.style.transform = 'translateX(0)';
      return () => { cancelAnimationFrame(rafRef.current); };
    }

    const contentWidth = el.scrollWidth / repeats;
    if (contentWidth <= 0) return;

    const parentWidth = el.parentElement?.clientWidth ?? window.innerWidth;
    const needed = Math.ceil(parentWidth / contentWidth) + 2;
    if (needed > repeats) {
      setRepeats(needed);
      return;
    }

    posRef.current = 0;
    const SPEED = 40;
    let lastTime = performance.now();

    const tick = (now: number) => {
      if (!pausedRef.current) {
        const dt = (now - lastTime) / 1000;
        lastTime = now;
        posRef.current -= SPEED * dt;
        if (Math.abs(posRef.current) >= contentWidth) {
          posRef.current += contentWidth;
        }
        el.style.transform = `translateX(${posRef.current}px)`;
      } else {
        lastTime = now;
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [items, repeats]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || items.length === 0) return;

    const handleResize = () => {
      const cw = el.scrollWidth / repeats;
      if (cw <= 0) return;
      const vw = window.innerWidth;
      setRepeats(Math.max(2, Math.ceil(vw / cw) + 2));
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [items, repeats]);

  if (items.length === 0) return null;

  const topItem = items[0];
  const isCritical = topItem.severity === 'critical' || topItem.severity === 'high';

  const renderItem = (item: EmergencyItem, key: string) => {
    const hasCoordinates = item.lat != null && item.lon != null;
    const content = (
      <>
        <span className={`w-1.5 h-1.5 rounded-full ${severityColors[item.severity]}`} />
        <span className="font-semibold text-base-content">{item.mag ? `M${item.mag.toFixed(1)}` : ''}</span>
        <span className="whitespace-nowrap text-base-content/70">{item.place || item.title}</span>
        <span className="text-[11px] text-base-content/70">
          {new Date(item.time).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}
        </span>
        {hasCoordinates && (
          <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
            <circle cx="12" cy="10" r="3" />
          </svg>
        )}
      </>
    );
    const className = `inline-flex items-center gap-2 text-xs shrink-0 ${
      item.severity === 'critical' ? 'text-error' : item.severity === 'high' ? 'text-warning' : 'text-base-content/80'
    }`;

    if (!hasCoordinates) return <span key={key} className={className}>{content}</span>;

    const location = item.place || item.title;
    const name = `Ver sismo ${item.mag != null ? `M ${item.mag.toFixed(1)} ` : ''}${location} en el mapa`;
    return (
      <button
        key={key}
        type="button"
        onClick={() => onOpenMap(item)}
        aria-label={name}
        title="Ver en el mapa"
        className={`${className} cursor-pointer hover:text-base-content focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary`}
      >
        {content}
      </button>
    );
  };

  return (
    <div
      className={`w-full overflow-hidden border-b ${
        isCritical ? 'border-error/30 bg-error/[0.06]' : 'border-base-300 bg-base-200'
      }`}
      onMouseEnter={() => { pausedRef.current = true; }}
      onMouseLeave={() => { pausedRef.current = false; }}
      onFocus={(e) => { if (e.currentTarget.contains(e.relatedTarget as Node)) return; pausedRef.current = true; }}
      onBlur={(e) => { if (e.currentTarget.contains(e.relatedTarget as Node)) return; pausedRef.current = false; }}
    >
      <div className="flex items-center h-9">
        <a
          href="#emergencia"
          aria-label={isCritical ? 'Ir al bloque de emergencias' : 'Ir al bloque de sismos'}
          className={`shrink-0 flex items-center gap-2 pl-4 pr-3 h-full z-10 cursor-pointer transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-current ${isCritical ? 'bg-error text-error-content' : 'bg-warning text-warning-content'}`}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" className="animate-pulse" aria-hidden="true">
            <path d="M12 2L1 21h22L12 2zm0 4l7.5 13h-15L12 6zm-1 5v4h2v-4h-2zm0 6v2h2v-2h-2z" />
          </svg>
          <span className="text-[11px] font-bold uppercase tracking-wider whitespace-nowrap">
            {isCritical ? 'Alerta' : 'Sismos'}
          </span>
        </a>

        <div className="flex-1 overflow-hidden relative">
          <div
            ref={scrollRef}
            className="flex gap-16 px-8"
            style={{ width: 'max-content', willChange: 'transform' }}
          >
            {Array.from({ length: repeats }, (_, c) =>
              items.map((item, i) => renderItem(item, `${item.id}-c${c}-${i}`))
            ).flat()}
          </div>
        </div>

        {onClose && (
          <button
            onClick={onClose}
            aria-label="Colapsar barra de emergencia"
            className="shrink-0 flex items-center justify-center h-full w-10 ml-3 text-base-content/70 hover:text-base-content transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
