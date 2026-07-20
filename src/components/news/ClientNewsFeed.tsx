import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import type { NewsCluster, Article, SourceResult, SourceFeed, PinnedSource } from '../../types';
import { NewsFeed } from './NewsFeed';
import type { clusterArticles, extractTrendingFromArticles } from '../../lib/clustering';
import { idbGet, idbSet, cacheGet, cacheSet } from '../../lib/idb-cache';
import { loadJSON, saveJSON } from '../../lib/storage';

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

const DEFAULT_SLOT_COUNT = 6;
const MAX_SLOTS = 12;
const MIN_SLOTS = 1;
const STORAGE_KEY_SLOTS = 'news-slots';
const STORAGE_KEY_PINS = 'news-pins';
const SKIP_GRACE_SECONDS = 5;
const CACHE_TTL = 15 * 60 * 1000; // 15 min, matching server cache
const CACHE_BATCH_TTL = 10 * 60 * 1000;

function batchCacheKey(sources: SourceFeed[]): string {
  return 'news-batch:' + sources.map(s => s.sourceKey).sort().join(',');
}

interface BatchCacheEntry {
  sourceKey: string;
  articles: Article[];
  error: string | null;
}

function restoreSlotState(sources: SourceFeed[]): { slots: SlotData[]; pins: Record<number, PinnedSource> } {
  const migratedPins = migratePinnedSources(
    loadJSON<Record<number, unknown>>(STORAGE_KEY_PINS, {}),
    sources
  );
  const savedKeys = loadJSON<string[]>(STORAGE_KEY_SLOTS, []);
  const slotCount = savedKeys.length || DEFAULT_SLOT_COUNT;
  const initial: SlotData[] = Array.from({ length: slotCount }, (_, i) => {
    const pin = migratedPins[i];
    if (pin) {
      const source = matchSource(sources, pin.sourceKey);
      if (source) return { source, articles: [], loading: true, error: null };
      if (pin.url) {
        return { source: { sourceKey: pin.sourceKey, name: pin.name, url: pin.url, source: pin.name }, articles: [], loading: true, error: null, isFallback: true };
      }
    }
    const key = savedKeys[i];
    const source = key ? matchSource(sources, key) : null;
    return { source, articles: [], loading: true, error: null };
  });

  for (let i = 0; i < initial.length; i++) {
    if (initial[i].source) continue;
    const seen = new Set(initial.map(s => s.source?.sourceKey).filter(Boolean));
    const unused = sources.find(s => !seen.has(s.sourceKey));
    if (unused) {
      seen.add(unused.sourceKey);
      initial[i].source = unused;
    }
  }
  for (const slot of initial) {
    if (!slot.source) slot.loading = false;
  }

  return { slots: initial, pins: migratedPins };
}

function matchSource(inventory: SourceFeed[], nameOrKey: string): SourceFeed | null {
  const lower = nameOrKey.toLowerCase();
  return inventory.find(
    s => s.sourceKey.toLowerCase() === lower || s.name.toLowerCase() === lower || s.source.toLowerCase() === lower
  ) ?? null;
}

function migratePinnedSources(raw: Record<number, unknown>, sources: SourceFeed[]): Record<number, PinnedSource> {
  const result: Record<number, PinnedSource> = {};
  for (const [idx, val] of Object.entries(raw)) {
    const slotIndex = Number(idx);
    if (typeof val === 'string') {
      const source = matchSource(sources, val);
      if (source) {
        result[slotIndex] = { sourceKey: source.sourceKey, name: source.name, url: source.url };
      }
    } else if (val && typeof val === 'object' && 'sourceKey' in (val as Record<string, unknown>)) {
      result[slotIndex] = val as PinnedSource;
    }
  }
  return result;
}

export function ClientNewsFeed() {
  const [allSources, setAllSources] = useState<SourceFeed[]>([]);
  const [inventoryLoading, setInventoryLoading] = useState(true);
  const [inventoryError, setInventoryError] = useState(false);

  const [slots, setSlots] = useState<SlotData[]>(() => {
    const savedKeys = loadJSON<string[]>(STORAGE_KEY_SLOTS, []);
    const count = savedKeys.length || DEFAULT_SLOT_COUNT;
    return Array.from({ length: count }, () => ({ source: null, articles: [], loading: true, error: null }));
  });

  const [clusters, setClusters] = useState<NewsCluster[]>([]);
  const [trending, setTrending] = useState<string[]>([]);
  const [clusteringMod, setClusteringMod] = useState<{ clusterArticles: typeof clusterArticles; extractTrendingFromArticles: typeof extractTrendingFromArticles } | null>(null);
  const [pinnedSources, setPinnedSources] = useState<Record<number, PinnedSource>>(() => loadJSON<Record<number, PinnedSource>>(STORAGE_KEY_PINS, {}));
  const [skipToasts, setSkipToasts] = useState<SkipToast[]>([]);
  const [triedSources, setTriedSources] = useState<Record<number, string[]>>({});

  const activeTag = useRef<string | null>(
    typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('tag')
  );
  const [, forceUpdate] = useState(0);

  // Load inventory on mount (IDB cache first, then network)
  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let cancelled = false;
    let resolved = false;

    // Phase 0: Try IDB cache for instant load (skip inventory fetch if hit)
    idbGet<{ allSources: SourceFeed[] }>('news-inventory').then(cached => {
      if (cancelled || !cached?.data?.allSources?.length) return;
      resolved = true;
      const sources = cached.data.allSources;
      const { slots: builtSlots, pins: migratedPins } = restoreSlotState(sources);
      setAllSources(sources);
      setPinnedSources(migratedPins);
      setSlots(builtSlots);
      setInventoryLoading(false);

      const toFetch = builtSlots.filter(s => s.source).map(s => s.source!);
      if (toFetch.length > 0) {
        // ponytail: cacheGet (no TTL) — always serve stale articles, network revalidates
        cacheGet<BatchCacheEntry[]>(batchCacheKey(toFetch)).then(batchCached => {
          if (cancelled || !batchCached?.length) return;
          const cachedMap = new Map(batchCached.map(e => [e.sourceKey, e]));
          setSlots(prev => prev.map(slot => {
            if (!slot.source) return slot;
            const entry = cachedMap.get(slot.source.sourceKey);
            if (entry) return { ...slot, articles: entry.articles, loading: false, error: entry.error };
            return slot;
          }));
        });

        fetchBatch(toFetch).then(results => {
          if (cancelled) return;
          // ponytail: skip on total failure — preserve IDB-cached articles
          if (results.every(r => r.error && !r.articles.length)) return;
          applyBatchResults(results);
          saveBatchToIDB(toFetch, results);
          startAutoSkip(results, builtSlots, sources);
        });
      }
    });

    // Phase 1: Network fetch (always, for freshness)
    fetch('/api/news?mode=inventory', { signal: controller.signal })
      .then(r => {
        clearTimeout(timeout);
        return r.json();
      })
      .then(data => {
        if (cancelled) return;
        const sources: SourceFeed[] = data.allSources || [];
        idbSet('news-inventory', { allSources: sources }, CACHE_TTL);

        if (!resolved) {
          // First time: restore slots from fresh inventory
          const { slots: builtSlots, pins: migratedPins } = restoreSlotState(sources);
          setAllSources(sources);
          setPinnedSources(migratedPins);
          saveJSON(STORAGE_KEY_PINS, migratedPins);
          setSlots(builtSlots);
          setInventoryLoading(false);

          const toFetch = builtSlots.filter(s => s.source).map(s => s.source!);
          if (toFetch.length > 0) {
            // Try batch IDB cache for instant article render
            idbGet<BatchCacheEntry[]>(batchCacheKey(toFetch)).then(batchCached => {
              if (cancelled || !batchCached?.data) return;
              const cachedMap = new Map(batchCached.data.map(e => [e.sourceKey, e]));
              setSlots(prev => prev.map(slot => {
                if (!slot.source) return slot;
                const entry = cachedMap.get(slot.source.sourceKey);
                if (entry) return { ...slot, articles: entry.articles, loading: false, error: entry.error };
                return slot;
              }));
            });

            fetchBatch(toFetch).then(results => {
              if (cancelled) return;
              applyBatchResults(results);
              saveBatchToIDB(toFetch, results);
              startAutoSkip(results, builtSlots, sources);
            });
          }
        } else {
          // Already showing cached data, just update sources list in bg
          setAllSources(sources);
        }
      })
      .catch(() => {
        if (cancelled || resolved) return;
        setInventoryLoading(false);
        setInventoryError(true);
        setSlots(prev => prev.map(s => ({ ...s, loading: false })));
      });

    return () => { cancelled = true; clearTimeout(timeout); controller.abort(); };
  }, []);

  // Lazy-load clustering module (code-split)
  useEffect(() => {
    import('../../lib/clustering').then(mod => {
      setClusteringMod({ clusterArticles: mod.clusterArticles, extractTrendingFromArticles: mod.extractTrendingFromArticles });
    });
  }, []);

  // Recompute clusters + trending whenever slot articles change
  const allArticles = useMemo(() => {
    return slots.flatMap(s => s.articles);
  }, [slots]);

  useEffect(() => {
    if (!clusteringMod) return;
    if (allArticles.length > 0) {
      setClusters(clusteringMod.clusterArticles(allArticles));
      setTrending(clusteringMod.extractTrendingFromArticles(allArticles));
    } else {
      setClusters([]);
      setTrending([]);
    }
  }, [allArticles, clusteringMod]);

  // Persist slot keys whenever they change (only when real data exists)
  useEffect(() => {
    const keys = slots.map(s => s.source?.sourceKey ?? '');
    const hasRealData = keys.some(k => k !== '');
    if (hasRealData) {
      saveJSON(STORAGE_KEY_SLOTS, keys);
    }
  }, [slots]);

  // Persist pinned sources
  useEffect(() => {
    const hasPins = Object.keys(pinnedSources).length > 0;
    if (hasPins) {
      saveJSON(STORAGE_KEY_PINS, pinnedSources);
    }
  }, [pinnedSources]);

  async function fetchBatch(sources: SourceFeed[]): Promise<Array<{ name: string; articles: Article[]; error: string | null }>> {
    try {
      const res = await fetch('/api/news/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sources }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error');
      return (data.sourceResults || []).map((sr: SourceResult) => {
        const srcArticles: Article[] = (data.articles || []).filter(
          (a: Article) => a.source === sr.name
        );
        return {
          name: sr.name,
          articles: srcArticles,
          error: sr.success ? null : (sr.error || 'Error'),
        };
      });
    } catch (err) {
      return sources.map(s => ({ name: s.source || s.name, articles: [], error: err instanceof Error ? err.message : 'Error' }));
    }
  }

  function applyBatchResults(results: Array<{ name: string; articles: Article[]; error: string | null }>) {
    setSlots(prev => {
      const next = prev.map(slot => {
        if (!slot.source) return slot;
        const result = results.find(r => r.name === slot.source!.source);
        if (result) {
          return { ...slot, articles: result.articles, loading: false, error: result.error };
        }
        return { ...slot, loading: false, error: 'Sin respuesta del servidor' };
      });
      return next;
    });
  }

  function saveBatchToIDB(sources: SourceFeed[], results: Array<{ name: string; articles: Article[]; error: string | null }>) {
    const entries: BatchCacheEntry[] = sources.map((src, i) => ({
      sourceKey: src.sourceKey,
      articles: results[i]?.articles || [],
      error: results[i]?.error || null,
    }));
    cacheSet(batchCacheKey(sources), entries);
  }

  async function fetchSingleSourceFeed(source: SourceFeed): Promise<{ articles: Article[]; error: string | null }> {
    const idbKey = `news-source:${source.sourceKey}`;
    // ponytail: 3s IDB timeout — Edge Tracking Prevention can hang indexedDB.open()
    const cached = await Promise.race([
      idbGet<{ articles: Article[]; error: string | null }>(idbKey),
      new Promise<null>(r => setTimeout(() => r(null), 3000)),
    ]);
    if (cached?.data) return cached.data;

    try {
      const res = await fetch('/api/news/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sources: [{ url: source.url, name: source.name }] }),
        signal: AbortSignal.timeout(15000),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || 'Error');
      const result = { articles: data.articles || [], error: null };
      idbSet(idbKey, result, CACHE_BATCH_TTL);
      return result;
    } catch (err) {
      return { articles: [], error: err instanceof Error ? err.message : 'Error' };
    }
  }

  function getReplacements(failedIndices: number[], currentSlots: SlotData[], availableSources: SourceFeed[]): Map<number, SourceFeed> {
    const usedKeys = new Set(currentSlots.filter(s => s.source).map(s => s.source!.sourceKey));
    const replacements = new Map<number, SourceFeed>();
    for (const idx of failedIndices) {
      const next = availableSources.find(s => !usedKeys.has(s.sourceKey) && ![...replacements.values()].some(r => r.sourceKey === s.sourceKey));
      if (next) {
        usedKeys.add(next.sourceKey);
        replacements.set(idx, next);
      }
    }
    return replacements;
  }

  function startAutoSkip(results: Array<{ name: string; articles: Article[]; error: string | null }>, currentSlots: SlotData[], availableSources: SourceFeed[]) {
    const failedIndices: number[] = [];
    for (let i = 0; i < currentSlots.length; i++) {
      const slot = currentSlots[i];
      if (!slot.source) continue;
      const result = results.find(r => r.name === slot.source!.source);
      if (!result || (result.error && !result.articles.length)) {
        failedIndices.push(i);
      }
    }
    if (failedIndices.length === 0) return;

    const replacements = getReplacements(failedIndices, currentSlots, availableSources);
    if (replacements.size === 0) return;

    const newToasts: SkipToast[] = [];
    for (const [slotIndex, newSource] of replacements) {
      const slot = currentSlots[slotIndex];
      const toast: SkipToast = {
        slotIndex,
        oldName: slot.source?.name ?? '',
        newSource,
        countdown: SKIP_GRACE_SECONDS,
        pendingResult: null,
        cancelled: false,
      };
      newToasts.push(toast);

      fetchSingleSourceFeed(newSource).then(result => {
        setSkipToasts(prev => prev.map(t =>
          t.slotIndex === slotIndex && !t.cancelled
            ? { ...t, pendingResult: result }
            : t
        ));
      });
    }

    setSkipToasts(prev => [...prev, ...newToasts]);
  }

  function applySkip(slotIndex: number, source: SourceFeed, articles: Article[], error: string | null) {
    setSlots(prev => {
      const next = [...prev];
      next[slotIndex] = { source, articles, loading: false, error };
      return next;
    });
  }

  const handleSourceChange = useCallback(async (slotIndex: number, source: SourceFeed, isSkip?: boolean) => {
    const currentSlot = slots[slotIndex];

    if (isSkip && currentSlot?.source) {
      setTriedSources(prev => ({
        ...prev,
        [slotIndex]: [...new Set([...(prev[slotIndex] || []), currentSlot!.source!.sourceKey])]
      }));
    } else if (!isSkip) {
      setTriedSources(prev => {
        if (!prev[slotIndex]) return prev;
        const next = { ...prev };
        delete next[slotIndex];
        return next;
      });
    }

    setSlots(prev => {
      const next = [...prev];
      next[slotIndex] = { source, articles: [], loading: true, error: null };
      return next;
    });

    const result = await fetchSingleSourceFeed(source);
    setSlots(prev => {
      const next = [...prev];
      next[slotIndex] = { ...next[slotIndex], articles: result.articles, loading: false, error: result.error };
      return next;
    });
  }, [slots]);

  const handleRetrySlot = useCallback(async (slotIndex: number) => {
    const src = slots[slotIndex].source;
    if (!src) return;
    setSlots(prev => {
      const next = [...prev];
      next[slotIndex] = { ...next[slotIndex], loading: true, error: null };
      return next;
    });

    const result = await fetchSingleSourceFeed(src);
    setSlots(prev => {
      const next = [...prev];
      next[slotIndex] = { ...next[slotIndex], articles: result.articles, loading: false, error: result.error };
      return next;
    });
  }, [slots]);

  const handleClearSlot = useCallback((slotIndex: number) => {
    setSlots(prev => {
      const next = [...prev];
      next[slotIndex] = { source: null, articles: [], loading: false, error: null };
      return next;
    });
  }, []);

  const handleAddSlot = useCallback(async () => {
    let addedSource: SourceFeed | null = null;
    setSlots(prev => {
      if (prev.length >= MAX_SLOTS) return prev;
      const newIdx = prev.length;
      const pin = pinnedSources[newIdx];
      if (pin) {
        const source = matchSource(allSources, pin.sourceKey);
        if (source) { addedSource = source; return [...prev, { source, articles: [], loading: true, error: null }]; }
        if (pin.url) {
          const fallbackSource: SourceFeed = {
            sourceKey: pin.sourceKey,
            name: pin.name,
            url: pin.url,
            source: pin.name,
          };
          addedSource = fallbackSource;
          return [...prev, { source: fallbackSource, articles: [], loading: true, error: null, isFallback: true }];
        }
      }
      const seen = new Set(prev.map(s => s.source?.sourceKey).filter(Boolean));
      const unused = allSources.find(s => !seen.has(s.sourceKey));
      if (unused) addedSource = unused;
      return [...prev, { source: unused ?? null, articles: [], loading: !!unused, error: null }];
    });
    if (addedSource) {
      const result = await fetchSingleSourceFeed(addedSource);
      setSlots(prev => {
        // ponytail: don't require s.loading — applyBatchResults can clear it before we resolve
        const idx = prev.findIndex(s => s.source?.sourceKey === addedSource!.sourceKey);
        if (idx === -1) return prev;
        const next = [...prev];
        next[idx] = { ...next[idx], articles: result.articles, loading: false, error: result.error };
        return next;
      });
    }
  }, [allSources, pinnedSources]);

  const handleRemoveSlot = useCallback(() => {
    setSlots(prev => {
      if (prev.length <= MIN_SLOTS) return prev;
      return prev.slice(0, -1);
    });
  }, []);

  const handleTogglePin = useCallback((slotIndex: number, source: SourceFeed) => {
    setPinnedSources(prev => {
      const next = { ...prev };
      // If this source is pinned to another slot, move it
      for (const [idx, ps] of Object.entries(next)) {
        if (ps.sourceKey === source.sourceKey && Number(idx) !== slotIndex) {
          delete next[Number(idx)];
        }
      }
      // Toggle pin for this slot
      if (next[slotIndex]?.sourceKey === source.sourceKey) {
        delete next[slotIndex];
      } else {
        next[slotIndex] = { sourceKey: source.sourceKey, name: source.name, url: source.url };
      }
      return next;
    });
  }, []);

  const handleRetry = useCallback(() => {
      setTriedSources({});
      setSlots(prev => prev.map(s => s.source ? { ...s, loading: true, error: null } : s));
      const toFetch = slots.filter(s => s.source).map(s => s.source!);
    if (toFetch.length > 0) {
      fetchBatch(toFetch).then(results => {
        applyBatchResults(results);
        saveBatchToIDB(toFetch, results);
        startAutoSkip(results, slots, allSources);
      });
    }
  }, [slots]);

  // Tag filter events
  useEffect(() => {
    const handler = () => {
      const tag = new URLSearchParams(window.location.search).get('tag');
      activeTag.current = tag;
      forceUpdate(n => n + 1);
    };
    window.addEventListener('tagchange', handler);
    window.addEventListener('popstate', handler);
    return () => {
      window.removeEventListener('tagchange', handler);
      window.removeEventListener('popstate', handler);
    };
  }, []);

  // Skip toast countdown
  useEffect(() => {
    if (skipToasts.length === 0) return;
    const interval = setInterval(() => {
      setSkipToasts(prev => {
        const next: SkipToast[] = [];
        for (const t of prev) {
          if (t.cancelled) continue;
          if (t.countdown <= 1 && t.pendingResult) {
            queueMicrotask(() => {
              applySkip(t.slotIndex, t.newSource, t.pendingResult!.articles, t.pendingResult!.error);
            });
            continue;
          }
          if (t.countdown <= 1 && !t.pendingResult) {
            next.push({ ...t, countdown: 0 });
          } else {
            next.push({ ...t, countdown: t.countdown - 1 });
          }
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [skipToasts.length]);

  function cancelSkip(slotIndex: number) {
    setSkipToasts(prev => prev.filter(t => t.slotIndex !== slotIndex));
  }

  const handleCancelSkip = useCallback((slotIndex: number) => {
    setSkipToasts(prev => prev.filter(t => t.slotIndex !== slotIndex));
  }, []);

  const initialLoading = inventoryLoading || (slots.some(s => s.loading) && slots.every(s => !s.articles.length));
  const flatSourceResults: SourceResult[] = useMemo(() => {
    return slots
      .filter(s => s.source && !s.loading)
      .map(s => ({
        name: s.source!.name,
        url: s.source!.url,
        success: s.error === null && s.articles.length > 0,
        articlesCount: s.articles.length,
        error: s.error ?? undefined,
      }));
  }, [slots]);

  const usedSourceKeys = useMemo(() => {
    return new Set(slots.filter(s => s.source).map(s => s.source!.sourceKey));
  }, [slots]);

  return (
    <div className="space-y-3">
      <NewsFeed
        clusters={clusters}
        articles={allArticles}
        sourceResults={flatSourceResults}
        trending={trending}
        allSources={allSources}
        activeTag={activeTag.current}
        loading={initialLoading}
        inventoryError={inventoryError}
        onRetry={handleRetry}
        slots={slots}
        usedSourceKeys={usedSourceKeys}
        pinnedSources={pinnedSources}
        triedSources={triedSources}
        onSourceChange={handleSourceChange}
        onRetrySlot={handleRetrySlot}
        onClearSlot={handleClearSlot}
        onTogglePin={handleTogglePin}
        onAddSlot={handleAddSlot}
        onRemoveSlot={handleRemoveSlot}
        slotCount={slots.length}
        skipToasts={skipToasts}
        onCancelSkip={handleCancelSkip}
      />
    </div>
  );
}
