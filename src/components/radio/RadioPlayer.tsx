import { useRef, useState, useEffect, useMemo } from 'react';
import type { RadioStation } from '../../lib/radios';
import { getRadioStreamType } from '../../lib/radios';
import { play } from '@/lib/sound';

interface Props {
  stations: RadioStation[];
  tags: string[];
  states: string[];
  stateCounts: Record<string, number>;
  favorites: Record<string, true>;
  onToggleFavorite: (id: string) => void;
}

const PLAY_ICON = (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor">
    <path d="M5 3l10 6-10 6V3z" />
  </svg>
);

const PAUSE_ICON = (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor">
    <rect x="4" y="3" width="3.5" height="12" rx="0.5" />
    <rect x="10.5" y="3" width="3.5" height="12" rx="0.5" />
  </svg>
);

const STOP_ICON = (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
    <rect x="2" y="2" width="10" height="10" rx="1" />
  </svg>
);

const VOLUME_HIGH = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 6v4h2.5l3.5 3V3L4.5 6H2zM10 5c.5.7.8 1.5.8 2.5s-.3 1.8-.8 2.5M12 3c1 1.2 1.5 2.9 1.5 4.5S13 10.8 12 12" />
  </svg>
);

const VOLUME_LOW = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 6v4h2.5l3.5 3V3L4.5 6H2zM10 5c.5.7.8 1.5.8 2.5s-.3 1.8-.8 2.5" />
  </svg>
);

const MUTED_ICON = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 6v4h2.5l3.5 3V3L4.5 6H2zM11 5.5l4 5M15 5.5l-4 5" />
  </svg>
);

const STAR_FILLED = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </svg>
);

const STAR_EMPTY = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </svg>
);

function BoomboxDisplay({ station, playing, loading }: { station: RadioStation; playing: boolean; loading: boolean }) {
  const cdRef = useRef<HTMLDivElement>(null);
  const rotRef = useRef({ angle: 0, speed: 0, aid: 0, did: 0 });
  const CDs = ['/cd-disc-1.png', '/cd-disc-2.png', '/cd-disc-3.png', '/cd-disc-4.png', '/cd-disc-5.png'];
  const cdSrc = useMemo(() => CDs[Math.floor(Math.random() * CDs.length)], [station.id]);

  useEffect(() => {
    const r = rotRef.current;
    clearInterval(r.aid);
    clearInterval(r.did);
    if (playing) {
      r.aid = window.setInterval(() => {
        r.speed += (0.5 - r.speed) * 0.05;
        r.angle += r.speed;
        if (cdRef.current) cdRef.current.style.transform = `rotate(${r.angle}deg)`;
      }, 16);
    } else {
      r.did = window.setInterval(() => {
        r.speed *= 0.95;
        if (r.speed < 0.01) { r.speed = 0; clearInterval(r.did); return; }
        r.angle += r.speed;
        if (cdRef.current) cdRef.current.style.transform = `rotate(${r.angle}deg)`;
      }, 16);
    }
    return () => { clearInterval(r.aid); clearInterval(r.did); };
  }, [playing]);

  return (
    <div className="flex flex-col items-center justify-center flex-1 w-full px-6">
      <div className="relative w-24 h-24">
        {/* CD disc — expands from logo when playing, spins via JS */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            transform: playing ? 'scale(1.35)' : 'scale(1)',
            transition: 'transform 0.5s cubic-bezier(0.22, 1, 0.36, 1)',
          }}
        >
          <div ref={cdRef} className="w-full h-full">
            <img
              src={cdSrc}
              alt=""
              className="w-full h-full object-contain"
            />
          </div>
        </div>
        {/* Loading spinner — between CD and logo */}
        {loading && (
          <div className="absolute -inset-1.5 z-[5] rounded-full border-[3px] border-base-content/10 border-t-primary animate-spin pointer-events-none" />
        )}
        {/* Station logo (on top) */}
        <div className={[
          'relative w-24 h-24 rounded-full overflow-hidden bg-base-100 ring-2 transition-all duration-500 z-10',
          playing ? 'ring-primary shadow-[0_0_30px_-8px_var(--color-primary)]' : 'ring-base-content/10',
        ].join(' ')}>
          {station.logo ? (
            <img src={station.logo} alt={station.name} className="w-full h-full object-contain" loading="lazy" onError={(e) => { const t = e.currentTarget; t.style.display = 'none'; t.parentElement && (t.parentElement.querySelector('.rf') as HTMLElement)?.classList.remove('hidden'); }} />
          ) : null}
          <div className={`w-full h-full flex items-center justify-center text-3xl font-bold text-base-content rf ${station.logo ? 'hidden' : ''}`}>
            {station.name.charAt(0)}
          </div>
        </div>
      </div>
      <h3 className="text-lg font-semibold text-balance text-base-content mt-4 text-center">{station.name}</h3>
      {station.website && (
        <a
          href={station.website}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => play('interaction.tap')}
          className="mt-1 flex items-center gap-1 text-[10px] text-base-content/40 hover:text-base-content underline-offset-2 underline transition-colors"
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
          </svg>
          <span>Sitio web</span>
        </a>
      )}
    </div>
  );
}

function BoomboxControls({
  playing,
  stopped,
  muted,
  volume,
  onPlayPause,
  onStop,
  onMute,
  onVolumeChange,
}: {
  playing: boolean;
  stopped: boolean;
  muted: boolean;
  volume: number;
  onPlayPause: () => void;
  onStop: () => void;
  onMute: () => void;
  onVolumeChange: (v: number) => void;
}) {
  return (
    <div className="w-full space-y-3 px-6 pb-4">
      <div className="flex items-center justify-center gap-4">
        <button
          onClick={onPlayPause}
          className="w-12 h-12 rounded-full bg-primary text-primary-content flex items-center justify-center hover:bg-primary/90 transition-all active:scale-[0.93] shadow-lg"
          title={playing ? 'Pausar' : 'Reproducir'}
        >
          {playing ? PAUSE_ICON : PLAY_ICON}
        </button>
        <button
          onClick={onStop}
          disabled={stopped}
          className="w-9 h-9 rounded-full bg-base-content/10 text-base-content flex items-center justify-center hover:bg-base-content/20 transition-all active:scale-[0.93] disabled:opacity-30 disabled:cursor-not-allowed"
          title="Detener"
        >
          {STOP_ICON}
        </button>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={onMute}
          className="text-base-content/70 hover:text-base-content transition-colors shrink-0 active:scale-[0.93]"
        >
          {muted || volume === 0 ? MUTED_ICON : volume > 0.5 ? VOLUME_HIGH : VOLUME_LOW}
        </button>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={muted ? 0 : volume}
          onChange={(e) => { play('interaction.subtle'); onVolumeChange(parseFloat(e.target.value)); }}
          className="flex-1 h-1 rounded-full appearance-none cursor-pointer range-thumb"
          style={{
            background: `linear-gradient(to right, var(--color-primary) ${(muted ? 0 : volume) * 100}%, var(--color-base-300) ${(muted ? 0 : volume) * 100}%)`,
          }}
        />
      </div>
    </div>
  );
}

function StationCard({
  station,
  isActive,
  isFav,
  onSelect,
  onToggleFavorite,
  compact,
}: {
  station: RadioStation;
  isActive: boolean;
  isFav: boolean;
  onSelect: (s: RadioStation) => void;
  onToggleFavorite: (id: string) => void;
  compact?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-2 ${compact ? 'p-2' : 'p-2.5'} rounded-xl border transition-colors duration-150 cursor-pointer group active:scale-[0.98] ${
        isActive
          ? 'bg-primary/10 border-primary'
          : 'bg-transparent border-base-300/50 hover:bg-base-200 hover:border-base-300'
      }`}
      onClick={() => onSelect(station)}
    >
      <div className={[
        'rounded-full overflow-hidden bg-base-100 shrink-0 ring-1 flex items-center justify-center',
        compact ? 'w-8 h-8' : 'w-9 h-9',
        isActive ? 'ring-primary/50' : 'ring-base-content/5',
      ].join(' ')}>
        {station.logo ? (
          <img src={station.logo} alt={station.name} className="w-full h-full object-contain" loading="lazy" onError={(e) => { const t = e.currentTarget; t.style.display = 'none'; t.parentElement && (t.parentElement.querySelector('.rf2') as HTMLElement)?.classList.remove('hidden'); }} />
        ) : null}
        <div className={`w-full h-full flex items-center justify-center text-sm font-bold text-base-content rf2 ${station.logo ? 'hidden' : ''}`}>
          {station.name.charAt(0)}
        </div>
      </div>
      <div className="text-left min-w-0 flex-1">
        <p className={[
          'text-sm leading-tight truncate transition-colors',
          isActive ? 'text-base-content font-medium' : 'text-base-content/70',
        ].join(' ')}>
          {station.name}
        </p>
      </div>
      {isActive && (
        <span className="w-2 h-2 rounded-full bg-primary animate-pulse shrink-0" />
      )}
      <button
        onClick={(e) => { e.stopPropagation(); play('interaction.toggle'); onToggleFavorite(station.id); }}
        className={`shrink-0 p-1 rounded transition-colors ${
          isFav
            ? 'text-base-content hover:text-base-content/70'
            : 'text-base-content/20 group-hover:text-base-content/50 hover:text-base-content/70'
        }`}
        title={isFav ? 'Quitar de favoritos' : 'Agregar a favoritos'}
      >
        {isFav ? STAR_FILLED : STAR_EMPTY}
      </button>
    </div>
  );
}


export function RadioPlayer({ stations, tags, states, stateCounts, favorites, onToggleFavorite }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const hlsRef = useRef<any>(null);
  const sectionRef = useRef<HTMLDivElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  const [current, setCurrent] = useState<RadioStation | null>(null);
  const [signalIndex, setSignalIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(0.8);
  const [loading, setLoading] = useState(false);
  const [sectionInView, setSectionInView] = useState(true);
  const [showSticky, setShowSticky] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [activeState, setActiveState] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [favExpanded, setFavExpanded] = useState(true);
  const [sortAZ, setSortAZ] = useState(true);

  const stopped = !current || !playing;
  const currentSignal = current?.signals?.[signalIndex] || { type: 'audio' as const, url: current?.streamUrl || '' };

  useEffect(() => {
    if (!current) return;
    setSignalIndex(0);
  }, [current?.id]);

  useEffect(() => {
    if (!current || !currentSignal?.url) return;
    setLoading(true);
    setPlaying(false);
    setError(null);

    const streamType = currentSignal.type;
    let cancelled = false;

    if (streamType === 'audio' && audioRef.current) {
      const audio = audioRef.current;
      const url = currentSignal.url;
      const isHttp = url?.startsWith('http:');
      const isHttpsPage = typeof location !== 'undefined' && location.protocol === 'https:';

      if (isHttp && isHttpsPage) {
        audio.src = '';
        setError('Transmisión bloqueada por contenido mixto. El navegador impide cargar HTTP desde HTTPS.');
        setLoading(false);
        return;
      }

      audio.src = url;
      audio.volume = muted ? 0 : volume;

      let playbackStarted = false;

      const onError = () => {
        const err: any = audio.error;
        if (err?.httpStatusCode === 403 || err?.httpStatusCode === 401) {
          setError('Transmisión bloqueada por el servidor (HTTP ' + err.httpStatusCode + ').');
        } else if (err?.code === MediaError.MEDIA_ERR_NETWORK) {
          setError('Error de conexión. Verifica tu red.');
        } else if (err?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
          probeUrl(url);
        } else if (err) {
          setError('Error al cargar la transmisión.');
        } else {
          setError('Error al cargar la transmisión.');
        }
        setLoading(false);
      };

      const onCanPlay = () => {
        playbackStarted = true;
        setError(null);
      };

      audio.addEventListener('error', onError);
      audio.addEventListener('canplay', onCanPlay);

      cleanupRef.current = () => {
        audio.removeEventListener('error', onError);
        audio.removeEventListener('canplay', onCanPlay);
      };

      audio.play().then(() => {
        playbackStarted = true;
        setPlaying(true);
        setLoading(false);
        setError(null);
      }).catch((e) => {
        if (e.name === 'NotAllowedError') {
          setError('Presiona Reproducir para iniciar.');
        } else if (!playbackStarted) {
          probeUrl(url);
        }
        setLoading(false);
      });

      function probeUrl(probeUrl: string) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        fetch(probeUrl, { method: 'HEAD', mode: 'no-cors', signal: controller.signal })
          .then((res) => {
            clearTimeout(timeout);
            if (cancelled || playbackStarted) return;
            if (res.type === 'opaque') {
              setError('No se pudo verificar la transmisión. Es posible que el servidor esté bloqueando el acceso.');
            } else if (res.status === 403 || res.status === 401) {
              setError('Transmisión bloqueada por el servidor (HTTP ' + res.status + ').');
            } else if (!res.ok) {
              setError('El servidor respondió con error (HTTP ' + res.status + ').');
            } else {
              setError('Formato de audio no soportado por el navegador.');
            }
          })
          .catch(() => {
            clearTimeout(timeout);
            if (cancelled || playbackStarted) return;
            setError('Error de conexión. Verifica tu red.');
          });
      }
    } else if (streamType === 'hls' && videoRef.current) {
      const video = videoRef.current;
      video.volume = muted ? 0 : volume;

      if (hlsRef.current) {
        hlsRef.current.destroy();
      }

      import('hls.js').then(({ default: Hls }) => {
        if (cancelled) return;

        if (Hls.isSupported()) {
          const hls = new Hls();
          hls.loadSource(currentSignal.url);
          hls.attachMedia(video);
          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            video.play().then(() => {
              setPlaying(true);
              setLoading(false);
              setError(null);
            }).catch(() => setLoading(false));
          });
          hls.on(Hls.Events.ERROR, (_event, data) => {
            if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
              setError('Error de red al cargar la transmisión.');
            } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
              setError('Error al procesar la transmisión.');
            } else {
              setError('Error al cargar la transmisión.');
            }
            setLoading(false);
          });
          hlsRef.current = hls;
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
          video.src = currentSignal.url;
          video.addEventListener('error', () => {
            setError('Error al cargar la transmisión HLS.');
            setLoading(false);
          }, { once: true });
          video.play().then(() => {
            setPlaying(true);
            setLoading(false);
            setError(null);
          }).catch(() => setLoading(false));
        } else {
          setLoading(false);
          setError('HLS no es compatible con tu navegador.');
        }
      });
    } else if (streamType === 'iframe') {
      setLoading(false);
    }

    return () => {
      cancelled = true;
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [current?.id, signalIndex]);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = muted ? 0 : volume;
    }
    if (audioRef.current) {
      audioRef.current.volume = muted ? 0 : volume;
    }
  }, [volume, muted]);

  // --- Sticky player: detect when section scrolls out of view ---
  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        setSectionInView(entry.isIntersecting);
      },
      { threshold: 0 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (current && !sectionInView) {
      setShowSticky(true);
    } else {
      setShowSticky(false);
    }
  }, [current, sectionInView]);

  const filteredStations = useMemo(() => {
    let result = stations;
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(
        (s) => s.name.toLowerCase().includes(q) || s.tags?.some((t) => t.includes(q))
      );
    }
    if (activeTags.length > 0) {
      result = result.filter((s) => activeTags.some((tag) => s.tags?.includes(tag)));
    }
    if (activeState) {
      result = result.filter((s) => s.state === activeState);
    }
    return result;
  }, [stations, searchQuery, activeTags, activeState]);

  const favoriteStations = useMemo(() => {
    const list = filteredStations.filter((s) => favorites[s.id]);
    return sortAZ ? [...list].sort((a, b) => a.name.localeCompare(b.name)) : [...list].sort((a, b) => b.name.localeCompare(a.name));
  }, [filteredStations, favorites, sortAZ]);

  const otherStations = useMemo(() => {
    const list = filteredStations.filter((s) => !favorites[s.id]);
    return sortAZ ? [...list].sort((a, b) => a.name.localeCompare(b.name)) : [...list].sort((a, b) => b.name.localeCompare(a.name));
  }, [filteredStations, favorites, sortAZ]);

  const toggleTag = (tag: string) => {
    setActiveTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const handlePlayPause = () => {
    play('interaction.tap');
    if (!current) return;
    if (playing) {
      if (videoRef.current) videoRef.current.pause();
      if (audioRef.current) audioRef.current.pause();
      setPlaying(false);
      setError(null);
    } else {
      setError(null);
      const streamType = getRadioStreamType(current.streamUrl);
      if (streamType === 'audio' && audioRef.current) {
        audioRef.current.play().then(() => setPlaying(true)).catch((e) => {
          if (e.name === 'NotAllowedError') {
            setError('Presiona Reproducir para iniciar.');
          } else {
            setError('Error al reproducir. Intenta de nuevo.');
          }
        });
      } else if (videoRef.current) {
        videoRef.current.play().then(() => setPlaying(true)).catch(() => {
          setError('Error al reanudar la reproducción.');
        });
      }
    }
  };

  const handleStop = () => {
    play('interaction.confirm');
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.src = '';
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
    }
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    setPlaying(false);
    setCurrent(null);
    setError(null);
  };

  const handleSelect = (station: RadioStation) => {
    play('interaction.tap');
    if (current?.id === station.id) {
      handleStop();
      return;
    }
    handleStop();
    setTimeout(() => setCurrent(station), 50);
  };

  const hasStations = stations.length > 0;
  const fallback = !hasStations;

  return (
    <>
      <video ref={videoRef} className="hidden" playsInline />
      <audio ref={audioRef} className="hidden" />

      <div ref={sectionRef} className={[
        'rounded-2xl overflow-hidden shadow-sm',
        'bg-gradient-to-br from-base-200 to-base-100',
        'border border-base-300',
      ].join(' ')}>
        <div className="flex flex-col md:flex-row">
          {/* Boombox player panel */}
          <div className="relative md:w-72 lg:w-80 shrink-0 flex flex-col items-center py-8 border-b md:border-b-0 md:border-r border-base-300 min-h-[320px]">
            {/* Ambient glow — no layout shift */}
            <div
              className="absolute inset-0 pointer-events-none z-0"
              style={{
                opacity: playing ? 1 : 0,
                transition: 'opacity 0.8s ease-in-out',
                background: 'radial-gradient(circle at 50% 115%, var(--color-primary) 0%, transparent 39%)',
                filter: 'blur(200px)',
              }}
            />
            {current ? (
              <>
                {error && (
                  <div className="mx-6 mb-2 w-full max-w-[200px] flex items-start gap-2 bg-error/10 border border-error/20 rounded-xl px-3 py-2">
                    <span className="text-error shrink-0 mt-0.5 text-xs">⚠</span>
                    <p className="text-[11px] text-error leading-snug">{error}</p>
                    <button
                      onClick={() => { play('interaction.subtle'); setError(null); }}
                      className="shrink-0 ml-auto text-error/50 hover:text-error transition-colors"
                    >
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>
                )}
                <BoomboxDisplay station={current} playing={playing} loading={loading} />
                
                {/* Signal selector - shown if multiple signals available */}
                {current.signals && current.signals.length > 1 && (
                  <div className="flex gap-1.5 mt-4">
                    {current.signals.map((signal, idx) => (
                      <button
                        key={idx}
                        onClick={() => { play('interaction.tap'); setSignalIndex(idx); }}
                        className={`text-[10px] px-2 py-1 rounded transition-colors cursor-pointer whitespace-nowrap ${
                          idx === signalIndex
                            ? 'bg-primary text-primary-content border border-primary'
                            : 'bg-base-content/5 text-base-content/70 hover:bg-base-content/10 border border-transparent hover:border-base-content/20'
                        }`}
                      >
                        {signal.label || signal.type.toUpperCase()}
                      </button>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="flex flex-col items-center justify-center flex-1 w-full px-6 text-center">
                <div className="w-24 h-24 rounded-full bg-base-100 ring-1 ring-base-content/5 flex items-center justify-center mb-4 text-base-content/70">
                  <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
                    <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3z" />
                    <path d="M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
                  </svg>
                </div>
                <p className="text-base-content/70 text-sm font-medium">Selecciona una radio</p>
                <p className="text-base-content/70 text-xs mt-1">Elige de la lista para empezar</p>
              </div>
            )}

            {current && (
              <BoomboxControls
                playing={playing}
                stopped={stopped}
                muted={muted}
                volume={volume}
                onPlayPause={handlePlayPause}
                onStop={handleStop}
                onMute={() => { play('interaction.toggle'); setMuted((m) => !m); }}
                onVolumeChange={setVolume}
              />
            )}
          </div>

          {/* Station list */}
          <div className="flex-1 p-4 min-w-0 flex flex-col">
            {/* Search + filter bar */}
            <div className="shrink-0 mb-3">
              <div className="relative">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Buscar radios..."
                  className="w-full text-sm bg-base-100 border border-base-300 rounded-xl px-3 py-2 pr-8 text-base-content placeholder:text-base-content/30 focus:outline-none focus:border-primary/50 transition-colors"
                />
                {searchQuery && (
                  <button
                    onClick={() => { play('interaction.subtle'); setSearchQuery(''); }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-base-content/30 hover:text-base-content/70 transition-colors"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                )}
              </div>
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {tags.map((tag) => {
                    const active = activeTags.includes(tag);
                    return (
                      <button
                        key={tag}
                        onClick={() => { play('interaction.tap'); toggleTag(tag); }}
                        className={`text-[10px] px-2 py-1 rounded-full border transition-colors cursor-pointer ${
                          active
                            ? 'bg-primary text-primary-content border-primary'
                            : 'bg-base-100 text-base-content/70 border-base-content/20 hover:border-base-content/30 hover:text-base-content'
                        }`}
                      >
                        {tag}
                      </button>
                    );
                  })}
                  {activeTags.length > 0 && (
                    <button
                      onClick={() => { play('interaction.confirm'); setActiveTags([]); }}
                      className="text-[10px] px-2 py-1 rounded-full border border-transparent text-base-content/30 hover:text-base-content/70 transition-colors"
                    >
                      Limpiar
                    </button>
                  )}
                </div>
              )}
              {states.length > 0 && (
                <div className="mt-2">
                  <select
                    value={activeState}
                    onChange={(e) => { play('interaction.tap'); setActiveState(e.target.value); }}
                    className="w-full text-xs bg-base-100 border border-base-300 rounded-lg px-2 py-1.5 text-base-content focus:outline-none focus:border-primary/50 transition-colors"
                  >
                    <option value="">Todas las ciudades ({states.reduce((s, c) => s + (stateCounts[c] || 0), 0)})</option>
                    {states.map((s) => (
                      <option key={s} value={s}>{s} ({stateCounts[s] || 0})</option>
                    ))}
                  </select>
                  {activeState && (
                    <button
                      onClick={() => { play('interaction.confirm'); setActiveState(''); }}
                      className="text-[10px] text-base-content/30 hover:text-base-content/70 ml-2 transition-colors"
                    >
                      Limpiar
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Favorites — fixed, never scrolls */}
            <div className="shrink-0 mb-2">
              <button
                onClick={() => { play('interaction.tap'); setFavExpanded((v) => !v); }}
                className="w-full flex items-center justify-between px-1.5 py-1 rounded-lg hover:bg-base-100 transition-colors"
              >
                <span className="text-[10px] text-base-content/40 font-semibold uppercase tracking-wider">
                  Favoritos {favoriteStations.length > 0 ? `(${favoriteStations.length})` : ''}
                </span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`text-base-content/30 transition-transform duration-200 ${favExpanded ? 'rotate-180' : ''}`}>
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
              {favExpanded && (
                <div className="mt-1 max-h-40 overflow-y-auto rounded-lg">
                  {favoriteStations.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-1">
                      {favoriteStations.map((station) => (
                        <StationCard
                          key={station.id}
                          station={station}
                          isActive={station.id === current?.id}
                          isFav={true}
                          onSelect={handleSelect}
                          onToggleFavorite={onToggleFavorite}
                          compact
                        />
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-base-content/30 px-1.5 py-2 italic leading-relaxed">
                      Sin favoritos. Haz clic en ☆ para agregar.
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="border-t border-base-300/40 mb-2" />

            {/* Scrollable list area */}
            <div className="flex-1 max-h-[360px] min-h-[360px] overflow-y-auto -mx-1 px-1">
              <div className="sticky top-0 z-10 bg-base-200 pt-0.5 pb-1 flex items-center justify-between">
                <p className="text-[10px] text-base-content/40 font-semibold uppercase tracking-wider px-1.5">
                  Todas ({otherStations.length})
                </p>
                <button
                  onClick={() => { play('interaction.tap'); setSortAZ((v) => !v); }}
                  className="text-[10px] text-base-content/40 hover:text-base-content px-1.5 transition-colors"
                >
                  {sortAZ ? 'A-Z' : 'Z-A'}
                </button>
              </div>

              {otherStations.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-1">
                  {otherStations.map((station) => (
                    <StationCard
                      key={station.id}
                      station={station}
                      isActive={station.id === current?.id}
                      isFav={!!favorites[station.id]}
                      onSelect={handleSelect}
                      onToggleFavorite={onToggleFavorite}
                    />
                  ))}
                </div>
              ) : filteredStations.length === 0 ? (
                <div className="text-center py-8 text-base-content/70 text-sm">
                  {fallback ? 'Cargando radios...' : 'Sin coincidencias'}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-2 text-right text-[10px] text-base-content/50">
        Fuentes:{' '}
        <a href="https://api.radio-browser.info" target="_blank" rel="noopener noreferrer" onClick={() => play('interaction.tap')} className="hover:text-base-content underline underline-offset-2 transition-colors">radio-browser.info</a>
        {' · '}
        <a href="https://github.com/Alplox/json-teles" target="_blank" rel="noopener noreferrer" onClick={() => play('interaction.tap')} className="hover:text-base-content underline underline-offset-2 transition-colors">json-teles</a>
        {' · '}
        <a href="https://github.com/Alplox/QueOnda/blob/main/AGENTS.md#cd-disc-images-radio-player-animation" target="_blank" rel="noopener noreferrer" onClick={() => play('interaction.tap')} className="hover:text-base-content underline underline-offset-2 transition-colors">CD images</a>
        {' (CC BY-NC 4.0)'}
      </div>

      {/* Sticky bottom player */}
      <div
        className={`fixed bottom-0 left-0 right-0 z-[9999] bg-base-100 border-t border-base-300 px-3 py-2 flex items-center gap-3 shadow-2xl shadow-neutral/60 transition-transform duration-300 ease-out ${
          showSticky && current ? 'translate-y-0' : 'translate-y-full'
        }`}
      >
        {current && (
          <>
          <div className="w-8 h-8 rounded-full overflow-hidden bg-base-100 ring-1 ring-primary/30 shrink-0">
            {current.logo ? (
              <img src={current.logo} alt="" className="w-full h-full object-contain" loading="lazy" onError={(e) => { const t = e.currentTarget; t.style.display = 'none'; t.parentElement && (t.parentElement.querySelector('.rf3') as HTMLElement)?.classList.remove('hidden'); }} />
            ) : null}
            <div className={`w-full h-full flex items-center justify-center text-sm font-bold text-base-content rf3 ${current.logo ? 'hidden' : ''}`}>
              {current.name.charAt(0)}
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-base-content font-medium truncate">{current.name}</p>
            <p className="text-[9px] text-base-content font-semibold uppercase tracking-wider">En Vivo</p>
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={() => { play('interaction.toggle'); if (videoRef.current) videoRef.current.muted = !videoRef.current.muted; if (audioRef.current) audioRef.current.muted = !audioRef.current.muted; setMuted((m) => !m); }}
              className="w-7 h-7 flex items-center justify-center rounded text-base-content/70 hover:text-base-content hover:bg-base-content/10 transition-colors active:scale-[0.9] shrink-0">
              {muted ? MUTED_ICON : volume > 0.5 ? VOLUME_HIGH : VOLUME_LOW}
            </button>
            <input
              type="range"
              min="0" max="1" step="0.05"
              value={muted ? 0 : volume}
              onChange={(e) => { play('media.volume'); setVolume(parseFloat(e.target.value)); }}
              className="w-20 h-1 rounded-full appearance-none cursor-pointer range-thumb"
              style={{
                background: `linear-gradient(to right, var(--color-primary) ${(muted ? 0 : volume) * 100}%, var(--color-base-300) ${(muted ? 0 : volume) * 100}%)`,
              }}
            />
            <button onClick={handlePlayPause}
              className="w-7 h-7 flex items-center justify-center rounded bg-primary text-primary-content hover:bg-primary/90 transition-colors active:scale-[0.9] shrink-0">
              {playing ? (
                <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><rect x="2" y="1.5" width="3" height="9" rx="0.5" /><rect x="7" y="1.5" width="3" height="9" rx="0.5" /></svg>
              ) : (
                <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><path d="M3 1.5l8 4.5-8 4.5v-9z" /></svg>
              )}
            </button>
            <button onClick={handleStop}
              className="w-7 h-7 flex items-center justify-center rounded text-base-content/70 hover:text-base-content hover:bg-base-content/10 transition-colors active:scale-[0.9] shrink-0">
              <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><rect x="1" y="1" width="8" height="8" rx="1" /></svg>
            </button>
          </div>
        </>
      )}
    </div>
    </>
  );
}
