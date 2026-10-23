import { useRef, useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { play } from '@/lib/sound';
import { foldAccents } from '@/lib/sources';

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

const catLabel = (cat: string) => LABELS[cat] || cat;
const collator = new Intl.Collator('es');

const PANEL_W = 252;
const PANEL_MAX_H = 320;

interface PanelPos {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  origin: 'top' | 'bottom';
}

export function ChannelSelector({ categories, counts, selected, onSelect }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  // Desplegable "todas las categorías": lista completa buscable sin ocupar más alto.
  const [listOpen, setListOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [pos, setPos] = useState<PanelPos | null>(null);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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

  /* Al elegir una categoría (sobre todo desde el desplegable) deja su chip a la vista,
     así no se pierde el contexto cuando la fila está desplazada. */
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const chip = scroller.querySelector<HTMLElement>(`[data-cat-chip="${CSS.escape(selected)}"]`);
    if (!chip) return;
    const start = chip.offsetLeft - 8;
    const end = chip.offsetLeft + chip.offsetWidth + 8;
    if (start < scroller.scrollLeft) {
      scroller.scrollTo({ left: start, behavior: 'smooth' });
    } else if (end > scroller.scrollLeft + scroller.clientWidth) {
      scroller.scrollTo({ left: end - scroller.clientWidth, behavior: 'smooth' });
    }
  }, [selected]);

  function buildPos(el: HTMLElement): PanelPos {
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const gap = 8;
    const width = Math.min(PANEL_W, vw - gap * 2);
    const left = Math.max(gap, Math.min(rect.left, vw - gap - width));
    const spaceBelow = vh - rect.bottom;
    const spaceAbove = rect.top;
    const below = spaceBelow >= 200 || spaceBelow >= spaceAbove;
    const available = Math.max(140, (below ? spaceBelow : spaceAbove) - gap * 2);
    const maxHeight = Math.min(PANEL_MAX_H, available);
    const top = below ? rect.bottom + 4 : rect.top - maxHeight - 4;
    return { top: Math.max(gap, top), left, width, maxHeight, origin: below ? 'top' : 'bottom' };
  }

  function openList() {
    const el = anchorRef.current;
    if (!el) return;
    play('overlay.open');
    setPos(buildPos(el));
    setQuery('');
    setListOpen(true);
  }

  function closeList(refocus = false) {
    play('overlay.close');
    setListOpen(false);
    if (refocus) anchorRef.current?.focus();
  }

  useEffect(() => {
    if (!listOpen) return;
    inputRef.current?.focus();

    function reposition() {
      const el = anchorRef.current;
      if (el) setPos(buildPos(el));
    }
    function onPointerDown(e: MouseEvent) {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      setListOpen(false);
    }

    window.addEventListener('scroll', reposition, { passive: true, capture: true });
    window.addEventListener('resize', reposition);
    document.addEventListener('mousedown', onPointerDown);
    return () => {
      window.removeEventListener('scroll', reposition, { capture: true } as EventListenerOptions);
      window.removeEventListener('resize', reposition);
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [listOpen]);

  const options = useMemo(() => {
    const rest = categories.filter((c) => c !== 'todas');
    const q = foldAccents(query.trim());
    const matches = q ? rest.filter((c) => foldAccents(catLabel(c)).includes(q)) : rest;
    return [...matches].sort((a, b) => collator.compare(catLabel(a), catLabel(b)));
  }, [categories, query]);

  function choose(cat: string) {
    play('navigation.tab');
    onSelect(cat);
    setListOpen(false);
    anchorRef.current?.focus();
  }

  function onPanelKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closeList(true);
      return;
    }
    if (e.key === 'ArrowDown' && document.activeElement === inputRef.current) {
      e.preventDefault();
      panelRef.current?.querySelector<HTMLElement>('[data-cat-row]')?.focus();
      return;
    }
    if (e.key !== 'Tab') return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusables = Array.from(panel.querySelectorAll<HTMLElement>('input, button'));
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="relative">
      {canScrollLeft && (
        <div className="absolute left-0 inset-y-0 z-10 flex items-center pointer-events-none"
          style={{ background: 'linear-gradient(to right, var(--color-base-100) 40%, transparent)' }}>
          <button onClick={() => { scrollBy(-1); play('interaction.subtle'); }} aria-label="Desplazar categorías a la izquierda"
            className="pointer-events-auto w-6 h-6 flex items-center justify-center rounded-full bg-base-200 border border-base-300 text-base-content/70 hover:text-base-content hover:bg-base-300 transition-colors cursor-pointer ml-1">
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
            const label = catLabel(cat);
            const count = counts[cat] ?? 0;

            // "Todos" es un pill partido: la etiqueta filtra y el chevron abre el listado completo.
            if (cat === 'todas') {
              return (
                <div
                  key={cat}
                  data-cat-chip={cat}
                  style={{ animationDelay: `${i * 40}ms` }}
                  className={`flex items-center shrink-0 whitespace-nowrap rounded-lg text-xs font-medium transition-colors opacity-0 animate-[fadeSlideIn_0.25s_ease-out_forwards] ${
                    isActive
                      ? 'bg-primary text-primary-content ring-1 ring-primary'
                      : 'bg-base-content/[0.04] text-base-content/70'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => { play('navigation.tab'); onSelect(cat); }}
                    aria-pressed={isActive}
                    className="flex items-center gap-1.5 pl-2.5 pr-1.5 py-1.5 rounded-l-lg cursor-pointer active:scale-[0.96] transition-transform"
                  >
                    <span>{label}</span>
                    <span className={`text-[11px] font-mono px-1 py-0.5 rounded ${
                      isActive ? 'bg-primary text-primary-content' : 'bg-base-content/[0.05] text-base-content/70'
                    }`}>
                      {count}
                    </span>
                  </button>
                  <button
                    type="button"
                    ref={anchorRef}
                    onClick={() => (listOpen ? closeList() : openList())}
                    aria-haspopup="dialog"
                    aria-expanded={listOpen}
                    aria-label="Ver todas las categorías"
                    title="Ver todas las categorías"
                    className={`flex items-center justify-center self-stretch pl-1.5 pr-2 rounded-r-lg cursor-pointer transition-colors ${
                      isActive ? 'hover:bg-primary/25' : 'hover:bg-base-content/[0.08]'
                    }`}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                      aria-hidden="true"
                      className={`transition-transform duration-200 ${listOpen ? 'rotate-180' : ''}`}>
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </button>
                </div>
              );
            }

            return (
              <button
                key={cat}
                data-cat-chip={cat}
                onClick={() => { play('navigation.tab'); onSelect(cat); }}
                aria-pressed={isActive}
                style={{ animationDelay: `${i * 40}ms` }}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 transition-[background-color,color,border-color,transform] cursor-pointer active:scale-[0.96] opacity-0 animate-[fadeSlideIn_0.25s_ease-out_forwards] ${
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
                <span className={`text-[11px] font-mono px-1 py-0.5 rounded ${
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
            className="pointer-events-auto w-6 h-6 flex items-center justify-center rounded-full bg-base-200 border border-base-300 text-base-content/70 hover:text-base-content hover:bg-base-300 transition-colors cursor-pointer mr-1">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
          </button>
        </div>
      )}

      {listOpen && pos && createPortal(
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label="Todas las categorías"
          onKeyDown={onPanelKeyDown}
          style={{
            position: 'fixed',
            top: pos.top,
            left: pos.left,
            width: pos.width,
            maxHeight: pos.maxHeight,
            zIndex: 9999,
            transformOrigin: pos.origin === 'top' ? 'top center' : 'bottom center',
          }}
          className="bg-base-300 border border-base-300 rounded-xl shadow-xl overflow-hidden flex flex-col animate-[fadeSlideIn_0.15s_ease-out]"
        >
          <div className="p-2 border-b border-base-300 shrink-0">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar categoría..."
              aria-label="Buscar categoría"
              className="w-full text-xs bg-base-200 border border-base-300 rounded-lg px-2.5 py-1.5 text-base-content placeholder:text-base-content/70 focus:outline-none focus:border-primary transition-colors"
            />
          </div>
          <div role="group" aria-label="Categorías" className="py-1 overflow-y-auto overscroll-contain flex-1 min-h-0">
            {options.map((cat) => {
              const isActive = selected === cat;
              return (
                <button
                  key={cat}
                  data-cat-row
                  type="button"
                  onClick={() => choose(cat)}
                  aria-pressed={isActive}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors cursor-pointer focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary ${
                    isActive
                      ? 'bg-primary/15 text-primary font-medium'
                      : 'text-base-content/80 hover:bg-base-200'
                  }`}
                >
                  <span className="flex-1 truncate">{catLabel(cat)}</span>
                  <span className="shrink-0 text-[11px] font-mono tabular-nums text-base-content/70">{counts[cat] ?? 0}</span>
                  {isActive && (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" aria-hidden="true">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </button>
              );
            })}
            {options.length === 0 && (
              <p className="px-3 py-4 text-xs text-base-content/70 text-center">Sin resultados</p>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
