import { useState, useEffect, useMemo } from 'react';
import type { NewsCluster, Article, SourceResult, FeedSource, SourceFeed, PinnedSource } from '../../types';
import { NewsClusterCard } from './NewsClusterCard';
import { TrendingTags } from '../widgets/TrendingTags';
import { SlotCard } from './SlotCard';
import { play } from '@/lib/sound';

interface SlotData {
  source: SourceFeed | null;
  articles: Article[];
  loading: boolean;
  error: string | null;
  isFallback?: boolean;
}

interface SkipToast {
  slotIndex: number;
  oldName: string;
  newSource: SourceFeed;
  countdown: number;
  pendingResult: { articles: Article[]; error: string | null } | null;
  cancelled: boolean;
}

interface Props {
  clusters: NewsCluster[];
  articles: Article[];
  sourceResults: SourceResult[];
  trending: string[];
  allSources: FeedSource[];
  activeTag: string | null;
  loading: boolean;
  inventoryError?: boolean;
  onRetry: () => void;
  slots: SlotData[];
  usedSourceKeys: Set<string>;
  pinnedSources: Record<number, PinnedSource>;
  triedSources: Record<number, string[]>;
  onSourceChange: (slotIndex: number, source: SourceFeed, isSkip?: boolean) => void;
  onRetrySlot: (slotIndex: number) => void;
  onClearSlot: (slotIndex: number) => void;
  onTogglePin: (slotIndex: number, source: SourceFeed) => void;
  onAddSlot: () => void;
  onRemoveSlot: () => void;
  slotCount: number;
  skipToasts: SkipToast[];
  onCancelSkip: (slotIndex: number) => void;
}

function SourceErrorPanel({ sourceResults, onRetry }: { sourceResults: SourceResult[]; onRetry: () => void }) {
  const failedResults = sourceResults.filter(r => !r.success);
  const loaded = sourceResults.filter(r => r.success).length;
  const failed = failedResults.length;
  const [expanded, setExpanded] = useState(false);

  if (failed === 0) return null;

  return (
    <div className="rounded-xl border border-error/20 bg-base-200 overflow-hidden">
      <div className="px-4 py-2.5 flex items-center justify-between">
        <span className="text-xs text-base-content/70">
          {loaded > 0 && <span className="text-success/80">{loaded} con artículos · </span>}
          <span className="text-error/80">{failed} fallaron</span>
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setExpanded(!expanded)}
            className="px-2 py-1 text-[11px] text-base-content/50 hover:text-base-content bg-base-300 rounded-lg transition-colors cursor-pointer"
          >
            {expanded ? 'Ocultar' : 'Detalles'}
          </button>
          <button
            onClick={onRetry}
            className="px-3 py-1 text-[11px] font-medium bg-primary text-primary-content rounded-lg hover:opacity-80 transition-all active:scale-[0.96] cursor-pointer"
          >
            Reintentar
          </button>
        </div>
      </div>
      {expanded && (
        <div className="border-t border-error/10 px-4 py-2 space-y-1 max-h-48 overflow-y-auto">
          {failedResults.map((r, i) => (
            <div key={i} className="flex items-start justify-between text-[11px] py-1">
              <span className="text-base-content/70 truncate min-w-0 mr-2">{r.name}</span>
              <span className="text-error/70 shrink-0">{r.error || 'Error desconocido'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function extractDomain(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

const SKELETON_LINE_WIDTHS = ['w-full', 'w-4/5', 'w-3/4', 'w-5/6', 'w-2/3', 'w-11/12'];

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-xl bg-base-200 border border-base-300 overflow-hidden animate-pulse min-h-[473px]">
            <div className="px-4 py-3 border-b border-base-300 flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-base-300 shrink-0" />
              <div className="h-3 w-28 bg-base-300 rounded" />
            </div>
            <div className="p-4 space-y-3">
              {SKELETON_LINE_WIDTHS.map((width, j) => (
                <div key={j} className={`h-3 bg-base-300 rounded ${width}`} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function NewsFeed({
  clusters, articles, sourceResults, trending, allSources, activeTag,
  loading, inventoryError, onRetry,
  slots, usedSourceKeys, pinnedSources, triedSources,
  onSourceChange, onRetrySlot, onClearSlot, onTogglePin,
  onAddSlot, onRemoveSlot, slotCount,
  skipToasts, onCancelSkip,
}: Props) {
  const [clusterLimit, setClusterLimit] = useState(3);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | '3d' | 'week'>('all');
  const [openDirect, setOpenDirect] = useState(() => {
    try {
      const saved = localStorage.getItem('open-articles-direct');
      return saved !== null ? saved === 'true' : true;
    } catch { return true;
    }
  });

  const hasActiveFilter = !!(activeTag || debouncedSearch || dateFilter !== 'all');

  useEffect(() => {
    localStorage.setItem('open-articles-direct', String(openDirect));
  }, [openDirect]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const filteredClusters = useMemo(() => activeTag
    ? clusters.filter(c =>
        c.keywords.some(k => k.toLowerCase().includes(activeTag.toLowerCase())) ||
        c.articles.some(a => a.title.toLowerCase().includes(activeTag.toLowerCase()))
      )
    : clusters, [clusters, activeTag]);

  const visibleClusters = filteredClusters.slice(0, clusterLimit);
  const hasMoreClusters = clusterLimit < filteredClusters.length;

  const dateCutoff = useMemo(() => {
    if (dateFilter === 'all') return 0;
    const now = Date.now();
    const days = { today: 1, '3d': 3, week: 7 }[dateFilter] ?? 1;
    return now - days * 86400000;
  }, [dateFilter]);

  const filteredSlots = useMemo(() => {
    return slots.map(slot => {
      if (!slot.source || slot.articles.length === 0) return slot;
      let filtered = slot.articles;

      if (activeTag) {
        const lower = activeTag.toLowerCase();
        filtered = filtered.filter(a =>
          a.title.toLowerCase().includes(lower) ||
          (a.description && a.description.toLowerCase().includes(lower))
        );
      }

      if (debouncedSearch) {
        const lower = debouncedSearch.toLowerCase();
        filtered = filtered.filter(a =>
          a.title.toLowerCase().includes(lower) ||
          (a.description && a.description.toLowerCase().includes(lower))
        );
      }

      if (dateCutoff > 0) {
        filtered = filtered.filter(a => new Date(a.pubDate).getTime() >= dateCutoff);
      }

      return { ...slot, articles: filtered };
    });
  }, [slots, activeTag, debouncedSearch, dateCutoff]);

  const hasSlotsWithSources = filteredSlots.some(s => s.source && s.articles.length > 0);

  const gridCols = slotCount <= 2 ? '' : slotCount <= 6 ? 'sm:grid-cols-2 lg:grid-cols-3' : 'sm:grid-cols-3 lg:grid-cols-4';

  if (inventoryError && !loading) {
    return (
      <div className="text-center flex flex-col items-center gap-4 py-12 text-base-content/70">
        <p>No se pudieron cargar las fuentes de noticias</p>
        <button onClick={onRetry} className="px-4 py-2 text-xs font-medium bg-primary text-primary-content border border-primary rounded-lg hover:opacity-80 transition-all active:scale-[0.96] cursor-pointer">Reintentar</button>
      </div>
    );
  }

  if (loading) {
    return <LoadingSkeleton />;
  }

  return (
    <div className="space-y-8">
      {trending.length > 0 && (
        <div>
          <TrendingTags tags={trending} />
        </div>
      )}

      <div className="transition-all duration-300">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <h3 className="text-xs text-base-content/50 uppercase tracking-wider font-semibold">
              {activeTag ? `"${activeTag}" en medios` : 'Últimas noticias'}
            </h3>
            <span className="text-[10px] text-base-content/30">{slotCount}/12</span>
            <div className="flex gap-0.5">
              <button
                onClick={() => { play('interaction.toggle'); onAddSlot(); }}
                disabled={slotCount >= 12}
                className="p-0.5 rounded hover:bg-base-300 text-base-content/30 hover:text-base-content transition-colors disabled:opacity-20 disabled:cursor-not-allowed cursor-pointer"
                title="Añadir bloque"
                aria-label="Añadir bloque"
              >
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
              <button
                onClick={() => { play('interaction.toggle'); onRemoveSlot(); }}
                disabled={slotCount <= 1}
                className="p-0.5 rounded hover:bg-base-300 text-base-content/30 hover:text-base-content transition-colors disabled:opacity-20 disabled:cursor-not-allowed cursor-pointer"
                title="Quitar bloque"
                aria-label="Quitar bloque"
              >
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <div className="relative min-w-0 w-full sm:w-auto sm:min-w-[140px] sm:max-w-[220px]">
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Buscar en noticias..."
                className="w-full text-xs bg-base-300 border border-base-300 rounded-lg px-2.5 py-1.5 text-base-content placeholder:text-base-content/40 focus:outline-none focus:border-primary transition-colors"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-base-content/30 hover:text-base-content"
                >
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              )}
            </div>
            <div className="flex gap-1">
              {([
                { value: 'all', label: 'Todo' },
                { value: 'today', label: 'Hoy' },
                { value: '3d', label: '3 días' },
                { value: 'week', label: 'Semana' },
              ] as const).map(opt => (
                <button
                  key={opt.value}
                  onClick={() => { play('interaction.tap'); setDateFilter(opt.value); }}
                  className={`px-2.5 py-1 text-[11px] rounded-lg transition-all ${
                    dateFilter === opt.value
                  ? 'bg-primary text-primary-content font-medium'
                      : 'bg-base-300 text-base-content/60 hover:text-base-content'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {hasSlotsWithSources ? (
          <>
            <div className={`flex gap-3 overflow-x-auto snap-x snap-mandatory pb-2 sm:grid sm:overflow-visible sm:snap-none sm:pb-0 scrollbar-hide-mobile ${gridCols}`}>
              {filteredSlots.map((slot, i) => {
                const st = skipToasts.find(t => t.slotIndex === i);
                const skipProgress = st ? {
                  newSourceName: st.newSource.name,
                  countdown: st.countdown,
                  isPending: !!st.pendingResult,
                  reason: slot.error ?? '',
                } : undefined;
                return (
                  <div key={i} className="snap-center shrink-0 w-[80vw] sm:w-auto">
                    <SlotCard
                      slotIndex={i}
                      selectedSource={slot.source}
                      articles={slot.articles}
                      loading={slot.loading}
                      error={slot.error}
                      allSources={allSources as SourceFeed[]}
                      usedSourceKeys={usedSourceKeys}
                      triedSources={triedSources}
                      pinnedSource={pinnedSources[i] ?? null}
                      allPinnedSources={pinnedSources}
                      onSourceChange={onSourceChange}
                      onRetry={onRetrySlot}
                      onClear={onClearSlot}
                      onTogglePin={onTogglePin}
                      hasActiveFilter={hasActiveFilter}
                      skipProgress={skipProgress}
                      onCancelSkip={onCancelSkip}
                      isFallback={slot.isFallback}
                    />
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <div className="text-center py-16 text-base-content/50 text-sm">
            Sin resultados{activeTag ? ` para "${activeTag}"` : ''}{searchQuery ? ` para "${searchQuery}"` : ''}{dateFilter !== 'all' ? ' con filtro de fecha' : ''}
          </div>
        )}
      </div>

      {visibleClusters.length > 0 && (
        <div className="transition-all duration-300 animate-[fadeSlideIn_0.4s_ease-out]">
          <h3 className="text-xs text-base-content/50 uppercase tracking-wider font-semibold mb-3">
            Agrupadas por tema
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {visibleClusters.map((cluster, index) => (
              <div key={index} className="opacity-0 animate-[fadeSlideIn_0.35s_ease-out_forwards]" style={{ animationDelay: `${index * 60}ms` }}>
                <NewsClusterCard cluster={cluster} openDirect={openDirect} />
              </div>
            ))}
          </div>
          <div className="flex justify-center gap-3 mt-4">
            {hasMoreClusters && (
              <button
                onClick={() => setClusterLimit(c => c + 3)}
                className="px-5 py-2 text-xs font-medium text-base-content bg-base-200 border border-base-300 rounded-lg hover:bg-base-300 hover:border-primary hover:ring-1 hover:ring-inset hover:ring-base-content/[0.04] transition-all duration-200 active:scale-[0.96] cursor-pointer"
              >
                Cargar más temas
              </button>
            )}
            {clusterLimit > 3 && (
              <button
                onClick={() => setClusterLimit(3)}
                className="px-5 py-2 text-xs font-medium text-base-content bg-base-200 border border-base-300 rounded-lg hover:bg-base-300 hover:border-primary hover:ring-1 hover:ring-inset hover:ring-base-content/[0.04] transition-all duration-200 active:scale-[0.96] cursor-pointer"
              >
                Colapsar todo
              </button>
            )}
          </div>
        </div>
      )}

      {clusters.length > 0 && filteredClusters.length === 0 && activeTag && (
        <div className="text-center py-12 text-base-content/50 text-sm">
          Sin resultados para "{activeTag}"
        </div>
      )}

      <div className="mt-4 text-right text-[10px] text-base-content/50">
        Fuente:{' '}
        <a href="https://github.com/alplox/awesome-chilean-rss" target="_blank" rel="noopener noreferrer" className="text-base-content/70 hover:text-base-content underline underline-offset-2 transition-colors">awesome-chilean-rss</a>
      </div>

      <SourceErrorPanel sourceResults={sourceResults} onRetry={onRetry} />
    </div>
  );
}
