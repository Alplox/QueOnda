import type { APIRoute } from 'astro';
import { BROWSER_UA } from '../../lib/rss';
import { getCached, setCache } from '../../lib/cache';
import { fetchAllSports, deduplicateArticles } from '../../lib/rss';
import type { SourceResult } from '../../types';

const CACHE_TTL = 10 * 60 * 1000;

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

interface FutbolResponse {
  standings: StandingEntry[];
  matches: MatchEntry[];
  articles: Article[];
  source: 'espn' | 'rss';
  sourceResults: SourceResult[];
  totalSources: number;
  displayedSources: number;
  error?: string;
}

function toStatus(espnState: string, espnName: string): MatchEntry['status'] {
  if (espnState === 'post') return 'FINISHED';
  if (espnState === 'in') return 'IN_PLAY';
  if (espnState === 'pre') return 'SCHEDULED';
  if (espnName === 'STATUS_POSTPONED') return 'POSTPONED';
  if (espnName === 'STATUS_CANCELLED') return 'CANCELLED';
  return 'SCHEDULED';
}

async function fetchFromESPN(): Promise<{ standings: StandingEntry[]; matches: MatchEntry[] } | null> {
  try {
    const [standingsRes, leagueRes] = await Promise.all([
      fetch('https://site.web.api.espn.com/apis/v2/sports/soccer/chi.1/standings?region=cl&lang=es', {
        signal: AbortSignal.timeout(8000),
        headers: { 'User-Agent': BROWSER_UA },
      }),
      fetch('https://site.api.espn.com/apis/site/v2/sports/soccer/chi.1/scoreboard?limit=1', {
        signal: AbortSignal.timeout(5000),
        headers: { 'User-Agent': BROWSER_UA },
      }),
    ]);
    if (!standingsRes.ok) return null;

    const sData = await standingsRes.json();
    const group = sData.children?.[0]?.standings;
    if (!group?.entries?.length) return null;

    const standings: StandingEntry[] = group.entries.map((e: any) => {
      const stats = (s: string) => e.stats?.find((st: any) => st.name === s);
      const val = (s: string) => {
        const st = stats(s);
        return st ? (st.value !== undefined ? Number(st.value) : 0) : 0;
      };
      return {
        position: val('rank'),
        team: e.team.displayName || e.team.name || e.team.location,
        crest: e.team.logos?.[0]?.href || null,
        playedGames: val('gamesPlayed'),
        won: val('wins'),
        draw: val('ties'),
        lost: val('losses'),
        points: val('points'),
        goalsFor: val('pointsFor'),
        goalsAgainst: val('pointsAgainst'),
        goalDifference: val('pointDifferential'),
        rankChange: val('rankChange'),
      }});

    const now = new Date();
    const calendar: string[] = sData.calendar || [];
    if (leagueRes.ok) {
      const lData = await leagueRes.json();
      const cal = lData.leagues?.[0]?.calendar;
      if (Array.isArray(cal)) calendar.push(...cal.filter((d: string) => !calendar.includes(d)));
    }
    const uniqueDates = [...new Set(calendar.map((d: string) => d.slice(0, 10).replace(/-/g, '')))].sort();

    const recentDates = uniqueDates
      .filter(d => d <= now.toISOString().slice(0, 10).replace(/-/g, ''))
      .slice(-3);
    const upcomingDates = uniqueDates
      .filter(d => d >= now.toISOString().slice(0, 10).replace(/-/g, ''))
      .slice(0, 2);

    const dateResults = await Promise.all(
      [...recentDates, ...upcomingDates].map(date =>
        fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/chi.1/scoreboard?dates=${date}&limit=20`, {
          signal: AbortSignal.timeout(6000),
          headers: { 'User-Agent': BROWSER_UA },
        }).then(r => r.json()).catch(() => null)
      )
    );

    const matches: MatchEntry[] = [];
    const seenIds = new Set<number>();
    for (const data of dateResults) {
      if (!data?.events) continue;
      for (const ev of data.events) {
        const comp = ev.competitions?.[0];
        if (!comp) continue;
        const home = comp.competitors?.find((c: any) => c.homeAway === 'home');
        const away = comp.competitors?.find((c: any) => c.homeAway === 'away');
        if (!home || !away) continue;
        const id = Number(ev.id);
        if (seenIds.has(id)) continue;
        seenIds.add(id);
        const st = comp.status?.type;
        matches.push({
          id,
          date: ev.date || comp.date,
          status: toStatus(st?.state, st?.name),
          homeTeam: home.team?.displayName || home.team?.name || home.team?.location,
          homeCrest: home.team?.logo || null,
          awayTeam: away.team?.displayName || away.team?.name || away.team?.location,
          awayCrest: away.team?.logo || null,
          homeScore: home.score !== undefined ? Number(home.score) : null,
          awayScore: away.score !== undefined ? Number(away.score) : null,
        });
      }
    }

    matches.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    return { standings, matches };
  } catch {
    return null;
  }
}

export const GET: APIRoute = async () => {
  const cached = await getCached<FutbolResponse>('futbol');
  if (cached) {
    return new Response(JSON.stringify(cached), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=600' },
    });
  }

  let standings: StandingEntry[] = [];
  let matches: MatchEntry[] = [];
  let source: FutbolResponse['source'] = 'rss';
  let error: string | undefined;

  const espnData = await fetchFromESPN();
  if (espnData) {
    standings = espnData.standings;
    matches = espnData.matches;
    source = 'espn';
  } else {
    error = 'No se pudieron obtener datos de ESPN';
  }

  let articles: Article[] = [];
  let sourceResults: SourceResult[] = [];
  let totalSources = 0;
  let displayedSources = 0;

  try {
    const sports = await fetchAllSports();
    for (const a of deduplicateArticles(sports.articles, Infinity) as Article[]) {
      articles.push({
        title: a.title,
        link: a.link,
        description: a.description.slice(0, 180),
        source: a.source,
      });
    }
    sourceResults = sports.sourceResults;
    totalSources = sports.totalSources;
    displayedSources = sports.displayedSources;
  } catch {}

  const data: FutbolResponse = {
    standings,
    matches: matches.slice(0, 20),
    articles: articles.slice(0, 25),
    source,
    sourceResults,
    totalSources,
    displayedSources,
    error,
  };

  await setCache('futbol', data, CACHE_TTL);

  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=600' },
  });
};
