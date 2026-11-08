import { useEffect, useLayoutEffect, useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { Article } from '../../types';
import { play } from '@/lib/sound';

export interface ArticleReaderOriginRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface ArticleContent {
  title: string;
  description: string;
  author: string;
  publishedTime: string;
  bodyHtml: string;
  body: string;
  url: string;
}

interface Props {
  url: string;
  onClose: () => void;
  initialArticle?: Article;
  /** Rect del disparador (viewport): la entrada/salida se anima desde/ hacia él. */
  originRect?: ArticleReaderOriginRect | null;
}

const fetchCache = new Map<string, ArticleContent>();
const CONTENT_TOO_SHORT = 300;
const ARTICLE_API_VERSION = 'v2';
const MOTION_MS = 220;
const siteLabel = (url: string) => {
  try { return `Abrir en ${new URL(url).hostname.replace(/^www\./, '')}`; } catch { return 'Abrir en sitio original'; }
};

function prefersReducedMotion() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

/** Transform que hace que `panel` (rect final) ocupe visualmente `origin`. */
function originTransform(panel: DOMRect, origin: ArticleReaderOriginRect): string {
  const sx = panel.width > 0 ? Math.max(0.08, origin.width / panel.width) : 0.2;
  const sy = panel.height > 0 ? Math.max(0.08, origin.height / panel.height) : 0.2;
  const tx = origin.left - panel.left;
  const ty = origin.top - panel.top;
  return `translate(${tx}px, ${ty}px) scale(${sx}, ${sy})`;
}

export function ArticleReader({ url, onClose, initialArticle, originRect }: Props) {
  const [fetchedArticle, setFetchedArticle] = useState<ArticleContent | null>(
    () => fetchCache.get(url) || null
  );
  const [loading, setLoading] = useState(() => !fetchCache.has(url));
  const [error, setError] = useState<{ type: string; message: string } | null>(null);
  const [fetchAttempted, setFetchAttempted] = useState(fetchCache.has(url));
  const [phase, setPhase] = useState<'enter' | 'idle' | 'exit'>(
    originRect && !prefersReducedMotion() ? 'enter' : 'idle'
  );
  const [panelMotion, setPanelMotion] = useState<React.CSSProperties>({});
  const [overlayOpacity, setOverlayOpacity] = useState<number | undefined>(
    originRect && !prefersReducedMotion() ? 0 : undefined
  );

  const overlayRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const closingRef = useRef(false);
  onCloseRef.current = onClose;

  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    if (!originRect || !panelRef.current || prefersReducedMotion()) {
      closingRef.current = true;
      onCloseRef.current();
      return;
    }
    closingRef.current = true;
    setPhase('exit');
    const panel = panelRef.current.getBoundingClientRect();
    const transform = originTransform(panel, originRect);
    setPanelMotion({
      transform,
      opacity: 0.18,
      borderRadius: '12px',
      transformOrigin: '0 0',
      transition: `transform ${MOTION_MS}ms cubic-bezier(0.4, 0, 1, 1), opacity ${MOTION_MS - 40}ms ease, border-radius ${MOTION_MS}ms ease`,
      willChange: 'transform, opacity',
    });
    setOverlayOpacity(0);
    window.setTimeout(() => onCloseRef.current(), MOTION_MS + 40);
  }, [originRect]);

  // Entrada: desde el rect del disparador hasta la posición final del panel.
  useLayoutEffect(() => {
    if (phase !== 'enter' || !originRect || !panelRef.current) return;
    const panel = panelRef.current.getBoundingClientRect();
    if (panel.width === 0 || panel.height === 0) { setPhase('idle'); setOverlayOpacity(undefined); return; }
    const from = originTransform(panel, originRect);
    setPanelMotion({
      transform: from,
      opacity: 0.18,
      borderRadius: '12px',
      transformOrigin: '0 0',
      transition: 'none',
      willChange: 'transform, opacity',
    });
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        setOverlayOpacity(1);
        setPanelMotion({
          transform: 'translate(0px, 0px) scale(1, 1)',
          opacity: 1,
          borderRadius: '',
          transformOrigin: '0 0',
          transition: `transform ${MOTION_MS}ms cubic-bezier(0.22, 1, 0.36, 1), opacity 160ms ease, border-radius ${MOTION_MS}ms ease`,
          willChange: 'transform, opacity',
        });
        window.setTimeout(() => {
          setPhase('idle');
          setPanelMotion({});
          setOverlayOpacity(undefined);
        }, MOTION_MS + 40);
      });
    });
    return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); };
  }, [phase, originRect]);

  useEffect(() => {
    const el = overlayRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Move focus into the dialog on open
    const focusTarget = el?.querySelector<HTMLElement>(
      'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    focusTarget?.focus?.();

    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); requestClose(); return; }
      // Trap Tab within the dialog
      if (e.key === 'Tab' && el) {
        const focusables = Array.from(
          el.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
          )
        ).filter((n) => n.offsetParent !== null || n === document.activeElement);
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (e.shiftKey && (active === first || active === el)) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
      }
    };

    window.addEventListener('keydown', handler);
    document.body.style.overflow = 'hidden';

    return () => {
      window.removeEventListener('keydown', handler);
      document.body.style.overflow = '';
      previouslyFocused?.focus?.();
    };
  }, [requestClose]);

  useEffect(() => {
    if (fetchCache.has(url)) {
      setFetchedArticle(fetchCache.get(url)!);
      setFetchAttempted(true);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setFetchAttempted(false);

    fetch(`/api/article?v=${ARTICLE_API_VERSION}&url=${encodeURIComponent(url)}`, { signal: controller.signal })
      .then(r => r.json())
      .then(data => {
        if (data.error) {
          setError({ type: data.error, message: data.message || 'No se pudo cargar el artículo' });
          return;
        }
        fetchCache.set(url, data);
        setFetchedArticle(data);
      })
      .catch(err => {
        if (err.name === 'AbortError') return;
        if (!fetchCache.has(url)) setError({ type: 'fetch_failed', message: 'No se pudo cargar el artículo' });
      })
      .finally(() => {
        setLoading(false);
        setFetchAttempted(true);
      });

    return () => controller.abort();
  }, [url]);

  function handleOverlayClick(e: React.MouseEvent) {
    if (e.target === overlayRef.current) { play('overlay.close'); requestClose(); }
  }

  function handleFetchFullArticle() {
    if (fetchCache.has(url)) {
      setFetchedArticle(fetchCache.get(url)!);
      setFetchAttempted(true);
      return;
    }

    setLoading(true);
    setError(null);
    fetch(`/api/article?v=${ARTICLE_API_VERSION}&url=${encodeURIComponent(url)}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) { setError({ type: data.error, message: data.message || 'No se pudo cargar el artículo' }); return; }
        fetchCache.set(url, data);
        setFetchedArticle(data);
        setFetchAttempted(true);
      })
      .catch(() => setError({ type: 'fetch_failed', message: 'No se pudo cargar el artículo' }))
      .finally(() => setLoading(false));
  }

  const hasRssContent = initialArticle?.description && initialArticle.description.length > 100;
  const isGoogleNews = url.includes('news.google.com');

  return createPortal(
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-label="Lector de artículo"
      tabIndex={-1}
      onClick={handleOverlayClick}
      className={`fixed inset-0 z-50 flex items-start justify-center bg-neutral/70 backdrop-blur-sm ${!originRect ? 'animate-[fadeSlideIn_0.2s_ease-out]' : ''}`}
      style={overlayOpacity !== undefined ? { opacity: overlayOpacity, transition: `opacity ${MOTION_MS}ms ease` } : undefined}
    >
      <div
        ref={panelRef}
        className={`relative w-full max-w-3xl mx-4 my-8 max-h-[calc(100dvh-4rem)] overflow-y-auto rounded-xl bg-base-100 border border-base-300 shadow-2xl ${!originRect ? 'animate-[fadeSlideIn_0.25s_ease-out] origin-top' : ''}`}
        style={panelMotion}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-3 border-b border-base-300 bg-base-100">
          <span className="text-xs text-base-content/70 uppercase tracking-wider">Leyendo artículo</span>
          <div className="flex items-center gap-2">
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => play('interaction.tap')}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded-full bg-primary text-primary-content hover:bg-primary hover:text-primary-content transition-colors ring-1 ring-inset ring-primary"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
              {siteLabel(url)}
            </a>
            <button
              onClick={() => { play('overlay.close'); requestClose(); }}
              className="p-1.5 rounded-lg hover:bg-base-200 hover:ring-1 hover:ring-inset hover:ring-base-content/[0.05] text-base-content/70 hover:text-base-content transition-colors cursor-pointer"
              aria-label="Cerrar"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {loading ? (
          <div className="px-5 sm:px-8 py-6 min-h-[min(72dvh,calc(100dvh-11rem))]" aria-busy="true">
            <p className="sr-only" role="status">Cargando artículo…</p>
            <div className="space-y-4" aria-hidden="true">
              <div className="space-y-2">
                <div className="h-5 w-4/5 rounded bg-base-300 skel-shimmer" />
                <div className="h-5 w-2/3 rounded bg-base-300 skel-shimmer" />
              </div>
              <div className="flex gap-3 pt-1">
                <div className="h-2.5 w-24 rounded bg-base-300 skel-shimmer" />
                <div className="h-2.5 w-32 rounded bg-base-300 skel-shimmer" />
              </div>
              <div className="space-y-2 pt-2">
                <div className="h-3 w-full rounded bg-base-300 skel-shimmer" />
                <div className="h-3 w-full rounded bg-base-300 skel-shimmer" />
                <div className="h-3 w-5/6 rounded bg-base-300 skel-shimmer" />
              </div>
              <div className="space-y-2 pt-4 border-t border-base-300">
                {[100, 100, 92, 100, 84, 100, 76, 100, 88, 100, 64, 100, 52].map((w, i) => (
                  <div key={i} className="h-3 rounded bg-base-300 skel-shimmer" style={{ width: `${w}%` }} />
                ))}
              </div>
            </div>
          </div>
        ) : error ? (
          <div className="py-16 text-center px-8">
            {error.type === 'google_news_unsupported' ? (
              <>
                <div className="flex items-center justify-center gap-2 text-sm text-base-content/70 mb-4">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="16" x2="12" y2="12" />
                    <line x1="12" y1="8" x2="12.01" y2="8" />
                  </svg>
                  <span>Google News no permite lectura local</span>
                </div>
                <p className="text-xs text-base-content/70 max-w-sm mx-auto mb-6 leading-relaxed">
                  {error.message}
                </p>
              </>
            ) : (
              <p className="text-base-content/70 text-sm mb-4">{error.message}</p>
            )}
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => play('interaction.tap')}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-primary text-primary-content hover:opacity-90 transition-[opacity,transform] active:scale-[0.96]"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
              {siteLabel(url)}
            </a>
          </div>
        ) : fetchedArticle && fetchAttempted ? (
          <div className="px-8 py-6 space-y-5">
            <h2 className="text-lg font-bold text-base-content leading-snug">{fetchedArticle.title}</h2>
            {(fetchedArticle.author || fetchedArticle.publishedTime) && (
              <div className="flex items-center gap-3 text-[11px] text-base-content/70">
                {fetchedArticle.author && <span>{fetchedArticle.author}</span>}
                {fetchedArticle.publishedTime && (
                  <span>{new Date(fetchedArticle.publishedTime).toLocaleDateString('es-CL', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                )}
              </div>
            )}
            {fetchedArticle.description && (
              <p className="text-sm text-base-content/70 leading-relaxed">{fetchedArticle.description}</p>
            )}
            {(!fetchedArticle.bodyHtml || fetchedArticle.bodyHtml.length < CONTENT_TOO_SHORT) && (
              <div className="pt-4 pb-2 flex flex-col items-center gap-4 text-center">
                <div className="flex items-center gap-2 text-sm text-base-content/70">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                  <span>El contenido no se pudo extraer automáticamente</span>
                </div>
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => play('interaction.tap')}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-primary text-primary-content hover:opacity-90 transition-[opacity,transform] active:scale-[0.96]"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                    <polyline points="15 3 21 3 21 9" />
                    <line x1="10" y1="14" x2="21" y2="3" />
                  </svg>
                  Cargar artículo completo
                </a>
              </div>
            )}
            <div
              className="pt-3 border-t border-base-300 article-body text-base text-base-content leading-[1.75] max-w-[70ch] mx-auto [&_p]:mb-4 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-base-content [&_h2]:mt-6 [&_h2]:mb-3 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:text-base-content [&_h3]:mt-5 [&_h3]:mb-2 [&_a]:text-base-content [&_a]:underline [&_a]:decoration-primary/50 [&_a]:underline-offset-2 [&_a]:hover:decoration-primary [&_img]:rounded-lg [&_img]:max-w-full [&_img]:h-auto [&_img]:my-6 [&_img]:max-h-[500px] [&_img]:w-auto [&_img]:object-contain [&_img]:mx-auto [&_img]:shadow-md               [&_blockquote]:border-l-[1.5px] [&_blockquote]:border-primary/40 [&_blockquote]:pl-4 [&_blockquote]:text-base-content/70 [&_blockquote]:italic [&_blockquote]:my-4 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:space-y-1.5 [&_figure]:my-6 [&_figure_img]:my-0 [&_figcaption]:text-[11px] [&_figcaption]:text-base-content/70 [&_figcaption]:mt-1.5 [&_figcaption]:text-center"
              dangerouslySetInnerHTML={{ __html: fetchedArticle.bodyHtml }}
            />
          </div>
        ) : isGoogleNews ? (
          <div className="px-8 py-6 space-y-5">
            <h2 className="text-lg font-bold text-base-content leading-snug">
              {initialArticle?.title || 'Artículo'}
            </h2>
            {initialArticle?.description && (
              <p className="text-sm text-base-content/70 leading-relaxed">{initialArticle.description}</p>
            )}
            <div className="pt-4 pb-2 flex flex-col items-center gap-4 text-center border-t border-base-300">
              <div className="flex items-center justify-center gap-2 text-sm text-base-content/70">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="16" x2="12" y2="12" />
                  <line x1="12" y1="8" x2="12.01" y2="8" />
                </svg>
                <span>Google News no permite lectura local</span>
              </div>
              <p className="text-xs text-base-content/70 max-w-sm leading-relaxed">
                Google News utiliza URLs de redirect internos en su RSS (news.google.com/rss/articles/...) que no permiten acceder directamente al contenido de la fuente original. Esta es una limitación del sistema de RSS de Google News.
              </p>
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => play('interaction.tap')}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-primary text-primary-content hover:opacity-90 transition-[opacity,transform] active:scale-[0.96]"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
                {siteLabel(url)}
              </a>
            </div>
          </div>
        ) : (
          <div className="px-8 py-6 space-y-5">
            <h2 className="text-lg font-bold text-base-content leading-snug">
              {initialArticle?.title || 'Artículo'}
            </h2>
            {initialArticle?.description && (
              <p className="text-sm text-base-content/70 leading-relaxed">{initialArticle.description}</p>
            )}
            {!hasRssContent && (
              <div className="pt-4 pb-2 flex flex-col items-center gap-4 text-center">
                <div className="flex items-center gap-2 text-sm text-base-content/70">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                  <span>El contenido no se pudo extraer automáticamente</span>
                </div>
              </div>
            )}
            <div className="flex justify-center pt-2">
              <button
                onClick={() => { play('interaction.tap'); handleFetchFullArticle(); }}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-primary text-primary-content hover:opacity-90 transition-[opacity,transform] active:scale-[0.96] cursor-pointer"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Cargar artículo completo
              </button>
            </div>
          </div>
        )}

        <div className="sticky bottom-0 z-10 flex items-center justify-center gap-3 px-5 py-3 border-t border-base-300 bg-base-100">
          <button
            onClick={() => { play('overlay.close'); requestClose(); }}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-base-200 text-base-content ring-1 ring-inset ring-base-content/[0.06] hover:bg-base-300 hover:ring-base-content/[0.12] transition-[background-color,box-shadow,transform] active:scale-[0.98] cursor-pointer"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
            Cerrar
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
