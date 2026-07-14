import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import type { Channel } from '../../types';
import { ChannelSelector } from './ChannelSelector';
import { ChannelGrid } from './ChannelGrid';
import { UnifiedPlayer } from './UnifiedPlayer';
import { Emoji } from '../Emoji';
import { play } from '@/lib/sound';
import { idbGet, idbSet } from '@/lib/idb-cache';

const IDB_KEY = 'tv-channels';
const IDB_TTL = 24 * 60 * 60 * 1000; // 24 hours

const JSON_TELES_URLS = [
  'https://raw.githubusercontent.com/Alplox/json-teles/main/countries/cl.json',
  'https://cdn.jsdelivr.net/gh/Alplox/json-teles@main/countries/cl.json',
];

const IPTV_ORG_URLS = [
  'https://iptv-org.github.io/iptv/countries/cl.m3u',
  'https://cdn.jsdelivr.net/gh/iptv-org/iptv@gh-pages/countries/cl.m3u',
];

function loadFavorites(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem('tv-favorites') || '[]')); } catch { return new Set(); }
}

function saveFavorites(favs: Set<string>) {
  localStorage.setItem('tv-favorites', JSON.stringify([...favs]));
}

async function fetchJSON(urls: string[]): Promise<any> {
  for (const url of urls) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (r.ok) return await r.json();
    } catch {}
  }
  return null;
}

async function fetchText(urls: string[]): Promise<string | null> {
  for (const url of urls) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (r.ok) return await r.text();
    } catch {}
  }
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

    // Phase 1: background fetch → update
    async function loadChannels() {
      if (source === 'iptv-org') {
        const text = await fetchText(IPTV_ORG_URLS);
        if (cancelled) return;
        // ponytail: reuses parseCustomM3U from this component (same M3U format)
        const channels = text ? parseCustomM3U(text) : [];
        const cats = ['todas', ...new Set(channels.map((c) => c.category).filter(Boolean))];
        idbSet(idbKey, { channels, categories: cats }, IDB_TTL);
        setChannels(channels);
        setCategories(cats);
      } else {
        const data = await fetchJSON(JSON_TELES_URLS);
        if (cancelled) return;
        const raw: Channel[] = data?.channels || [];
        const channels = raw
          .filter((ch: Channel) => ch.signals?.length > 0 || ch.youtube || ch.twitch)
          .map((ch: Channel) => {
            const signals = (ch.signals || []).filter((s) => s.type === 'm3u8' || s.type === 'iframe');
            if (ch.youtube) {
              (ch.last_youtube_livestreams || []).forEach((vid: string) => {
                signals.push({ type: 'youtube-vod', url: `https://www.youtube.com/embed/${vid}?autoplay=1` });
              });
              signals.push({ type: 'youtube', url: `https://www.youtube.com/embed/live_stream?channel=${ch.youtube}&autoplay=1` });
            }
            if (ch.twitch) {
              signals.push({ type: 'twitch', url: `https://player.twitch.tv/?channel=${ch.twitch}&parent=localhost&parent=queonda.vercel.app` });
            }
            return { ...ch, signals };
          })
          .filter((ch: Channel) => ch.signals.length > 0);
        const cats = ['todas', ...new Set(channels.map((c) => c.category).filter(Boolean))];
        idbSet(idbKey, { channels, categories: cats }, IDB_TTL);
        setChannels(channels);
        setCategories(cats);
      }
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

  const handleSelect = useCallback((ch: Channel) => {
    setPlayer((prev) => {
      if (prev && prev.channel.id === ch.id && prev.mode === 'inline') return null;
      return { channel: ch, signalIndex: 0, mode: 'inline' };
    });
  }, []);

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
              selectedId={player?.channel.id ?? null}
              favorites={favorites}
              onSelect={handleSelect}
              onToggleFavorite={toggleFavorite}
            />
          </div>

          {/* Player */}
          {player ? (
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
