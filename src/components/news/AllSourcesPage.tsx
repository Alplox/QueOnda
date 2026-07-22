import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import type { SourceFeed, Article, NewsCluster, SourceResult } from '../../types';
import { idbGet, idbSet } from '../../lib/idb-cache';
import { ArticleReader } from './ArticleReader';
import { extractHost } from '../../lib/url';
import { loadJSON, saveJSON } from '../../lib/storage';
import { play } from '@/lib/sound';
import { navigate } from 'astro:transitions/client';
import { ChileMap } from './ChileMap';
import { FaviconImg } from './FaviconImg';

const CACHE_TTL = 30 * 60 * 1000;
const CHUNK_SIZE = 250;
const STORAGE_SELECTION = 'all-sources-selection';
const BATCH_CACHE_TTL_HINT = 'Artículos duplicados se muestran una sola vez; Si dos fuentes distintas tienen el mismo artículo con la misma URL, solo se muestra uno.';

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
      <span className="shrink-0 text-[10px] text-base-content/50">{extractHost(source.url)}</span>
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
  const [retryingSources, setRetryingSources] = useState<Set<string>>(new Set());
  const [failedPanelExpanded, setFailedPanelExpanded] = useState(false);
  const [addSourceRegion, setAddSourceRegion] = useState<string | null>(null);
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | '3d' | 'week'>('all');
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
      idbGet<{ articles: Article[]; sourceResults: SourceResult[] }>(cacheKey).then(cached => {
        if (cached) {
          setArticles(cached.data.articles);
          setSourceResults(cached.data.sourceResults);
          setCachedTimestamp(new Date(cached.timestamp).toLocaleString('es-CL'));
          setStatus('results');
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
      setStatus(prev => prev === 'results' ? 'results' : 'selecting');
    } catch {
      setStatus(prev => prev === 'results' ? 'results' : 'selecting');
    }
  }

  // Compute clusters + trending whenever articles change
  // Filter by active tag
  const dateCutoff = useMemo(() => {
    if (dateFilter === 'all') return 0;
    const days = { today: 1, '3d': 3, week: 7 }[dateFilter];
    return Date.now() - days * 86400000;
  }, [dateFilter]);

  const filteredArticles = useMemo(() => {
    let filtered = articles;
    if (activeTag) {
      const q = activeTag.toLowerCase();
      filtered = filtered.filter(a =>
        a.title.toLowerCase().includes(q) ||
        a.description.toLowerCase().includes(q)
      );
    }
    if (dateCutoff > 0) {
      filtered = filtered.filter(a => new Date(a.pubDate).getTime() >= dateCutoff);
    }
    return filtered;
  }, [articles, activeTag, dateCutoff]);

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

  const hasActiveFilter = useMemo(() => !!(activeTag || resultsSearch || dateFilter !== 'all'), [activeTag, resultsSearch, dateFilter]);

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
    setSelected(prev => {
      const next = new Set(prev);
      filteredSources.forEach(s => next.add(s.sourceKey));
      return next;
    });
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
    let sources = allSources;
    if (addSourceRegion) {
      sources = sources.filter(s => s.region === addSourceRegion);
    }
    if (!addSourceQuery) return sources;
    const q = addSourceQuery.toLowerCase();
    return sources.filter(s =>
      s.name.toLowerCase().includes(q) ||
      s.source.toLowerCase().includes(q) ||
      s.sourceKey.toLowerCase().includes(q) ||
      extractHost(s.url).includes(q)
    );
  }, [allSources, addSourceQuery, addSourceRegion]);

  const availableRegions = useMemo(() => {
    const regionSet = new Set(allSources.filter(s => s.region).map(s => s.region!));
    return ALL_REGIONS_ORDERED.filter(r => regionSet.has(r));
  }, [allSources]);

  function makeCacheKey(sourceKeys: string[]): string {
    return 'all-sources:' + [...sourceKeys].sort().join(',');
  }

  async function handleRemoveSource(sourceName: string) {
    setArticles(prev => prev.filter(a => a.source !== sourceName));
    setSourceResults(prev => prev.filter(sr => sr.name !== sourceName));

    const selectedArr = [...selected];
    if (selectedArr.length > 0) {
      const cacheKey = makeCacheKey(selectedArr);
      await idbSet(cacheKey, {
        articles: articles.filter(a => a.source !== sourceName),
        sourceResults: sourceResults.filter(sr => sr.name !== sourceName),
      }, CACHE_TTL);
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
        await idbSet(cacheKey, {
          articles: [...articles, ...newArticles],
          sourceResults: [...sourceResults, ...newResults],
        }, CACHE_TTL);
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

  async function handleRetrySource(sourceKey: string) {
    const source = allSources.find(s => s.sourceKey === sourceKey);
    if (!source) return;

    setRetryingSources(prev => new Set(prev).add(sourceKey));

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

      const selectedArr = [...selected];
      if (selectedArr.length > 0) {
        const cacheKey = makeCacheKey(selectedArr);
        await idbSet(cacheKey, {
          articles: [...articles, ...newArticles],
          sourceResults: [...sourceResults.filter(sr => sr.name !== source.name), ...newResults],
        }, CACHE_TTL);
      }
    } catch {
      // silent
    } finally {
      setRetryingSources(prev => {
        const next = new Set(prev);
        next.delete(sourceKey);
        return next;
      });
    }
  }

  async function handleRetryAllFailed() {
    const failed = sourceResults.filter(r => !r.success);
    const sourceKeys = failed
      .map(f => allSources.find(s => s.name === f.name)?.sourceKey)
      .filter((k): k is string => !!k);
    await Promise.all(sourceKeys.map(k => handleRetrySource(k)));
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
      await idbSet(cacheKey, {
        articles: articles,
        sourceResults: allResults,
      }, CACHE_TTL);
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
        await idbSet(cacheKey, {
          articles: articles,
          sourceResults: allResults,
        }, CACHE_TTL);
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
    navigate('/');
  }, []);

  const selectedCount = selected.size;
  const allSelected = filteredSources.length > 0 && filteredSources.every(s => selected.has(s.sourceKey));

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
                className="w-full text-sm bg-base-200 border border-base-300 rounded-xl px-4 py-2.5 pl-10 text-base-content placeholder:text-base-content/50 focus:outline-none focus:border-primary transition-colors"
              />
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-base-content/50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
              onClick={() => { play('interaction.tap'); (allSelected || selected.size > 0 ? deselectAll() : selectAll()); }}
              className={`px-3 py-1.5 text-[11px] font-medium rounded-lg transition-all cursor-pointer ${
allSelected || selected.size > 0
                    ? 'bg-base-content/10 text-base-content/70 hover:text-base-content'
                    : 'bg-primary text-primary-content hover:bg-primary'
              }`}
            >
              {allSelected ? 'Deseleccionar todo' : selected.size > 0 ? 'Limpiar selección' : 'Seleccionar todo'}
            </button>
            {searchQuery && filteredSources.length > 0 && (
              <button
                onClick={() => { play('interaction.tap'); selectBySearch(); }}
                className="px-3 py-1.5 text-[11px] font-medium bg-base-content/10 text-base-content/70 hover:text-base-content rounded-lg transition-colors cursor-pointer"
              >
                Agregar {filteredSources.length - filteredSources.filter(s => selected.has(s.sourceKey)).length} de búsqueda
              </button>
            )}
            <button
              onClick={() => { play('interaction.tap'); setShowMap(v => !v); }}
              className={`px-3 py-1.5 text-[11px] font-medium rounded-lg transition-colors cursor-pointer ${
showMap ? 'bg-primary text-primary-content' : 'bg-base-content/10 text-base-content/70 hover:text-base-content'
              }`}
            >
              {showMap ? 'Ocultar mapa' : 'Filtrar por región'}
            </button>
            {selectedRegion && (
              <button
                onClick={() => { play('interaction.tap'); setSelectedRegion(null); }}
                className="px-3 py-1.5 text-[11px] font-medium bg-base-content/10 text-error/80 hover:text-error rounded-lg transition-colors cursor-pointer"
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
              <div className="px-4 py-8 text-center text-xs text-base-content/50">
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
                className="w-full py-3 text-sm font-semibold bg-primary text-primary-content rounded-xl hover:opacity-90 transition-all active:scale-[0.96] shadow-lg shadow-primary/20 cursor-pointer"
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
          <p className="text-[10px] text-base-content/50">{BATCH_CACHE_TTL_HINT}</p>
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
            {cachedTimestamp && (
              <p className="text-[10px] text-base-content/50">Resultados cacheados desde las {cachedTimestamp}</p>
            )}
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:flex-none sm:w-56">
              <input
                type="text"
                value={resultsSearch}
                onChange={e => setResultsSearch(e.target.value)}
                placeholder="Buscar en resultados..."
                className="w-full text-sm bg-base-200 border border-base-300 rounded-xl px-4 py-2 pl-9 text-base-content placeholder:text-base-content/50 focus:outline-none focus:border-primary transition-colors"
              />
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-base-content/50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              {resultsSearch && (
                <button
                  onClick={() => { play('interaction.tap'); setResultsSearch(''); }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-base-content/50 hover:text-base-content transition-colors cursor-pointer"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              )}
            </div>
            <button
              onClick={() => { play('interaction.tap'); setStatus('selecting'); loadInventory(); }}
              className="shrink-0 px-3 py-2 text-[11px] font-medium bg-base-300 text-base-content/70 hover:text-base-content rounded-xl transition-colors cursor-pointer"
            >
              Cambiar selección
            </button>
          </div>
        </div>

        {/* Date filter pills */}
        <div className="flex gap-1 flex-wrap">
          {([
            { value: 'all' as const, label: 'Todo' },
            { value: 'today' as const, label: 'Hoy' },
            { value: '3d' as const, label: '3 días' },
            { value: 'week' as const, label: 'Semana' },
          ]).map(opt => (
            <button
              key={opt.value}
              onClick={() => { play('interaction.tap'); setDateFilter(opt.value); }}
              className={`px-3 py-1.5 text-[11px] rounded-lg transition-all cursor-pointer ${
                dateFilter === opt.value
                  ? 'bg-primary text-primary-content font-medium'
                  : 'bg-base-200 text-base-content/60 border border-base-300 hover:border-primary/50 hover:text-base-content'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Filter status — below pills to avoid layout shift */}
        {hasActiveFilter && (
          <p className="text-[10px] text-base-content/50">
            {searchedArticles.length > 0
              ? `mostrando ${searchedArticles.length} con filtro`
              : 'ninguna coincidencia con el filtro actual'}
            {dateFilter !== 'all' ? ' · filtro de fecha' : ''}
          </p>
        )}

        {/* Failed sources panel — full width row */}
        {failedSources.length > 0 && (
          <FailedSourcesPanel
            failedSources={failedSources}
            allSources={allSources}
            retryingSources={retryingSources}
            expanded={failedPanelExpanded}
            onToggle={() => setFailedPanelExpanded(v => !v)}
            onRetryOne={handleRetrySource}
            onRetryAll={handleRetryAllFailed}
          />
        )}

        {/* Clickable trending tags */}
        {trending.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {trending.map((tag, i) => (
              <button
                key={i}
                onClick={() => { play('interaction.tap'); setActiveTag(activeTag === tag ? null : tag); }}
                className={`px-3 py-1.5 rounded-full text-sm border transition-colors cursor-pointer active:scale-[0.96] ${
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
                className="px-3 py-1.5 rounded-full text-sm bg-base-200 text-error border border-base-300 hover:border-error/50 hover:text-base-content transition-colors cursor-pointer active:scale-[0.96]"
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
                <span className="text-[10px] text-base-content/50">
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
                  {availableRegions.length > 0 && (
                    <div className="px-3 pt-3 pb-2 border-b border-base-300">
                      <select
                        value={addSourceRegion ?? ''}
                        onChange={e => { setAddSourceRegion(e.target.value || null); setAddSourceQuery(''); }}
                        className="w-full text-xs bg-base-100 border border-base-300 rounded-lg px-2.5 py-1.5 text-base-content focus:outline-none focus:border-primary transition-colors cursor-pointer"
                      >
                        <option value="">Todas las regiones</option>
                        {availableRegions.map(r => (
                          <option key={r} value={r}>{REGION_LABELS[r] || r}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div className="relative p-3 border-b border-base-300">
                    <input
                      type="text"
                      value={addSourceQuery}
                      onChange={e => setAddSourceQuery(e.target.value)}
                      placeholder="Buscar fuente para agregar..."
                      className="w-full text-sm bg-base-100 border border-base-300 rounded-lg px-3 py-2 pl-9 text-base-content placeholder:text-base-content/50 focus:outline-none focus:border-primary transition-colors"
                      autoFocus
                    />
                    <svg className="absolute left-6 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-base-content/50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
                          <span className="shrink-0 text-[10px] text-base-content/50 ml-auto">{extractHost(s.url)}</span>
                        </button>
                      ))
                    ) : (
            <div className="px-3 py-4 text-center text-[11px] text-base-content/50 h-full flex items-center justify-center">
                        {addSourceQuery ? 'Sin resultados' : 'Todas las fuentes ya están agregadas'}
                      </div>
                    )}
                  </div>
                  <div className="border-t border-base-300 px-3 py-2">
                    <button
                    onClick={() => { play('overlay.close'); setShowAddSource(false); setAddSourceQuery(''); setAddSourceRegion(null); }}
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

function FailedSourcesPanel({ failedSources, allSources, retryingSources, expanded, onToggle, onRetryOne, onRetryAll }: {
  failedSources: SourceResult[];
  allSources: SourceFeed[];
  retryingSources: Set<string>;
  expanded: boolean;
  onToggle: () => void;
  onRetryOne: (sourceKey: string) => void;
  onRetryAll: () => void;
}) {
  const anyRetrying = retryingSources.size > 0;
  return (
    <div className="rounded-xl border border-error/20 bg-error/5 overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-error shrink-0">
          <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <span className="text-[11px] text-error/80 font-medium">
          {failedSources.length} {failedSources.length === 1 ? 'fuente falló' : 'fuentes fallaron'}
        </span>
        <div className="flex items-center gap-2 ml-auto">
          <button onClick={onToggle} className="text-[10px] text-base-content/50 hover:text-base-content cursor-pointer transition-colors">
            {expanded ? 'Ocultar' : 'Detalles'}
          </button>
          <button
            onClick={onRetryAll}
            disabled={anyRetrying}
            className="text-[10px] text-primary hover:text-primary font-medium cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Reintentar todo
          </button>
        </div>
      </div>
      {expanded && (
        <div className="border-t border-error/10 divide-y divide-error/10">
          {failedSources.map(f => {
            const sourceKey = allSources.find(s => s.name === f.name)?.sourceKey ?? '';
            const retrying = retryingSources.has(sourceKey);
            return (
              <div key={f.name} className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2">
                <FaviconImg domain={extractHost(f.url)} />
                <span className="text-xs text-base-content/80 truncate">{f.name}</span>
                <span className="text-[10px] text-error/60">
                  {f.statusCode ? `${f.statusCode} ` : ''}{f.error ?? 'Error desconocido'}
                </span>
                <button
                  onClick={() => { play('interaction.tap'); onRetryOne(sourceKey); }}
                  disabled={retrying}
                  className="ml-auto shrink-0 text-[10px] text-primary hover:text-primary font-medium cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {retrying ? (
                    <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 border border-primary border-t-transparent rounded-full animate-spin" /> Retry</span>
                  ) : 'Reintentar'}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
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
    <div className="rounded-xl bg-base-200 border border-base-300 overflow-hidden min-h-[473px] h-full flex flex-col">
      <div className="px-3 py-2.5 border-b border-base-300 flex items-center gap-1.5 flex-shrink-0">
        <FaviconImg domain={extractHost(sourceResult.url)} />
        <span className="text-sm font-semibold truncate text-base-content">{sourceResult.name}</span>
        <button
          onClick={() => { play('interaction.tap'); onRemove(sourceResult.name); }}
          className="shrink-0 p-1 rounded-md text-base-content/50 hover:text-error hover:bg-base-300 transition-colors cursor-pointer ml-auto"
          title="Quitar fuente"
          aria-label={`Quitar ${sourceResult.name}`}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
      <div className="relative flex-1">
        {articles.length > 0 ? (
          <div className="max-h-[400px] overflow-y-auto h-full">
            <div className="divide-y divide-base-300">
              {articles.map((a, i) => (
                <div
                  key={i}
                  className="flex items-center gap-1 group hover:bg-base-300 transition-colors"
                >
                  <button
                    onClick={() => { play('interaction.tap'); window.open(a.link, '_blank', 'noopener,noreferrer'); }}
                    className="flex-1 text-left min-w-0 px-3 py-2 cursor-pointer"
                  >
                    <p className="text-xs text-base-content leading-snug line-clamp-2">
                      {a.title}
                    </p>
                  </button>
                  <button
                    onClick={(e) => { play('interaction.tap'); e.stopPropagation(); onOpenArticle(a); }}
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
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full py-8 px-4 text-center">
            <p className="text-xs text-base-content/50">
              {hasActiveFilter ? 'Sin coincidencias' : 'Sin artículos disponibles'}
            </p>
          </div>
        )}
      </div>
      <div className="px-3 py-1.5 border-t border-base-300 text-[10px] text-base-content/50 flex items-center justify-between gap-2 flex-shrink-0">
        <span className="text-base-content/50">
          {articles.length} artículos
        </span>
        <div className="flex items-center gap-2 min-w-0">
          <a
            href={`https://${extractHost(sourceResult.url)}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => play('interaction.tap')}
            className="hover:text-base-content underline underline-offset-2 transition-colors truncate"
          >
            {extractHost(sourceResult.url)}
          </a>
          <span className="text-base-content/20">·</span>
          <a
            href={sourceResult.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => play('interaction.tap')}
            className="hover:text-base-content underline underline-offset-2 transition-colors truncate"
            title={sourceResult.url}
          >
            Feed RSS
          </a>
        </div>
      </div>
    </div>
  );
}
