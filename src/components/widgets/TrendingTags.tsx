import { useState, useEffect, useCallback, useRef } from 'react';
import { play } from '@/lib/sound';

interface Props {
  tags: string[];
  loading?: boolean;
}

function getTag(): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('tag');
}

function setTag(tag: string | null) {
  const url = new URL(window.location.href);
  if (tag) url.searchParams.set('tag', tag);
  else url.searchParams.delete('tag');
  window.history.pushState({ tag }, '', url.toString());
  window.dispatchEvent(new CustomEvent('tagchange', { detail: { tag } }));
}

export function TrendingTags({ tags, loading }: Props) {
  const [activeTag, setActiveTag] = useState<string | null>(() => getTag());
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [scrollEdges, setScrollEdges] = useState({ overflow: false, start: true, end: true });

  useEffect(() => {
    const handler = () => setActiveTag(getTag());
    window.addEventListener('tagchange', handler);
    window.addEventListener('popstate', handler);
    return () => {
      window.removeEventListener('tagchange', handler);
      window.removeEventListener('popstate', handler);
    };
  }, []);

  const handleClick = useCallback((tag: string) => {
    if (activeTag === tag) {
      play('interaction.confirm');
      setTag(null);
    } else {
      play('interaction.tap');
      setTag(tag);
    }
  }, [activeTag]);

  const measureScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const next = { overflow: max > 8, start: el.scrollLeft <= 8, end: max <= 8 || el.scrollLeft >= max - 8 };
    setScrollEdges(previous =>
      previous.overflow === next.overflow && previous.start === next.start && previous.end === next.end
        ? previous
        : next
    );
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    measureScroll();
    el.addEventListener('scroll', measureScroll, { passive: true });
    window.addEventListener('resize', measureScroll);
    const observer = new ResizeObserver(measureScroll);
    observer.observe(el);
    return () => {
      el.removeEventListener('scroll', measureScroll);
      window.removeEventListener('resize', measureScroll);
      observer.disconnect();
    };
  }, [measureScroll, tags]);

  const slideTags = useCallback((direction: number) => {
    const el = scrollerRef.current;
    if (!el) return;
    play('interaction.subtle');
    el.scrollBy({ left: direction * Math.max(el.clientWidth * 0.9, 160), behavior: 'smooth' });
  }, []);

  if (loading) {
    return (
      <div className="flex gap-2 overflow-hidden h-[40px] items-center">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="h-[34px] w-20 rounded-full bg-base-300 skel-shimmer shrink-0"
          />
        ))}
      </div>
    );
  }

  if (tags.length === 0 && !activeTag) return null;

  return (
    /* Una sola fila con scroll horizontal: antes las etiquetas hacían wrap y
       cada fila nueva empujaba toda la página hacia abajo (CLS). */
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => slideTags(-1)}
        disabled={!scrollEdges.overflow || scrollEdges.start}
        aria-label="Desplazar etiquetas a la izquierda"
        className="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-base-content/70 transition-colors hover:bg-base-200 hover:text-base-content disabled:pointer-events-none disabled:opacity-30"
      >
        <svg aria-hidden="true" className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m15 18-6-6 6-6" />
        </svg>
      </button>
      <div ref={scrollerRef} className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto px-1 py-[3px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tags.map((tag, i) => {
        const isActive = activeTag === tag;
        return (
          <button
            key={i}
            onClick={() => handleClick(tag)}
            aria-pressed={isActive}
            style={{ animationDelay: `${i * 40}ms` }}
            className={`shrink-0 px-3 py-1.5 rounded-full text-sm border transition-[background-color,border-color,color,transform] cursor-pointer active:scale-[0.96] hover:scale-105 animate-[fadeSlideIn_0.25s_ease-out_forwards] ${
              isActive
                ? 'bg-primary border-primary text-primary-content'
                : 'bg-base-200 text-base-content/70 border-base-300 hover:border-primary/50 hover:text-base-content'
            }`}
          >
            #{tag}
          </button>
        );
        })}
        {activeTag && (
          <button
            onClick={() => { play('interaction.confirm'); setTag(null); }}
            className="shrink-0 px-3 py-1.5 rounded-full text-sm bg-base-200 text-error border border-base-300 hover:border-error/50 hover:text-base-content transition-colors cursor-pointer active:scale-[0.96]"
          >
            Limpiar filtro
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={() => slideTags(1)}
        disabled={!scrollEdges.overflow || scrollEdges.end}
        aria-label="Desplazar etiquetas a la derecha"
        className="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-base-content/70 transition-colors hover:bg-base-200 hover:text-base-content disabled:pointer-events-none disabled:opacity-30"
      >
        <svg aria-hidden="true" className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m9 18 6-6-6-6" />
        </svg>
      </button>
    </div>
  );
}
