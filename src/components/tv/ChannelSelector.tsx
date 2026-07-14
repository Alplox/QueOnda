import { useRef, useCallback, useEffect, useState } from 'react';
import { play } from '@/lib/sound';

interface Props {
  categories: string[];
  counts: Record<string, number>;
  selected: string;
  onSelect: (cat: string) => void;
}

const LABELS: Record<string, string> = {
  todas: 'Todos',
  __favorites__: 'Favoritos',
  news: 'Noticias',
  general: 'General',
  sports: 'Deportes',
  music: 'Música',
  entertainment: 'Entretención',
  culture: 'Cultura',
  kids: 'Infantiles',
  legislative: 'Legislativo',
  business: 'Negocios',
  religious: 'Religioso',
  outdoor: 'Cámaras',
  animation: 'Animación',
};

export function ChannelSelector({ categories, counts, selected, onSelect }: Props) {
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
    return () => el.removeEventListener('scroll', checkScroll);
  }, [checkScroll, categories]);

  const scrollBy = useCallback((dir: number) => {
    scrollRef.current?.scrollBy({ left: dir * 200, behavior: 'smooth' });
  }, []);

  return (
    <div className="relative">
      {canScrollLeft && (
        <div className="absolute left-0 inset-y-0 z-10 flex items-center pointer-events-none"
          style={{ background: 'linear-gradient(to right, var(--color-base-100) 40%, transparent)' }}>
          <button onClick={() => { scrollBy(-1); play('interaction.subtle'); }} aria-label="Desplazar categorías a la izquierda"
            className="pointer-events-auto w-6 h-6 flex items-center justify-center rounded-full bg-base-200 border border-base-300 text-base-content/70 hover:text-base-content hover:bg-base-300 transition-all cursor-pointer ml-1">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
          </button>
        </div>
      )}

      <div ref={scrollRef}
        className="overflow-x-auto"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
        <div className="flex gap-1.5 py-1 px-1">
          {categories.map((cat, i) => {
            const isActive = selected === cat;
            const label = LABELS[cat] || cat;
            const count = counts[cat] ?? 0;
            return (
              <button
                key={cat}
                onClick={() => { play('navigation.tab'); onSelect(cat); }}
                style={{ animationDelay: `${i * 40}ms` }}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 transition-all cursor-pointer active:scale-[0.96] opacity-0 animate-[fadeSlideIn_0.25s_ease-out_forwards] ${
                  isActive
                    ? 'bg-primary text-primary-content ring-1 ring-primary'
                    : 'text-base-content/70 hover:text-base-content/70 hover:bg-base-content/[0.04]'
                }`}
              >
                {label === 'Favoritos' ? (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill={isActive ? 'var(--color-primary)' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                  </svg>
                ) : null}
                <span>{label}</span>
                <span className={`text-[10px] font-mono px-1 py-0.5 rounded ${
                  isActive ? 'bg-primary text-primary-content' : 'bg-base-content/[0.05] text-base-content/70'
                }`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {canScrollRight && (
        <div className="absolute right-0 inset-y-0 z-10 flex items-center pointer-events-none"
          style={{ background: 'linear-gradient(to left, var(--color-base-100) 40%, transparent)' }}>
          <button onClick={() => { scrollBy(1); play('interaction.subtle'); }} aria-label="Desplazar categorías a la derecha"
            className="pointer-events-auto w-6 h-6 flex items-center justify-center rounded-full bg-base-200 border border-base-300 text-base-content/70 hover:text-base-content hover:bg-base-300 transition-all cursor-pointer mr-1">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
          </button>
        </div>
      )}
    </div>
  );
}
