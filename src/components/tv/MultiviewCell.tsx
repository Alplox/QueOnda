import { useEffect, useRef, useState, useCallback } from 'react';
import type { Channel } from '../../types';
import { play } from '@/lib/sound';

const SIGNAL_LABEL: Record<string, string> = {
  m3u8: 'HD', iframe: 'WEB', youtube: 'YT Live', 'youtube-vod': 'YT VOD', twitch: 'Twitch',
};

function isPlayable(type: string) {
  return type === 'm3u8' || type === 'iframe' || type === 'twitch' || type.startsWith('youtube');
}

interface Props {
  channel: Channel;
  signalIndex: number;
  focused: boolean;
  onSignalChange: (index: number) => void;
  onFocus: () => void;
  onRemove: () => void;
}

export function MultiviewCell({ channel, signalIndex, focused, onSignalChange, onFocus, onRemove }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(!focused);
  const [showControls, setShowControls] = useState(false);
  const controlsTimer = useRef<ReturnType<typeof setTimeout>>();
  const mountedRef = useRef(false);

  const signals = channel.signals.filter(s => isPlayable(s.type));
  const currentSignal = signals[signalIndex];
  const signalType = currentSignal?.type ?? '';
  const isHlsType = signalType === 'm3u8';
  const isEmbedType = !isHlsType && (signalType === 'iframe' || signalType === 'twitch' || signalType.startsWith('youtube'));
  const hasMultipleSignals = signals.length > 1;

  // Sync mute state with focus
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const shouldMute = !focused;
    video.muted = shouldMute;
    setMuted(shouldMute);
  }, [focused]);

  // HLS setup
  useEffect(() => {
    const prevHls = hlsRef.current;
    hlsRef.current = null;
    const video = videoRef.current;
    if (!video) return;

    setLoading(true);
    setError(false);
    setPlaying(false);

    if (prevHls) prevHls.destroy();
    video.removeAttribute('src');
    video.load();

    if (!isHlsType) { setLoading(false); return; }

    const url = currentSignal?.url;
    if (!url) { setError(true); setLoading(false); return; }

    video.muted = !focused;

    const onPlay = () => { setPlaying(true); setError(false); };
    const onPause = () => setPlaying(false);
    const onLoadedMetadata = () => setLoading(false);
    const onCanPlay = () => { setLoading(false); setError(false); };
    const onError = () => { setError(true); setLoading(false); };

    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('loadedmetadata', onLoadedMetadata);
    video.addEventListener('canplay', onCanPlay);
    video.addEventListener('error', onError);

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
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      video.removeEventListener('canplay', onCanPlay);
      video.removeEventListener('error', onError);
    };
  }, [signalIndex, channel.id, isHlsType]);

  useEffect(() => { if (isEmbedType) setLoading(false); }, [isEmbedType]);
  useEffect(() => () => { if (hlsRef.current) hlsRef.current.destroy(); }, []);

  const togglePlay = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    play('interaction.tap');
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) video.play().catch(() => {}); else video.pause();
  }, []);

  const toggleMute = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    play('interaction.toggle');
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setMuted(video.muted);
    if (!video.muted) onFocus();
  }, [onFocus]);

  const handleFullscreen = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    play('overlay.expand');
    const el = videoRef.current?.parentElement;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else el.requestFullscreen();
  }, []);

  const handleClose = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    play('overlay.close');
    onRemove();
  }, [onRemove]);

  const handleMouseMove = useCallback(() => {
    if (isEmbedType) return;
    setShowControls(true);
    if (controlsTimer.current) clearTimeout(controlsTimer.current);
    controlsTimer.current = setTimeout(() => setShowControls(false), 2500);
  }, [isEmbedType]);

  const handleMouseLeave = useCallback(() => {
    if (isEmbedType) return;
    setShowControls(false);
  }, [isEmbedType]);

  // Always show controls for embed types (YouTube/Twitch/iframe trap mouse events)
  const controlsVisible = isEmbedType || showControls || !playing;

  return (
    <div
      className={`relative rounded-xl overflow-hidden bg-neutral group cursor-pointer transition-all ${
        focused ? 'ring-2 ring-primary shadow-lg shadow-primary/20' : 'ring-1 ring-base-300 hover:ring-base-content/20'
      }`}
      onClick={() => { play('interaction.tap'); onFocus(); }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      {/* Header */}
      <div className={`absolute top-0 left-0 right-0 z-20 flex items-center gap-1.5 px-2 py-1.5 bg-gradient-to-b from-neutral/95 to-transparent transition-opacity ${controlsVisible ? 'opacity-100' : 'opacity-0'}`}>
        {channel.logo && (
          <img src={channel.logo} alt="" className="w-4 h-4 rounded object-contain shrink-0" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
        )}
        <span className="text-[10px] text-white font-medium truncate flex-1 min-w-0">{channel.name}</span>
        {focused && <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse shrink-0" />}
        <button onClick={handleClose} className="p-0.5 rounded text-white/60 hover:text-white hover:bg-white/15 transition-colors shrink-0" title="Quitar del multiview">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
        </button>
      </div>

      {/* Video area */}
      <div className="relative w-full aspect-video bg-neutral">
        {loading && isHlsType && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-neutral/70">
            <div className="w-4 h-4 border-[1.5px] border-primary/30 border-t-primary rounded-full animate-spin" />
          </div>
        )}
        {error && isHlsType && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-neutral/80">
            <div className="text-center">
              <p className="text-white text-[10px]">Señal no disponible</p>
              {hasMultipleSignals && (
                <div className="mt-1 flex gap-1 justify-center">
                  {signals.map((s, i) => (
                    <button key={i} onClick={(e) => { e.stopPropagation(); play('interaction.tap'); onSignalChange(i); }}
                      className={`text-[8px] px-1.5 py-0.5 rounded transition-colors cursor-pointer ${
                        i === signalIndex ? 'bg-primary text-primary-content' : 'bg-white/15 text-white/60 hover:bg-white/25'
                      }`}>
                      {SIGNAL_LABEL[s.type] ?? s.type}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
        {isHlsType && (
          <video ref={videoRef} className="w-full h-full object-contain" autoPlay playsInline muted={!focused} onClick={(e) => togglePlay(e)} />
        )}
        {isEmbedType && currentSignal && (
          <iframe key={`${channel.id}-${signalIndex}`} src={currentSignal.url} className="w-full h-full" allow="autoplay; encrypted-media; fullscreen" allowFullScreen />
        )}
      </div>

      {/* Bottom controls */}
      <div className={`absolute bottom-0 left-0 right-0 z-20 bg-gradient-to-t from-neutral/95 via-neutral/50 to-transparent px-1.5 pb-1 pt-6 transition-opacity ${controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
        <div className="flex items-center justify-between gap-1">
          <div className="flex items-center gap-0.5">
            <button onClick={(e) => { e.stopPropagation(); togglePlay(e); }}
              className="p-1 rounded text-white/80 hover:text-white hover:bg-white/15 transition-colors" title={playing ? 'Pausar' : 'Reproducir'}>
              {playing
                ? <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" /></svg>
                : <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
              }
            </button>
            <button onClick={toggleMute}
              className="p-1 rounded text-white/80 hover:text-white hover:bg-white/15 transition-colors" title={muted ? 'Activar sonido' : 'Silenciar'}>
              {muted
                ? <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M11 5L6 9H2v6h4l5 4V5z" /><line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" /></svg>
                : <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M11 5L6 9H2v6h4l5 4V5z" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" /></svg>
              }
            </button>
            <button onClick={handleFullscreen}
              className="p-1 rounded text-white/80 hover:text-white hover:bg-white/15 transition-colors" title="Pantalla completa">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" /></svg>
            </button>
          </div>
          {hasMultipleSignals && (
            <div className="flex items-center gap-0.5">
              {signals.map((s, i) => (
                <button key={i} onClick={(e) => { e.stopPropagation(); play('interaction.tap'); onSignalChange(i); }}
                  className={`text-[7px] px-1 py-0.5 rounded transition-colors cursor-pointer ${
                    i === signalIndex ? 'bg-primary text-primary-content' : 'text-white/50 hover:text-white hover:bg-white/15'
                  }`}>
                  {SIGNAL_LABEL[s.type] ?? s.type}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
