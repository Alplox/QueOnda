import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import type { SourceFeed, Article, NewsCluster, SourceResult } from '../../types';
import { cacheGet, cacheSet } from '../../lib/idb-cache';
import { ArticleReader } from './ArticleReader';
import { extractHost } from '../../lib/url';
import { loadJSON, saveJSON } from '../../lib/storage';
import { play } from '@/lib/sound';
import { ChileMap } from './ChileMap';
import { FaviconImg } from './FaviconImg';

const CACHE_TTL = 30 * 60 * 1000;
const CHUNK_SIZE = 250;
const STORAGE_SELECTION = 'all-sources-selection';
const BATCH_CACHE_TTL_HINT = 'Artículos duplicados se muestran una sola vez; Si dos fuentes distintas tienen el mismo artículo con la misma URL, solo se muestra uno.';

type PageStatus = 'loading' | 'selecting' | 'fetching' | 'results';

function SourceCheckbox({ source, checked, onChange }: {
  source: SourceFeed;
  checked: boolean;
  onChange: (key: string, checked: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-base-300 transition-colors cursor-pointer group">
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(source.sourceKey, e.target.checked)}
        className="w-4 h-4 rounded border-base-300 text-primary focus:ring-primary/30 cursor-pointer"
      />
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <FaviconImg domain={extractHost(source.siteUrl || source.url)} />
        <span className="text-xs text-base-content truncate">{source.name}</span>
      </div>
      <span className="shrink-0 text-[10px] text-base-content/40">{extractHost(source.url)}</span>
    </label>
  );
}

export function AllSourcesPage() {
  const [status, setStatus] = useState<PageStatus>('loading');
  const [allSources, setAllSources] = useState<SourceFeed[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [articles, setArticles] = useState<Article[]>([]);
  const [sourceResults, setSourceResults] = useState<SourceResult[]>([]);
  const [trending, setTrending] = useState<string[]>([]);
  const [fetchProgress, setFetchProgress] = useState({ loaded: 0, total: 0, failed: 0 });
  const [clusteringMod, setClusteringMod] = useState<{ clusterArticles: (a: Article[]) => NewsCluster[]; extractTrendingFromArticles: (a: Article[]) => string[] } | null>(null);
  const [cachedTimestamp, setCachedTimestamp] = useState<string | null>(null);
  const [readerArticle, setReaderArticle] = useState<Article | null>(null);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [resultsSearch, setResultsSearch] = useState('');
  const [showAddSource, setShowAddSource] = useState(false);
  const [addSourceQuery, setAddSourceQuery] = useState('');
  const [addingSources, setAddingSources] = useState<Set<string>>(new Set());
  const [selectedRegion, setSelectedRegion] = useState<string | null>(null);
  const [showMap, setShowMap] = useState(true);
  const abortRef = useRef<AbortController | null>(null);
  const cancelledRef = useRef(false);

  // Load clustering module (code-split)
  useEffect(() => {
    import('../../lib/clustering').then(mod => {
      setClusteringMod({ clusterArticles: mod.clusterArticles, extractTrendingFromArticles: mod.extractTrendingFromArticles });
    });
  }, []);

  // On mount: check IDB cache or load inventory
  useEffect(() => {
    const lastSelection = loadJSON<string[]>(STORAGE_SELECTION, []);
    if (lastSelection.length > 0) {
      const cacheKey = makeCacheKey(lastSelection);
      cacheGet<{ timestamp: number; articles: Article[]; sourceResults: SourceResult[] }>(cacheKey).then(cached => {
        if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
          setArticles(cached.articles);
          setSourceResults(cached.sourceResults);
          setCachedTimestamp(new Date(cached.timestamp).toLocaleString('es-CL'));
          setStatus('results');
          return;
        }
        loadInventory();
      });
    } else {
      loadInventory();
    }
  }, []);

  async function loadInventory() {
    try {
      const res = await fetch('/api/news?mode=inventory');
      const data = await res.json();
      const sources: SourceFeed[] = data.allSources || [];
      setAllSources(sources);

      // Preselect from last selection if valid
      const lastSelection = loadJSON<string[]>(STORAGE_SELECTION, []);
      const validSelection = lastSelection.filter(k => sources.some(s => s.sourceKey === k));
      if (validSelection.length > 0) {
        setSelected(new Set(validSelection));
      }
      setStatus('selecting');
    } catch {
      setStatus('selecting');
    }
  }

  // Compute clusters + trending whenever articles change
  // Filter by active tag
  const filteredArticles = useMemo(() => {
    if (!activeTag) return articles;
    const q = activeTag.toLowerCase();
    return articles.filter(a =>
      a.title.toLowerCase().includes(q) ||
      a.description.toLowerCase().includes(q)
    );
  }, [articles, activeTag]);

  // Search within filtered results
  const searchedArticles = useMemo(() => {
    if (!resultsSearch) return filteredArticles;
    const q = resultsSearch.toLowerCase();
    return filteredArticles.filter(a =>
      a.title.toLowerCase().includes(q) ||
      a.source.toLowerCase().includes(q)
    );
  }, [filteredArticles, resultsSearch]);

  // Group searched articles by source
  const searchedBySource = useMemo(() => {
    const map = new Map<string, Article[]>();
    for (const a of searchedArticles) {
      const key = a.source;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(a);
    }
    return map;
  }, [searchedArticles]);

  const hasActiveFilter = useMemo(() => !!(activeTag || resultsSearch), [activeTag, resultsSearch]);

  useEffect(() => {
    if (!clusteringMod || status !== 'results') return;
    if (articles.length > 0) {
      setTrending(clusteringMod.extractTrendingFromArticles(articles));
    } else {
      setTrending([]);
    }
  }, [articles, clusteringMod, status]);

  // Save selection to localStorage whenever it changes
  useEffect(() => {
    const keys = [...selected];
    if (keys.length > 0) {
      saveJSON(STORAGE_SELECTION, keys);
    }
  }, [selected]);

  function handleToggle(key: string, checked: boolean) {
    setSelected(prev => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  function selectAll() {
    if (status !== 'selecting') return;
    setSelected(new Set(filteredSources.map(s => s.sourceKey)));
  }

  function deselectAll() {
    setSelected(new Set());
  }

  function selectBySearch() {
    const matching = filteredSources.filter(s => !selected.has(s.sourceKey));
    if (matching.length === 0) return;
    setSelected(prev => {
      const next = new Set(prev);
      matching.forEach(s => next.add(s.sourceKey));
      return next;
    });
  }

  const filteredSources = useMemo(() => {
    let sources = allSources;
    if (selectedRegion) {
      sources = sources.filter(s => s.region === selectedRegion);
    }
    if (!searchQuery) return sources;
    const q = searchQuery.toLowerCase();
    return sources.filter(s =>
      s.name.toLowerCase().includes(q) ||
      s.source.toLowerCase().includes(q) ||
      s.sourceKey.toLowerCase().includes(q) ||
      extractHost(s.url).includes(q)
    );
  }, [allSources, searchQuery, selectedRegion]);

  const addFilteredSources = useMemo(() => {
    if (!addSourceQuery) return allSources;
    const q = addSourceQuery.toLowerCase();
    return allSources.filter(s =>
      s.name.toLowerCase().includes(q) ||
      s.source.toLowerCase().includes(q) ||
      s.sourceKey.toLowerCase().includes(q) ||
      extractHost(s.url).includes(q)
    );
  }, [allSources, addSourceQuery]);

  function makeCacheKey(sourceKeys: string[]): string {
    return 'all-sources:' + [...sourceKeys].sort().join(',');
  }

  async function handleRemoveSource(sourceName: string) {
    setArticles(prev => prev.filter(a => a.source !== sourceName));
    setSourceResults(prev => prev.filter(sr => sr.name !== sourceName));

    const selectedArr = [...selected];
    if (selectedArr.length > 0) {
      const cacheKey = makeCacheKey(selectedArr);
      await cacheSet(cacheKey, {
        timestamp: Date.now(),
        articles: articles.filter(a => a.source !== sourceName),
        sourceResults: sourceResults.filter(sr => sr.name !== sourceName),
      });
    }
  }

  async function handleAddSource(sourceKey: string) {
    const source = allSources.find(s => s.sourceKey === sourceKey);
    if (!source) return;
    if (sourceResults.some(sr => sr.name === source.name)) return;

    setShowAddSource(false);
    setAddSourceQuery('');
    setAddingSources(prev => new Set(prev).add(sourceKey));

    try {
      const res = await fetch('/api/news/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sources: [source] }),
      });
      const data = await res.json();
      if (!res.ok) return;

      const newArticles: Article[] = (data.articles || []).filter(
        (a: Article) => !articles.some(existing => existing.link === a.link)
      );
      const newResults: SourceResult[] = data.sourceResults || [];

      setArticles(prev => [...prev, ...newArticles]);
      setSourceResults(prev => {
        const filtered = prev.filter(sr => !newResults.some(nr => nr.name === sr.name));
        return [...filtered, ...newResults];
      });

      // Update IDB cache
      const selectedArr = [...selected];
      if (selectedArr.length > 0) {
        const cacheKey = makeCacheKey(selectedArr);
        await cacheSet(cacheKey, {
          timestamp: Date.now(),
          articles: [...articles, ...newArticles],
          sourceResults: [...sourceResults, ...newResults],
        });
      }
    } catch {
      // silent
    } finally {
      setAddingSources(prev => {
        const next = new Set(prev);
        next.delete(sourceKey);
        return next;
      });
    }
  }

  async function handleFetch() {
    const selectedArr = [...selected];
    if (selectedArr.length === 0) return;

    setStatus('fetching');
    setFetchProgress({ loaded: 0, total: selectedArr.length, failed: 0 });

    const sourcesToFetch = allSources.filter(s => selected.has(s.sourceKey));

    const controller = new AbortController();
    abortRef.current = controller;

    // Split into chunks for progressive loading feedback
    const chunks: SourceFeed[][] = [];
    for (let i = 0; i < sourcesToFetch.length; i += CHUNK_SIZE) {
      chunks.push(sourcesToFetch.slice(i, i + CHUNK_SIZE));
    }

    let articles: Article[] = [];
    let allResults: SourceResult[] = [];
    let totalLoaded = 0;
    let totalFailed = 0;
    cancelledRef.current = false;

    try {
      for (let i = 0; i < chunks.length; i++) {
        if (controller.signal.aborted) break;

        const res = await fetch('/api/news/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sources: chunks[i] }),
          signal: controller.signal,
        });
        const data = await res.json();
        if (!res.ok) continue;

        const chunkResults: SourceResult[] = data.sourceResults || [];
        const chunkArticles: Article[] = data.articles || [];

        // Merge articles (dedup by link)
        const existingLinks = new Set(articles.map(a => a.link));
        for (const a of chunkArticles) {
          if (!existingLinks.has(a.link)) {
            articles.push(a);
            existingLinks.add(a.link);
          }
        }

        // Merge source results (keep first success)
        for (const sr of chunkResults) {
          const existing = allResults.find(r => r.name === sr.name);
          if (!existing) {
            allResults.push(sr);
          } else {
            if (sr.success) existing.success = true;
            if (sr.error && !existing.error) existing.error = sr.error;
          }
        }

        totalLoaded += chunkResults.filter(r => r.success).length;
        totalFailed += chunkResults.filter(r => !r.success).length;

        // Update state progressively so user sees real-time progress
        setArticles([...articles]);
        setSourceResults([...allResults]);
        setFetchProgress({ total: selectedArr.length, loaded: totalLoaded, failed: totalFailed });
      }

      if (cancelledRef.current) {
        setStatus('selecting');
        return;
      }

      // Cache in IDB
      const cacheKey = makeCacheKey(selectedArr);
      await cacheSet(cacheKey, {
        timestamp: Date.now(),
        articles: articles,
        sourceResults: allResults,
      });
      setCachedTimestamp(new Date().toLocaleString('es-CL'));

      setStatus('results');
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setStatus('selecting');
        return;
      }
      // Show partial results if some chunks loaded
      if (articles.length > 0) {
        const cacheKey = makeCacheKey(selectedArr);
        await cacheSet(cacheKey, {
          timestamp: Date.now(),
          articles: articles,
          sourceResults: allResults,
        });
        setCachedTimestamp(new Date().toLocaleString('es-CL'));
        setStatus('results');
      } else {
        setStatus('selecting');
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      cancelledRef.current = false;
    }
  }

  const handleBack = useCallback(() => {
    window.location.href = '/';
  }, []);

  const selectedCount = selected.size;
  const allSelected = allSources.length > 0 && selectedCount === allSources.length;

  // Loading Skeleton
  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-base-100">
        <NavBar onBack={handleBack} />
        <div className="max-w-2xl mx-auto px-4 py-12 text-center">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-sm text-base-content/60">Cargando fuentes...</p>
        </div>
      </div>
    );
  }

  // Source Selection
  if (status === 'selecting') {
    return (
      <div className="min-h-screen bg-base-100">
        <NavBar onBack={handleBack} />
        <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <div className="relative flex-1">
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Buscar fuentes..."
                className="w-full text-sm bg-base-200 border border-base-300 rounded-xl px-4 py-2.5 pl-10 text-base-content placeholder:text-base-content/40 focus:outline-none focus:border-primary transition-colors"
              />
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-base-content/30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </div>
            <div className="flex gap-2 items-center">
              <span className="text-xs text-base-content/70 whitespace-nowrap">
                {selectedCount} de {allSources.length}
              </span>
            </div>
          </div>

          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => { play('interaction.tap'); (allSelected ? deselectAll() : selectAll()); }}
              className={`px-3 py-1.5 text-[11px] font-medium rounded-lg transition-all cursor-pointer ${
allSelected
                    ? 'bg-base-300 text-base-content/70 hover:text-base-content'
                    : 'bg-primary text-primary-content hover:bg-primary'
              }`}
            >
              {allSelected ? 'Deseleccionar todo' : 'Seleccionar todo'}
            </button>
            {searchQuery && filteredSources.length > 0 && (
              <button
                onClick={() => { play('interaction.tap'); selectBySearch(); }}
                className="px-3 py-1.5 text-[11px] font-medium bg-base-300 text-base-content/70 hover:text-base-content rounded-lg transition-colors cursor-pointer"
              >
                Agregar {filteredSources.length - filteredSources.filter(s => selected.has(s.sourceKey)).length} de búsqueda
              </button>
            )}
            <button
              onClick={() => { play('interaction.tap'); setShowMap(v => !v); }}
              className={`px-3 py-1.5 text-[11px] font-medium rounded-lg transition-colors cursor-pointer ${
showMap ? 'bg-primary text-primary-content' : 'bg-base-300 text-base-content/70 hover:text-base-content'
              }`}
            >
              {showMap ? 'Ocultar mapa' : 'Filtrar por región'}
            </button>
            {selectedRegion && (
              <button
                onClick={() => { play('interaction.tap'); setSelectedRegion(null); }}
                className="px-3 py-1.5 text-[11px] font-medium bg-base-300 text-error/80 hover:text-error rounded-lg transition-colors cursor-pointer"
              >
                Limpiar región
              </button>
            )}
          </div>

          <div className="flex gap-4">
            {showMap && (
              <div className="w-[180px] shrink-0">
                <ChileMap allSources={allSources} selectedRegion={selectedRegion} onSelectRegion={setSelectedRegion} />
              </div>
            )}
            <div className={showMap ? 'flex-1 min-w-0' : 'w-full'}>
              <div className="bg-base-200 border border-base-300 rounded-xl overflow-hidden max-h-[60vh] overflow-y-auto">
            {filteredSources.length > 0 ? (
              filteredSources.map(source => (
                <SourceCheckbox
                  key={source.sourceKey}
                  source={source}
                  checked={selected.has(source.sourceKey)}
                  onChange={handleToggle}
                />
              ))
            ) : (
              <div className="px-4 py-8 text-center text-xs text-base-content/40">
                {searchQuery ? 'Sin resultados para esta búsqueda' : 'No hay fuentes disponibles'}
              </div>
            )}
          </div>
            </div>
          </div>

          {selectedCount > 0 && allSources.length > 0 && (
            <div className="sticky bottom-4">
              <button
                onClick={() => { play('interaction.tap'); handleFetch(); }}
                className="w-full py-3 text-sm font-semibold bg-primary text-primary-content rounded-xl hover:opacity-90 transition-all active:scale-[0.98] shadow-lg shadow-primary/20 cursor-pointer"
              >
                Cargar {selectedCount} {selectedCount === 1 ? 'fuente' : 'fuentes'}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Fetching progress
  if (status === 'fetching') {
    const pct = fetchProgress.total > 0 ? ((fetchProgress.loaded + fetchProgress.failed) / fetchProgress.total) * 100 : 0;
    return (
      <div className="min-h-screen bg-base-100">
        <NavBar onBack={handleBack} />
        <div className="max-w-2xl mx-auto px-4 py-12 text-center space-y-6">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
          <div>
            <p className="text-sm text-base-content/80 font-medium">
              Cargando {fetchProgress.loaded + fetchProgress.failed} de {fetchProgress.total} fuentes...
            </p>
            <p className="text-xs text-base-content/70 mt-1">
              {fetchProgress.loaded} con artículos{fetchProgress.failed > 0 ? `, ${fetchProgress.failed} fallaron` : ''}
            </p>
          </div>
          <div className="w-full max-w-md mx-auto h-2 bg-base-300 rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-300 ease-out"
              style={{ width: `${Math.min(pct, 100)}%` }}
            />
          </div>
          <button
            onClick={() => { play('interaction.tap'); cancelledRef.current = true; abortRef.current?.abort(); }}
            className="px-4 py-2 text-xs font-medium text-base-content/70 hover:text-base-content bg-base-300 hover:bg-base-300/80 rounded-xl transition-colors cursor-pointer"
          >
            Cancelar
          </button>
          <p className="text-[10px] text-base-content/40">{BATCH_CACHE_TTL_HINT}</p>
        </div>
      </div>
    );
  }

  // Results
  const failedSources = sourceResults.filter(r => !r.success);

  return (
    <div className="min-h-screen bg-base-100">
      <NavBar onBack={handleBack} />
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        {/* Header: count + search + bulk change */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-bold text-base-content">
              {articles.length > 0
                ? `${articles.length} artículos de ${sourceResults.length} fuentes`
                : 'Sin resultados'}
            </h2>
            {hasActiveFilter && (
              <p className="text-[10px] text-base-content/40 mt-0.5">
                {searchedArticles.length > 0
                  ? `mostrando ${searchedArticles.length} con filtro`
                  : 'ninguna coincidencia con el filtro actual'}
              </p>
            )}
            {cachedTimestamp && (
              <p className="text-[10px] text-base-content/40">Resultados cacheados desde las {cachedTimestamp}</p>
            )}
            {failedSources.length > 0 && (
              <p className="text-[10px] text-error/70 mt-0.5">
                {failedSources.length} {failedSources.length === 1 ? 'fuente falló' : 'fuentes fallaron'}
              </p>
            )}
          </div>
          <div className="relative w-full sm:w-56">
            <input
              type="text"
              value={resultsSearch}
              onChange={e => setResultsSearch(e.target.value)}
              placeholder="Buscar en resultados..."
               className="w-full text-sm bg-base-200 border border-base-300 rounded-xl px-4 py-2 pl-9 text-base-content placeholder:text-base-content/40 focus:outline-none focus:border-primary transition-colors"
            />
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-base-content/30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            {resultsSearch && (
              <button
                onClick={() => { play('interaction.tap'); setResultsSearch(''); }}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-base-content/30 hover:text-base-content transition-colors cursor-pointer"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            )}
          </div>
          <button
            onClick={() => { play('interaction.tap'); setStatus('selecting'); loadInventory(); }}
            className="shrink-0 px-3 py-1.5 text-[11px] font-medium bg-base-300 text-base-content/70 hover:text-base-content rounded-lg transition-colors cursor-pointer"
          >
            Cambiar selección
          </button>
        </div>

        {/* Clickable trending tags */}
        {trending.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {trending.map((tag, i) => (
              <button
                key={i}
                onClick={() => { play('interaction.tap'); setActiveTag(activeTag === tag ? null : tag); }}
                className={`px-3 py-1.5 rounded-full text-sm border transition-colors cursor-pointer active:scale-95 ${
                  activeTag === tag
                    ? 'bg-primary border-primary text-primary-content'
                    : 'bg-base-200 text-base-content/70 border-base-300 hover:border-primary/50 hover:text-base-content'
                }`}
              >
                #{tag}
              </button>
            ))}
            {activeTag && (
              <button
                onClick={() => { play('interaction.tap'); setActiveTag(null); }}
                className="px-3 py-1.5 rounded-full text-sm bg-base-200 text-error border border-base-300 hover:border-error/50 hover:text-base-content transition-colors cursor-pointer active:scale-95"
              >
                Limpiar filtro
              </button>
            )}
          </div>
        )}

        {/* Articles by source */}
        {sourceResults.filter(r => r.success).length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <h3 className="text-xs text-base-content/70 uppercase tracking-wider font-semibold">
                Artículos por fuente
              </h3>
              {activeTag && (
                <span className="text-[10px] text-base-content/40">
                  filtrando por «{activeTag}»
                </span>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {sourceResults.filter(r => r.success).map((sr, i) => (
                <SourceCard
                  key={i}
                  sourceResult={sr}
                  articles={searchedBySource.get(sr.name) ?? []}
                  onOpenArticle={setReaderArticle}
                  onRemove={handleRemoveSource}
                  hasActiveFilter={hasActiveFilter}
                />
              ))}
            </div>

            {/* Skeleton for sources being added */}
            {addingSources.size > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {[...addingSources].map(key => {
                  const src = allSources.find(s => s.sourceKey === key);
                  return (
                    <div key={key} className="rounded-xl bg-base-200 border border-base-300 overflow-hidden animate-pulse">
                      <div className="px-3 py-2.5 border-b border-base-300 flex items-center gap-1.5">
                        <div className="w-1.5 h-1.5 rounded-full bg-base-300" />
                        <div className="h-3 bg-base-300 rounded w-28" />
                        <div className="h-2.5 bg-base-300 rounded w-12 ml-auto" />
                      </div>
                      <div className="space-y-2 p-3">
                        {[1, 2, 3].map(n => (
                          <div key={n} className="h-2.5 bg-base-300 rounded w-full" />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Add source inline */}
            <div>
              {showAddSource ? (
                <div className="bg-base-200 border border-base-300 rounded-xl overflow-hidden">
                  <div className="relative p-3 border-b border-base-300">
                    <input
                      type="text"
                      value={addSourceQuery}
                      onChange={e => setAddSourceQuery(e.target.value)}
                      placeholder="Buscar fuente para agregar..."
                      className="w-full text-sm bg-base-100 border border-base-300 rounded-lg px-3 py-2 pl-9 text-base-content placeholder:text-base-content/40 focus:outline-none focus:border-primary transition-colors"
                      autoFocus
                    />
                    <svg className="absolute left-6 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-base-content/30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="11" cy="11" r="8" />
                      <line x1="21" y1="21" x2="16.65" y2="16.65" />
                    </svg>
                  </div>
                  <div className="max-h-48 overflow-y-auto">
                    {addFilteredSources.filter(s => !sourceResults.some(sr => sr.name === s.name)).length > 0 ? (
                      addFilteredSources.filter(s => !sourceResults.some(sr => sr.name === s.name)).map(s => (
                        <button
                          key={s.sourceKey}
                          onClick={() => { play('interaction.tap'); handleAddSource(s.sourceKey); }}
                          className="w-full text-left px-3 py-2 text-xs text-base-content/80 hover:text-base-content hover:bg-base-300/50 transition-colors cursor-pointer flex items-center gap-2"
                        >
                          <span className="w-1 h-1 rounded-full bg-primary shrink-0" />
                          <span className="truncate">{s.name}</span>
                          <span className="shrink-0 text-[10px] text-base-content/40 ml-auto">{extractHost(s.url)}</span>
                        </button>
                      ))
                    ) : (
                      <div className="px-3 py-4 text-center text-[11px] text-base-content/40">
                        {addSourceQuery ? 'Sin resultados' : 'Todas las fuentes ya están agregadas'}
                      </div>
                    )}
                  </div>
                  <div className="border-t border-base-300 px-3 py-2">
                    <button
                    onClick={() => { play('overlay.close'); setShowAddSource(false); setAddSourceQuery(''); }}
                    className="text-[11px] text-base-content/70 hover:text-base-content transition-colors cursor-pointer"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : (
                <button
              onClick={() => { play('interaction.tap'); setShowAddSource(true); }}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-base-content/70 hover:text-base-content bg-base-200 border border-base-300 border-dashed rounded-xl hover:bg-base-300/50 transition-colors cursor-pointer w-full justify-center"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  Agregar fuente
                </button>
              )}
            </div>
          </div>
        )}

        {/* Attribution */}
        <div className="mt-4 text-right text-[10px] text-base-content/70">
          Fuente:{' '}
          <a href="https://github.com/alplox/awesome-chilean-rss" target="_blank" rel="noopener noreferrer" onClick={() => play('interaction.tap')} className="text-base-content/70 hover:text-base-content underline underline-offset-2 transition-colors">awesome-chilean-rss</a>
        </div>
      </div>

      {readerArticle && (
        <ArticleReader url={readerArticle.link} initialArticle={readerArticle} onClose={() => setReaderArticle(null)} />
      )}
    </div>
  );
}

function NavBar({ onBack }: { onBack: () => void }) {
  return (
      <nav className="sticky top-0 z-40 bg-base-100/80 backdrop-blur-md border-b border-base-300">
      <div className="max-w-5xl mx-auto px-4 h-12 flex items-center gap-3">
        <button
          onClick={() => { play('overlay.close'); onBack(); }}
          className="flex items-center gap-1 text-sm text-base-content/70 hover:text-base-content transition-colors cursor-pointer"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
          Volver
        </button>
        <div className="w-px h-4 bg-base-300" />
        <span className="text-sm font-semibold text-base-content">Todas las fuentes</span>
      </div>
    </nav>
  );
}

function SourceCard({ sourceResult, articles, onOpenArticle, onRemove, hasActiveFilter }: {
  sourceResult: SourceResult;
  articles: Article[];
  onOpenArticle: (a: Article) => void;
  onRemove: (name: string) => void;
  hasActiveFilter: boolean;
}) {
  return (
    <div className="rounded-xl bg-base-200 border border-base-300 overflow-hidden">
      <div className="px-3 py-2.5 border-b border-base-300 flex items-center gap-1.5">
        <FaviconImg domain={extractHost(sourceResult.url)} />
        <span className="text-sm font-semibold truncate text-base-content">{sourceResult.name}</span>
        <span className="shrink-0 text-[10px] text-base-content/40 ml-auto">{articles.length} artículos</span>
        <button
          onClick={() => { play('interaction.tap'); onRemove(sourceResult.name); }}
          className="shrink-0 p-1 rounded-md text-base-content/30 hover:text-error hover:bg-base-300 transition-colors cursor-pointer"
          title="Quitar fuente"
          aria-label={`Quitar ${sourceResult.name}`}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
      <div className="divide-y divide-base-300 max-h-80 overflow-y-auto">
        {articles.length > 0 ? (
          articles.map((a, i) => (
            <div
              key={i}
              className="flex items-center gap-1 group hover:bg-base-300/50 transition-colors"
            >
              <button
                onClick={() => { play('interaction.tap'); window.open(a.link, '_blank', 'noopener,noreferrer'); }}
                className="flex-1 text-left min-w-0 px-3 py-2 cursor-pointer"
              >
                <p className="text-xs text-base-content/80 leading-snug line-clamp-2 group-hover:text-base-content transition-colors">
                  {a.title}
                </p>
              </button>
              <button
                onClick={(e) => { play('interaction.tap'); e.stopPropagation(); onOpenArticle(a); }}
                className="shrink-0 p-1 mr-1 rounded-md opacity-50 group-hover:opacity-100 focus:opacity-100 hover:bg-base-300 text-base-content/40 hover:text-base-content transition-all cursor-pointer"
                title="Leer en ventana flotante"
                aria-label="Leer en modal"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                  <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
                </svg>
              </button>
            </div>
          ))
          ) : (
            <div className="px-3 py-4 text-center text-[11px] text-base-content/40">
              {hasActiveFilter ? 'Sin coincidencias' : 'Sin artículos disponibles'}
            </div>
          )}
      </div>
    </div>
  );
}
