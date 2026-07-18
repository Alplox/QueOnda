import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import type { Channel } from '../../types';
import { ChannelSelector } from './ChannelSelector';
import { ChannelGrid } from './ChannelGrid';
import { UnifiedPlayer } from './UnifiedPlayer';
import { MultiviewGrid } from './MultiviewGrid';
import type { MultiviewLayout } from './MultiviewGrid';
import { maxSlots } from './MultiviewGrid';
import { Emoji } from '../Emoji';
import { play } from '@/lib/sound';
import { idbGet, idbSet } from '@/lib/idb-cache';

const IDB_KEY = 'tv-channels';
const IDB_TTL = 24 * 60 * 60 * 1000; // 24 hours

function loadFavorites(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem('tv-favorites') || '[]')); } catch { return new Set(); }
}

function saveFavorites(favs: Set<string>) {
  localStorage.setItem('tv-favorites', JSON.stringify([...favs]));
}

async function fetchChannelsApi(source: 'json-teles' | 'iptv-org'): Promise<{ channels: Channel[]; categories: string[] } | null> {
  try {
    const r = await fetch(`/api/channels?source=${source}`, { signal: AbortSignal.timeout(10000) });
    if (r.ok) return await r.json();
  } catch {}
  return null;
}

export function ClientTV() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [categories, setCategories] = useState<string[]>(['todas']);
  const [selectedCat, setSelectedCat] = useState('todas');
  const [favorites, setFavorites] = useState<Set<string>>(() => loadFavorites());
  const [showFavorites, setShowFavorites] = useState(false);
  const [player, setPlayer] = useState<{ channel: Channel; signalIndex: number; mode: 'inline' | 'pip' } | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [autoPipEnabled, setAutoPipEnabled] = useState(() => {
    try { return localStorage.getItem('tv-auto-pip') !== 'false'; } catch { return true; }
  });
  const sectionRef = useRef<HTMLDivElement>(null);
  const sectionEverVisibleRef = useRef(false);
  const playerRef = useRef(player);
  const autoPipRef = useRef(true);
  const [importMethod, setImportMethod] = useState<'file' | 'url' | 'text'>('file');
  const [urlInput, setUrlInput] = useState('');
  const [textInput, setTextInput] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  // Multiview state
  const [viewMode, setViewMode] = useState<'single' | 'multiview'>(() => {
    try { return localStorage.getItem('tv-view-mode') === 'multiview' ? 'multiview' : 'single'; } catch { return 'single'; }
  });
  const [multiviewLayout, setMultiviewLayout] = useState<MultiviewLayout>(() => {
    try { const v = localStorage.getItem('tv-multiview-layout'); return v === '2x3' || v === '3x3' || v === '1x3' ? v : '2x2'; } catch { return '2x2'; }
  });
  const [multiviewSlots, setMultiviewSlots] = useState<Array<{ channel: Channel; signalIndex: number }>>(() => {
    try { return JSON.parse(localStorage.getItem('tv-multiview-slots') || '[]'); } catch { return []; }
  });
  const [focusedSlot, setFocusedSlot] = useState<number | null>(null);
  const multiviewGridRef = useRef<HTMLDivElement>(null);
  const dragChannelRef = useRef<{ ch: Channel; ghost: HTMLElement; pointerId: number } | null>(null);

  playerRef.current = player;
  autoPipRef.current = autoPipEnabled;

  const [source, setSource] = useState<'json-teles' | 'iptv-org' | 'custom'>(() => {
    try { const s = localStorage.getItem('tv-source'); return s === 'iptv-org' || s === 'custom' ? s : 'json-teles'; } catch { return 'json-teles'; }
  });
  const [customChannels, setCustomChannels] = useState<Channel[]>(() => {
    try { return JSON.parse(localStorage.getItem('tv-custom-channels') || '[]'); } catch { return []; }
  });

  function parseCustomM3U(text: string): Channel[] {
    const result: Channel[] = [];
    const lines = text.split('\n');
    const seen = new Set<string>();
    let idx = 0;
    let cur: Partial<Channel> | null = null;
    function uniqueId(raw: string): string {
      let id = raw, i = 1;
      while (seen.has(id)) id = `${raw}-${i++}`;
      seen.add(id);
      return id;
    }
    for (const line of lines) {
      const t = line.trim();
      if (t.startsWith('#EXTINF:')) {
        const rawId = t.match(/tvg-id="([^"]*)"/)?.[1] || `custom-${idx}`;
        cur = {
          id: uniqueId(rawId),
          name: t.match(/,([^,]+)$/)?.[1]?.trim() || 'Unknown',
          logo: t.match(/tvg-logo="([^"]*)"/)?.[1] || null,
          category: t.match(/group-title="([^"]*)"/)?.[1] || 'general',
          signals: [], youtube: null, twitch: null, website: '',
        };
      } else if (t && !t.startsWith('#') && cur) {
        cur.signals = [{ type: 'm3u8', url: t }];
        result.push({ id: cur.id || `custom-${result.length}`, name: cur.name || 'Unknown', logo: cur.logo || null, signals: cur.signals, youtube: null, twitch: null, website: '', category: cur.category || 'general' });
        cur = null; idx++;
      }
    }
    return result;
  }

  function applyCustomChannels(parsed: Channel[]) {
    if (parsed.length === 0) {
      setImportError('No se encontraron canales en la lista.');
      return;
    }
    setCustomChannels(parsed);
    localStorage.setItem('tv-custom-channels', JSON.stringify(parsed));
    setChannels(parsed);
    const cats = ['todas', ...new Set(parsed.map((c) => c.category).filter(Boolean))];
    setCategories(cats);
    setImportError(null);
    setImportMethod('file');
  }

  const handleSourceChange = useCallback((s: typeof source) => {
    setSource(s);
    localStorage.setItem('tv-source', s);
    setPlayer(null);
    setImportError(null);
    if (s === 'custom') {
      setChannels(customChannels);
      const cats = ['todas', ...new Set(customChannels.map((c) => c.category).filter(Boolean))];
      setCategories(cats);
      setLoading(false);
    }
    // actual fetch happens in the useEffect watching `source`
  }, [customChannels]);

  const handleFileImport = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportError(null);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      applyCustomChannels(parseCustomM3U(text));
    };
    reader.readAsText(file);
    e.target.value = '';
  }, []);

  const handleURLImport = useCallback(async () => {
    const u = urlInput.trim();
    if (!u) { setImportError('Ingresa una URL.'); return; }
    setImporting(true);
    setImportError(null);
    try {
      const res = await fetch(u);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      applyCustomChannels(parseCustomM3U(text));
      setUrlInput('');
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Error al obtener la URL');
    } finally {
      setImporting(false);
    }
  }, [urlInput]);

  const handleTextImport = useCallback(() => {
    const t = textInput.trim();
    if (!t) { setImportError('Pega el contenido de la lista M3U.'); return; }
    setImportError(null);
    applyCustomChannels(parseCustomM3U(t));
    setTextInput('');
  }, [textInput]);

  const handleClearCustom = useCallback(() => {
    localStorage.removeItem('tv-custom-channels');
    setCustomChannels([]);
    setChannels([]);
    setCategories(['todas']);
    setPlayer(null);
    setSearch('');
  }, []);

  useEffect(() => {
    if (source === 'custom') {
      setChannels(customChannels);
      const cats = ['todas', ...new Set(customChannels.map((c) => c.category).filter(Boolean))];
      setCategories(cats);
      setLoading(false);
      return;
    }

    const idbKey = source === 'iptv-org' ? `${IDB_KEY}:iptv` : IDB_KEY;
    let cancelled = false;
    let resolved = false;

    type TVCache = { channels: Channel[]; categories: string[] };

    // Phase 0: IDB cache → instant render
    idbGet<TVCache>(idbKey).then(cached => {
      if (cancelled || !cached?.data?.channels?.length) return;
      resolved = true;
      setChannels(cached.data.channels);
      setCategories(cached.data.categories);
      setLoading(false);
    });

    // Phase 1: background fetch → update (server-cached endpoint)
    async function loadChannels() {
      const apiSource = source === 'iptv-org' ? 'iptv-org' : 'json-teles';
      const data = await fetchChannelsApi(apiSource);
      if (cancelled || !data?.channels) return;
      idbSet(idbKey, { channels: data.channels, categories: data.categories }, IDB_TTL);
      setChannels(data.channels);
      setCategories(data.categories);
      if (!resolved) setLoading(false);
      resolved = true;
    }

    loadChannels();
    return () => { cancelled = true; };
  }, [source, customChannels]);

  const counts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const ch of channels) {
      const cat = ch.category || 'todas';
      map[cat] = (map[cat] || 0) + 1;
    }
    map['todas'] = channels.length;
    map['__favorites__'] = [...favorites].filter((id) => channels.some((ch) => ch.id === id)).length;
    return map;
  }, [channels, favorites]);

  const filtered = useMemo(() => {
    let list = channels;
    if (showFavorites) list = list.filter((ch) => favorites.has(ch.id));
    else if (selectedCat !== 'todas') list = list.filter((ch) => ch.category === selectedCat);
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      list = list.filter((ch) => ch.name.toLowerCase().includes(q));
    }
    return list;
  }, [channels, selectedCat, favorites, showFavorites, search]);

  // Auto-PiP observer
  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          sectionEverVisibleRef.current = true;
        }
        if (
          !entry.isIntersecting &&
          autoPipRef.current &&
          sectionEverVisibleRef.current &&
          playerRef.current?.mode === 'inline'
        ) {
          setPlayer((prev) => prev ? { ...prev, mode: 'pip' } : null);
        }
      },
      { threshold: 0 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Persist autoPip preference
  useEffect(() => {
    localStorage.setItem('tv-auto-pip', String(autoPipEnabled));
  }, [autoPipEnabled]);

  // Persist multiview state
  useEffect(() => { localStorage.setItem('tv-view-mode', viewMode); }, [viewMode]);
  useEffect(() => { localStorage.setItem('tv-multiview-layout', multiviewLayout); }, [multiviewLayout]);
  useEffect(() => { localStorage.setItem('tv-multiview-slots', JSON.stringify(multiviewSlots)); }, [multiviewSlots]);

  // Truncate slots when layout shrinks
  useEffect(() => {
    const max = maxSlots(multiviewLayout);
    setMultiviewSlots(prev => prev.slice(0, max));
    setFocusedSlot(prev => prev !== null && prev >= max ? null : prev);
  }, [multiviewLayout]);

  // Multiview handlers
  const handleToggleViewMode = useCallback(() => {
    play('interaction.tap');
    setViewMode(prev => {
      const next = prev === 'single' ? 'multiview' : 'single';
      if (next === 'single') {
        setPlayer(null);
        setFocusedSlot(null);
      }
      return next;
    });
  }, []);

  const handleAddToMultiview = useCallback((ch: Channel) => {
    play('interaction.tap');
    let removed = false;
    let swapIndex = -1;
    setMultiviewSlots(prev => {
      const existing = prev.findIndex(s => s.channel.id === ch.id);
      if (existing !== -1) {
        removed = true;
        return prev.filter((_, i) => i !== existing);
      }
      const max = maxSlots(multiviewLayout);
      if (prev.length < max) return [...prev, { channel: ch, signalIndex: 0 }];
      // full: replace focused slot, or last slot
      const target = focusedSlot !== null && focusedSlot < prev.length ? focusedSlot : prev.length - 1;
      swapIndex = target;
      const next = [...prev];
      next[target] = { channel: ch, signalIndex: 0 };
      return next;
    });
    if (removed) setFocusedSlot(null);
  }, [multiviewLayout, focusedSlot]);

  const handleRemoveFromMultiview = useCallback((index: number) => {
    setMultiviewSlots(prev => prev.filter((_, i) => i !== index));
    setFocusedSlot(prev => {
      if (prev === index) return null;
      if (prev !== null && prev > index) return prev - 1;
      return prev;
    });
  }, []);

  const handleFocusSlot = useCallback((index: number) => {
    setFocusedSlot(prev => prev === index ? null : index);
  }, []);

  const handleReorderSlots = useCallback((fromIndex: number, toIndex: number) => {
    setMultiviewSlots(prev => {
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
    setFocusedSlot(prev => {
      if (prev === null) return null;
      if (prev === fromIndex) return toIndex;
      if (fromIndex < toIndex) {
        if (prev > fromIndex && prev <= toIndex) return prev - 1;
      } else {
        if (prev >= toIndex && prev < fromIndex) return prev + 1;
      }
      return prev;
    });
  }, []);

  const handleMultiviewSignalChange = useCallback((index: number, signalIndex: number) => {
    setMultiviewSlots(prev => prev.map((s, i) => i === index ? { ...s, signalIndex } : s));
  }, []);

  const handleDragChannelStart = useCallback((ch: Channel, e: React.PointerEvent) => {
    if (viewMode !== 'multiview') return;
    e.preventDefault();
    const ghost = document.createElement('div');
    ghost.className = 'fixed z-[9999] w-20 h-20 rounded-xl bg-primary/80 text-primary-content flex items-center justify-center text-[9px] font-bold shadow-2xl pointer-events-none';
    ghost.textContent = ch.name.slice(0, 20);
    ghost.style.left = `${e.clientX - 40}px`;
    ghost.style.top = `${e.clientY - 40}px`;
    document.body.appendChild(ghost);
    dragChannelRef.current = { ch, ghost, pointerId: e.pointerId };

    const onMove = (ev: PointerEvent) => {
      if (!dragChannelRef.current) return;
      dragChannelRef.current.ghost.style.left = `${ev.clientX - 40}px`;
      dragChannelRef.current.ghost.style.top = `${ev.clientY - 40}px`;
    };
    const onUp = (ev: PointerEvent) => {
      if (!dragChannelRef.current) return;
      dragChannelRef.current.ghost.remove();
      const chDropped = dragChannelRef.current.ch;
      dragChannelRef.current = null;
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const slotEl = el?.closest('[data-slot-index]');
      if (slotEl) {
        const idx = parseInt(slotEl.getAttribute('data-slot-index') ?? '', 10);
        if (!isNaN(idx)) {
          setMultiviewSlots(prev => {
            const existing = prev.findIndex(s => s.channel.id === chDropped.id);
            if (existing !== -1) return prev;
            const max = maxSlots(multiviewLayout);
            if (prev.length >= max) {
              const next = [...prev];
              next[idx] = { channel: chDropped, signalIndex: 0 };
              return next;
            }
            if (idx <= prev.length) {
              const next = [...prev];
              next.splice(idx, 0, { channel: chDropped, signalIndex: 0 });
              return next.slice(0, max);
            }
            return [...prev, { channel: chDropped, signalIndex: 0 }];
          });
          play('interaction.confirm');
        }
      }
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
  }, [viewMode, multiviewLayout]);

  const handleSelect = useCallback((ch: Channel) => {
    if (viewMode === 'multiview') {
      handleAddToMultiview(ch);
      return;
    }
    setPlayer((prev) => {
      if (prev && prev.channel.id === ch.id && prev.mode === 'inline') return null;
      return { channel: ch, signalIndex: 0, mode: 'inline' };
    });
  }, [viewMode, handleAddToMultiview]);

  const toggleFavorite = useCallback((id: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      saveFavorites(next);
      return next;
    });
  }, []);

  const handleModeChange = useCallback((newMode: 'inline' | 'pip') => {
    setPlayer((prev) => prev ? { ...prev, mode: newMode } : null);
    if (newMode === 'inline') {
      play('overlay.expand');
      sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      play('overlay.collapse');
    }
  }, []);

  const handleClose = useCallback(() => { play('overlay.close'); setPlayer(null); }, []);

  const handleSelectCategory = useCallback((cat: string) => {
    if (cat === '__favorites__') {
      setShowFavorites(true);
      setSelectedCat('todas');
    } else {
      setShowFavorites(false);
      setSelectedCat(cat);
    }
  }, []);

  const allCats = ['todas', '__favorites__', ...categories.filter(c => c !== 'todas')];

  const isEmptyCustom = source === 'custom' && channels.length === 0;

  return (
    <div ref={sectionRef} id="seccion-tv" className="space-y-2">
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
        </div>
      ) : (
        <>
      {/* Search */}
      <div className="relative">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="absolute left-2.5 top-1/2 -translate-y-1/2 text-base-content/70 pointer-events-none">
          <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
        </svg>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar canales..."
          className="w-full bg-base-100 border border-base-300 rounded-lg pl-8 pr-3 py-2 text-xs text-base-content placeholder-base-content/50 outline-none focus:border-primary/40 transition-colors"
        />
        {search && (
          <button onClick={() => { play('interaction.subtle'); setSearch(''); }} aria-label="Limpiar búsqueda" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-base-content/70 hover:text-base-content/70 transition-colors cursor-pointer">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        )}
      </div>

      {/* Source selector */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {(['json-teles', 'iptv-org', 'custom'] as const).map((s) => (
          <button key={s} onClick={() => handleSourceChange(s)}
            className={`text-[10px] px-2 py-1 rounded-md transition-colors cursor-pointer ${
              source === s ? 'bg-primary/15 text-primary font-medium' : 'text-base-content/50 hover:text-base-content/70'
            }`}>
            {s === 'json-teles' ? 'json-teles' : s === 'iptv-org' ? 'iptv-org' : 'Lista M3U'}
          </button>
        ))}
        {source === 'custom' && customChannels.length > 0 && (
          <div className="flex items-center gap-1 ml-auto">
            <button onClick={handleClearCustom}
              className="text-[10px] px-2 py-1 rounded-md text-base-content/50 hover:text-error hover:bg-error/10 transition-colors cursor-pointer flex items-center gap-1">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" /></svg>
              Quitar lista
            </button>
          </div>
        )}
      </div>

      {isEmptyCustom ? (
        /* Empty state — import panel */
        <div className="rounded-xl bg-base-100 border border-base-300 p-5">
          <div className="max-w-lg mx-auto">
            <p className="text-xs text-base-content/50 text-center mb-4">
              Aún no has cargado una lista M3U personalizada.
            </p>

            {/* Method tabs */}
            <div className="flex gap-1 mb-4 justify-center">
              {(['file', 'url', 'text'] as const).map((m) => (
                <button key={m} onClick={() => { setImportMethod(m); setImportError(null); }}
                  className={`text-[11px] px-3 py-1.5 rounded-md transition-colors cursor-pointer ${
                    importMethod === m ? 'bg-primary/15 text-primary font-medium' : 'text-base-content/50 hover:text-base-content/70'
                  }`}>
                  {m === 'file' ? <><Emoji emoji="📁" /> Archivo</> : m === 'url' ? <><Emoji emoji="🔗" /> URL</> : <><Emoji emoji="📝" /> Texto</>}
                </button>
              ))}
            </div>

            {/* Tab content */}
            {importMethod === 'file' && (
              <label className="flex flex-col items-center gap-2 py-6 px-4 rounded-lg border-2 border-dashed border-base-300 hover:border-primary/40 cursor-pointer transition-colors">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-base-content/40">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" />
                </svg>
                <span className="text-xs text-base-content/70">Seleccionar archivo .m3u</span>
                <span className="text-[10px] text-base-content/50">o arrastra el archivo aquí</span>
                <input type="file" accept=".m3u,.m3u8" onChange={handleFileImport} className="hidden" />
              </label>
            )}

            {importMethod === 'url' && (
              <div className="space-y-2">
                <input type="url" value={urlInput} onChange={(e) => setUrlInput(e.target.value)}
                  placeholder="https://ejemplo.com/lista.m3u"
                  className="w-full bg-base-200 border border-base-300 rounded-lg px-3 py-2 text-xs text-base-content placeholder-base-content/50 outline-none focus:border-primary/40 transition-colors" />
                <button onClick={handleURLImport} disabled={importing}
                  className="w-full text-[11px] px-3 py-1.5 rounded-md bg-primary/15 text-primary hover:bg-primary/25 disabled:opacity-50 transition-colors cursor-pointer">
                  {importing ? 'Obteniendo...' : 'Obtener lista'}
                </button>
              </div>
            )}

            {importMethod === 'text' && (
              <div className="space-y-2">
                <textarea value={textInput} onChange={(e) => setTextInput(e.target.value)} rows={6}
                  placeholder="Pega aquí el contenido del archivo M3U..."
                  className="w-full bg-base-200 border border-base-300 rounded-lg px-3 py-2 text-xs text-base-content placeholder-base-content/50 outline-none focus:border-primary/40 transition-colors resize-y" />
                <button onClick={handleTextImport}
                  className="w-full text-[11px] px-3 py-1.5 rounded-md bg-primary/15 text-primary hover:bg-primary/25 transition-colors cursor-pointer">
                  Cargar lista
                </button>
              </div>
            )}

            {importError && (
              <p className="mt-3 text-[10px] text-error text-center">{importError}</p>
            )}

            <p className="mt-4 text-[9px] text-base-content/40 text-center leading-relaxed">
              Formatos soportados: M3U y M3U8. Si la URL falla por CORS, usa la opción Texto para pegar el contenido directamente.
            </p>
          </div>
        </div>
      ) : (
        <>
          {/* Category filter (hidden when custom empty) */}
          {source !== 'custom' && (
            <ChannelSelector
              categories={allCats}
              counts={counts}
              selected={showFavorites ? '__favorites__' : selectedCat}
              onSelect={handleSelectCategory}
            />
          )}

          {/* View mode toggle */}
          <div className="flex items-center gap-1.5">
            <button onClick={handleToggleViewMode}
              className={`flex items-center gap-1.5 text-[10px] px-2.5 py-1.5 rounded-lg transition-all cursor-pointer ${
                viewMode === 'multiview'
                  ? 'bg-primary/15 text-primary font-medium'
                  : 'text-base-content/50 hover:text-base-content/70 hover:bg-base-content/[0.04]'
              }`}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
              </svg>
              Multi
            </button>
            {viewMode === 'multiview' && (
              <div className="flex items-center gap-0.5 ml-1">
                {(['1x3', '2x2', '2x3', '3x3'] as const).map((l) => (
                  <button key={l} onClick={() => { play('interaction.tap'); setMultiviewLayout(l); }}
                    className={`text-[9px] px-1.5 py-1 rounded transition-colors cursor-pointer ${
                      multiviewLayout === l ? 'bg-primary/15 text-primary font-medium' : 'text-base-content/50 hover:text-base-content/70'
                    }`}>
                    {l}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Row label + count */}
          <div className="flex items-center justify-between px-0.5">
            <p className="text-[9px] text-base-content/70 font-medium uppercase tracking-wider">
              {showFavorites ? 'Favoritos' : selectedCat === 'todas' ? 'Canales' : selectedCat}
              {' '}· {filtered.length}
            </p>
            {(selectedCat !== 'todas' || showFavorites) && (
              <button onClick={() => { play('navigation.tab'); setSelectedCat('todas'); setShowFavorites(false); }}
                className="text-[9px] text-base-content/70 hover:text-base-content transition-colors cursor-pointer">
                Ver todos
              </button>
            )}
          </div>

          {/* Horizontal scrollable channel row */}
          <div key={`${selectedCat}-${showFavorites}-${search}`} className="transition-opacity duration-200">
            <ChannelGrid
              channels={filtered}
              selectedIds={viewMode === 'multiview' ? multiviewSlots.map(s => s.channel.id) : (player ? [player.channel.id] : [])}
              favorites={favorites}
              onSelect={handleSelect}
              onToggleFavorite={toggleFavorite}
              onDragChannelStart={viewMode === 'multiview' ? handleDragChannelStart : undefined}
            />
          </div>

          {/* Player */}
          {viewMode === 'multiview' ? (
            <MultiviewGrid
              slots={multiviewSlots}
              layout={multiviewLayout}
              focusedSlot={focusedSlot}
              onFocus={handleFocusSlot}
              onRemove={handleRemoveFromMultiview}
              onSignalChange={handleMultiviewSignalChange}
              onReorder={handleReorderSlots}
            />
          ) : player ? (
            <UnifiedPlayer
              channel={player.channel}
              signalIndex={player.signalIndex}
              onSignalChange={(index) => setPlayer((prev) => prev ? { ...prev, signalIndex: index } : null)}
              mode={player.mode}
              onModeChange={handleModeChange}
              onClose={handleClose}
              autoPipEnabled={autoPipEnabled}
              onToggleAutoPip={() => setAutoPipEnabled((v) => !v)}
            />
          ) : (
            <div className="relative rounded-xl bg-base-100 border border-base-300">
              <div className="flex items-center gap-2.5 px-3 py-2 bg-base-100/95 backdrop-blur-sm border-b border-base-300 rounded-t-xl">
                <div className="flex-1 min-w-0 flex items-center gap-2">
                  <span className="text-xs text-base-content/40 font-medium">Selecciona un canal</span>
                </div>
              </div>
              <div className="aspect-video rounded-b-xl bg-neutral flex items-center justify-center">
                <div className="text-center">
                  <div className="w-10 h-10 mx-auto mb-2 rounded-full bg-base-200/80 flex items-center justify-center">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-base-content/70">
                      <rect x="2" y="4" width="20" height="16" rx="2" /><path d="M10 10l4 2-4 2v-4z" />
                    </svg>
                  </div>
                  <p className="text-[10px] text-neutral-content">Selecciona un canal para ver</p>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      <div className="mt-2 text-right text-[10px] text-base-content/70">
        Fuente:{' '}
        {source === 'json-teles' ? (
          <a href="https://github.com/Alplox/json-teles" target="_blank" rel="noopener noreferrer" className="hover:text-base-content underline underline-offset-2 transition-colors">json-teles</a>
        ) : source === 'iptv-org' ? (
          <a href="https://github.com/iptv-org/iptv" target="_blank" rel="noopener noreferrer" className="hover:text-base-content underline underline-offset-2 transition-colors">iptv-org</a>
        ) : (
          <span className="text-base-content/50">Lista personalizada</span>
        )}
      </div>
        </>
      )}
    </div>
  );
}
