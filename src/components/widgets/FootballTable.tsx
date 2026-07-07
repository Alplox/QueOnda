import { useEffect, useRef, useState } from 'react';
import { ArticleReader } from '../news/ArticleReader';
import { play } from '@/lib/sound';

interface StandingEntry {
  position: number;
  team: string;
  crest: string | null;
  playedGames: number;
  won: number;
  draw: number;
  lost: number;
  points: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  rankChange: number;
}

interface MatchEntry {
  id: number;
  date: string;
  status: 'SCHEDULED' | 'TIMED' | 'IN_PLAY' | 'PAUSED' | 'FINISHED' | 'POSTPONED' | 'CANCELLED';
  homeTeam: string;
  homeCrest: string | null;
  awayTeam: string;
  awayCrest: string | null;
  homeScore: number | null;
  awayScore: number | null;
}

interface Article {
  title: string;
  link: string;
  description: string;
  source: string;
}

const INITIAL_COUNT = 6;
const LOAD_MORE = 6;

const SPORT_SOURCE_STYLES: Record<string, string> = {
  'La Tercera': 'bg-info/10 text-info border-info/20',
  'Cooperativa Deportes': 'bg-error/10 text-error border-error/20',
  'Cooperativa Fútbol': 'bg-error/10 text-error border-error/20',
  'RedGol': 'bg-success/10 text-success border-success/20',
  'Terra Chile': 'bg-warning/10 text-warning border-warning/20',
  'ADN Radio': 'bg-primary text-primary-content border-primary',
  'Al Aire Libre': 'bg-primary text-primary-content border-primary',
  'ESPN': 'bg-error/10 text-error border-error/20',
};

function getSourceStyle(source: string): string {
  return SPORT_SOURCE_STYLES[source] || 'bg-base-300 text-base-content/70 border-base-300';
}

function formatDate(utc: string): string {
  if (!utc) return '';
  const d = new Date(utc);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const opts: Intl.DateTimeFormatOptions = isToday
    ? { hour: '2-digit', minute: '2-digit' }
    : { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' };
  return d.toLocaleDateString('es-CL', opts);
}

export function FootballTable() {
  const [data, setData] = useState<{
    standings: StandingEntry[];
    matches: MatchEntry[];
    articles: Article[];
    source: 'espn' | 'rss';
    error?: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [limit, setLimit] = useState(INITIAL_COUNT);
  const [readerUrl, setReaderUrl] = useState<string | null>(null);
  const loadMoreRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    fetch('/api/futbol')
      .then((r) => r.json())
      .then((res) => setData(res))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const visibleArticles = data?.articles.slice(0, limit) || [];
  const hasMore = limit < (data?.articles.length || 0);

  useEffect(() => {
    if (limit > INITIAL_COUNT && loadMoreRef.current) {
      loadMoreRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [limit]);

  const liveMatches = data?.matches.filter(m => m.status === 'IN_PLAY' || m.status === 'PAUSED') || [];
  const finishedMatches = data?.matches.filter(m => m.status === 'FINISHED').reverse() || [];
  const upcomingMatches = data?.matches.filter(m => m.status === 'SCHEDULED' || m.status === 'TIMED') || [];

  const standings = data?.standings || [];
  const totalTeams = standings.length;

  if (loading) {
    return (
      <div className="rounded-xl bg-base-200 border border-base-300 overflow-hidden animate-pulse">
        <div className="p-4 border-b border-base-300">
          <div className="h-3 bg-base-300 rounded w-32" />
        </div>
        <div className="p-4 space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="h-4 w-4 bg-base-300 rounded" />
              <div className="h-5 w-5 bg-base-300 rounded-full shrink-0" />
              <div className="h-3 bg-base-300 rounded flex-1" />
              <div className="h-3 w-6 bg-base-300 rounded" />
              <div className="h-3 w-6 bg-base-300 rounded" />
              <div className="h-3 w-6 bg-base-300 rounded" />
              <div className="h-3 w-6 bg-base-300 rounded" />
              <div className="h-3 w-6 bg-base-300 rounded" />
              <div className="h-4 w-8 bg-base-300 rounded" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <>
    <div className="rounded-xl bg-base-200 border border-base-300 shadow-sm overflow-hidden">
      <div className="p-4 border-b border-base-300 flex items-baseline justify-between">
        <p className="text-xs text-base-content/70 uppercase tracking-wider">Fútbol chileno</p>
        {standings.length > 0 && (
          <p className="text-[10px] text-base-content/40">{totalTeams} equipos</p>
        )}
      </div>

      {data?.error && (
        <div className="px-4 py-2 text-[10px] text-base-content/70 border-b border-base-300">
          {data.error}
        </div>
      )}

      {/* Standings */}
      {standings.length > 0 && (
        <div className="border-b border-base-300">
          <div className="px-4 py-2 border-b border-base-300 bg-base-300/30">
            <p className="text-[10px] text-base-content/70 font-semibold uppercase tracking-wider">Tabla de posiciones</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-base-content/40 text-[10px] uppercase tracking-wider border-b border-base-300">
                  <th className="text-left px-3 py-1.5 font-medium w-8">#</th>
                  <th className="text-left px-1 py-1.5 font-medium" colSpan={2}>Equipo</th>
                  <th className="text-center px-2 py-1.5 font-medium w-7">PJ</th>
                  <th className="text-center px-2 py-1.5 font-medium w-7">G</th>
                  <th className="text-center px-2 py-1.5 font-medium w-7">E</th>
                  <th className="text-center px-2 py-1.5 font-medium w-7">P</th>
                  <th className="text-center px-2 py-1.5 font-medium w-7">DG</th>
                  <th className="text-center px-3 py-1.5 font-medium w-9">Pts</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-base-300/50">
                {standings.map((s) => {
                  const isTop3 = s.position <= 3;
                  const isRelegation = s.position > totalTeams - 2;
                  return (
                  <tr
                    key={s.position}
                    className={`hover:bg-base-300/40 transition-colors ${
                      isTop3 ? 'bg-success/[0.03]' : isRelegation ? 'bg-error/[0.03]' : ''
                    }`}
                  >
                    <td className={`px-3 py-2 text-sm font-mono tabular-nums ${
                      isTop3 ? 'font-bold text-success' : isRelegation ? 'font-bold text-error' : 'text-base-content/70'
                    }`}>
                      <div className="flex items-center gap-1">
                        {s.position}
                        {s.rankChange !== 0 && (
                          <span className={`text-[9px] ${s.rankChange > 0 ? 'text-success' : 'text-error'}`}>
                            {s.rankChange > 0 ? '↑' : '↓'}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-1 py-2 w-8">
                      {s.crest && <img src={s.crest} alt="" className="w-6 h-6 object-contain ring-1 ring-inset ring-black/5 dark:ring-white/10 rounded-full" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none'; }} />}
                    </td>
                    <td className="py-2 pr-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="truncate font-medium text-sm text-base-content">{s.team}</span>
                        {isTop3 && (
                          <span className="badge badge-xs badge-success shrink-0">Líder</span>
                        )}
                        {isRelegation && (
                          <span className="badge badge-xs badge-error shrink-0">Descenso</span>
                        )}
                      </div>
                    </td>
                    <td className="text-center px-2 py-2 text-base-content/70 font-mono tabular-nums text-xs">{s.playedGames}</td>
                    <td className="text-center px-2 py-2 text-success font-mono tabular-nums text-xs">{s.won}</td>
                    <td className="text-center px-2 py-2 text-base-content/70 font-mono tabular-nums text-xs">{s.draw}</td>
                    <td className="text-center px-2 py-2 text-error font-mono tabular-nums text-xs">{s.lost}</td>
                    <td className={`text-center px-2 py-2 font-mono tabular-nums text-xs ${
                      s.goalDifference > 0 ? 'text-success' : s.goalDifference < 0 ? 'text-error' : 'text-base-content/70'
                    }`}>
                      {s.goalDifference > 0 ? `+${s.goalDifference}` : s.goalDifference}
                    </td>
                    <td className="text-center px-3 py-2 font-bold text-base-content font-mono tabular-nums text-sm">{s.points}</td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Live Matches */}
      {liveMatches.length > 0 && (
        <div className="border-b border-base-300">
          <div className="px-4 py-2 border-b border-base-300 bg-base-300/30">
            <p className="text-[10px] text-base-content/70 font-semibold uppercase tracking-wider flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
              En vivo
            </p>
          </div>
          <div className="divide-y divide-base-300">
            {liveMatches.map((m) => (
              <div key={m.id} className="px-4 py-3 bg-success/[0.04] border-l-2 border-l-success animate-pulse">
                <div className="flex items-center justify-center gap-4">
                  <div className="flex items-center gap-2 flex-1 justify-end min-w-0">
                    <span className="text-sm font-medium text-base-content truncate text-right">{m.homeTeam}</span>
                    {m.homeCrest && <img src={m.homeCrest} alt="" className="w-7 h-7 object-contain shrink-0 ring-1 ring-inset ring-black/5 dark:ring-white/10 rounded-full" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none'; }} />}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-base font-bold font-mono tabular-nums text-base-content">
                      {m.homeScore ?? '-'} – {m.awayScore ?? '-'}
                    </span>
                    <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
                  </div>
                  <div className="flex items-center gap-2 flex-1 justify-start min-w-0">
                    {m.awayCrest && <img src={m.awayCrest} alt="" className="w-7 h-7 object-contain shrink-0 ring-1 ring-inset ring-black/5 dark:ring-white/10 rounded-full" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none'; }} />}
                    <span className="text-sm font-medium text-base-content truncate">{m.awayTeam}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Finished Matches */}
      {finishedMatches.length > 0 && (
        <div className="border-b border-base-300">
          <div className="px-4 py-2 border-b border-base-300 bg-base-300/30">
            <p className="text-[10px] text-base-content/70 font-semibold uppercase tracking-wider">Resultados recientes</p>
          </div>
          <div className="divide-y divide-base-300">
            {finishedMatches.slice(0, 6).map((m) => (
              <div key={m.id} className="px-4 py-2.5 hover:bg-base-300/40 transition-colors">
                <div className="flex items-center justify-center gap-3">
                  <div className="flex items-center gap-2 flex-1 justify-end min-w-0">
                    <span className="text-xs font-medium text-base-content truncate text-right">{m.homeTeam}</span>
                    {m.homeCrest && <img src={m.homeCrest} alt="" className="w-5 h-5 object-contain shrink-0 ring-1 ring-inset ring-black/5 dark:ring-white/10 rounded-full" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none'; }} />}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 bg-base-300 rounded-lg px-3 py-1 min-w-[64px] justify-center">
                    <span className="text-sm font-bold font-mono tabular-nums text-base-content">
                      {m.homeScore ?? '-'}
                    </span>
                    <span className="text-xs text-base-content/30">–</span>
                    <span className="text-sm font-bold font-mono tabular-nums text-base-content">
                      {m.awayScore ?? '-'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 flex-1 justify-start min-w-0">
                    {m.awayCrest && <img src={m.awayCrest} alt="" className="w-5 h-5 object-contain shrink-0 ring-1 ring-inset ring-black/5 dark:ring-white/10 rounded-full" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none'; }} />}
                    <span className="text-xs font-medium text-base-content truncate">{m.awayTeam}</span>
                  </div>
                </div>
                <p className="text-[10px] text-base-content/40 text-center mt-1">{formatDate(m.date)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Upcoming Matches */}
      {upcomingMatches.length > 0 && (
        <div className="border-b border-base-300">
          <div className="px-4 py-2 border-b border-base-300 bg-base-300/30">
            <p className="text-[10px] text-base-content/70 font-semibold uppercase tracking-wider">Próximos partidos</p>
          </div>
          <div className="divide-y divide-base-300">
            {upcomingMatches.slice(0, 6).map((m) => {
              const d = new Date(m.date);
              const dateStr = d.toLocaleDateString('es-CL', { weekday: 'short', day: 'numeric', month: 'short' });
              return (
              <div key={m.id} className="px-4 py-2.5 hover:bg-base-300/40 transition-colors">
                <div className="flex items-center justify-center gap-3">
                  <div className="flex items-center gap-2 flex-1 justify-end min-w-0">
                    <span className="text-xs font-medium text-base-content truncate text-right">{m.homeTeam}</span>
                    {m.homeCrest && <img src={m.homeCrest} alt="" className="w-5 h-5 object-contain shrink-0 ring-1 ring-inset ring-black/5 dark:ring-white/10 rounded-full" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none'; }} />}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 bg-base-300 rounded-lg px-3 py-1 min-w-[64px] justify-center">
                    <span className="text-[10px] text-base-content/70 whitespace-nowrap leading-none">vs</span>
                  </div>
                  <div className="flex items-center gap-2 flex-1 justify-start min-w-0">
                    {m.awayCrest && <img src={m.awayCrest} alt="" className="w-5 h-5 object-contain shrink-0 ring-1 ring-inset ring-black/5 dark:ring-white/10 rounded-full" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none'; }} />}
                    <span className="text-xs font-medium text-base-content truncate">{m.awayTeam}</span>
                  </div>
                </div>
                <p className="text-[10px] text-base-content/40 text-center mt-1">{dateStr}</p>
              </div>
              );
            })}
          </div>
        </div>
      )}

      {/* News */}
      {data?.articles.length === 0 && !standings.length && !data?.matches.length ? (
        <div className="p-8 text-center text-base-content/70 text-sm">
          Información deportiva no disponible
        </div>
      ) : data?.articles.length === 0 ? null : (
        <>
        <div className="px-4 py-2 border-b border-base-300 bg-base-300/30">
          <p className="text-[10px] text-base-content/70 font-semibold uppercase tracking-wider">Noticias deportivas</p>
        </div>
        <div className="divide-y divide-base-300">
          {visibleArticles.map((article, i) => (
            <div key={i} className="flex items-center gap-1 group hover:bg-base-300 transition-colors">
              <button
                onClick={() => { play('interaction.tap'); window.open(article.link, '_blank', 'noopener,noreferrer'); }}
                className="flex-1 text-left min-w-0 px-3 py-2 cursor-pointer"
              >
                <div className="flex items-center gap-2 mb-0.5">
                  <span className={`px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider rounded border ${getSourceStyle(article.source)}`}>
                    {article.source}
                  </span>
                </div>
                <p className={`${i === 0 ? 'text-sm' : 'text-xs'} text-base-content line-clamp-2 leading-snug font-medium`}>{article.title}</p>
                {article.description && (
                  <p className="text-[11px] text-base-content/70 mt-0.5 line-clamp-1 leading-normal">{article.description}</p>
                )}
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); play('interaction.tap'); setReaderUrl(article.link); }}
                className="shrink-0 p-1 mr-2 rounded-md opacity-50 group-hover:opacity-100 focus:opacity-100 hover:bg-base-300 text-base-content/40 hover:text-base-content/80 transition-all cursor-pointer"
                title="Leer en ventana flotante"
                aria-label="Leer en modal"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                  <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
                </svg>
              </button>
            </div>
          ))}
        </div>
        <div className="p-3 flex justify-center gap-2 border-t border-base-300">
          {hasMore && (
            <button
              ref={loadMoreRef}
              onClick={() => setLimit(l => l + LOAD_MORE)}
              className="px-4 py-1.5 text-xs font-medium text-base-content bg-base-300 border border-base-300 rounded-lg hover:bg-base-300 hover:border-primary hover:ring-1 hover:ring-inset hover:ring-base-content/[0.04] transition-all active:scale-[0.97] cursor-pointer scroll-mt-16"
            >
              Cargar más noticias ({(data?.articles.length ?? 0) - limit} restantes)
            </button>
          )}
          {limit > INITIAL_COUNT && (
            <>
            <button
              onClick={() => setLimit(l => Math.max(INITIAL_COUNT, l - LOAD_MORE))}
              className="px-4 py-1.5 text-xs font-medium text-base-content/60 bg-base-300 border border-base-300 rounded-lg hover:text-base-content hover:border-primary/50 hover:ring-1 hover:ring-inset hover:ring-base-content/[0.04] transition-all active:scale-[0.97] cursor-pointer"
            >
              Mostrar menos
            </button>
            <button
              onClick={() => setLimit(INITIAL_COUNT)}
              className="px-4 py-1.5 text-xs font-medium text-base-content/60 bg-base-300 border border-base-300 rounded-lg hover:text-base-content hover:border-primary/50 hover:ring-1 hover:ring-inset hover:ring-base-content/[0.04] transition-all active:scale-[0.97] cursor-pointer"
            >
              Colapsar todo
            </button>
            </>
          )}
        </div>
        </>
      )}
    </div>
    <div className="mt-2 text-right text-[10px] text-base-content/70">
      {data?.source === 'espn' ? (
        <>Fuentes:{' '}
        <a href="https://github.com/pseudo-r/Public-ESPN-API" target="_blank" rel="noopener noreferrer" className="text-base-content/70 hover:text-base-content underline underline-offset-2 transition-colors">ESPN (API pública)</a>
        {' · '}
        <a href="https://github.com/alplox/awesome-chilean-rss" target="_blank" rel="noopener noreferrer" className="text-base-content/70 hover:text-base-content underline underline-offset-2 transition-colors">awesome-chilean-rss</a>
        </>
      ) : (
        <>Fuente:{' '}
        <a href="https://github.com/alplox/awesome-chilean-rss" target="_blank" rel="noopener noreferrer" className="text-base-content/70 hover:text-base-content underline underline-offset-2 transition-colors">awesome-chilean-rss</a>
        </>
      )}
    </div>
    {readerUrl && (
      <ArticleReader url={readerUrl} onClose={() => setReaderUrl(null)} />
    )}
    </>);
}
