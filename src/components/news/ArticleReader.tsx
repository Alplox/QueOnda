import { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { Article } from '../../types';
import { play } from '@/lib/sound';

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
}

const fetchCache = new Map<string, ArticleContent>();
const CONTENT_TOO_SHORT = 300;
const siteLabel = (url: string) => {
  try { return `Abrir en ${new URL(url).hostname.replace(/^www\./, '')}`; } catch { return 'Abrir en sitio original'; }
};

export function ArticleReader({ url, onClose, initialArticle }: Props) {
  const [fetchedArticle, setFetchedArticle] = useState<ArticleContent | null>(
    () => fetchCache.get(url) || null
  );
  const [loading, setLoading] = useState(() => !fetchCache.has(url));
  const [error, setError] = useState<{ type: string; message: string } | null>(null);
  const [fetchAttempted, setFetchAttempted] = useState(fetchCache.has(url));
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', handler);
      document.body.style.overflow = '';
    };
  }, [onClose]);

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

    fetch(`/api/article?url=${encodeURIComponent(url)}`, { signal: controller.signal })
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
    if (e.target === overlayRef.current) onClose();
  }

  function handleFetchFullArticle() {
    if (fetchCache.has(url)) {
      setFetchedArticle(fetchCache.get(url)!);
      setFetchAttempted(true);
      return;
    }

    setLoading(true);
    setError(null);
    fetch(`/api/article?url=${encodeURIComponent(url)}`)
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
      onClick={(e) => { play('overlay.close'); handleOverlayClick(e); }}
      className="fixed inset-0 z-50 flex items-start justify-center bg-neutral/70 backdrop-blur-sm animate-[fadeSlideIn_0.2s_ease-out]"
    >
      <div className="relative w-full max-w-3xl mx-4 my-8 max-h-[calc(100dvh-4rem)] overflow-y-auto rounded-xl bg-base-100 border border-base-300 shadow-2xl animate-[fadeSlideIn_0.25s_ease-out] origin-top">
        <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-3 border-b border-base-300 bg-base-100">
          <span className="text-xs text-base-content/70 uppercase tracking-wider">Leyendo artículo</span>
          <div className="flex items-center gap-2">
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => play('interaction.tap')}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded-full bg-primary text-primary-content hover:bg-primary hover:text-primary-content transition-all ring-1 ring-inset ring-primary"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
              {siteLabel(url)}
            </a>
            <button
              onClick={() => { play('overlay.close'); onClose(); }}
              className="p-1.5 rounded-lg hover:bg-base-200 hover:ring-1 hover:ring-inset hover:ring-base-content/[0.05] text-base-content/70 hover:text-base-content transition-all cursor-pointer"
              aria-label="Cerrar"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
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
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-primary text-primary-content hover:opacity-90 transition-all active:scale-[0.97]"
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
              <div className="flex items-center gap-3 text-[10px] text-base-content/70">
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
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-primary text-primary-content hover:opacity-90 transition-all active:scale-[0.97]"
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
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-primary text-primary-content hover:opacity-90 transition-all active:scale-[0.97]"
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
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-primary text-primary-content hover:opacity-90 transition-all active:scale-[0.97] cursor-pointer"
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
      </div>
    </div>,
    document.body
  );
}