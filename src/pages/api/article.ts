import type { APIRoute } from 'astro';
import { BROWSER_UA } from '../../lib/rss';
import * as cheerio from 'cheerio';
import { getCached, setCache, dedupeFetch, edgeCacheHeaders } from '../../lib/cache';
import { validateFetchUrl } from '../../lib/url-validator';
import { checkRateLimit } from '../../lib/rate-limit';
import { sanitizeArticleHtml } from '../../lib/sanitize-html';

const JUNK_SELECTORS = [
  'script', 'style', 'nav', 'header', 'footer', 'aside', 'iframe', 'noscript',
  '.ad', '.advertisement', '.banner', '.share', '.comments', '.related', '.sidebar',
  '.recommended', '.suggestions', '.read-more', '.also-read', '.te-puede-interestar',
  '.relacionados', '.comentarios', '.newsletter', '.subscription', '.social-share',
  '.sharing', '[class*="social"]', '[class*="share"]', '[class*="related"]',
  '[class*="recommended"]', '[id*="comments"]', '[id*="related"]',
  '.article-footer', '.entry-footer', '.post-footer',
  '.yarpp', '.jp-relatedposts', '.wppr-related',
];

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;
const MAX_SOURCE_HTML_LENGTH = 2_000_000;
const ARTICLE_CACHE_TTL = 60 * 60 * 1000;
const ARTICLE_CACHE_VERSION = 'v2';

interface ArticleContent {
  title: string;
  description: string;
  author: string;
  publishedTime: string;
  bodyHtml: string;
  body: string;
  url: string;
}

function cleanText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function articleCacheKey(target: string): string {
  return `article:${ARTICLE_CACHE_VERSION}:${encodeURIComponent(target)}`;
}

function extractWithCheerio($: cheerio.CheerioAPI): string {
  const selectors = [
    'article',
    '[role="main"]',
    'main',
    '.post-content',
    '.entry-content',
    '.article-content',
    '.story-body',
    '.noticia-cuerpo',
    '.article-body',
    '.single-content',
    '[itemprop="articleBody"]',
    '#content',
    '.content',
  ];

  for (const selector of selectors) {
    const element = $(selector);
    if (!element.length) continue;
    element.find(JUNK_SELECTORS.join(',')).remove();
    const textLength = element.text().replace(/\s+/g, ' ').trim().length;
    if (textLength > 200) return element.html() || '';
  }

  const body = $('body');
  body.find(JUNK_SELECTORS.join(',')).remove();
  return body.html() || '';
}

async function fetchArticleHtml(initialUrl: URL): Promise<{ html: string; failed: boolean; finalUrl: URL }> {
  let currentUrl = initialUrl;

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
    const response = await fetch(currentUrl, {
      headers: {
        'User-Agent': BROWSER_UA,
        'Accept': 'text/html,application/xhtml+xml',
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(15000),
    });

    if (REDIRECT_STATUSES.has(response.status)) {
      const location = response.headers.get('Location');
      if (redirectCount === MAX_REDIRECTS || !location) {
        return { html: '', failed: true, finalUrl: currentUrl };
      }

      let nextUrl: URL;
      try {
        nextUrl = new URL(location, currentUrl);
      } catch {
        return { html: '', failed: true, finalUrl: currentUrl };
      }

      const check = validateFetchUrl(nextUrl.toString());
      if (!check.valid) return { html: '', failed: true, finalUrl: currentUrl };
      currentUrl = check.url;
      continue;
    }

    if (!response.ok) return { html: '', failed: true, finalUrl: currentUrl };

    const contentType = response.headers.get('Content-Type')?.toLowerCase() ?? '';
    if (contentType && !contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
      return { html: '', failed: true, finalUrl: currentUrl };
    }

    const html = await response.text();
    if (html.length > MAX_SOURCE_HTML_LENGTH) return { html: '', failed: true, finalUrl: currentUrl };
    return { html, failed: false, finalUrl: currentUrl };
  }

  return { html: '', failed: true, finalUrl: currentUrl };
}

export const GET: APIRoute = async ({ url, request }) => {
  if ([...url.searchParams.keys()].some(param => param !== 'url' && param !== 'v')) {
    return new Response(JSON.stringify({ error: 'Unsupported query parameter' }), { status: 400 });
  }

  const rateLimited = checkRateLimit(request, 'article', 30);
  if (rateLimited) return rateLimited;

  const rawTarget = url.searchParams.get('url');
  if (!rawTarget) {
    return new Response(JSON.stringify({ error: 'Missing url param' }), { status: 400 });
  }

  const check = validateFetchUrl(rawTarget);
  if (!check.valid) {
    return new Response(JSON.stringify({ error: check.error }), { status: 400 });
  }

  check.url.hash = '';
  const target = check.url.toString();
  if (check.url.hostname === 'news.google.com' || check.url.hostname.endsWith('.news.google.com')) {
    return new Response(JSON.stringify({
      error: 'google_news_unsupported',
      message: 'Google News utiliza URLs de redirect internos en su RSS (news.google.com/rss/articles/...) que no permiten acceder directamente al contenido de la fuente original. Esta es una limitación del sistema de RSS de Google News. Para leer el artículo completo, ábrelo en el sitio original.'
    }), { status: 400 });
  }

  const cacheKey = articleCacheKey(target);
  const cached = await getCached<ArticleContent>(cacheKey);
  if (cached) {
    return new Response(JSON.stringify(cached), {
      headers: edgeCacheHeaders(3600),
    });
  }

  try {
    const { html, failed, finalUrl } = await dedupeFetch(`fetch:${cacheKey}`, () => fetchArticleHtml(check.url));
    if (failed) {
      return new Response(JSON.stringify({ error: 'Failed to fetch' }), { status: 502 });
    }

    let title = '';
    let description = '';
    let author = '';
    let publishedTime = '';
    let bodyHtml = '';

    try {
      const [{ Readability }, { parseHTML }] = await Promise.all([
        import('@mozilla/readability'),
        import('linkedom'),
      ]);
      const dom = parseHTML(html, finalUrl.toString());
      const reader = new Readability(dom.document);
      const article = reader.parse();

      if (article && (article.textContent?.trim().length ?? 0) > 200) {
        title = cleanText(article.title || '');
        description = cleanText(article.excerpt || '');
        author = cleanText(article.byline || '');
        bodyHtml = article.content || '';
      }
    } catch {
      // Readability failed; use the selector-based fallback below.
    }

    if (!bodyHtml) {
      const $ = cheerio.load(html);
      bodyHtml = extractWithCheerio($);
      title = title || cleanText($('meta[property="og:title"]').attr('content') || '') || cleanText($('title').text());
      description = description || cleanText($('meta[property="og:description"]').attr('content') || '');
      author = author || cleanText($('meta[name="author"]').attr('content') || '') || cleanText($('meta[property="article:author"]').attr('content') || '');
      publishedTime = $('meta[property="article:published_time"]').attr('content') || '';
    }

    const sanitized = sanitizeArticleHtml(bodyHtml, finalUrl.toString());
    const result: ArticleContent = {
      title: (title || 'Artículo').slice(0, 300),
      description: description.slice(0, 500),
      author: author.slice(0, 100),
      publishedTime,
      bodyHtml: sanitized.html,
      body: cleanText(sanitized.text).slice(0, 30000),
      url: target,
    };

    await setCache(cacheKey, result, ARTICLE_CACHE_TTL);
    return new Response(JSON.stringify(result), {
      headers: edgeCacheHeaders(3600),
    });
  } catch {
    return new Response(JSON.stringify({ error: 'Failed to fetch article' }), { status: 502 });
  }
};
