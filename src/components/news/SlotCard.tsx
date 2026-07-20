import { useState, memo, useRef, useEffect, forwardRef, useCallback, useMemo, type RefObject, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { Article, SourceFeed, PinnedSource } from '../../types';
import { ArticleReader } from './ArticleReader';
import { FaviconImg } from './FaviconImg';
import { play } from '@/lib/sound';
import { extractHost } from '@/lib/url';

const REGION_LABELS: Record<string, string> = {
  'arica-y-parinacota': 'XV Arica y Parinacota',
  tarapaca: 'I Tarapacá',
  antofagasta: 'II Antofagasta',
  atacama: 'III Atacama',
  coquimbo: 'IV Coquimbo',
  valparaiso: 'V Valparaíso',
  metropolitana: 'RM Metropolitana',
  ohiggins: "VI O'Higgins",
  maule: 'VII Maule',
  nuble: 'XVI Ñuble',
  biobio: 'VIII Biobío',
  araucania: 'IX La Araucanía',
  'los-rios': 'XIV Los Ríos',
  'los-lagos': 'X Los Lagos',
  aysen: 'XI Aysén',
  magallanes: 'XII Magallanes',
};

const ALL_REGIONS_ORDERED = [
  'arica-y-parinacota', 'tarapaca', 'antofagasta', 'atacama', 'coquimbo',
  'valparaiso', 'metropolitana', 'ohiggins', 'maule', 'nuble',
  'biobio', 'araucania', 'los-rios', 'los-lagos', 'aysen', 'magallanes',
];

interface SkipProgress {
  newSourceName: string;
  countdown: number;
  isPending: boolean;
  reason: string;
}

interface Props {
  slotIndex: number;
  selectedSource: SourceFeed | null;
  articles: Article[];
  loading: boolean;
  error: string | null;
  allSources: SourceFeed[];
  usedSourceKeys: Set<string>;
  triedSources: Record<number, string[]>;
  pinnedSource: PinnedSource | null;
  allPinnedSources: Record<number, PinnedSource>;
  onSourceChange: (slotIndex: number, source: SourceFeed, isSkip?: boolean) => void;
  onRetry: (slotIndex: number) => void;
  onClear: (slotIndex: number) => void;
  onTogglePin: (slotIndex: number, source: SourceFeed) => void;
  hasActiveFilter: boolean;
  skipProgress?: SkipProgress;
  onCancelSkip?: (slotIndex: number) => void;
  isFallback?: boolean;
}

export const SlotCard = memo(function SlotCard({
  slotIndex,
  selectedSource,
  articles,
  loading,
  error,
  allSources,
  usedSourceKeys,
  triedSources,
  pinnedSource,
  allPinnedSources,
  onSourceChange,
  onRetry,
  onClear,
  onTogglePin,
  hasActiveFilter,
  skipProgress,
  onCancelSkip,
  isFallback,
}: Props) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [closingDropdown, setClosingDropdown] = useState(false);
  const [readerArticle, setReaderArticle] = useState<Article | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [regionFilter, setRegionFilter] = useState<string | null>(null);
  const [showGradient, setShowGradient] = useState(false);
  const [portalPos, setPortalPos] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);
  const [portalOrigin, setPortalOrigin] = useState<string>('top');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLElement | null>(null);
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  function buildPortalPos(el: HTMLElement): { top: number; left: number; width: number; maxHeight: number } {
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const gap = 8;

    const spaceBelow = vh - rect.bottom;
    const spaceAbove = rect.top;
    const preferBelow = spaceBelow >= 200 || spaceBelow >= spaceAbove;

    let top: number;
    let maxHeight: number;
    if (preferBelow) {
      top = rect.bottom;
      maxHeight = Math.min(288, vh - top - gap);
    } else {
      top = Math.max(gap, rect.top);
      maxHeight = Math.min(288, top - gap);
      top = top - maxHeight;
    }

    let width = Math.max(rect.width, 260);
    let left = rect.left;
    if (left + width > vw - gap) {
      left = Math.max(gap, vw - gap - width);
    }
    if (left < gap) {
      left = gap;
      width = vw - gap * 2;
    }

    return { top, left, width, maxHeight };
  }

  function openDropdown(el: HTMLElement) {
    if (closeTimeoutRef.current) { clearTimeout(closeTimeoutRef.current); closeTimeoutRef.current = null; }
    if (closingDropdown) {
      setClosingDropdown(false);
      anchorRef.current = el;
      const pos = buildPortalPos(el);
      setPortalPos(pos);
      setPortalOrigin(pos.top > el.getBoundingClientRect().bottom ? 'top' : 'bottom');
      return;
    }
    if (dropdownOpen) { closeDropdown(); return; }
    play('overlay.open');
    anchorRef.current = el;
    const pos = buildPortalPos(el);
    setPortalPos(pos);
    setPortalOrigin(pos.top > el.getBoundingClientRect().bottom ? 'top' : 'bottom');
    setDropdownOpen(true);
    setSearchQuery('');
    setRegionFilter(null);
  }

  function closeDropdown() {
    if (closingDropdown) return;
    setClosingDropdown(true);
    closeTimeoutRef.current = setTimeout(() => {
      closeTimeoutRef.current = null;
      setDropdownOpen(false);
      setPortalPos(null);
      setClosingDropdown(false);
      setSearchQuery('');
      anchorRef.current = null;
    }, 120);
  }

  useEffect(() => {
    if (!dropdownOpen) return;
    function update() {
      if (anchorRef.current) setPortalPos(buildPortalPos(anchorRef.current));
    }
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [dropdownOpen]);

  const checkOverflow = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const hasOverflow = el.scrollHeight > el.clientHeight;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 2;
    setShowGradient(hasOverflow && !atBottom);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(checkOverflow);
    ro.observe(el);
    checkOverflow();
    return () => ro.disconnect();
  }, [checkOverflow]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      const trigger = anchorRef.current;
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(target) &&
        (!trigger || !trigger.contains(target))
      ) {
        closeDropdown();
      }
    }
    if (dropdownOpen) {
      document.addEventListener('mousedown', handleClick);
      setTimeout(() => searchRef.current?.focus(), 50);
    }
    return () => document.removeEventListener('mousedown', handleClick);
  }, [dropdownOpen]);

  const availableSources = allSources.filter(s => {
    if (selectedSource && s.sourceKey === selectedSource.sourceKey) return true;
    return !usedSourceKeys.has(s.sourceKey);
  });

  const availableRegions = useMemo(() => {
    const regionSet = new Set<string>();
    for (const s of allSources) {
      if (s.region) regionSet.add(s.region);
    }
    return ALL_REGIONS_ORDERED.filter(k => regionSet.has(k));
  }, [allSources]);

  const regionFilteredSources = regionFilter
    ? availableSources.filter(s => s.region === regionFilter)
    : availableSources;

  const filteredSources = searchQuery
    ? regionFilteredSources.filter(s =>
        s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.source.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : regionFilteredSources;

  const nextAvailable = useMemo(() => {
    const tried = triedSources[slotIndex] || [];
    return allSources.find(s =>
      !usedSourceKeys.has(s.sourceKey) &&
      s.sourceKey !== selectedSource?.sourceKey &&
      !tried.includes(s.sourceKey)
    );
  }, [allSources, usedSourceKeys, selectedSource?.sourceKey, triedSources, slotIndex]);

  function handleSelect(source: SourceFeed) {
    play('interaction.tap');
    onSourceChange(slotIndex, source);
    closeDropdown();
  }

  function handleClear() {
    play('interaction.confirm');
    onClear(slotIndex);
    closeDropdown();
  }

  function handleRetry() {
    play('interaction.subtle');
    onRetry(slotIndex);
  }

  if (!selectedSource) {
    return (
      <>
        <div className="rounded-xl bg-base-200 border border-dashed border-base-300 shadow-sm h-full flex flex-col items-center justify-center py-10 px-4 text-center min-h-[200px]">
          <button
            onClick={(e) => openDropdown(e.currentTarget)}
            className="relative cursor-pointer"
          >
            <div className="w-12 h-12 rounded-full bg-base-300 flex items-center justify-center mb-3 mx-auto hover:bg-primary/20 hover:border-primary/50 transition-colors border-2 border-transparent">
              <svg className="w-5 h-5 text-base-content/50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="16" />
                <line x1="8" y1="12" x2="16" y2="12" />
              </svg>
            </div>
            <p className="text-xs text-base-content/50">Seleccionar fuente</p>
          </button>
        </div>
        {dropdownOpen && portalPos && createPortal(
          <SourceDropdown
            ref={dropdownRef}
            searchRef={searchRef}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            regionFilter={regionFilter}
            onRegionFilterChange={setRegionFilter}
            availableRegions={availableRegions}
            filteredSources={filteredSources}
            selectedSource={selectedSource}
            onSelect={handleSelect}
            onClear={handleClear}
            pinnedSource={pinnedSource}
            allPinnedSources={allPinnedSources}
            currentSlotIndex={slotIndex}
            onTogglePin={onTogglePin}
            closing={closingDropdown}
            style={{
            position: 'fixed',
            top: portalPos.top,
            left: portalPos.left,
            width: portalPos.width,
            maxHeight: portalPos.maxHeight,
            zIndex: 9999,
            transformOrigin: portalOrigin === 'top' ? 'top center' : 'bottom center',
          }}
          />,
          document.body
        )}
        {readerArticle && (
          <ArticleReader url={readerArticle.link} initialArticle={readerArticle} onClose={() => setReaderArticle(null)} />
        )}
      </>
    );
  }

  return (
    <>
      <div className={`rounded-xl bg-base-200 border overflow-hidden h-full min-h-[473px] flex flex-col shadow-sm transition-colors ${error ? 'border-error/30' : 'border-base-300'}`}>
        <div className="px-3 py-2.5 border-b border-base-300 flex items-center gap-1.5 flex-shrink-0 relative">
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${error ? 'bg-error' : loading ? 'bg-warning animate-pulse' : 'bg-primary'}`} />
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            <FaviconImg domain={extractHost(selectedSource.url)} />
            <button
              onClick={(e) => openDropdown(e.currentTarget)}
              className="text-sm font-semibold text-left text-balance text-base-content cursor-pointer hover:text-base-content/80 transition-colors inline-flex items-center gap-1 min-w-0"
            >
              <span className="truncate">{selectedSource.name}</span>
              <svg className={`shrink-0 w-3 h-3 mt-0.5 text-base-content/50 transition-transform duration-200 ${dropdownOpen || closingDropdown ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {isFallback && (
              <span className="shrink-0 text-[9px] font-medium text-warning/80 bg-warning/10 px-1.5 py-0.5 rounded-full" title="Esta fuente ya no está en el listado principal, se cargó desde la URL guardada">
                Externa
              </span>
            )}
          </div>

          <button
            onClick={() => { play('interaction.toggle'); onTogglePin(slotIndex, selectedSource); }}
            className={`group shrink-0 p-1 rounded-md hover:bg-base-300 transition-colors cursor-pointer ${pinnedSource?.sourceKey === selectedSource.sourceKey ? 'text-primary' : 'text-base-content/50 hover:text-base-content/60'}`}
            title={pinnedSource?.sourceKey === selectedSource.sourceKey ? 'Fijado — siempre cargado aquí' : 'Fijar a este bloque'}
            aria-label={pinnedSource?.sourceKey === selectedSource.sourceKey ? 'Desfijar' : 'Fijar'}
          >
            <svg className="w-3.5 h-3.5 transition-transform duration-300 ease-out group-hover:scale-110 group-hover:rotate-12" viewBox="0 0 24 24" fill={pinnedSource?.sourceKey === selectedSource.sourceKey ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
            </svg>
          </button>

          <button
            onClick={handleClear}
            className="shrink-0 p-1 rounded-md hover:bg-base-300 text-base-content/50 hover:text-error transition-colors cursor-pointer"
            title="Vaciar slot"
            aria-label="Vaciar slot"
          >
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="relative flex-1">
          {loading ? (
            <div className="p-4 space-y-3 animate-pulse">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className={`h-3 bg-base-300 rounded ${['w-full', 'w-4/5', 'w-3/4', 'w-5/6', 'w-2/3'][i] || 'w-full'}`} />
              ))}
            </div>
          ) : error && skipProgress ? (
            <div className="flex flex-col items-center justify-center h-full py-8 px-4 text-center">
              <svg className="w-8 h-8 text-warning/50 mb-2 animate-pulse" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="16" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
              <p className="text-xs text-warning/70 mb-1">
                <span className="font-semibold">{selectedSource?.name}</span> falló: {skipProgress.reason || 'Error'}
              </p>
              <p className="text-xs text-base-content/60">
                Probando con <span className="font-semibold">{skipProgress.newSourceName}</span>
              </p>
              <p className="text-[10px] text-base-content/50 mt-1 mb-3">
                {skipProgress.isPending
                  ? `aplicando en ${skipProgress.countdown}s`
                  : skipProgress.countdown > 0
                    ? `esperando ${skipProgress.countdown}s`
                    : 'cargando...'}
              </p>
              <div className="w-16 h-1 bg-base-300 rounded-full overflow-hidden">
                <div
                  className="h-full bg-warning rounded-full transition-all"
                  style={{ width: `${(skipProgress.countdown / 5) * 100}%` }}
                />
              </div>
              {onCancelSkip && (
                <button
                    onClick={() => { play('interaction.subtle'); onCancelSkip(slotIndex); }}
                  className="mt-3 px-3 py-1.5 text-[11px] font-medium bg-base-300 text-base-content/70 hover:text-base-content rounded-lg transition-all active:scale-[0.96] cursor-pointer"
                >
                  Cancelar
                </button>
              )}
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center h-full py-8 px-4 text-center">
              <svg className="w-8 h-8 text-error/40 mb-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <p className="text-xs text-error/60 mb-1">Error al cargar</p>
              {error && (
                <p className="text-[10px] text-base-content/50 mb-3 max-w-[200px] truncate">{error}</p>
              )}
              <button
                onClick={handleRetry}
                className="px-3 py-1.5 text-[11px] font-medium bg-primary text-primary-content border border-primary rounded-lg hover:opacity-80 transition-all active:scale-[0.96] cursor-pointer"
              >
                Reintentar
              </button>
            </div>
              ) : articles.length > 0 ? (
            <div ref={scrollRef} className="max-h-[400px] overflow-y-auto" onScroll={checkOverflow}>
              <div className="divide-y divide-base-300">
                {articles.map((article, i) => (
                  <div
                    key={`${selectedSource?.sourceKey}-${i}`}
                    className="flex items-center gap-1 group hover:bg-base-300 transition-colors animate-[fadeSlideIn_0.3s_ease-out_both]"
                    style={{ animationDelay: `${i * 40}ms` }}
                  >
                    <button
                      onClick={() => { play('interaction.tap'); window.open(article.link, '_blank', 'noopener,noreferrer'); }}
                      className="flex-1 text-left min-w-0 px-3 py-2 cursor-pointer"
                    >
                      <p className="text-xs text-base-content leading-snug line-clamp-2">
                        {article.title}
                      </p>
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); play('interaction.tap'); setReaderArticle(article); }}
                      className="shrink-0 p-1 mr-1 rounded-md opacity-50 group-hover:opacity-100 focus:opacity-100 hover:bg-base-300 text-base-content/50 hover:text-base-content/80 transition-all cursor-pointer"
                      title="Leer en ventana flotante"
                      aria-label="Leer en modal"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                        <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
              {showGradient && (
                <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-base-200 to-transparent pointer-events-none" />
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full py-8 px-4 text-center">
              <p className="text-xs text-base-content/50 mb-2">
                {hasActiveFilter ? 'Sin coincidencias' : 'Vacío por ahora'}
              </p>
              {!hasActiveFilter && (
                <div className="flex gap-2">
                  <button
                    onClick={() => { play('interaction.subtle'); handleRetry(); }}
                    className="px-3 py-1 text-[11px] font-medium bg-base-300 text-base-content/60 rounded-lg hover:bg-primary hover:text-primary-content transition-colors cursor-pointer"
                  >
                    Recargar
                  </button>
                  {nextAvailable && (
                    <button
                      onClick={() => { play('interaction.tap'); onSourceChange(slotIndex, nextAvailable, true); }}
                      className="px-3 py-1 text-[11px] font-medium bg-primary text-primary-content rounded-lg hover:opacity-80 transition-all active:scale-[0.96] cursor-pointer"
                    >
                      Cargar siguiente
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="px-3 py-1.5 border-t border-base-300 text-right text-[10px] text-base-content/50 flex items-center justify-between gap-2">
          <span className="text-base-content/50">
            {loading ? 'Cargando...' : error ? '' : `${articles.length} artículos`}
          </span>
          {selectedSource && (
            <div className="flex items-center gap-2 min-w-0">
              <a
                href={selectedSource.siteUrl || (extractHost(selectedSource.url) ? `https://${extractHost(selectedSource.url)}` : selectedSource.url)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => play('interaction.tap')}
                className="hover:text-base-content underline underline-offset-2 transition-colors truncate"
              >
                {selectedSource.siteUrl ? extractHost(selectedSource.siteUrl) : extractHost(selectedSource.url)}
              </a>
              <span className="text-base-content/20">·</span>
              <a
                href={selectedSource.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => play('interaction.tap')}
                className="hover:text-base-content underline underline-offset-2 transition-colors truncate"
                title={selectedSource.url}
              >
                Feed RSS
              </a>
            </div>
          )}
        </div>
      </div>
      {dropdownOpen && portalPos && createPortal(
        <SourceDropdown
          ref={dropdownRef}
          searchRef={searchRef}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          regionFilter={regionFilter}
          onRegionFilterChange={setRegionFilter}
          availableRegions={availableRegions}
          filteredSources={filteredSources}
          selectedSource={selectedSource}
          onSelect={handleSelect}
          onClear={handleClear}
          pinnedSource={pinnedSource}
          allPinnedSources={allPinnedSources}
          currentSlotIndex={slotIndex}
          onTogglePin={onTogglePin}
          closing={closingDropdown}
          style={{
            position: 'fixed',
            top: portalPos.top,
            left: portalPos.left,
            width: portalPos.width,
            maxHeight: portalPos.maxHeight,
            zIndex: 9999,
            transformOrigin: portalOrigin === 'top' ? 'top center' : 'bottom center',
          }}
        />,
        document.body
      )}
      {readerArticle && (
        <ArticleReader url={readerArticle.link} initialArticle={readerArticle} onClose={() => setReaderArticle(null)} />
      )}
    </>
  );
});

interface DropdownProps {
  searchRef: RefObject<HTMLInputElement | null>;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  regionFilter: string | null;
  onRegionFilterChange: (r: string | null) => void;
  availableRegions: string[];
  filteredSources: SourceFeed[];
  selectedSource: SourceFeed | null;
  onSelect: (source: SourceFeed) => void;
  onClear: () => void;
  pinnedSource: PinnedSource | null;
  allPinnedSources: Record<number, PinnedSource>;
  currentSlotIndex: number;
  onTogglePin: (slotIndex: number, source: SourceFeed) => void;
  style: CSSProperties;
  closing?: boolean;
}

const SourceDropdown = forwardRef<HTMLDivElement, DropdownProps>(function SourceDropdown({
  searchRef, searchQuery, onSearchChange,
  regionFilter, onRegionFilterChange, availableRegions,
  filteredSources,
  selectedSource, onSelect, onClear,
  pinnedSource, allPinnedSources, currentSlotIndex, onTogglePin,
  style,
  closing,
}, ref) {
  const slotIndexesBySource = useMemo(() => {
    const map = new Map<string, number>();
    for (const [idx, ps] of Object.entries(allPinnedSources)) {
      map.set(ps.sourceKey, Number(idx));
    }
    return map;
  }, [allPinnedSources]);

  const sorted = useMemo(() => {
    const pinned: SourceFeed[] = [];
    const rest: SourceFeed[] = [];
    for (const s of filteredSources) {
      if (slotIndexesBySource.has(s.sourceKey)) {
        pinned.push(s);
      } else {
        rest.push(s);
      }
    }
    return { pinned, rest };
  }, [filteredSources, slotIndexesBySource]);

  return (
    <div ref={ref} style={style} className={`bg-base-300 border border-base-300 rounded-xl shadow-xl overflow-hidden ${closing ? 'animate-[fadeSlideOut_0.12s_ease-in_forwards]' : 'animate-[fadeSlideIn_0.15s_ease-out]'}`}>
      <div className="p-2 border-b border-base-300 space-y-1.5">
        <input
          ref={searchRef}
          type="text"
          value={searchQuery}
          onChange={e => onSearchChange(e.target.value)}
          placeholder="Buscar fuente..."
          className="w-full text-xs bg-base-200 border border-base-300 rounded-lg px-2.5 py-1.5 text-base-content placeholder:text-base-content/50 focus:outline-none focus:border-primary transition-colors"
        />
        <select
          value={regionFilter ?? ''}
          onChange={e => onRegionFilterChange(e.target.value || null)}
          aria-label="Filtrar por región"
          className="w-full text-xs bg-base-200 border border-base-300 rounded-lg px-2 py-1.5 text-base-content focus:outline-none focus:border-primary transition-colors"
        >
          <option value="">Todas las regiones</option>
          {availableRegions.map(r => (
            <option key={r} value={r}>{REGION_LABELS[r] || r}</option>
          ))}
        </select>
      </div>
      <div className="overflow-y-auto max-h-52">
        {sorted.pinned.length > 0 && (
          <div className="px-3 pt-2 pb-1 text-[10px] text-base-content/50 uppercase tracking-wider font-semibold">
            Fijados
          </div>
        )}
        {sorted.pinned.map((source) => {
          const isSelected = selectedSource?.sourceKey === source.sourceKey;
          const pinnedSlotIdx = slotIndexesBySource.get(source.sourceKey)!;
          const isThisSlot = pinnedSlotIdx === currentSlotIndex;
          return (
            <div
              key={source.sourceKey}
              className={`flex items-center gap-1 px-3 py-2 text-xs ${
                isSelected ? 'bg-primary text-primary-content font-medium' : 'text-base-content/80'
              }`}
            >
              <button
                onClick={() => onSelect(source)}
                className="flex-1 flex items-center gap-2 text-left min-w-0 cursor-pointer"
              >
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isSelected ? 'bg-primary' : 'bg-base-content/20'}`} />
                <FaviconImg domain={extractHost(source.url)} className="w-3.5 h-3.5 rounded shrink-0" />
                <span className="truncate">{source.name}</span>
              </button>
              {isThisSlot ? (
                <button
                  onClick={() => { play('interaction.toggle'); onTogglePin(currentSlotIndex, source); }}
                  className={`shrink-0 p-1 rounded transition-colors cursor-pointer ${
                    isSelected
                      ? 'text-primary-content/70 hover:text-primary-content hover:bg-primary/20'
                      : 'text-primary hover:text-primary hover:bg-base-200'
                  }`}
                  title="Desfijar de este bloque"
                  aria-label="Desfijar"
                >
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                    <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
                  </svg>
                </button>
              ) : (
                <span className="shrink-0 text-[10px] text-base-content/50 px-1 py-0.5 rounded bg-base-200/50">
                  Slot {pinnedSlotIdx + 1}
                </span>
              )}
            </div>
          );
        })}
        {sorted.pinned.length > 0 && sorted.rest.length > 0 && (
          <div className="border-t border-base-300 mx-2 my-1" />
        )}
        {sorted.rest.map((source) => {
          const isSelected = selectedSource?.sourceKey === source.sourceKey;
          return (
            <div
              key={source.sourceKey}
              className="flex items-center gap-1 px-3 py-2 text-xs text-base-content/80"
            >
              <button
                onClick={() => onSelect(source)}
                className="flex-1 flex items-center gap-2 text-left min-w-0 cursor-pointer"
              >
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isSelected ? 'bg-primary' : 'bg-base-content/20'}`} />
                <FaviconImg domain={extractHost(source.url)} className="w-3.5 h-3.5 rounded shrink-0" />
                <span className="truncate">{source.name}</span>
              </button>
              <button
                onClick={() => { play('interaction.toggle'); onTogglePin(currentSlotIndex, source); onSelect(source); }}
                className="shrink-0 p-1 rounded hover:bg-base-200 text-base-content/50 hover:text-base-content/80 transition-colors cursor-pointer"
                title="Fijar a este bloque"
                aria-label="Fijar"
              >
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
                </svg>
              </button>
            </div>
          );
        })}
        {filteredSources.length === 0 && (
          <div className="px-3 py-4 text-xs text-base-content/50 text-center">
            {searchQuery ? 'Sin resultados' : 'No hay fuentes disponibles'}
          </div>
        )}
      </div>
      {selectedSource && (
        <div className="border-t border-base-300 p-1.5">
          <button
            onClick={onClear}
            className="w-full text-left px-2 py-1.5 text-xs text-error/70 hover:text-error hover:bg-base-200 rounded-lg transition-colors cursor-pointer"
          >
            Vaciar slot
          </button>
        </div>
      )}
    </div>
  );
});
