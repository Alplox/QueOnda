import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import type { Channel } from '../../types';
import { ChannelSelector } from './ChannelSelector';
import { ChannelGrid } from './ChannelGrid';
import { UnifiedPlayer } from './UnifiedPlayer';
import { SectionSources } from '../SectionSources';
import { MultiviewGrid } from './MultiviewGrid';
import type { MultiviewLayout } from './MultiviewGrid';
import { maxSlots } from './MultiviewGrid';
import { Emoji } from '../Emoji';
import { play } from '@/lib/sound';
import { idbGet, idbSet } from '@/lib/idb-cache';

const IDB_KEY = 'tv-channels';
const IDB_TTL = 24 * 60 * 60 * 1000; // 24 hours

/** Where the player/multiview block sits relative to the channel grid. */
type PlayerPlacement = 'below' | 'above' | 'left' | 'right';

const SIDE_PLACEMENTS: PlayerPlacement[] = ['left', 'right'];

const PLACEMENT_OPTIONS: Array<{ id: PlayerPlacement; label: string; title: string; dividerBefore?: boolean; icon: React.ReactNode }> = [
  {
    id: 'above',
    label: 'Reproductor arriba de los canales',
    title: 'Reproductor arriba',
    icon: (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="3" width="18" height="9" rx="1.5" fill="currentColor" stroke="none" />
        <path d="M4 16.5h16M4 20.5h10" />
      </svg>
    ),
  },
  {
    id: 'below',
    label: 'Reproductor debajo de los canales',
    title: 'Reproductor debajo',
    icon: (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 3.5h16M4 7.5h10" />
        <rect x="3" y="12" width="18" height="9" rx="1.5" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  {
    id: 'left',
    label: 'Reproductor a la izquierda de los canales',
    title: 'Reproductor a la izquierda (escritorio)',
    dividerBefore: true,
    icon: (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="3" width="10" height="18" rx="1.5" fill="currentColor" stroke="none" />
        <path d="M17 5h4M17 9h4M17 13h4M17 17h4" />
      </svg>
    ),
  },
  {
    id: 'right',
    label: 'Reproductor a la derecha de los canales',
    title: 'Reproductor a la derecha (escritorio)',
    icon: (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="11" y="3" width="10" height="18" rx="1.5" fill="currentColor" stroke="none" />
        <path d="M3 5h4M3 9h4M3 13h4M3 17h4" />
      </svg>
    ),
  },
];

/** `lg` breakpoint (1024px) — the side-by-side layouts only exist on desktop. */
function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return isDesktop;
}

/** Selector de ubicación del reproductor — vive dentro del propio reproductor. */
function PlacementPicker({ value, allowSide, onChange }: { value: PlayerPlacement; allowSide: boolean; onChange: (p: PlayerPlacement) => void }) {
  const options = PLACEMENT_OPTIONS.filter((o) => allowSide || !SIDE_PLACEMENTS.includes(o.id));
  return (
    <div className="flex items-center gap-0.5" role="group" aria-label="Ubicación del reproductor">
      {options.map((o) => (
        <span key={o.id} className="flex items-center gap-0.5">
          {o.dividerBefore && <span className="w-px h-3.5 bg-base-300 mx-0.5" aria-hidden="true" />}
          <button type="button" onClick={() => { play('navigation.tab'); onChange(o.id); }}
            aria-pressed={value === o.id}
            aria-label={o.label}
            title={o.title}
            className={`w-6 h-6 flex items-center justify-center rounded transition-colors cursor-pointer ${
              value === o.id
                ? 'bg-primary/15 text-primary'
                : 'text-base-content/70 hover:text-base-content hover:bg-base-300'
            }`}>
            {o.icon}
          </button>
        </span>
      ))}
    </div>
  );
}

function loadFavorites(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem('tv-favorites') || '[]')); } catch { return new Set(); }
}

function saveFavorites(favs: Set<string>) {
  localStorage.setItem('tv-favorites', JSON.stringify([...favs]));
}

async function fetchChannelsApi(source: 'json-teles' | 'iptv-org' | 'mi-iptv'): Promise<{ channels: Channel[]; categories: string[] } | null> {
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
  const [gridRows, setGridRows] = useState<number>(() => {
    try { const v = parseInt(localStorage.getItem('tv-grid-rows') || '', 10); return v >= 1 && v <= 5 ? v : 1; } catch { return 1; }
  });
  const [sortOrder, setSortOrder] = useState<'default' | 'az' | 'za'>(() => {
    try { const v = localStorage.getItem('tv-sort'); return v === 'az' || v === 'za' ? v : 'default'; } catch { return 'default'; }
  });
  const [autoPipEnabled, setAutoPipEnabled] = useState(() => {
    try { return localStorage.getItem('tv-auto-pip') !== 'false'; } catch { return true; }
  });
  const [playerPlacement, setPlayerPlacement] = useState<PlayerPlacement>(() => {
    try {
      const v = localStorage.getItem('tv-player-placement');
      // `side` fue el valor antiguo (solo izquierda) — se migra a `left`.
      if (v === 'side') return 'left';
      return v === 'above' || v === 'left' || v === 'right' ? v : 'below';
    } catch { return 'below'; }
  });
  const isDesktop = useIsDesktop();
  const sectionRef = useRef<HTMLDivElement>(null);
  const sectionEverVisibleRef = useRef(false);
  const playerRef = useRef(player);
  const autoPipRef = useRef(true);
  const [importMethod, setImportMethod] = useState<'file' | 'url' | 'text'>('file');
  const [urlInput, setUrlInput] = useState('');
  const [textInput, setTextInput] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  // Placeholder sin canal: completo por defecto (la primera carga), compacto si el usuario lo pide.
  const [placeholderCompact, setPlaceholderCompact] = useState(() => {
    try { return localStorage.getItem('tv-placeholder-compact') === 'true'; } catch { return false; }
  });

  // Multiview state
  const [viewMode, setViewMode] = useState<'single' | 'multiview'>(() => {
    try { return localStorage.getItem('tv-view-mode') === 'multiview' ? 'multiview' : 'single'; } catch { return 'single'; }
  });
  const [multiviewLayout, setMultiviewLayout] = useState<MultiviewLayout>(() => {
    try {
      const v = localStorage.getItem('tv-multiview-layout');
      if (v === '1x1' || v === '1x2' || v === '1x3' || v === '2x2' || v === '2x3' || v === '3x3') return v;
      return '2x2';
    } catch { return '2x2'; }
  });
  const [multiviewSlots, setMultiviewSlots] = useState<Array<{ channel: Channel; signalIndex: number }>>(() => {
    try { return JSON.parse(localStorage.getItem('tv-multiview-slots') || '[]'); } catch { return []; }
  });
  const [focusedSlot, setFocusedSlot] = useState<number | null>(null);
  const dragChannelRef = useRef<{ ch: Channel; ghost: HTMLElement; pointerId: number } | null>(null);

  playerRef.current = player;
  autoPipRef.current = autoPipEnabled;

  const [source, setSource] = useState<'json-teles' | 'iptv-org' | 'mi-iptv' | 'custom'>(() => {
    try { const s = localStorage.getItem('tv-source'); return s === 'iptv-org' || s === 'mi-iptv' || s === 'custom' ? s : 'json-teles'; } catch { return 'json-teles'; }
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

    const idbKey = source === 'iptv-org' ? `${IDB_KEY}:iptv` : source === 'mi-iptv' ? `${IDB_KEY}:mi-iptv` : IDB_KEY;
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
    // `custom` already returned above; assert the narrowed feed source for the nested function.
    const feedSource = source as 'json-teles' | 'iptv-org' | 'mi-iptv';
    async function loadChannels() {
      const data = await fetchChannelsApi(feedSource);
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
    if (sortOrder !== 'default') {
      const collator = new Intl.Collator('es', { sensitivity: 'base', numeric: true });
      list = [...list].sort((a, b) => sortOrder === 'az' ? collator.compare(a.name, b.name) : collator.compare(b.name, a.name));
    }
    return list;
  }, [channels, selectedCat, favorites, showFavorites, search, sortOrder]);

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

  // Persist player placement preference
  useEffect(() => {
    localStorage.setItem('tv-player-placement', playerPlacement);
  }, [playerPlacement]);

  // Persist placeholder density (completo por defecto)
  useEffect(() => {
    localStorage.setItem('tv-placeholder-compact', String(placeholderCompact));
  }, [placeholderCompact]);


  // Persist multiview state
  useEffect(() => { localStorage.setItem('tv-view-mode', viewMode); }, [viewMode]);
  useEffect(() => { localStorage.setItem('tv-multiview-layout', multiviewLayout); }, [multiviewLayout]);
  useEffect(() => { localStorage.setItem('tv-multiview-slots', JSON.stringify(multiviewSlots)); }, [multiviewSlots]);

  // Persist channel grid preferences
  useEffect(() => { localStorage.setItem('tv-grid-rows', String(gridRows)); }, [gridRows]);
  useEffect(() => { localStorage.setItem('tv-sort', sortOrder); }, [sortOrder]);

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
    const existing = multiviewSlots.findIndex(slot => slot.channel.id === ch.id);
    if (existing !== -1) {
      setMultiviewSlots(prev => prev.filter((_, index) => index !== existing));
      setFocusedSlot(prev => {
        if (prev === existing) return null;
        return prev !== null && prev > existing ? prev - 1 : prev;
      });
      return;
    }

    const max = maxSlots(multiviewLayout);
    setMultiviewSlots(prev => {
      if (prev.length < max) return [...prev, { channel: ch, signalIndex: 0 }];
      const target = focusedSlot !== null && focusedSlot < prev.length ? focusedSlot : prev.length - 1;
      const next = [...prev];
      next[target] = { channel: ch, signalIndex: 0 };
      return next;
    });
  }, [multiviewLayout, multiviewSlots, focusedSlot]);

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
    ghost.className = 'fixed z-[9999] w-20 h-20 rounded-xl bg-primary/80 text-primary-content flex items-center justify-center text-[11px] font-bold shadow-2xl pointer-events-none';
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

  // Las ubicaciones laterales solo existen en escritorio; en móvil caen a `below`
  // (arriba/abajo siguen funcionando igual).
  const mediaSide: 'left' | 'right' | null =
    isDesktop && SIDE_PLACEMENTS.includes(playerPlacement) ? (playerPlacement as 'left' | 'right') : null;
  const sideActive = mediaSide !== null;
  const effectivePlacement: PlayerPlacement =
    !isDesktop && SIDE_PLACEMENTS.includes(playerPlacement) ? 'below' : playerPlacement;

  /* Orden visual del bloque de video. Los dos nodos se quedan montados en el mismo
     árbol (media primero, filtros+grilla después) y sólo cambian de `order`, así el
     <video> no se desmonta al reposicionar y el stream no se reinicia. */
  const mediaOrder =
    effectivePlacement === 'below' ? 'order-last'
      : effectivePlacement === 'right' ? 'lg:order-last'
        : 'order-first';

  /* Pulso corto de "aterrizó aquí" al cambiar de ubicación — sin animar el contenido. */
  const [placementLanded, setPlacementLanded] = useState(false);
  const lastPlacementRef = useRef(effectivePlacement);
  useEffect(() => {
    if (lastPlacementRef.current === effectivePlacement) return;
    lastPlacementRef.current = effectivePlacement;
    setPlacementLanded(true);
    const timer = setTimeout(() => setPlacementLanded(false), 500);
    return () => clearTimeout(timer);
  }, [effectivePlacement]);

  const sourceRow = (
    <div className="flex items-center gap-1 flex-wrap">
      {(['json-teles', 'iptv-org', 'mi-iptv', 'custom'] as const).map((s) => {
        const isActive = source === s;
        const total = s === 'custom' ? customChannels.length : channels.length;
        return (
          <button key={s} onClick={() => handleSourceChange(s)}
            aria-pressed={isActive}
            className={`inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md transition-colors cursor-pointer ${
              isActive ? 'bg-primary/15 text-primary font-medium' : 'text-base-content/70 hover:text-base-content/70 hover:bg-base-content/[0.04]'
            }`}>
            {s === 'json-teles' ? 'json-teles' : s === 'iptv-org' ? 'iptv-org' : s === 'mi-iptv' ? 'mi-iptv' : 'Lista M3U'}
            {/* El conteo va con la playlist activa, no como badge suelto */}
            {isActive && total > 0 && (
              <span className="text-[11px] font-mono tabular-nums px-1 py-0.5 rounded bg-primary/10">{total}</span>
            )}
          </button>
        );
      })}
      {source === 'custom' && customChannels.length > 0 && (
        <button onClick={handleClearCustom}
          className="ml-auto text-[11px] px-2 py-1 rounded-md text-base-content/70 hover:text-error hover:bg-error/10 transition-colors cursor-pointer flex items-center gap-1">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" /></svg>
          Quitar lista
        </button>
      )}
    </div>
  );

  /* Campos de filtro. Las playlists ya no viven aquí: se movieron a la barra
     fija de arriba. La card que envuelve esto también envuelve los canales. */
  const filterFields = (
    <div className="space-y-1.5">
      {/* Búsqueda */}
      <div className="relative">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="absolute left-2.5 top-1/2 -translate-y-1/2 text-base-content/70 pointer-events-none">
          <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
        </svg>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar canales..."
          aria-label="Buscar canales"
          className="w-full bg-base-200/60 border border-base-300 rounded-lg pl-8 pr-8 py-1.5 text-base sm:text-sm text-base-content placeholder:text-base-content/70 outline-none focus:border-primary/40 transition-colors"
        />
        {search && (
          <button onClick={() => { play('interaction.subtle'); setSearch(''); }} aria-label="Limpiar búsqueda" className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-base-content/70 hover:text-base-content transition-colors cursor-pointer">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        )}
      </div>

      {/* Categorías */}
      {source !== 'custom' && (
        <ChannelSelector
          categories={allCats}
          counts={counts}
          selected={showFavorites ? '__favorites__' : selectedCat}
          onSelect={handleSelectCategory}
        />
      )}
    </div>
  );

  /* Ajustes de presentación de los canales: viven con la grilla, no con los filtros. */
  const gridControls = (
    <div className="flex items-center justify-end gap-2 px-0.5">
      <span role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {filtered.length} canales
      </span>
      {!sideActive && (
        <div className="flex items-center gap-0.5" role="group" aria-label="Cantidad de filas de canales">
          <span className="text-[11px] text-base-content/70 font-medium uppercase tracking-wider mr-1">Filas</span>
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} onClick={() => { play('interaction.tap'); setGridRows(n); }}
              aria-pressed={gridRows === n}
              aria-label={`Mostrar ${n} ${n === 1 ? 'fila' : 'filas'}`}
              className={`min-w-[24px] h-6 px-1.5 text-[11px] tabular-nums rounded-md transition-colors cursor-pointer ${
                gridRows === n ? 'bg-primary/15 text-primary font-medium' : 'text-base-content/70 hover:text-base-content/70 hover:bg-base-content/[0.04]'
              }`}>
              {n}
            </button>
          ))}
        </div>
      )}
      <div className="w-px h-4 bg-base-300" aria-hidden="true" />
      <div className="flex items-center gap-0.5" role="group" aria-label="Orden de canales">
        <span className="text-[11px] text-base-content/70 font-medium uppercase tracking-wider mr-1">Orden</span>
        <button onClick={() => { play('interaction.tap'); setSortOrder((prev) => prev === 'az' ? 'default' : 'az'); }}
          aria-pressed={sortOrder === 'az'} title="Ordenar de A a Z"
          className={`min-w-[32px] h-6 px-1.5 text-[11px] rounded-md transition-colors cursor-pointer ${
            sortOrder === 'az' ? 'bg-primary/15 text-primary font-medium' : 'text-base-content/70 hover:text-base-content/70 hover:bg-base-content/[0.04]'
          }`}>
          A-Z
        </button>
        <button onClick={() => { play('interaction.tap'); setSortOrder((prev) => prev === 'za' ? 'default' : 'za'); }}
          aria-pressed={sortOrder === 'za'} title="Ordenar de Z a A"
          className={`min-w-[32px] h-6 px-1.5 text-[11px] rounded-md transition-colors cursor-pointer ${
            sortOrder === 'za' ? 'bg-primary/15 text-primary font-medium' : 'text-base-content/70 hover:text-base-content/70 hover:bg-base-content/[0.04]'
          }`}>
          Z-A
        </button>
      </div>
    </div>
  );

  const gridNode = (
    <div className="space-y-1">
      {gridControls}
      <div key={`${selectedCat}-${showFavorites}-${search}-${sideActive}`} className="transition-opacity duration-200">
        <ChannelGrid
          channels={filtered}
          rows={gridRows}
          variant={sideActive ? 'wrap' : 'strip'}
          selectedIds={viewMode === 'multiview' ? multiviewSlots.map(s => s.channel.id) : (player ? [player.channel.id] : [])}
          favorites={favorites}
          onSelect={handleSelect}
          onToggleFavorite={toggleFavorite}
          onDragChannelStart={viewMode === 'multiview' ? handleDragChannelStart : undefined}
        />
      </div>
    </div>
  );

  /* Una sola card para filtros + canales: así los botones de canales se leen
     como el resultado de los filtros y no como un bloque aparte. */
  const filtersBlock = (
    <div className="rounded-xl border border-base-300 bg-base-100 p-1.5 space-y-1.5">
      {filterFields}
      <div className="border-t border-base-300/70 pt-1">
        {gridNode}
      </div>
    </div>
  );

  /* Controles del reproductor: modo (uno / varios), cuadrícula y ubicación.
     Viven en una barra fija arriba de la sección — nunca viajan con el bloque de
     video, así reposicionar no mueve los controles de sitio. */
  /* "Cuadrícula" y su disposición son un solo control segmentado: al activarse,
     las opciones se pegan al toggle compartiendo la misma superficie. */
  const gridModeControl = (
    <div className={`flex items-center rounded-lg transition-colors ${
      viewMode === 'multiview' ? 'bg-primary/15' : ''
    }`}>
      <button onClick={handleToggleViewMode} aria-pressed={viewMode === 'multiview'}
        title={viewMode === 'multiview' ? 'Volver a un solo canal' : 'Ver varios canales a la vez'}
        aria-label={viewMode === 'multiview' ? 'Cuadrícula: volver a un solo canal' : 'Cuadrícula: ver varios canales a la vez'}
        className={`flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-lg transition-colors cursor-pointer ${
          viewMode === 'multiview'
            ? 'text-primary font-medium'
            : 'text-base-content/70 hover:text-base-content hover:bg-base-300'
        }`}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
        </svg>
        <span>Cuadrícula</span>
      </button>
      {viewMode === 'multiview' && (
        <div role="group" aria-label="Disposición de la cuadrícula"
          className="flex items-center gap-0.5 pl-1.5 pr-1 border-l border-primary/25">
          {(['1x1', '1x2', '1x3', '2x2', '2x3', '3x3'] as const).map((l) => (
            <button key={l} onClick={() => { play('interaction.tap'); setMultiviewLayout(l); }}
              aria-pressed={multiviewLayout === l}
              aria-label={`Cuadrícula ${l}`}
              title={l === '1x1' ? '1 canal — pantalla completa (móvil)' : l === '1x2' ? '2 canales vertical (móvil)' : l}
              className={`min-w-[26px] h-6 px-1 text-[11px] rounded-md transition-colors cursor-pointer ${
                multiviewLayout === l
                  ? 'bg-primary text-primary-content font-semibold'
                  : 'text-primary hover:bg-primary/20'
              }`}>
              {l}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  /* Solo aplica al placeholder sin canal: el video siempre va a tamaño completo. */
  const placeholderDensityControl = !player && viewMode !== 'multiview' ? (
    <button onClick={() => { play('interaction.toggle'); setPlaceholderCompact((v) => !v); }}
      aria-pressed={placeholderCompact}
      aria-label="Reproductor compacto"
      title={placeholderCompact ? 'Ver el reproductor a tamaño completo' : 'Ver el reproductor compacto'}
      className={`w-6 h-6 flex items-center justify-center rounded transition-colors cursor-pointer ${
        placeholderCompact
          ? 'bg-primary/15 text-primary'
          : 'text-base-content/70 hover:text-base-content hover:bg-base-300'
      }`}>
      {placeholderCompact ? (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
        </svg>
      ) : (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M8 3H5a2 2 0 00-2 2v3M16 3h3a2 2 0 012 2v3M21 16v3a2 2 0 01-2 2h-3M3 16v3a2 2 0 002 2h3" />
        </svg>
      )}
    </button>
  ) : null;

  /* Barra fija de la sección. Arriba la fuente de los canales (playlists);
     abajo, los controles que afectan al bloque de video. */
  const mediaBar = (
    <div className="rounded-xl border border-base-300 bg-base-100 px-2 py-1.5 space-y-1.5">
      {sourceRow}
      <div className="h-px bg-base-300/70" aria-hidden="true" />
      <div className="flex items-center gap-2 flex-wrap">
        {gridModeControl}
        <div className="ml-auto flex items-center gap-1.5">
          {placeholderDensityControl}
          <PlacementPicker value={effectivePlacement} allowSide={isDesktop} onChange={setPlayerPlacement} />
        </div>
      </div>
    </div>
  );

  const mediaNode = viewMode === 'multiview' ? (
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
  ) : placeholderCompact ? (
    /* Versión compacta (opt-in): una sola fila. */
    <div className="rounded-xl bg-base-100 border border-base-300 flex items-center gap-2.5 px-3 py-2">
      <div className="w-8 h-8 rounded-lg bg-base-200 flex items-center justify-center text-base-content/70 shrink-0">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <rect x="2" y="4" width="20" height="16" rx="2" /><path d="M10 10l4 2-4 2v-4z" />
        </svg>
      </div>
      <p className="flex-1 min-w-0 text-xs text-base-content/70 font-medium">Selecciona un canal para ver</p>
    </div>
  ) : (
    /* Versión completa (default): reserva el área 16:9 del reproductor. */
    <div className="aspect-video rounded-xl bg-base-200/40 border border-base-300 flex flex-col items-center justify-center gap-2 px-4 text-center">
      <div className="w-12 h-12 rounded-full bg-base-200 flex items-center justify-center text-base-content/70">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <rect x="2" y="4" width="20" height="16" rx="2" /><path d="M10 10l4 2-4 2v-4z" />
        </svg>
      </div>
      <p className="text-xs font-medium text-base-content/70">Selecciona un canal para ver</p>
      <p className="text-[11px] text-base-content/70">Elige un canal de la grilla, o activa Cuadrícula para ver varios</p>
    </div>
  );

  return (
    <div ref={sectionRef} id="seccion-tv" className="space-y-2">
      {loading ? (
        /* Reserva el alto real del bloque (medido: 1031 px en desktop, 579 px en
           móvil, sin contar la atribución de fuentes que va debajo): barra de
           playlists + reproductor 16:9 + card de filtros/canales. Antes faltaba
           el reproductor y la sección crecía ~770 px. */
        <div className="flex flex-col space-y-1.5 animate-pulse min-h-[579px] sm:min-h-[1031px]" aria-hidden="true">
          {/* Barra fija: playlists arriba, controles del reproductor abajo */}
          <div className="rounded-xl border border-base-300 bg-base-100 px-2 py-1.5 space-y-1.5">
            <div className="flex gap-1.5 flex-wrap">
              <div className="h-6 w-16 bg-base-200 rounded-md" />
              <div className="h-6 w-16 bg-base-200 rounded-md" />
              <div className="h-6 w-16 bg-base-200 rounded-md" />
              <div className="h-6 w-20 bg-base-200 rounded-md" />
            </div>
            <div className="h-px bg-base-300/70" />
            <div className="flex items-center gap-2">
              <div className="h-6 w-24 bg-base-200 rounded-md" />
              <div className="ml-auto flex items-center gap-1.5">
                <div className="h-6 w-6 bg-base-200 rounded" />
                <div className="h-6 w-24 bg-base-200 rounded" />
              </div>
            </div>
          </div>
          {/* Reproductor: mismo aspect-video que el placeholder real */}
          <div className="aspect-video shrink-0 rounded-xl bg-base-200/50 border border-base-300" />
          {/* Filtros + canales, en la misma card (crece para llenar la reserva) */}
          <div className="flex flex-1 flex-col rounded-xl border border-base-300 bg-base-100 p-1.5 space-y-1.5">
            <div className="h-8 bg-base-200 rounded-lg w-full" />
            <div className="flex gap-1.5">
              <div className="h-6 w-20 bg-base-200 rounded-md" />
              <div className="h-6 w-20 bg-base-200 rounded-md" />
              <div className="h-6 w-20 bg-base-200 rounded-md" />
            </div>
            <div className="flex-1 border-t border-base-300/70 pt-1">
              <div className="flex gap-2 overflow-hidden pt-1">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="flex flex-col items-center gap-1.5 p-2 rounded-xl bg-base-200 shrink-0 w-[84px] sm:w-24">
                    <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-xl bg-base-300" />
                    <div className="h-2.5 w-12 bg-base-300 rounded" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : isEmptyCustom ? (
        /* Custom source with no list yet: source switcher + import panel */
        <div className="space-y-2">
          <div className="rounded-xl border border-base-300 bg-base-100 p-1.5">{sourceRow}</div>
        <div className="rounded-xl bg-base-100 border border-base-300 p-5">
          <div className="max-w-lg mx-auto">
            <p className="text-xs text-base-content/70 text-center mb-4">
              Aún no has cargado una lista M3U personalizada.
            </p>

            {/* Method tabs */}
            <div className="flex gap-1 mb-4 justify-center">
              {(['file', 'url', 'text'] as const).map((m) => (
                <button key={m} onClick={() => { setImportMethod(m); setImportError(null); }}
                  className={`text-[11px] px-3 py-1.5 rounded-md transition-colors cursor-pointer ${
                    importMethod === m ? 'bg-primary/15 text-primary font-medium' : 'text-base-content/70 hover:text-base-content/70'
                  }`}>
                  {m === 'file' ? <><Emoji emoji="📁" /> Archivo</> : m === 'url' ? <><Emoji emoji="🔗" /> URL</> : <><Emoji emoji="📝" /> Texto</>}
                </button>
              ))}
            </div>

            {/* Tab content */}
            {importMethod === 'file' && (
              <label className="flex flex-col items-center gap-2 py-6 px-4 rounded-lg border-2 border-dashed border-base-300 hover:border-primary/40 cursor-pointer transition-colors">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-base-content/70">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" />
                </svg>
                <span className="text-xs text-base-content/70">Seleccionar archivo .m3u</span>
                <span className="text-[11px] text-base-content/70">o arrastra el archivo aquí</span>
                <input type="file" accept=".m3u,.m3u8" onChange={handleFileImport} className="hidden" />
              </label>
            )}

            {importMethod === 'url' && (
              <div className="space-y-2">
                <input type="url" value={urlInput} onChange={(e) => setUrlInput(e.target.value)}
                  aria-label="URL de la lista M3U" placeholder="https://ejemplo.com/lista.m3u"
                  className="w-full bg-base-200 border border-base-300 rounded-lg px-3 py-2 text-base sm:text-sm text-base-content placeholder:text-base-content/70 outline-none focus:border-primary/40 transition-colors" />
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
                  className="w-full bg-base-200 border border-base-300 rounded-lg px-3 py-2 text-base sm:text-sm text-base-content placeholder:text-base-content/70 outline-none focus:border-primary/40 transition-colors resize-y" />
                <button onClick={handleTextImport}
                  className="w-full text-[11px] px-3 py-1.5 rounded-md bg-primary/15 text-primary hover:bg-primary/25 transition-colors cursor-pointer">
                  Cargar lista
                </button>
              </div>
            )}

            {importError && (
              <p className="mt-3 text-[11px] text-error text-center">{importError}</p>
            )}

            <p className="mt-4 text-[11px] text-base-content/70 text-center leading-relaxed">
              Formatos soportados: M3U y M3U8. Si la URL falla por CORS, usa la opción Texto para pegar el contenido directamente.
            </p>
          </div>
        </div>
        </div>
      ) : (
        <>
          {/* Barra fija de controles: siempre en el mismo sitio de la sección. */}
          {mediaBar}
          <div className={
            'flex flex-col gap-1.5 ' +
            (sideActive
              ? `lg:grid lg:items-start ${
                  mediaSide === 'left'
                    ? 'lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]'
                    : 'lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]'
                }`
              : '')
          }>
            {/* `z-30` es intencional: en los laterales el wrapper es `sticky`, que crea su
                propio stacking context; sin él el miniplayer (`fixed z-50` dentro) queda
                pintado por debajo de las tarjetas de canales (hermanas posicionadas). */}
            <div className={`min-w-0 rounded-xl z-30 ${mediaOrder} ${sideActive ? 'lg:sticky lg:top-[88px]' : ''} ${placementLanded ? 'tv-media-land' : ''}`}>
              {mediaNode}
            </div>
            <div className="min-w-0">
              {filtersBlock}
            </div>
          </div>
        </>
      )}

      {source === 'json-teles' || source === 'iptv-org' || source === 'mi-iptv' ? (
        <SectionSources section="tv" only={[source === 'json-teles' ? 'json-teles' : source === 'iptv-org' ? 'iptv-org' : 'mi-iptv']} />
      ) : (
        <div className="mt-2 text-right text-[11px] text-base-content/70">
          <span className="text-base-content/70">Lista personalizada</span>
        </div>
      )}
    </div>
  );
}
