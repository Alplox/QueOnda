import { useEffect, useRef, useState } from 'react';

export function SpotifyChart() {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [meta, setMeta] = useState<{ title: string; thumbnailUrl: string }>({ title: 'Top 50 - Chile', thumbnailUrl: '' });
  const [retryKey, setRetryKey] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(null);

  useEffect(() => {
    fetch('/api/spotify')
      .then(r => r.json())
      .then(d => setMeta(d))
      .catch(() => {});

    timerRef.current = setTimeout(() => setFailed(true), 30000);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  useEffect(() => {
    if (loaded && timerRef.current) {
      clearTimeout(timerRef.current);
      setFailed(false);
    }
  }, [loaded]);

  return (
    <div>
      <div className={`rounded-xl overflow-hidden bg-base-200 border border-base-300 transition-opacity duration-500 ${loaded ? 'opacity-100' : 'opacity-60'}`}>
        {!failed ? (
          <>
            <iframe
              key={retryKey}
              src="https://open.spotify.com/embed/playlist/37i9dQZEVXbL0GavIqMTeb?utm_source=generator"
              width="100%"
              height="380"
              allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
              className="border-0"
              loading="lazy"
              title="Spotify Top 50 Chile"
              onLoad={() => setLoaded(true)}
              onError={() => setFailed(true)}
            />
            {!loaded && (
              <div className="h-[380px] flex items-center justify-center -mt-[380px] relative z-10">
                <div className="flex flex-col items-center gap-3">
                  <div className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                  <span className="text-[10px] text-base-content/70">Cargando playlist...</span>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="h-[380px] flex flex-col items-center justify-center gap-4 p-6">
            {meta.thumbnailUrl ? (
              <img src={meta.thumbnailUrl} alt="" className="w-32 h-32 rounded-xl shadow-lg ring-1 ring-black/10" loading="lazy" />
            ) : (
              <div className="w-32 h-32 rounded-xl bg-base-300 flex items-center justify-center">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor" className="text-base-content/50"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.56 17.438c-.214.35-.614.48-.963.266-2.486-1.508-5.634-1.856-9.297-1.023-.466.107-.914-.203-1.02-.668-.108-.466.202-.915.667-1.02 4.11-.94 7.686-.544 10.566 1.21.349.214.48.613.266.963l-.21.24-.01.032zm1.666-3.006c-.27.438-.83.572-1.268.302-2.808-1.706-7.05-2.24-10.355-1.222-.534.166-1.108-.134-1.274-.667-.166-.534.134-1.108.667-1.274 3.813-1.186 8.646-.586 11.914 1.392.438.27.573.83.302 1.268l.014.001v0zm.15-3.134c-3.312-1.98-8.934-2.178-12.145-1.205-.638.194-1.312-.164-1.506-.803-.194-.638.164-1.312.803-1.506 3.786-1.15 9.85-.89 13.848 1.557.556.345.738 1.086.393 1.642-.345.556-1.086.738-1.642.393l-.002-.002.251-.076z"/></svg>
              </div>
            )}
            <p className="text-sm font-semibold text-base-content text-center">{meta.title}</p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => { setFailed(false); setLoaded(false); setRetryKey(k => k + 1); }}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-base-300 text-base-content text-xs font-medium hover:bg-base-content/10 transition-colors"
              >
                Reintentar
              </button>
              <a
                href="https://open.spotify.com/playlist/37i9dQZEVXbL0GavIqMTeb"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary text-primary-content text-xs font-medium hover:opacity-90 transition-opacity"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.56 17.438c-.214.35-.614.48-.963.266-2.486-1.508-5.634-1.856-9.297-1.023-.466.107-.914-.203-1.02-.668-.108-.466.202-.915.667-1.02 4.11-.94 7.686-.544 10.566 1.21.349.214.48.613.266.963l-.21.24-.01.032zm1.666-3.006c-.27.438-.83.572-1.268.302-2.808-1.706-7.05-2.24-10.355-1.222-.534.166-1.108-.134-1.274-.667-.166-.534.134-1.108.667-1.274 3.813-1.186 8.646-.586 11.914 1.392.438.27.573.83.302 1.268l.014.001v0zm.15-3.134c-3.312-1.98-8.934-2.178-12.145-1.205-.638.194-1.312-.164-1.506-.803-.194-.638.164-1.312.803-1.506 3.786-1.15 9.85-.89 13.848 1.557.556.345.738 1.086.393 1.642-.345.556-1.086.738-1.642.393l-.002-.002.251-.076z"/></svg>
                Abrir en Spotify
              </a>
            </div>
          </div>
        )}
      </div>
      <div className="mt-2 text-right text-[10px] text-base-content/70">
        Fuente:{' '}
        <a href="https://open.spotify.com/playlist/37i9dQZEVXbL0GavIqMTeb" target="_blank" rel="noopener noreferrer" className="text-base-content/70  hover:text-base-content transition-colors underline underline-offset-2">
          Spotify "Top 50 Chile" playlist
        </a>
      </div>
    </div>
  );
}
