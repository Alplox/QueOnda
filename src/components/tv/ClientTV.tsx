import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import type { Channel } from '../../types';
import { ChannelSelector } from './ChannelSelector';
import { ChannelGrid } from './ChannelGrid';
import { UnifiedPlayer } from './UnifiedPlayer';
import { play } from '@/lib/sound';

function loadFavorites(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem('tv-favorites') || '[]')); } catch { return new Set(); }
}

function saveFavorites(favs: Set<string>) {
  localStorage.setItem('tv-favorites', JSON.stringify([...favs]));
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

  playerRef.current = player;
  autoPipRef.current = autoPipEnabled;

  useEffect(() => {
    fetch('/api/channels')
      .then((r) => r.json())
      .then((data) => {
        setChannels(data.channels || []);
        setCategories(data.categories || ['todas']);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

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
          <button onClick={() => { play('interaction.subtle'); setSearch(''); }} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-base-content/70 hover:text-base-content/70 transition-colors cursor-pointer">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        )}
      </div>

      {/* Category filter */}
      <ChannelSelector
        categories={allCats}
        counts={counts}
        selected={showFavorites ? '__favorites__' : selectedCat}
        onSelect={handleSelectCategory}
      />

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

      <div className="mt-2 text-right text-[10px] text-base-content/70">
        Fuente:{' '}
        <a href="https://github.com/Alplox/json-teles" target="_blank" rel="noopener noreferrer" className="text-base-content/70 hover:text-base-content underline underline-offset-2 transition-colors">json-teles</a>
      </div>
        </>
      )}
    </div>
  );
}
