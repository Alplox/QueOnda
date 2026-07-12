import { useEffect, useRef, useState, useCallback } from 'react';
import type { Channel } from '../../types';
import { play } from '@/lib/sound';

interface Props {
  channel: Channel;
  signalIndex: number;
  onSignalChange: (index: number) => void;
  mode: 'inline' | 'pip';
  onModeChange: (mode: 'inline' | 'pip') => void;
  onClose: () => void;
  autoPipEnabled?: boolean;
  onToggleAutoPip?: () => void;
}

const PIP_WIDTH = 340;
const PIP_HEIGHT = 200;
const PIP_RIGHT = 20;
const PIP_BOTTOM = 80;

const PLAY_ICON = (<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>);
const PAUSE_ICON = (<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" /></svg>);
const VOLUME_HIGH = (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 5L6 9H2v6h4l5 4V5z" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" /></svg>);
const VOLUME_OFF = (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 5L6 9H2v6h4l5 4V5z" /><line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" /></svg>);
const FULLSCREEN_ICON = (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" /></svg>);
const EXPAND_ICON = (<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2 7.5v2.5h2.5M10 4.5V2H7.5M2 4.5V2h2.5M10 7.5v2.5H7.5" /></svg>);
const CLOSE_ICON = (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>);
const PIP_CLOSE_ICON = (<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3l6 6M9 3l-6 6" /></svg>);

function formatTime(s: number): string {
  if (!isFinite(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

const SIGNAL_LABEL: Record<string, string> = {
  m3u8: 'HD',
  iframe: 'WEB',
  youtube: 'YT Live',
  'youtube-vod': 'YT VOD',
  twitch: 'Twitch',
};

function isPlayable(type: string) {
  return type === 'm3u8' || type === 'iframe' || type === 'twitch' || type.startsWith('youtube');
}

export function UnifiedPlayer({ channel, signalIndex, onSignalChange, mode, onModeChange, onClose, autoPipEnabled, onToggleAutoPip }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<any>(null);
  const controlsTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const animTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const inlineRectRef = useRef<{ left: number; top: number; width: number; height: number } | null>(null);
  const mountedRef = useRef(false);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [showControls, setShowControls] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const [animating, setAnimating] = useState(false);
  const [animStyle, setAnimStyle] = useState<React.CSSProperties>({});

  const [pipPos, setPipPos] = useState(() => ({
    x: Math.max(0, window.innerWidth - PIP_WIDTH - PIP_RIGHT),
    y: Math.max(0, window.innerHeight - PIP_HEIGHT - PIP_BOTTOM),
  }));

  const signals = channel.signals.filter(s => isPlayable(s.type));
  const currentSignal = signals[signalIndex];
  const signalType = currentSignal?.type ?? '';
  const isHlsType = signalType === 'm3u8';
  const isEmbedType = !isHlsType && (signalType === 'iframe' || signalType === 'twitch' || signalType.startsWith('youtube'));
  const hasMultipleSignals = signals.length > 1;

  // Track inline rect whenever component is in inline mode (runs when mode changes, not every render)
  // This ensures it's available for expand animation even after auto-pip
  useEffect(() => {
    if (mode === 'inline' && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        inlineRectRef.current = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
      }
    }
  }, [mode]);

  // Signal switch: cleanup + init in a single effect for atomicity
  useEffect(() => {
    const prevHls = hlsRef.current;
    hlsRef.current = null;

    const video = videoRef.current;
    if (!video) return;

    setLoading(true);
    setError(false);
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);

    if (prevHls) {
      prevHls.destroy();
    }

    // Clear stale MediaSource blob before re-attaching
    video.removeAttribute('src');
    video.load();

    if (!isHlsType) {
      setLoading(false);
      return;
    }

    const url = currentSignal?.url;
    if (!url) { setError(true); setLoading(false); return; }

    const onPlay = () => { setPlaying(true); setError(false); };
    const onPause = () => setPlaying(false);
    const onTimeUpdate = () => { setCurrentTime(video.currentTime); setDuration(video.duration); };
    const onLoadedMetadata = () => { setDuration(video.duration); setLoading(false); };
    const onWaiting = () => setLoading(true);
    const onCanPlay = () => { setLoading(false); setError(false); };
    const onError = () => { setError(true); setLoading(false); };

    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('loadedmetadata', onLoadedMetadata);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('canplay', onCanPlay);
    video.addEventListener('canplaythrough', onCanPlay);
    video.addEventListener('error', onError);

    if (!video.paused) setPlaying(true);

    let hlsInstance: any = null;
    let cancelled = false;

    import('hls.js').then(({ default: Hls }) => {
      if (cancelled) return;

      if (Hls.isSupported()) {
        hlsInstance = new Hls();
        hlsRef.current = hlsInstance;
        hlsInstance.loadSource(url);
        hlsInstance.attachMedia(video);
        hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => { video.play().catch(() => {}); });
        hlsInstance.on(Hls.Events.ERROR, (_e: any, d: any) => { if (d.fatal) { setError(true); setLoading(false); } });
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = url;
        video.play().catch(() => setError(true));
      } else {
        setError(true);
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
      if (hlsInstance) hlsInstance.destroy();
      hlsRef.current = null;
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('canplay', onCanPlay);
      video.removeEventListener('canplaythrough', onCanPlay);
      video.removeEventListener('error', onError);
    };
  }, [signalIndex, channel.id, isHlsType]);

  // Embed type cleanup
  useEffect(() => {
    if (isEmbedType) setLoading(false);
  }, [isEmbedType]);

  // Fullscreen
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  // Unmount cleanup
  useEffect(() => () => { if (hlsRef.current) hlsRef.current.destroy(); }, []);

  // Animation: inline → pip
  const startFloatAnim = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      inlineRectRef.current = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    }
    const targetX = Math.max(0, window.innerWidth - PIP_WIDTH - PIP_RIGHT);
    const targetY = Math.max(0, window.innerHeight - PIP_HEIGHT - PIP_BOTTOM);
    setPipPos({ x: targetX, y: targetY });

    setAnimStyle({
      position: 'fixed',
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      zIndex: 50,
      borderRadius: '0.75rem',
      transition: 'none',
      margin: 0,
      border: '1px solid',
      borderColor: 'var(--color-base-300)',
      backgroundColor: 'var(--color-base-100)',
      overflow: 'hidden',
    });
    setAnimating(true);

    requestAnimationFrame(() => {
      setAnimStyle({
        position: 'fixed',
        left: targetX,
        top: targetY,
        width: PIP_WIDTH,
        height: PIP_HEIGHT,
        zIndex: 50,
        borderRadius: '0.75rem',
        transition: 'all 0.35s cubic-bezier(0.22, 1, 0.36, 1)',
        margin: 0,
        border: '1px solid',
        borderColor: 'var(--color-base-300)',
        backgroundColor: 'var(--color-base-100)',
        overflow: 'hidden',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
      });
    });

    animTimerRef.current = setTimeout(() => {
      setAnimating(false);
      setAnimStyle({});
      onModeChange('pip');
    }, 380);
  }, [onModeChange]);

  // Animation: pip → inline
  const startExpandAnim = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;

    const pipRect = el.getBoundingClientRect();
    const sentinel = document.querySelector('[data-tv-sentinel]');
    const sentinelRect = sentinel?.getBoundingClientRect();
    const inlineRect = sentinelRect && sentinelRect.width > 0
      ? sentinelRect
      : (inlineRectRef.current ?? pipRect);

    setAnimStyle({
      position: 'fixed',
      left: pipRect.left,
      top: pipRect.top,
      width: pipRect.width,
      height: pipRect.height,
      zIndex: 50,
      borderRadius: '0.75rem',
      transition: 'none',
      margin: 0,
      border: '1px solid',
      borderColor: 'var(--color-base-300)',
      backgroundColor: 'var(--color-base-100)',
      overflow: 'hidden',
      boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
    });
    setAnimating(true);

    requestAnimationFrame(() => {
      setAnimStyle({
        position: 'fixed',
        left: inlineRect.left,
        top: inlineRect.top,
        width: inlineRect.width,
        height: inlineRect.height,
        zIndex: 50,
        borderRadius: '0.75rem',
        transition: 'all 0.35s cubic-bezier(0.22, 1, 0.36, 1)',
        margin: 0,
        border: '1px solid',
        borderColor: 'var(--color-base-300)',
        backgroundColor: 'var(--color-base-100)',
        overflow: 'hidden',
      });
    });

    animTimerRef.current = setTimeout(() => {
      setAnimating(false);
      setAnimStyle({});
      onModeChange('inline');
    }, 380);
  }, [onModeChange]);

  const handleFloat = useCallback(() => {
    play('overlay.expand');
    setShowControls(false);
    startFloatAnim();
  }, [startFloatAnim]);

  const handleExpand = useCallback(() => {
    play('overlay.expand');
    startExpandAnim();
  }, [startExpandAnim]);

  // Cleanup animation timer
  useEffect(() => () => { if (animTimerRef.current) clearTimeout(animTimerRef.current); }, []);

  const togglePlay = useCallback(() => {
    play('interaction.tap');
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) video.play().catch(() => {}); else video.pause();
  }, []);

  const toggleMute = useCallback(() => {
    play('interaction.toggle');
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setMuted(video.muted);
  }, []);

  const handleVolume = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value);
    const video = videoRef.current;
    if (video) { video.volume = v; video.muted = v === 0; }
    setVolume(v);
    setMuted(v === 0);
    play('interaction.subtle');
  }, []);

  const handleSeek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const video = videoRef.current;
    const bar = progressRef.current;
    if (!video || !bar || !duration) return;
    const rect = bar.getBoundingClientRect();
    video.currentTime = ((e.clientX - rect.left) / rect.width) * duration;
  }, [duration]);

  const toggleFullscreen = useCallback(() => {
    play('overlay.expand');
    if (!containerRef.current) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else containerRef.current.requestFullscreen();
  }, []);

  // Controls auto-hide (inline only)
  const handleMouseMove = useCallback(() => {
    if (mode !== 'inline' || animating) return;
    setShowControls(true);
    if (controlsTimer.current) clearTimeout(controlsTimer.current);
    controlsTimer.current = setTimeout(() => { if (playing) setShowControls(false); }, 3000);
  }, [mode, playing, animating]);

  const handleMouseLeave = useCallback(() => {
    if (playing) setShowControls(false);
  }, [playing]);

  // PiP drag — only start from title bar, not on interactive elements
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (mode !== 'pip' || animating) return;
    const target = e.target as HTMLElement;
    if (target.closest('button, a, input, video, iframe, [role="button"]')) return;
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: rect.left,
      origY: rect.top,
    };
    el.setPointerCapture(e.pointerId);
  }, [mode, animating]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const el = containerRef.current;
    if (!el) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    const newX = Math.max(0, Math.min(window.innerWidth - PIP_WIDTH, dragRef.current.origX + dx));
    const newY = Math.max(0, Math.min(window.innerHeight - PIP_HEIGHT, dragRef.current.origY + dy));
    el.style.left = `${newX}px`;
    el.style.top = `${newY}px`;
  }, []);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const el = containerRef.current;
    if (el) {
      el.releasePointerCapture(e.pointerId);
      const rect = el.getBoundingClientRect();
      setPipPos({ x: rect.left, y: rect.top });
    }
    dragRef.current = null;
  }, []);

  // Hide controls on pip mount
  useEffect(() => {
    if (mode === 'pip' && !animating) setShowControls(false);
  }, [mode, animating]);

  const progress = duration ? (currentTime / duration) * 100 : 0;

  // Determine container classes & style
  let containerClasses: string;
  let containerStyle: React.CSSProperties;

  if (animating && animStyle.position === 'fixed') {
    containerClasses = 'overflow-hidden';
    containerStyle = animStyle;
  } else if (mode === 'pip') {
    containerClasses = 'fixed z-50 rounded-xl overflow-hidden shadow-2xl shadow-neutral/60 border border-neutral/10 touch-none';
    containerStyle = { left: pipPos.x, top: pipPos.y, width: PIP_WIDTH, height: PIP_HEIGHT };
  } else {
    containerClasses = 'relative rounded-xl bg-base-100 border border-base-300';
    containerStyle = {};
  }

  return (
    <>
      {/* Sentinel: maintains layout when player is fixed (pip mode or during FLIP animation) */}
      {(mode === 'pip' || (animating && animStyle.position === 'fixed')) && (
        <div data-tv-sentinel className="w-full rounded-xl bg-base-100 border-2 border-dashed border-base-300/50 flex items-center justify-center gap-1.5 select-none" style={{ height: inlineRectRef.current?.height ?? PIP_HEIGHT }}>
          <span className="flex items-center gap-1.5 text-base-content/40 text-[10px]">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <rect x="10" y="8" width="10" height="9" rx="1" />
            </svg>
            Miniplayer activo
          </span>
        </div>
      )}

      <div
        ref={containerRef}
        className={containerClasses}
        style={containerStyle}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onPointerDown={mode === 'pip' && !animating ? handlePointerDown : undefined}
        onPointerMove={mode === 'pip' && !animating ? handlePointerMove : undefined}
        onPointerUp={mode === 'pip' && !animating ? handlePointerUp : undefined}
      >
        {/* --- HEADER / TITLE BAR (hidden in fullscreen) --- */}
        {!(mode === 'inline' && isFullscreen) && (
        <div className={`${mode === 'pip' ? 'absolute top-0 left-0 right-0 z-20 bg-gradient-to-b from-neutral/70 to-transparent h-9' : 'bg-base-100/95 backdrop-blur-sm border-b border-base-300 rounded-t-xl'}`}>
          {mode === 'inline' ? (
            <>
              <div className="flex items-center gap-1.5 sm:gap-2.5 px-2 sm:px-3 py-2">
                {channel.logo && (
                  <div className="w-6 h-6 rounded-md overflow-hidden bg-base-200 shrink-0 ring-1 ring-base-content/5 flex items-center justify-center">
                    <img src={channel.logo} alt="" className="w-full h-full object-contain" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                  </div>
                )}
                <div className="flex-1 min-w-0 flex items-center gap-1.5">
                  <span className="text-xs text-base-content font-medium truncate">{channel.name}</span>
                  <span className="w-1 h-1 rounded-full bg-primary animate-pulse shrink-0" />
                  <span className="text-[8px] text-base-content font-bold uppercase tracking-wider shrink-0">En Vivo</span>
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                  {channel.website && (
                    <a href={channel.website} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-0.5 p-1 rounded text-base-content/70 hover:text-base-content hover:bg-base-300 transition-all active:scale-[0.9] shrink-0"
                      onClick={(e) => { play('interaction.tap'); e.stopPropagation(); }} title="Sitio web">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                        <polyline points="15 3 21 3 21 9" />
                        <line x1="10" y1="14" x2="21" y2="3" />
                      </svg>
                      <span className="hidden sm:inline text-[9px]">Sitio web</span>
                    </a>
                  )}
                  {onToggleAutoPip && (
                    <>
                      <div className="w-px h-3.5 bg-base-300 shrink-0" />
                      <button onClick={() => { play('interaction.toggle'); onToggleAutoPip?.(); }}
                        className={`flex items-center gap-0.5 p-1 rounded transition-all active:scale-[0.9] ${
                          autoPipEnabled ? 'text-base-content hover:text-base-content' : 'text-base-content/70 hover:text-base-content hover:bg-base-300'
                        }`}
                        title={autoPipEnabled ? 'Auto-PiP: Al desplazarse, abrir automáticamente en ventana flotante' : 'Auto-PiP: Desactivado'}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M8 7l-5 5m0 0l5 5m-5-5h16" /></svg>
                        <span className="hidden sm:inline text-[7px] font-medium leading-none">Auto</span>
                      </button>
                    </>
                  )}
                  <div className="w-px h-3.5 bg-base-300 shrink-0" />
                  <button onClick={handleFloat} className="flex items-center gap-0.5 p-1 rounded text-base-content/70 hover:text-base-content hover:bg-base-300 transition-all active:scale-[0.9]" title="Abrir en ventana flotante">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="3" /><path d="M2 9h20" /><path d="M9 2v20" /></svg>
                    <span className="hidden sm:inline text-[7px] font-medium leading-none">PiP</span>
                  </button>
                  <button onClick={() => { play('overlay.close'); onClose(); }} className="p-1 rounded text-base-content/70 hover:text-base-content hover:bg-base-300 transition-all active:scale-[0.9]" title="Cerrar reproductor">
                    {CLOSE_ICON}
                  </button>
                </div>
              </div>
              {hasMultipleSignals && (
                <div className="flex flex-wrap items-center gap-1 px-2 sm:px-3 pb-2 pt-1.5 border-t border-base-300/50">
                  {signals.map((s, i) => (
                    <button key={i} onClick={() => { play('interaction.tap'); onSignalChange(i); }}
                      className={`text-[8px] px-1.5 py-0.5 rounded transition-colors cursor-pointer whitespace-nowrap ${
                        i === signalIndex
                          ? 'bg-primary text-primary-content'
                          : 'bg-base-300/80 text-base-content/70 hover:text-base-content hover:bg-base-200'
                      }`}
                      title={`Cambiar a señal ${SIGNAL_LABEL[s.type] ?? s.type}`}>
                      {SIGNAL_LABEL[s.type] ?? s.type}
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              <div className="flex items-center justify-between h-full px-2">
                <div className="flex items-center gap-1.5 min-w-0 flex-1 pointer-events-none">
                  {channel.logo && (
                    <img src={channel.logo} alt="" className="w-4 h-4 object-contain rounded shrink-0" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                  )}
                  <span className="text-[11px] text-white font-medium truncate">{channel.name}</span>
                </div>
                <div className="flex items-center gap-1" style={{ pointerEvents: 'auto' }}>
                  {channel.website && (
                    <a href={channel.website} target="_blank" rel="noopener noreferrer"
                      onClick={(e) => { play('interaction.tap'); e.stopPropagation(); }}
                      className="p-1.5 rounded text-white/70 hover:text-white hover:bg-white/15 transition-colors">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>
                    </a>
                  )}
                  {!isEmbedType && (
                    <button onClick={(e) => { e.stopPropagation(); toggleMute(); }}
                      className="p-1.5 rounded text-white/70 hover:text-white hover:bg-white/15 transition-colors"
                      title={muted ? 'Activar sonido' : 'Silenciar'}>
                      {muted ? <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M1 4.5v3h2l3 3V1.5L3 4.5H1zM8 4l4 4M12 4l-4 4" /></svg> : <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M1 4.5v3h2l3 3V1.5L3 4.5H1zM8 4c.4.6.7 1.3.7 2s-.3 1.4-.7 2M9.5 2.5c.8 1 .9 2.3.9 3.5s-.1 2.5-.9 3.5" /></svg>}
                    </button>
                  )}
                  <button onClick={(e) => { e.stopPropagation(); handleExpand(); }}
                    className="p-1.5 rounded text-white/70 hover:text-white hover:bg-white/15 transition-colors"
                    title="Expandir">
                    {EXPAND_ICON}
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); play('overlay.close'); onClose(); }}
                    className="p-1.5 rounded text-white/70 hover:text-white hover:bg-white/15 transition-colors"
                    title="Cerrar">
                    {PIP_CLOSE_ICON}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
        )}

        {/* --- VIDEO AREA --- */}
        <div className={`relative bg-neutral ${(mode === 'inline' && isFullscreen) ? 'h-full' : mode === 'inline' ? 'aspect-video rounded-b-xl overflow-hidden' : 'h-full pt-9'}`}>
          {/* Loading */}
          {loading && isHlsType && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-neutral/80">
              <div className={`${mode === 'pip' ? 'w-4 h-4 border-[1.5px]' : 'w-5 h-5 border-2'} border-primary/30 border-t-primary rounded-full animate-spin`} />
            </div>
          )}

          {/* Error */}
          {error && isHlsType && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-neutral/80">
              <div className="text-center">
                <p className="text-white text-xs">Señal no disponible</p>
                {hasMultipleSignals && (
                  <div className="mt-1.5 flex items-center gap-1.5 justify-center">
                    {signals.map((s, i) => (
                      <button key={i} onClick={() => { play('interaction.tap'); onSignalChange(i); }}
                        className={`text-[10px] px-2 py-0.5 rounded transition-colors cursor-pointer ${
                          i === signalIndex ? 'bg-primary text-primary-content' : 'bg-base-300/80 text-base-content/70 hover:bg-base-200'
                        }`}>
                        {SIGNAL_LABEL[s.type] ?? s.type}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* HLS video */}
          {isHlsType && (
            <video
              ref={videoRef}
              className="w-full h-full object-contain"
              autoPlay
              playsInline
              muted={muted}
              onClick={togglePlay}
            />
          )}

          {/* Embedded players */}
          {isEmbedType && currentSignal && (
            <iframe
              key={`${channel.id}-${signalIndex}`}
              src={currentSignal.url}
              className="w-full h-full"
              allow="autoplay; encrypted-media; fullscreen"
              allowFullScreen
            />
          )}

          {/* Center play button (HLS only, inline mode) */}
          {!playing && !loading && !error && isHlsType && mode === 'inline' && (
            <div role="button" className="absolute inset-0 z-10 flex items-center justify-center cursor-pointer" onClick={togglePlay}>
              <div className="w-12 h-12 rounded-full bg-primary/90 flex items-center justify-center shadow-lg shadow-neutral/50 transition-transform hover:scale-105 active:scale-95">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" className="text-primary-content"><path d="M8 5v14l11-7z" /></svg>
              </div>
            </div>
          )}

          {/* Center play button (pip mode, smaller) */}
          {!playing && !loading && !error && isHlsType && mode === 'pip' && (
            <div role="button" className="absolute inset-0 z-10 flex items-center justify-center cursor-pointer" onClick={togglePlay}>
              <div className="w-10 h-10 rounded-full bg-primary/90 flex items-center justify-center shadow-lg shadow-neutral/50 transition-transform hover:scale-105 active:scale-95">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" className="text-primary-content"><path d="M8 5v14l11-7z" /></svg>
              </div>
            </div>
          )}

          {/* Bottom signal selector (pip mode, hidden during error to avoid duplication with error overlay) */}
          {mode === 'pip' && hasMultipleSignals && !error && (
            <div className="absolute bottom-1 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1 bg-neutral/70 rounded-lg px-1.5 py-0.5">
              {signals.map((s, i) => (
                <button key={i} onClick={(e) => { e.stopPropagation(); play('interaction.tap'); onSignalChange(i); }}
                  className={`text-[7px] px-1.5 py-0.5 rounded transition-colors cursor-pointer ${
                    i === signalIndex ? 'bg-primary text-primary-content' : 'text-white/60 hover:text-white hover:bg-white/15'
                  }`}>
                  {SIGNAL_LABEL[s.type] ?? s.type}
                </button>
              ))}
            </div>
          )}

          {/* Controls overlay — inline mode only */}
          {isHlsType && mode === 'inline' && (
            <div className={`absolute bottom-0 left-0 right-0 bg-gradient-to-t from-neutral/90 via-neutral/50 to-transparent pt-10 pb-1.5 px-2.5 transition-opacity duration-300 z-20 ${showControls || !playing ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
              <div ref={progressRef} className="relative w-full h-0.5 bg-base-content/20 rounded-full cursor-pointer mb-2 group/progress" onClick={(e) => { play('interaction.tap'); handleSeek(e); }}>
                <div className="absolute left-0 top-0 h-full bg-primary rounded-full" style={{ width: `${progress}%` }} />
                <div className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 bg-primary rounded-full shadow opacity-0 group-hover/progress:opacity-100 transition-opacity" style={{ left: `${progress}%`, marginLeft: '-5px' }} />
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <button onClick={togglePlay} className="p-1 text-white hover:text-base-content/80 transition-colors" title={playing ? 'Pausar' : 'Reproducir'}>
                    {playing ? PAUSE_ICON : PLAY_ICON}
                  </button>
                  <button onClick={toggleMute} className="p-1 text-white/70 hover:text-base-content transition-colors" title={muted ? 'Activar sonido' : 'Silenciar'}>
                    {muted ? VOLUME_OFF : VOLUME_HIGH}
                  </button>
                  <div className="hidden sm:flex items-center">
                    <input type="range" min="0" max="1" step="0.05" value={muted ? 0 : volume} onChange={handleVolume}
                      className="w-14 h-0.5 accent-primary cursor-pointer" />
                  </div>
                  <span className="text-[9px] text-white/70 font-mono tabular-nums ml-0.5">{formatTime(currentTime)}</span>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={toggleFullscreen} className="p-1 text-white/70 hover:text-base-content transition-colors" title={isFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}>{FULLSCREEN_ICON}</button>
                </div>
              </div>
            </div>
          )}

          {/* Bottom gradient (pip mode) */}
          {mode === 'pip' && (
            <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-neutral/40 to-transparent pointer-events-none z-10" />
          )}
        </div>
      </div>
    </>
  );
}
