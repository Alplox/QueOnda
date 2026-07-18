import { XMLParser } from 'fast-xml-parser';
import feedsDb from './feeds-database.json';
import type { Article, NewsCluster, SourceResult, SourceFeed } from '../types';
import { BROWSER_UA } from './ua';


const FEEDS_DB_URLS = [
  'https://raw.githubusercontent.com/alplox/awesome-chilean-rss/main/feeds-database.json',
  'https://cdn.jsdelivr.net/gh/Alplox/awesome-chilean-rss@refs/heads/main/feeds-database.json',
];
const DB_CACHE_TTL = 60 * 60 * 1000;

interface DbFeed {
  name: string;
  rss_url: string;
  status: string;
  verified: boolean;
  feed_type: string;
  category?: string;
}

interface DbSite {
  name: string;
  category: string;
  url?: string;
  region?: string;
  feeds: DbFeed[];
}

interface DbData {
  sites: DbSite[];
}

interface FetchResult {
  articles: Article[];
  sourceResults: SourceResult[];
  totalSources: number;
  displayedSources: number;
  allSources: SourceFeed[];
}

let cachedDb: { feeds: SourceFeed[]; categories: Map<string, SourceFeed[]> } | null = null;
let dbCacheTimestamp: number = 0;

const PROXY_FEED_PATTERN = /google news|bing news|mastodon/i;

export { BROWSER_UA } from './ua';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  ignoreDeclaration: true,
});

const FEED_FETCH_TIMEOUT = 5000;
const FETCH_CONCURRENCY = 8;
const MAX_FEEDS_FALLBACK = 40;

const AGGREGATOR_DOMAINS = new Set([
  'bing.com',
  'news.google.com',
  'feedburner.com',
  'feeds.feedburner.com',
  'feedproxy.google.com',
  'mastodon.cl',
  'mastodon.social',
  'mastodon.online',
]);

const NEWS_CATEGORIES = ['news', 'regional'];

function getBaseName(name: string): string {
  const idx = name.indexOf(' - ');
  return idx > 0 ? name.slice(0, idx).trim() : name.trim();
}

function slugifyBaseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9áéíóúüñ]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/á/g, 'a').replace(/é/g, 'e').replace(/í/g, 'i')
    .replace(/ó/g, 'o').replace(/ú/g, 'u').replace(/ü/g, 'u').replace(/ñ/g, 'n');
}

async function loadFeedsDatabase(): Promise<{ feeds: SourceFeed[]; categories: Map<string, SourceFeed[]> }> {
  const now = Date.now();
  if (cachedDb && (now - dbCacheTimestamp) < DB_CACHE_TTL) {
    return cachedDb;
  }

  // Static import (instant, no network)
  const categories = new Map<string, SourceFeed[]>();
  for (const [cat, feeds] of Object.entries((feedsDb as any).categories)) {
    categories.set(cat, feeds as SourceFeed[]);
  }
  const localData = { feeds: (feedsDb as any).feeds as SourceFeed[], categories };
  cachedDb = localData;
  dbCacheTimestamp = now;

  // Fire-and-forget remote fetch to update cache for subsequent requests
  tryFetchRemoteDb().then(remote => {
    if (remote) {
      const result = processDbData(remote);
      cachedDb = result;
      dbCacheTimestamp = now;
    }
  }).catch(() => {});

  return localData;
}

async function tryFetchRemoteDb(): Promise<DbData | null> {
  for (let i = 0; i < FEEDS_DB_URLS.length; i++) {
    try {
      const res = await fetch(FEEDS_DB_URLS[i], {
        headers: { 'User-Agent': BROWSER_UA },
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) return await res.json();
      console.warn(`Feeds DB URL ${i} returned ${res.status}, trying next...`);
    } catch (err) {
      console.warn(`Feeds DB URL ${i} failed:`, err);
    }
  }
  return null;
}

function processDbData(data: DbData): { feeds: SourceFeed[]; categories: Map<string, SourceFeed[]> } {
  const categories = new Map<string, SourceFeed[]>();
  const allFeeds: SourceFeed[] = [];
  const seenUrls = new Set<string>();
  const keyCounts = new Map<string, number>();

  for (const site of (data.sites || [])) {
    for (const feed of (site.feeds || [])) {
      if (feed.status !== 'active' || !feed.verified) continue;
      if (feed.feed_type !== 'RSS' && feed.feed_type !== 'rss') continue;
      if (PROXY_FEED_PATTERN.test(feed.name)) continue;
      if (seenUrls.has(feed.rss_url)) continue;
      seenUrls.add(feed.rss_url);

      const effectiveCat = feed.category || site.category;
      const base = getBaseName(feed.name);
      const baseKey = slugifyBaseName(feed.name);
      const count = keyCounts.get(baseKey) ?? 0;
      keyCounts.set(baseKey, count + 1);
      const sourceKey = count > 0 ? `${baseKey}-${count}` : baseKey;

      const sourceFeed: SourceFeed = {
        name: feed.name,
        url: feed.rss_url,
        siteUrl: site.url,
        sourceKey,
        source: base,
        region: site.region || null,
      };

      allFeeds.push(sourceFeed);

      if (effectiveCat) {
        if (!categories.has(effectiveCat)) categories.set(effectiveCat, []);
        categories.get(effectiveCat)!.push(sourceFeed);
      }
    }
  }

  return { feeds: allFeeds, categories };
}

async function getSourcesFromCategories(
  categoryNames: string[],
  maxFeeds?: number
): Promise<SourceFeed[]> {
  const { categories } = await loadFeedsDatabase();
  const raw: SourceFeed[] = [];
  const limit = maxFeeds ?? MAX_FEEDS_FALLBACK;
  for (const name of categoryNames) {
    const feeds = categories.get(name);
    if (feeds) {
      raw.push(...feeds.slice(0, limit));
    }
  }
  return raw;
}

export async function getNewsSources(): Promise<SourceFeed[]> {
  return getSourcesFromCategories(NEWS_CATEGORIES);
}

export async function pMap<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  concurrency: number
): Promise<R[]> {
  let i = 0;
  const results: R[] = new Array(items.length);

  async function worker(): Promise<void> {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

async function fetchSingleSource(
  source: { name: string; url: string; sourceKey?: string; source?: string }
): Promise<{ articles: Article[]; sourceResult: SourceResult }> {
  try {
    const res = await fetch(source.url, {
      headers: { 'User-Agent': BROWSER_UA },
      signal: AbortSignal.timeout(FEED_FETCH_TIMEOUT),
    });

    if (!res.ok) {
      return {
        articles: [],
        sourceResult: {
          name: source.name,
          url: source.url,
          success: false,
          articlesCount: 0,
          statusCode: res.status,
          error: `HTTP ${res.status}`,
        },
      };
    }

    const xml = await res.text();
    const parsed = parser.parse(xml);

    let rawItems: any[] = [];
    if (parsed.rss?.channel?.item) {
      rawItems = Array.isArray(parsed.rss.channel.item)
        ? parsed.rss.channel.item
        : [parsed.rss.channel.item];
    } else if (parsed.feed?.entry) {
      rawItems = Array.isArray(parsed.feed.entry)
        ? parsed.feed.entry
        : [parsed.feed.entry];
    }

    const feedDomain = extractDomain(source.url);
    const isAggregator = AGGREGATOR_DOMAINS.has(feedDomain);
    const effectiveSourceKey = source.sourceKey || feedDomain;
    const effectiveSource = source.source || source.name;

    const articles = rawItems.map((item: any) => {
      const rawDescription = safeString(item.description || item.summary || item['media:group']?.['media:description'] || '');
      const link = extractLink(item, source.url);
      const effectiveLink = isAggregator && link
        ? extractLinkFromDescription(rawDescription, feedDomain) || link
        : link;
      const cleanDescription = cleanHtml(rawDescription).slice(0, 300);
      let title = cleanHtml(item.title);
      if (!title && rawDescription) {
        const decoded = decodeHtmlEntities(rawDescription);
        const plain = decoded.replace(/<[^>]*>/g, '').trim();
        const firstLine = plain.split('\n')[0].trim();
        title = firstLine.replace(/^\p{So}+\s*/u, '');
      }
      return {
        title: title || 'Sin título',
        link: effectiveLink,
        description: cleanDescription,
        pubDate: item.pubDate || item['dc:date'] || item.updated || new Date().toISOString(),
        source: effectiveSource,
        sourceKey: effectiveSourceKey,
        image: extractImage(item),
      };
    }).filter((a) => a.title && a.link);

    const hasArticles = articles.length > 0;

    return {
      articles,
      sourceResult: {
        name: effectiveSource,
        url: source.url,
        success: hasArticles,
        articlesCount: articles.length,
        error: hasArticles ? undefined : (rawItems.length === 0 ? 'Formato no soportado' : 'Sin artículos'),
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      articles: [],
      sourceResult: {
        name: source.name,
        url: source.url,
        success: false,
        articlesCount: 0,
        error: message.includes('timed out') ? 'Timeout' : message,
      },
    };
  }
}

function extractImage(item: any): string | undefined {
  if (item.enclosure?.['@_url']) return item.enclosure['@_url'];
  if (item['media:content']?.['@_url']) return item['media:content']['@_url'];
  if (item['media:thumbnail']?.['@_url']) return item['media:thumbnail']['@_url'];
  const desc = safeString(item.description || '');
  if (!desc) return undefined;
  // ponytail: regex replaces cheerio.load() — avoids ~2600 DOM parses per sports refresh
  const m = desc.match(/<img[^>]+src="(https?:\/\/[^"]+)"/i);
  return m?.[1];
}

function safeString(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v == null) return '';
  if (typeof v === 'object' && '#text' in (v as any)) return String((v as any)['#text']);
  return String(v);
}

function decodeHtmlEntities(text: unknown): string {
  const s = safeString(text);
  return s
    .replace(/&#(\d+);/g, (_, c) => String.fromCodePoint(parseInt(c, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, c) => String.fromCodePoint(parseInt(c, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function cleanHtml(text: unknown): string {
  const s = safeString(text);
  // ponytail: fast path — skip 8 entity replaces when string has no & at all
  if (!s.includes('&')) return s.replace(/<[^>]*>/g, '').trim();
  return s
    .replace(/&#(\d+);/g, (_, c) => String.fromCodePoint(parseInt(c, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, c) => String.fromCodePoint(parseInt(c, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/<[^>]*>/g, '').trim();
}

export function deduplicateArticles<T extends { title?: string; link?: string }>(articles: T[], limit = 25): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const a of articles) {
    if (!a.title || !a.link || seen.has(a.link)) continue;
    seen.add(a.link);
    result.push(a);
    if (result.length >= limit) break;
  }
  return result;
}

function extractDomain(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return host;
  } catch {
    return url;
  }
}

function extractLink(item: any, sourceUrl: string): string {
  let link = item.link?.href || item.link?.$?.href || item.link || item.guid?.['#text'] || '';
  if (!link) return '';

  let decoded: string;
  try {
    decoded = decodeURIComponent(link).replace(/&amp;/g, '&');
  } catch {
    decoded = link.replace(/&amp;/g, '&');
  }
  if (/<a\s+[^>]*href=/.test(decoded)) {
    const match = decoded.match(/href="([^"]+)"/);
    if (match) {
      try {
        return new URL(match[1], sourceUrl).href;
      } catch { /* fall through */ }
    }
  }
  return link;
}

function extractLinkFromDescription(rawDescription: unknown, aggregatorDomain: string): string {
  const html = decodeHtmlEntities(safeString(rawDescription));
  const hrefRegex = /<a\s+[^>]*href="([^"]+)"[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = hrefRegex.exec(html)) !== null) {
    const href = m[1];
    const host = tryExtractHost(href);
    if (!host) continue;
    if (href.includes('/tags/') || href.includes('#') || host === aggregatorDomain) continue;
    return href;
  }
  return '';
}

function tryExtractHost(url: string): string | null {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return null; }
}



async function fetchSources(
  sources: SourceFeed[]
): Promise<FetchResult> {
  const results = await pMap(
    sources,
    (source) => fetchSingleSource(source),
    FETCH_CONCURRENCY
  );

  const articles: Article[] = [];
  const rawResults: SourceResult[] = [];

  for (const { articles: srcArticles, sourceResult } of results) {
    rawResults.push(sourceResult);
    articles.push(...srcArticles);
  }

  const valid = articles.filter((a) => a.title && a.link);
  valid.sort((a, b) => {
    if (a.pubDate > b.pubDate) return -1;
    if (a.pubDate < b.pubDate) return 1;
    return 0;
  });

  const keptPerName = new Map<string, number>();
  for (const a of valid) {
    keptPerName.set(a.source, (keptPerName.get(a.source) || 0) + 1);
  }

  const mergedMap = new Map<string, SourceResult>();
  for (const sr of rawResults) {
    const existing = mergedMap.get(sr.name);
    if (!existing) {
      mergedMap.set(sr.name, { ...sr });
    } else {
      if (sr.success) existing.success = true;
      if (sr.error && !existing.error) existing.error = sr.error;
      if (sr.statusCode) existing.statusCode = sr.statusCode;
    }
  }

  const sourceResults = [...mergedMap.values()];
  for (const sr of sourceResults) {
    sr.articlesCount = keptPerName.get(sr.name) ?? 0;
  }

  const displayedSources = new Set(valid.map((a) => a.sourceKey)).size;
  const totalSources = new Set(sources.map((s) => s.sourceKey)).size;

  return { articles: valid, sourceResults, totalSources, displayedSources, allSources: sources };
}

export async function fetchAllSports(): Promise<FetchResult> {
  const { categories } = await loadFeedsDatabase();
  // ponytail: cap at MAX_FEEDS_FALLBACK — free tier limits 50 subrequests/invocation,
  // 177 sports feeds would exceed that on cache miss
  return fetchSources((categories.get('sports') || []).slice(0, MAX_FEEDS_FALLBACK));
}

export async function getAllNewsSources(): Promise<SourceFeed[]> {
  return getSourcesFromCategories(NEWS_CATEGORIES, Infinity);
}

export { fetchSingleSource, fetchSources };
