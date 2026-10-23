import { useRef, useCallback, useEffect, useState } from 'react';
import type { Channel } from '../../types';
import { play } from '@/lib/sound';

interface Props {
  channels: Channel[];
  selectedIds: string[];
  favorites: Set<string>;
  onSelect: (channel: Channel) => void;
  onToggleFavorite: (id: string) => void;
  onDragChannelStart?: (channel: Channel, e: React.PointerEvent) => void;
  /** Rows of channels to show (1–5). Values above 1 wrap into a horizontally scrolling grid. */
  rows?: number;
  /**
   * `strip` (default) = horizontal scrolling row(s), full width.
   * `wrap` = vertical wrapping grid for narrow columns (the "player on the side" layout).
   */
  variant?: 'strip' | 'wrap';
}

export function ChannelGrid({ channels, selectedIds, favorites, onSelect, onToggleFavorite, onDragChannelStart, rows = 1, variant = 'strip' }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const rowCount = Math.max(1, Math.min(5, Math.round(rows)));
  const multiRow = rowCount > 1;
  const wrap = variant === 'wrap';

  const checkScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 4);
  }, []);

  useEffect(() => {
    if (wrap) return;
    const el = scrollRef.current;
    if (!el) return;
    checkScroll();
    el.addEventListener('scroll', checkScroll, { passive: true });
    return () => el.removeEventListener('scroll', checkScroll);
  }, [checkScroll, channels, rowCount, wrap]);

  const scrollBy = useCallback((dir: number) => {
    const el = scrollRef.current;
    if (!el) return;
    // Step a near-full viewport so long lists stay quick to traverse
    const amount = Math.max(240, Math.round(el.clientWidth * 0.85));
    el.scrollBy({ left: dir * amount, behavior: 'smooth' });
  }, []);

  if (channels.length === 0) {
    return (
      <div className="text-center py-8 rounded-xl bg-base-100 border border-base-300">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="mx-auto mb-2 text-base-content/70">
          <rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8" /><path d="M12 17v4" />
        </svg>
        <p className="text-xs text-base-content/70">No hay canales</p>
      </div>
    );
  }

  const renderChannel = (ch: Channel, index: number) => {
    const isSelected = selectedIds.includes(ch.id);
    const isFav = favorites.has(ch.id);

    return (
      <div
        key={ch.id}
        style={{ animationDelay: `${Math.min(index, 12) * 40}ms` }}
        className={`relative flex flex-col items-center gap-1.5 p-2 rounded-xl transition-all ${
          wrap ? 'w-full' : 'shrink-0 w-[84px] sm:w-24'
        } opacity-0 animate-[fadeSlideIn_0.3s_ease-out_forwards] ${
          isSelected
            ? 'bg-primary ring-2 ring-primary'
            : 'bg-base-200 hover:bg-base-200 ring-1 ring-base-content/[0.07]'
        }`}
      >
        {/* Select channel — real button, fills the card for keyboard + touch */}
        <button
          type="button"
          onClick={() => { play('interaction.tap'); onSelect(ch); }}
          aria-pressed={isSelected}
          aria-label={`Ver canal ${ch.name}`}
          className="absolute inset-0 z-0 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        />
        {/* Drag handle */}
        {onDragChannelStart && (
          <button
            type="button"
            onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); onDragChannelStart(ch, e); }}
            aria-label="Arrastrar al multiview"
            className="absolute -top-1 -left-1 z-20 w-5 h-5 flex items-center justify-center rounded-full bg-base-300 border border-base-300 text-base-content/50 hover:text-base-content hover:bg-base-200 cursor-grab active:cursor-grabbing touch-none transition-colors"
            style={{ touchAction: 'none' }}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <circle cx="9" cy="5" r="1.5"/><circle cx="15" cy="5" r="1.5"/>
              <circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/>
              <circle cx="9" cy="19" r="1.5"/><circle cx="15" cy="19" r="1.5"/>
            </svg>
          </button>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); play('interaction.toggle'); onToggleFavorite(ch.id); }}
          aria-label={isFav ? `Quitar ${ch.name} de favoritos` : `Agregar ${ch.name} a favoritos`}
          aria-pressed={isFav}
          className={`absolute top-1 right-1 z-10 w-5 h-5 flex items-center justify-center rounded-full transition-all active:scale-[0.85] ${
            isFav
              ? isSelected
                ? 'bg-base-100 text-primary ring-1 ring-primary'
                : 'bg-primary text-primary-content'
              : 'bg-base-200 text-base-content/70 opacity-30 hover:opacity-70 hover:bg-base-300 ring-1 ring-base-content/[0.06]'
          }`}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill={isFav ? 'var(--color-primary)' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
          </svg>
        </button>

        {/* Logo */}
        <div className={`${wrap ? 'w-11 h-11' : 'w-12 h-12 sm:w-14 sm:h-14'} rounded-xl overflow-hidden bg-base-100 flex items-center justify-center`}>
          {ch.logo ? (
            <img src={ch.logo} alt={ch.name} className="w-full h-full object-contain" loading="lazy" onError={(e) => { const t = e.currentTarget; t.style.display = 'none'; t.parentElement && (t.parentElement.querySelector('.fallback') as HTMLElement)?.classList.remove('hidden'); }} />
          ) : null}
          <span className={`text-sm font-bold text-base-content fallback ${ch.logo ? 'hidden' : ''}`}>{ch.name.charAt(0)}</span>
        </div>

        {/* Name */}
        <span className={`text-[10px] truncate leading-tight w-full text-center ${isSelected ? 'text-primary-content' : 'text-base-content/70'}`}>
          {ch.name}
        </span>
      </div>
    );
  };

  // Narrow column (player on the side): vertical wrapping grid, no arrows.
  if (wrap) {
    return (
      <div
        className="grid grid-cols-3 gap-1.5 p-0.5 max-h-[440px] overflow-y-auto overflow-x-hidden overscroll-contain"
        style={{ scrollbarWidth: 'thin' }}
      >
        {channels.map(renderChannel)}
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Arrow overlay — left */}
      {canScrollLeft && (
        <div className="absolute left-0 inset-y-0 z-10 flex items-center pointer-events-none"
          style={{ background: 'linear-gradient(to right, var(--color-base-100) 40%, transparent)' }}>
          <button onClick={() => { scrollBy(-1); play('interaction.subtle'); }} aria-label="Desplazar a la izquierda"
            className="pointer-events-auto w-7 h-7 flex items-center justify-center rounded-full bg-base-200 border border-base-300 text-base-content/70 hover:text-base-content hover:bg-base-300 transition-all cursor-pointer ml-1">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
          </button>
        </div>
      )}

      {/* Scroll container */}
      <div ref={scrollRef}
        className="overflow-x-auto"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
        {/* Inner padded wrapper — pushes content away from clip edges.
            1 row = flex row; >1 rows = column-flow grid so items fill down then wrap right. */}
        <div
          className={multiRow ? 'grid grid-flow-col gap-2 py-1.5 px-1.5' : 'flex gap-2 py-1.5 px-1.5'}
          style={multiRow ? { gridTemplateRows: `repeat(${rowCount}, auto)` } : undefined}
        >
          {channels.map(renderChannel)}
        </div>
      </div>

      {/* Arrow overlay — right */}
      {canScrollRight && (
        <div className="absolute right-0 inset-y-0 z-10 flex items-center pointer-events-none"
          style={{ background: 'linear-gradient(to left, var(--color-base-100) 40%, transparent)' }}>
          <button onClick={() => { scrollBy(1); play('interaction.subtle'); }} aria-label="Desplazar a la derecha"
            className="pointer-events-auto w-7 h-7 flex items-center justify-center rounded-full bg-base-200 border border-base-300 text-base-content/70 hover:text-base-content hover:bg-base-300 transition-all cursor-pointer mr-1">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
          </button>
        </div>
      )}
    </div>
  );
}
