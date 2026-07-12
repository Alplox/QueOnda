import type { Article, NewsCluster } from '../types';

const MAX_SAME_SOURCE = 6;
const MAX_ARTICLES_FOR_CLUSTERING = 500;

const STOPWORDS = new Set([
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas',
  'y', 'e', 'o', 'u', 'ni', 'que', 'como',
  'de', 'del', 'en', 'con', 'por', 'para', 'a', 'al', 'ante', 'bajo',
  'cabe', 'contra', 'desde', 'durante', 'entre', 'hacia', 'hasta',
  'mediante', 'segun', 'sin', 'so', 'sobre', 'tras',
  'es', 'son', 'era', 'ser', 'han', 'hay', 'esta', 'estan',
  'se', 'le', 'lo', 'su', 'sus', 'tu', 'mi',
  'nos', 'os', 'les', 'ello', 'ella', 'ellos', 'este',
  'estos', 'estas', 'ese', 'esa', 'esos', 'esas', 'aquel', 'aquella',
  'mas', 'pero', 'todo', 'toda', 'todos', 'todas',
  'cada', 'muy', 'tan', 'tanto', 'donde', 'cuando',
  'quien', 'cual', 'cuales', 'cuanto', 'porque', 'aunque',
  'sino', 'tiene', 'tenia', 'puede', 'debe', 'hace', 'hizo',
  'dijo', 'otro', 'otra', 'otros', 'otras',
  'mismo', 'misma', 'mismos', 'mismas',
  'nuevo', 'nueva', 'nuevos', 'nuevas', 'primer', 'primera',
  'ultimo', 'ultima', 'gran', 'mayor', 'menor', 'mejor', 'peor',
  'sera', 'sido', 'siendo', 'tener', 'hacer', 'haber', 'poder',
]);

function stripDiacritics(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9áéíóúüñ\s]/g, '')
    .trim();
}

export function extractKeywords(title: string): string[] {
  const clean = normalizeTitle(title);
  const tokens = clean.split(/\s+/).filter((w) => w.length > 2 && !STOPWORDS.has(w));
  if (tokens.length === 0) return [];

  const unigrams = tokens.filter((w) => w.length > 3);
  const bigrams: string[] = [];
  const trigrams: string[] = [];

  for (let i = 0; i < tokens.length - 1; i++) {
    if (tokens[i].length > 2 && tokens[i + 1].length > 2) {
      bigrams.push(`${tokens[i]} ${tokens[i + 1]}`);
    }
  }

  for (let i = 0; i < tokens.length - 2; i++) {
    if (tokens[i].length > 2 && tokens[i + 1].length > 2 && tokens[i + 2].length > 2) {
      trigrams.push(`${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]}`);
    }
  }

  // ponytail: normalize diacritics once at extraction time, not per comparison
  return [...new Set([...unigrams, ...bigrams, ...trigrams].map(stripDiacritics))];
}

// ponytail: operates on pre-built Sets, iterates smaller for intersection
function calculateSimilarity(setA: Set<string>, setB: Set<string>): number {
  if (setA.size === 0 || setB.size === 0) return 0;
  const [smaller, larger] = setA.size <= setB.size ? [setA, setB] : [setB, setA];
  let intersection = 0;
  for (const k of smaller) if (larger.has(k)) intersection++;
  return intersection / (setA.size + setB.size - intersection);
}

export function clusterArticles(articles: Article[]): NewsCluster[] {
  const seenUrls = new Set<string>();
  const deduped = articles.filter(a => {
    const normalized = a.link.replace(/\/$/, '').replace(/^https?:\/\//, '').replace(/^www\./, '');
    if (seenUrls.has(normalized)) return false;
    seenUrls.add(normalized);
    return true;
  });

  // ponytail: pre-build Sets once — avoids re-allocation in O(n^2) comparisons
  const allKeywordSets = deduped.map(a => new Set(extractKeywords(a.title)));
  const clusters: NewsCluster[] = [];
  const assigned = new Set<number>();

  for (let i = 0; i < deduped.length; i++) {
    if (assigned.has(i)) continue;

    const cluster: NewsCluster = {
      topic: deduped[i].title,
      keywords: [...allKeywordSets[i]],
      articles: [deduped[i]],
      sourceCount: 1,
    };
    assigned.add(i);

    const sourceCountInCluster: Record<string, number> = { [deduped[i].sourceKey]: 1 };

    for (let j = i + 1; j < deduped.length; j++) {
      if (assigned.has(j)) continue;

      const similarity = calculateSimilarity(allKeywordSets[i], allKeywordSets[j]);

      if (similarity > 0.25) {
        if ((sourceCountInCluster[deduped[j].sourceKey] || 0) < MAX_SAME_SOURCE) {
          cluster.articles.push(deduped[j]);
          assigned.add(j);
          sourceCountInCluster[deduped[j].sourceKey] = (sourceCountInCluster[deduped[j].sourceKey] || 0) + 1;
        }
      }
    }

    clusters.push(cluster);
  }

  for (const cluster of clusters) {
    const uniqueSources = new Set(cluster.articles.map((a) => a.sourceKey));
    cluster.sourceCount = uniqueSources.size;
  }

  return clusters
    .filter((c) => c.articles.length > 0 && c.sourceCount >= 2)
    .sort((a, b) => {
      const scoreA = a.articles.length * Math.min(a.sourceCount / 2, 1);
      const scoreB = b.articles.length * Math.min(b.sourceCount / 2, 1);
      return scoreB - scoreA;
    });
}

export function extractTrendingFromArticles(articles: Article[]): string[] {
  const keywordSources = new Map<string, Set<string>>();
  const activeSources = new Set<string>();
  for (const a of articles.slice(0, MAX_ARTICLES_FOR_CLUSTERING)) {
    activeSources.add(a.sourceKey);
    const kws = extractKeywords(a.title).slice(0, 3);
    for (const kw of kws) {
      if (!keywordSources.has(kw)) keywordSources.set(kw, new Set());
      keywordSources.get(kw)!.add(a.sourceKey);
    }
  }
  const minSources = activeSources.size >= 6 ? 3 : 2;
  return [...keywordSources.entries()]
    .filter(([, sources]) => sources.size >= minSources)
    .sort((a, b) => b[1].size - a[1].size)
    .slice(0, 20)
    .map(([kw]) => kw);
}
