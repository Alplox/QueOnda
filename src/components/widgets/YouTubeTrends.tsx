import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { play } from '@/lib/sound';
import { loadJSON, saveJSON } from '@/lib/storage';
import { idbGet, idbSet } from '@/lib/idb-cache';

interface Video {
  title: string;
  videoId: string;
  channelId: string;
  author: string;
  thumbnail: string;
  link: string;
}

interface ChannelStatus {
  id: string;
  name: string;
  status: 'ok' | 'error' | 'empty';
  count: number;
  errorMessage?: string;
}

const STORAGE_KEY = 'youtube-channels';
const PER_CHANNEL_KEY = 'youtube-per-channel';
const PER_CHANNEL_OPTIONS = [1, 2, 3, 6, 10];
const IDB_KEY = 'youtube-trends';
const IDB_TTL = 30 * 60 * 1000; // 30 min

function VideoCard({ video, isCompact }: { video: Video; isCompact?: boolean }) {
  return (
    <a
      href={video.link}
      target="_blank"
      rel="noopener noreferrer"
      className={`group rounded-xl overflow-hidden bg-base-200 border border-base-300 hover:border-primary hover:shadow-lg shadow-sm transition-[border-color,box-shadow] no-underline active:scale-[0.96] ${
        isCompact ? 'w-52 shrink-0' : ''
      }`}
    >
      <div className="aspect-video overflow-hidden bg-base-300">
        {video.thumbnail ? (
          <img
            src={video.thumbnail}
            alt={video.title}
            className="w-full h-full object-cover group-hover:scale-105 group-hover:brightness-110 transition-[transform,filter] duration-300 ring-1 ring-inset ring-black/5 dark:ring-white/10"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-base-content">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        )}
      </div>
      <div className="p-2.5">
        <p className="text-xs text-base-content line-clamp-2 leading-snug group-hover:text-base-content group-hover:underline decoration-primary/60 underline-offset-2 transition-colors">
          {video.title}
        </p>
        <p className="text-[10px] text-base-content/70 mt-1 truncate">{video.author}</p>
      </div>
    </a>
  );
}

function MobileCarousel({ videos }: { videos: Video[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

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
  }, [checkScroll, videos]);

  const scrollBy = useCallback((dir: number) => {
    scrollRef.current?.scrollBy({ left: dir * 260, behavior: 'smooth' });
  }, []);

  return (
    <div className="relative sm:hidden">
      {canScrollLeft && (
        <div className="absolute left-0 inset-y-0 z-10 flex items-center pointer-events-none"
          style={{ background: 'linear-gradient(to right, var(--color-base-100) 40%, transparent)' }}>
          <button onClick={() => { scrollBy(-1); play('interaction.subtle'); }}
            className="pointer-events-auto w-7 h-7 flex items-center justify-center rounded-full bg-base-200 border border-base-300 text-base-content/70 hover:text-base-content hover:bg-base-300 transition-all cursor-pointer ml-1">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
          </button>
        </div>
      )}
      <div ref={scrollRef}
        className="overflow-x-auto"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
        <div className="flex gap-3 py-1 px-1">
          {videos.map((video) => (
            <VideoCard key={video.videoId} video={video} isCompact />
          ))}
        </div>
      </div>
      {canScrollRight && (
        <div className="absolute right-0 inset-y-0 z-10 flex items-center pointer-events-none"
          style={{ background: 'linear-gradient(to left, var(--color-base-100) 40%, transparent)' }}>
          <button onClick={() => { scrollBy(1); play('interaction.subtle'); }}
            className="pointer-events-auto w-7 h-7 flex items-center justify-center rounded-full bg-base-200 border border-base-300 text-base-content/70 hover:text-base-content hover:bg-base-300 transition-all cursor-pointer mr-1">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
          </button>
        </div>
      )}
    </div>
  );
}

export function YouTubeTrends() {
  const [videos, setVideos] = useState<Video[]>([]);
  const [channels, setChannels] = useState<ChannelStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [perChannel, setPerChannel] = useState(() => loadJSON<number>(PER_CHANNEL_KEY, 1));
  const [gridLimit, setGridLimit] = useState(15);
  const [selectedIds, setSelectedIds] = useState<Set<string> | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [expandedErrors, setExpandedErrors] = useState<Set<string>>(new Set());
  const [retryingChannel, setRetryingChannel] = useState<string | null>(null);
  const [isRetryingAll, setIsRetryingAll] = useState(false);
  const configRef = useRef<HTMLDivElement>(null);

  const retryChannels = useCallback(async (chs: ChannelStatus[]) => {
    if (chs.length === 0) return;
    setIsRetryingAll(true);
    const results = await Promise.allSettled(
      chs.map(ch =>
        fetch(`/api/youtube/source?channelId=${encodeURIComponent(ch.id)}&name=${encodeURIComponent(ch.name)}`)
          .then(r => r.json())
          .then(data => ({ id: ch.id, data })),
      ),
    );
    setChannels(prev => prev.map(c => {
      const r = results.find(rr => rr.status === 'fulfilled' && rr.value.id === c.id);
      if (r?.status === 'fulfilled') {
        const d = r.value.data;
        return { ...c, status: d.status, count: d.count || 0, errorMessage: d.status === 'error' ? (d.errorMessage || 'Error desconocido') : undefined };
      }
      return c;
    }));
    setVideos(prev => {
      const existing = new Set(prev.map(v => v.videoId));
      const newVids: any[] = [];
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value.data.status === 'ok' && r.value.data.videos) {
          for (const v of r.value.data.videos) {
            if (!existing.has(v.videoId)) { newVids.push(v); existing.add(v.videoId); }
          }
        }
      }
      return newVids.length > 0 ? [...newVids, ...prev] : prev;
    });
    setIsRetryingAll(false);
  }, []);

  const handleRetryAllErrors = useCallback(() => {
    const errorChs = channels.filter(c => c.status === 'error');
    play('interaction.subtle');
    retryChannels(errorChs);
  }, [channels, retryChannels]);

  useEffect(() => {
    let cancelled = false;

    // Phase 0: IDB cache → instant render
    type YTCache = { videos: Video[]; channels: ChannelStatus[] };
    idbGet<YTCache>(IDB_KEY).then(cached => {
      if (cancelled || !cached?.data) return;
      setVideos(cached.data.videos);
      setChannels(cached.data.channels);
      setLoading(false);
    });

    // Phase 1: Fetch fresh data
    fetch('/api/youtube')
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setVideos(data.videos || []);
        setChannels(data.channelStatuses || []);
        idbSet(IDB_KEY, { videos: data.videos || [], channels: data.channelStatuses || [] }, IDB_TTL);
        const errorChs = (data.channelStatuses || []).filter((c: ChannelStatus) => c.status === 'error');
        if (errorChs.length > 0) retryChannels(errorChs);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });

    const saved = loadJSON<string[] | null>(STORAGE_KEY, null);
    if (saved && saved.length > 0) setSelectedIds(new Set(saved));
    return () => { cancelled = true; };
  }, [retryChannels]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (configRef.current && !configRef.current.contains(e.target as Node)) {
        setConfigOpen(false);
        setSearch('');
      }
    }
    if (configOpen) {
      document.addEventListener('mousedown', onClick);
      return () => document.removeEventListener('mousedown', onClick);
    }
  }, [configOpen]);

  const displayVideos = useMemo(() => {
    const filtered = selectedIds === null
      ? videos
      : videos.filter((v) => selectedIds.has(v.channelId));

    // Cuando exactamente 1 canal seleccionado → mostrar todos sus videos
    if (selectedIds && selectedIds.size === 1) return filtered;

    // Múltiples canales: mostrar `perChannel` videos por canal
    const perChannelMap = new Map<string, Video[]>();
    for (const v of filtered) {
      const list = perChannelMap.get(v.channelId);
      if (!list) {
        perChannelMap.set(v.channelId, [v]);
      } else if (list.length < perChannel) {
        list.push(v);
      }
    }
    return [...perChannelMap.values()].flat();
  }, [videos, selectedIds, perChannel]);

  const toggleChannel = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev ?? channels.map((c) => c.id));
      if (next.has(id)) next.delete(id); else next.add(id);
      saveJSON(STORAGE_KEY, next.size === channels.length ? null : [...next]);
      return next.size === channels.length ? null : next;
    });
  }, [channels]);

  const handlePerChannel = useCallback((val: number) => {
    setPerChannel(val);
    saveJSON(PER_CHANNEL_KEY, val);
  }, []);

  const handleRetryChannel = useCallback(async (ch: ChannelStatus) => {
    setRetryingChannel(ch.id);
    try {
      const res = await fetch(`/api/youtube/source?channelId=${encodeURIComponent(ch.id)}&name=${encodeURIComponent(ch.name)}`);
      const data = await res.json();
      setChannels(prev => prev.map(c => c.id === ch.id ? { ...c, status: data.status, count: data.count || 0, errorMessage: data.status === 'error' ? (data.errorMessage || 'Error desconocido') : undefined } : c));
      if (data.status === 'ok' && data.videos) {
        setVideos(prev => {
          const existing = new Set(prev.map(v => v.videoId));
          const newVids = data.videos.filter((v: any) => !existing.has(v.videoId));
          return [...newVids, ...prev];
        });
      }
    } catch {
      setChannels(prev => prev.map(c => c.id === ch.id ? { ...c, status: 'error', errorMessage: 'Error de conexión al reintentar' } : c));
    } finally {
      setRetryingChannel(null);
    }
  }, []);

  const filteredChannels = useMemo(() => {
    const sorted = [...channels].sort((a, b) => a.name.localeCompare(b.name));
    if (!search) return sorted;
    const q = search.toLowerCase();
    return sorted.filter((c) => c.name.toLowerCase().includes(q));
  }, [channels, search]);

  if (loading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
        {Array.from({ length: 15 }).map((_, i) => (
          <div key={i} className="rounded-xl overflow-hidden bg-base-200 border border-base-300 animate-pulse">
            <div className="aspect-video bg-base-300" />
            <div className="p-2 space-y-2">
              <div className="h-3 bg-base-300 rounded w-full" />
              <div className="h-3 bg-base-300 rounded w-3/4" />
              <div className="h-2.5 bg-base-300 rounded w-1/2" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (videos.length === 0) {
    return (
      <div className="rounded-xl bg-base-200 border border-base-300 p-8 text-center text-base-content/70 text-sm">
        No hay videos nuevos de canales chilenos hoy
        <div className="mt-2">
          <a href="https://www.youtube.com/feed/trending?gl=CL" target="_blank" rel="noopener noreferrer" className="text-[10px] text-base-content/70 underline underline-offset-2 hover:text-base-content transition-colors">
            Ver en YouTube →
          </a>
        </div>
      </div>
    );
  }

  const hasMore = gridLimit < displayVideos.length;
  const activeCount = selectedIds ? selectedIds.size : channels.length;
  const errorCount = channels.filter((c) => c.status === 'error').length;
  const emptyCount = channels.filter((c) => c.status === 'empty').length;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <span className="text-xs text-base-content/70">
          {selectedIds && selectedIds.size === 1 ? (
            <>
              Mostrando {Math.min(gridLimit, displayVideos.length)} de {displayVideos.length} video{displayVideos.length !== 1 ? 's' : ''} ·<span className="text-primary"> últimos 10</span>
            </>
          ) : (
            <>
              Mostrando {Math.min(gridLimit, displayVideos.length)} de {activeCount} canal{activeCount !== 1 ? 'es' : ''}
            </>
          )}
          {errorCount > 0 && <span className="text-warning"> · {errorCount} con error{emptyCount > 0 && <> · {emptyCount} sin videos hoy</>}</span>}
          {errorCount === 0 && emptyCount > 0 && <span className="text-base-content/30"> · {emptyCount} sin videos hoy</span>}
          {isRetryingAll && (
            <span className="inline-flex items-center gap-1 ml-1">
              <span className="w-3 h-3 rounded-full border-2 border-warning border-t-transparent animate-spin" />
              <span className="text-warning">Reintentando...</span>
            </span>
          )}
        </span>

        {!isRetryingAll && errorCount > 0 && (
          <button onClick={handleRetryAllErrors}
            className="px-2 py-1 text-[10px] font-medium bg-primary text-primary-content rounded-lg hover:opacity-80 transition-all active:scale-[0.96] cursor-pointer">
            Reintentar todos ({errorCount})
          </button>
        )}

        {(!selectedIds || selectedIds.size !== 1) && (
          <select value={perChannel} onChange={(e) => handlePerChannel(Number(e.target.value))}
            aria-label="Videos por canal"
            className="px-2 py-1 text-[10px] font-medium text-base-content bg-base-200 border border-base-300 rounded-lg hover:bg-base-300 transition-colors cursor-pointer outline-none focus:border-primary">
            {PER_CHANNEL_OPTIONS.map((o) => (
              <option key={o} value={o}>{o} por canal</option>
            ))}
          </select>
        )}

        <div className="relative" ref={configRef}>
          <button onClick={() => { play('interaction.tap'); setConfigOpen(o => !o); }}
            className="px-2.5 py-1 text-[10px] font-medium text-base-content bg-base-200 border border-base-300 rounded-lg hover:bg-base-300 hover:border-primary transition-all active:scale-[0.96] cursor-pointer">
            Canales
          </button>
          {configOpen && (
              <div className="absolute top-full left-0 sm:right-0 sm:left-auto mt-1 z-20 w-60 max-w-[calc(100vw-16px)] bg-base-200 border border-base-300 rounded-xl shadow-xl overflow-hidden">
              <div className="p-2 border-b border-base-300 space-y-1.5">
                <input autoFocus value={search} onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar canal..."
                  className="w-full px-2.5 py-1.5 text-xs bg-base-100 border border-base-300 rounded-lg outline-none focus:border-primary placeholder:text-base-content/30" />
                <div className="flex gap-1.5">
                  <button onClick={() => { play('interaction.tap'); setSelectedIds(null); saveJSON(STORAGE_KEY, null); }}
                    className="flex-1 px-2 py-1 text-[10px] font-medium text-base-content bg-base-100 border border-base-300 rounded-lg hover:bg-base-300 transition-colors cursor-pointer">
                    Todos
                  </button>
                  <button onClick={() => { play('interaction.tap'); setSelectedIds(new Set()); saveJSON(STORAGE_KEY, []); }}
                    className="flex-1 px-2 py-1 text-[10px] font-medium text-base-content bg-base-100 border border-base-300 rounded-lg hover:bg-base-300 transition-colors cursor-pointer">
                    Ninguno
                  </button>
                </div>
              </div>
              <div className="max-h-60 overflow-y-auto p-1 space-y-0.5">
                {filteredChannels.map((ch) => {
                  const on = !selectedIds || selectedIds.has(ch.id);
                  const isError = ch.status === 'error';
                  const expanded = expandedErrors.has(ch.id);
                  return (
                    <div key={ch.id} className={isError ? 'bg-base-300/50 rounded-lg' : ''}>
                      <div className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs transition-colors ${
                        on ? 'bg-primary/10 text-primary' : ''
                      }`}>
                        <button onClick={() => toggleChannel(ch.id)}
                          className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 transition-colors cursor-pointer ${
                            on ? 'bg-primary border-primary text-primary-content' : 'border-base-content/30 hover:border-base-content'
                          }`}>
                          {on && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="m4 12 5 5 11-11" /></svg>}
                        </button>
                        <button onClick={() => { if (isError) { setExpandedErrors(prev => { const n = new Set(prev); if (n.has(ch.id)) n.delete(ch.id); else n.add(ch.id); return n; }); } else { toggleChannel(ch.id); } }}
                          className={`flex-1 flex items-center gap-2 min-w-0 text-left transition-colors cursor-pointer ${
                            on ? 'text-primary' : 'text-base-content/50 hover:text-base-content'
                          }`}>
                          <span className="truncate flex-1">{ch.name}</span>
                          {ch.status === 'ok' && ch.count > 0 && (
                            <span className="text-[10px] text-primary/60 shrink-0 ml-1">{ch.count}</span>
                          )}
                          {ch.status === 'empty' && (
                            <span className="shrink-0 ml-1" title="Sin videos hoy">
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-base-content/30"><circle cx="12" cy="12" r="10"/><path d="M8 12h8"/></svg>
                            </span>
                          )}
                          {ch.status === 'error' && (
                            <span className="shrink-0 ml-1 flex items-center gap-1" title="Error al cargar">
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-warning"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6M9 9l6 6"/></svg>
                              <svg className={`w-3 h-3 text-base-content/30 transition-transform ${expanded ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                            </span>
                          )}
                        </button>
                      </div>
                      {isError && expanded && (
                        <div className="px-4 pb-2 space-y-1.5">
                          <p className="text-[10px] text-warning/80 leading-relaxed break-words">{ch.errorMessage || 'Error desconocido'}</p>
                          <div className="flex gap-2">
                            <button onClick={() => { navigator.clipboard.writeText(ch.errorMessage || ''); play('interaction.confirm'); }}
                              className="px-2 py-1 text-[10px] font-medium bg-base-100 border border-base-300 rounded-lg text-base-content/70 hover:text-base-content hover:bg-base-300 transition-all cursor-pointer active:scale-[0.96]" title="Copiar error">
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="inline mr-0.5"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                              Copiar
                            </button>
                            <button onClick={() => { play('interaction.subtle'); handleRetryChannel(ch); }}
                              disabled={retryingChannel === ch.id}
                              className="px-2 py-1 text-[10px] font-medium bg-primary text-primary-content rounded-lg hover:opacity-80 transition-all cursor-pointer active:scale-[0.96] disabled:opacity-50 disabled:cursor-not-allowed">
                              {retryingChannel === ch.id ? 'Reintentando...' : 'Reintentar'}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
                {filteredChannels.length === 0 && (
                  <p className="text-[10px] text-base-content/40 text-center py-4">Sin resultados</p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {displayVideos.length === 0 ? (
        <div className="rounded-xl bg-base-200 border border-base-300 p-8 text-center">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mx-auto mb-2 text-base-content/30">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
          </svg>
          <p className="text-sm text-base-content/70">Todos los canales están desactivados</p>
          <p className="text-[10px] text-base-content/40 mt-1">Abre el selector y activa al menos un canal para ver videos</p>
        </div>
      ) : (
        <>
          <MobileCarousel videos={displayVideos.slice(0, gridLimit)} />
          <div className="hidden sm:grid sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {displayVideos.slice(0, gridLimit).map((video) => (
              <VideoCard key={`${video.channelId}-${video.videoId}`} video={video} />
            ))}
          </div>
        </>
      )}

      {displayVideos.length > 0 && (
        <div className="hidden sm:flex items-center justify-center gap-3 mt-4">
          {hasMore && (
            <button onClick={() => setGridLimit(s => Math.min(s + 6, displayVideos.length))}
              className="px-4 py-1.5 text-xs font-medium text-base-content bg-base-200 border border-base-300 rounded-lg hover:bg-base-300 hover:border-primary hover:ring-1 hover:ring-inset hover:ring-base-content/[0.04] transition-all duration-200 active:scale-[0.96] cursor-pointer">
              Mostrar más ({displayVideos.length - gridLimit})
            </button>
          )}
          {gridLimit > 15 && (
            <button onClick={() => setGridLimit(s => Math.max(s - 6, 15))}
              className="px-4 py-1.5 text-xs font-medium text-base-content bg-base-200 border border-base-300 rounded-lg hover:bg-base-300 transition-all duration-200 active:scale-[0.96] cursor-pointer">
              Mostrar menos
            </button>
          )}
          {gridLimit > 15 && (
            <button onClick={() => setGridLimit(15)}
              className="px-4 py-1.5 text-xs font-medium text-base-content bg-base-200 border border-base-300 rounded-lg hover:bg-base-300 transition-all duration-200 active:scale-[0.96] cursor-pointer">
              Ocultar todo
            </button>
          )}
        </div>
      )}

      <div className="mt-3 text-right text-[10px] text-base-content/70">
        Fuentes:{' '}
        <a href="https://github.com/Alplox/json-teles/blob/main/countries/cl.json" target="_blank" rel="noopener noreferrer" className="text-base-content/70 hover:text-base-content underline underline-offset-2 transition-colors">json-teles</a>
      </div>
    </div>
  );
}
