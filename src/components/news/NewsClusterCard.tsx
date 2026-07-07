import { useState } from 'react';
import type { NewsCluster } from '../../types';
import { ArticleReader } from './ArticleReader';

interface Props {
  cluster: NewsCluster;
  openDirect: boolean;
}

export function NewsClusterCard({ cluster, openDirect }: Props) {
  const [readerArticle, setReaderArticle] = useState<typeof cluster.articles[number] | null>(null);
  const [expandedSource, setExpandedSource] = useState<string | null>(null);
  const mainArticle = cluster.articles[0];

  const groupedBySource = () => {
    const groups = new Map<string, typeof cluster.articles>();
    for (const article of cluster.articles) {
      const existing = groups.get(article.source);
      if (existing) {
        existing.push(article);
      } else {
        groups.set(article.source, [article]);
      }
    }
    return [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  };

  function handleClick(article: typeof cluster.articles[number]) {
    if (openDirect) {
      window.open(article.link, '_blank', 'noopener,noreferrer');
    } else {
      setReaderArticle(article);
    }
  }

  function toggleSource(source: string) {
    setExpandedSource(prev => prev === source ? null : source);
  }

  return (
    <>
      <div className="rounded-xl bg-base-200 border border-base-300 overflow-hidden hover:border-primary/60 shadow-sm transition-colors h-full flex flex-col group">
        {mainArticle.image ? (
          <img
            src={mainArticle.image}
            alt=""
            className="w-full h-40 object-cover flex-shrink-0 ring-1 ring-inset ring-black/5 dark:ring-white/10 transition-transform duration-300 group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-40 bg-base-300/50 flex items-center justify-center flex-shrink-0">
            <svg className="w-8 h-8 text-base-content/15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-4 0v-4a2 2 0 0 1 2-2h2" />
              <path d="M14 2v6l2-2 2 2V2" />
            </svg>
          </div>
        )}

        <div className="p-4 flex flex-col flex-1">
          <div className="flex items-center gap-2 mb-2 flex-shrink-0">
            <span className="text-xs font-medium text-base-content/70">
              {cluster.sourceCount} {cluster.sourceCount === 1 ? 'fuente' : 'fuentes'}
            </span>
            <span className="text-base-content/50">·</span>
            <span className="text-xs text-base-content/70">
              {new Date(mainArticle.pubDate).toLocaleDateString('es-CL', {
                day: 'numeric',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          </div>

          <div className="flex items-start gap-1 group">
            <button
              onClick={() => handleClick(mainArticle)}
              className="flex-1 text-left cursor-pointer"
            >
              <h3 className="text-lg font-bold text-balance text-base-content leading-tight tracking-tight transition-colors line-clamp-3" style={{ fontFamily: 'inherit' }}>
                {mainArticle.title}
              </h3>
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); setReaderArticle(mainArticle); }}
              className="shrink-0 p-1 mt-0.5 rounded-md opacity-50 group-hover:opacity-100 focus:opacity-100 hover:bg-base-300 text-base-content/40 hover:text-base-content transition-all cursor-pointer"
              title="Leer en ventana flotante"
              aria-label="Leer en modal"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
              </svg>
            </button>
          </div>

          {groupedBySource().length > 0 && (
            <div className="mt-3 space-y-1 flex-1">
              {groupedBySource().map(([source, srcArticles]) => {
                const isExpanded = expandedSource === source;
                return (
                  <div key={source}>
                    <button
                      onClick={() => toggleSource(source)}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left cursor-pointer hover:bg-base-300 transition-colors group/source"
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                      <span className="text-xs font-medium text-base-content/80 truncate">
                        {source}
                      </span>
                      <span className="text-[10px] font-semibold text-base-content/40 bg-base-300 px-1.5 py-0.5 rounded-full shrink-0">
                        {srcArticles.length}
                      </span>
                      <svg
                        className={`w-3 h-3 ml-auto text-base-content/30 shrink-0 transition-transform duration-200 ${
                          isExpanded ? 'rotate-180' : ''
                        }`}
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </button>
                    <div
                      className={`ml-3 pl-3 border-l-2 border-base-300 overflow-hidden transition-[max-height] duration-300 ease-out ${
                        isExpanded ? 'max-h-[500px]' : 'max-h-0'
                      }`}
                    >
                      {isExpanded && (
                        <div className="space-y-0.5 mt-0.5">
                          {srcArticles.map((article, i) => (
                            <div
                              key={i}
                              className="flex items-center gap-1 group/article"
                            >
                              <button
                                onClick={() => handleClick(article)}
                                className="flex-1 text-left min-w-0 py-1 px-2 rounded-md hover:bg-base-300 transition-colors cursor-pointer"
                              >
                                <p className="text-xs text-base-content/80 leading-snug line-clamp-2">
                                  {article.title}
                                </p>
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); setReaderArticle(article); }}
                                className="shrink-0 p-1 rounded-md opacity-0 group-hover/article:opacity-100 focus:opacity-100 hover:bg-base-300 text-base-content/40 hover:text-base-content transition-all cursor-pointer"
                                title="Leer en ventana flotante"
                                aria-label="Leer en modal"
                              >
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                                  <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
                                </svg>
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
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
