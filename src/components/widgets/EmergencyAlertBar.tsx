import { useEffect, useRef, useState } from 'react';
import type { EmergencyItem } from './EmergencyWidget';
import { play } from '@/lib/sound';

interface Props {
  items: EmergencyItem[];
}

const severityColors: Record<string, string> = {
  critical: 'bg-error',
  high: 'bg-warning',
  moderate: 'bg-info',
  low: 'bg-warning',
};

export function EmergencyAlertBar({ items }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const posRef = useRef(0);
  const pausedRef = useRef(false);
  const rafRef = useRef(0);
  const [repeats, setRepeats] = useState(2);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || items.length === 0) return;

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

  const renderItem = (item: EmergencyItem, key: string) => (
    <a
      key={key}
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => play('notification.warning')}
      className={`inline-flex items-center gap-2 text-xs no-underline shrink-0 ${
        item.severity === 'critical' ? 'text-error-content' : item.severity === 'high' ? 'text-warning-content' : 'text-base-content/80'
      } hover:text-base-content transition-colors`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${severityColors[item.severity]}`} />
      <span className="font-semibold text-base-content">{item.mag ? `M${item.mag.toFixed(1)}` : ''}</span>
      <span className="whitespace-nowrap text-base-content/70">{item.place || item.title}</span>
      <span className="text-[10px] text-base-content/70">
        {new Date(item.time).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}
      </span>
    </a>
  );

  return (
    <div
      className={`w-full overflow-hidden border-b ${
        isCritical ? 'border-error/30 bg-error/[0.06]' : 'border-base-300 bg-base-200'
      }`}
      onMouseEnter={() => { pausedRef.current = true; }}
      onMouseLeave={() => { pausedRef.current = false; }}
    >
      <div className="flex items-center h-9">
        <div className={`shrink-0 flex items-center gap-2 pl-4 pr-3 h-full z-10 ${isCritical ? 'bg-error text-error-content' : 'bg-warning text-warning-content'}`}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" className="animate-pulse">
            <path d="M12 2L1 21h22L12 2zm0 4l7.5 13h-15L12 6zm-1 5v4h2v-4h-2zm0 6v2h2v-2h-2z" />
          </svg>
          <span className="text-[10px] font-bold uppercase tracking-wider whitespace-nowrap">
            {isCritical ? 'Alerta' : 'Sismos'}
          </span>
        </div>

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
      </div>
    </div>
  );
}
