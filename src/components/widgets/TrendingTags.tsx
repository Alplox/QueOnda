import { useState, useEffect, useCallback } from 'react';
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

  if (loading) {
    return (
      <div className="flex gap-2 overflow-hidden h-[34px]">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="h-[34px] w-20 rounded-full bg-base-300 animate-pulse shrink-0"
          />
        ))}
      </div>
    );
  }

  if (tags.length === 0 && !activeTag) return null;

  return (
    /* Una sola fila con scroll horizontal: antes las etiquetas hacían wrap y
       cada fila nueva empujaba toda la página hacia abajo (CLS). */
    <div className="flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
  );
}
