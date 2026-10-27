import { useEffect, useId, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import type { Article, NewsCluster } from '../../types';
import { ArticleReader } from './ArticleReader';
import { FaviconImg } from './FaviconImg';
import { play } from '@/lib/sound';
import { extractHost } from '@/lib/url';

interface Props {
  cluster: NewsCluster;
  openDirect: boolean;
}

type SourceGroup = [string, Article[]];

function groupBySource(articles: Article[]): SourceGroup[] {
  const groups = new Map<string, Article[]>();
  for (const article of articles) {
    const existing = groups.get(article.source);
    if (existing) {
      existing.push(article);
    } else {
      groups.set(article.source, [article]);
    }
  }
  return [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
}

function formatPubDate(pubDate: string): string {
  const date = new Date(pubDate);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('es-CL', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function NewsClusterCard({ cluster, openDirect }: Props) {
  const [readerArticle, setReaderArticle] = useState<Article | null>(null);
  const [openSource, setOpenSource] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  const mainArticle = cluster.articles.find(a => a.image) ?? cluster.articles[0];
  const sources = groupBySource(cluster.articles);
  const mainDate = formatPubDate(mainArticle.pubDate);

  function handleMainClick(e: MouseEvent<HTMLAnchorElement>) {
    play('interaction.tap');
    if (!openDirect) {
      e.preventDefault();
      setReaderArticle(mainArticle);
    }
  }

  function openArticle(e: MouseEvent<HTMLAnchorElement>, article: Article) {
    play('interaction.tap');
    if (!openDirect) {
      e.preventDefault();
      setReaderArticle(article);
    }
  }

  // El listado de un medio vive en un panel flotante, no en un acordeón: si
  // expandiera dentro de la card, la fila entera crecería y las demás cards
  // cambiarían de tamaño con cada clic.
  useEffect(() => {
    if (!openSource) return;

    // `preventScroll`: si no, enfocar el primer artículo arrastra el slider
    // ~6 px (el contenedor scrollea para revelar el foco) y el gap del borde
    // izquierdo deja de coincidir.
    panelRef.current?.querySelector<HTMLAnchorElement>('a')?.focus({ preventScroll: true });

    const close = () => setOpenSource(null);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      close();
      triggerRef.current?.focus({ preventScroll: true });
    };

    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [openSource]);

  return (
    <>
      <div className="w-full rounded-xl bg-base-200 border border-base-300 overflow-hidden hover:border-primary/60 shadow-sm transition-colors h-full flex flex-col group">
        <a
          href={mainArticle.link}
          target="_blank"
          rel="noopener noreferrer"
          onClick={handleMainClick}
          tabIndex={-1}
          aria-hidden="true"
          className="block shrink-0 cursor-pointer"
        >
          {mainArticle.image ? (
            <img
              src={mainArticle.image}
              alt=""
              className="w-full h-32 object-cover ring-1 ring-inset ring-black/5 dark:ring-white/10 transition-transform duration-300 group-hover:scale-105"
              loading="lazy"
            />
          ) : (
            <div className="w-full h-32 bg-base-300/50 flex items-center justify-center">
              <svg className="w-8 h-8 text-base-content/15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-4 0v-4a2 2 0 0 1 2-2h2" />
                <path d="M14 2v6l2-2 2 2V2" />
              </svg>
            </div>
          )}
        </a>

        <div className="p-3.5 flex flex-col flex-1">
          {/* El titular es de UN medio: se dice cuál, con su favicon, antes del
              título. El chip de la derecha es el dato del tema (cuántos medios). */}
          <div className="flex items-center gap-1.5 mb-1.5 min-w-0 flex-shrink-0">
            <FaviconImg domain={extractHost(mainArticle.link)} className="w-3.5 h-3.5 rounded shrink-0" />
            <span className="text-[11px] font-medium text-base-content/80 truncate">
              {mainArticle.source}
            </span>
            {mainDate && (
              <>
                <span aria-hidden="true" className="text-[11px] text-base-content/70">·</span>
                <span className="text-[11px] text-base-content/70 tabular-nums shrink-0">
                  {mainDate}
                </span>
              </>
            )}
            <span className="ml-auto shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary tabular-nums">
              {sources.length} {sources.length === 1 ? 'fuente' : 'fuentes'}
            </span>
          </div>

          <div className="flex items-start gap-1">
            <a
              href={mainArticle.link}
              target="_blank"
              rel="noopener noreferrer"
              onClick={handleMainClick}
              className="flex-1 min-w-0 rounded-md text-left cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <h3 className="text-base font-semibold text-pretty text-base-content leading-snug tracking-tight transition-colors line-clamp-3" style={{ fontFamily: 'inherit' }}>
                {mainArticle.title}
              </h3>
            </a>
            <button
              onClick={() => setReaderArticle(mainArticle)}
              className="shrink-0 p-1.5 mt-0.5 rounded-md hover:bg-base-300 active:scale-95 text-base-content/70 hover:text-base-content transition-[color,background-color,transform] cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
              title="Leer en ventana flotante"
              aria-label={`Leer el titular de ${mainArticle.source} en modal`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
              </svg>
            </button>
          </div>

          {sources.length > 0 && (
            <div className="mt-auto pt-2.5 border-t border-base-300/70">
              <ul className="space-y-0.5">
                {sources.map(([source, srcArticles], i) => {
                  const isOpen = openSource === source;
                  const itemPanelId = `${panelId}-${i}`;
                  return (
                    <li key={source} className="relative">
                      <button
                        ref={isOpen ? triggerRef : undefined}
                        onClick={() => setOpenSource(isOpen ? null : source)}
                        onPointerDown={(e) => e.stopPropagation()}
                        aria-expanded={isOpen}
                        aria-controls={isOpen ? itemPanelId : undefined}
                        className={`w-full flex items-center gap-2 px-2 py-1 rounded-lg text-left cursor-pointer transition-colors hover:bg-base-300 active:bg-base-300 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary ${isOpen ? 'bg-base-300' : ''}`}
                      >
                        <FaviconImg domain={extractHost(srcArticles[0].link)} className="w-3.5 h-3.5 rounded shrink-0" />
                        <span className="text-xs font-medium text-base-content/80 truncate">
                          {source}
                        </span>
                        <span className="text-[10px] font-semibold text-base-content/70 bg-base-300 px-1.5 py-0.5 rounded-full tabular-nums shrink-0">
                          {srcArticles.length}
                        </span>
                        <svg
                          className={`w-3 h-3 ml-auto text-base-content/70 shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          aria-hidden="true"
                        >
                          <polyline points="6 9 12 15 18 9" />
                        </svg>
                      </button>

                      {isOpen && (
                        <div
                          id={itemPanelId}
                          ref={panelRef}
                          onPointerDown={(e) => e.stopPropagation()}
                          className="absolute bottom-full left-0 right-0 z-20 mb-1 max-h-[180px] overflow-y-auto overscroll-contain rounded-lg border border-base-300 bg-base-100 p-1 shadow-lg"
                        >
                          <p className="px-2 pt-1 pb-1 text-[10px] uppercase tracking-wider text-base-content/70 truncate">
                            {source} · {srcArticles.length} {srcArticles.length === 1 ? 'artículo' : 'artículos'}
                          </p>
                          {srcArticles.map((article, i) => (
                            <div key={i} className="flex items-start gap-1">
                              <a
                                href={article.link}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => openArticle(e, article)}
                                className="flex-1 min-w-0 rounded-md px-2 py-1.5 text-xs text-base-content/80 leading-snug line-clamp-2 transition-colors hover:bg-base-200 hover:text-base-content active:bg-base-200 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
                              >
                                {article.title}
                              </a>
                              <button
                                onClick={() => setReaderArticle(article)}
                                className="shrink-0 p-1.5 rounded-md hover:bg-base-200 active:scale-95 text-base-content/70 hover:text-base-content transition-[color,background-color,transform] cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
                                title="Leer en ventana flotante"
                                aria-label={`Leer artículo de ${source} en modal`}
                              >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                  <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                                  <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
                                </svg>
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      </div>
      {readerArticle && (
        <ArticleReader url={readerArticle.link} initialArticle={readerArticle} onClose={() => setReaderArticle(null)} />
      )}
    </>
  );
}
