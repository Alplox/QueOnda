import type { APIRoute } from 'astro';
import { BROWSER_UA } from '../../lib/rss';
import * as cheerio from 'cheerio';
import { dedupeFetch } from '../../lib/cache';
import { validateFetchUrl } from '../../lib/url-validator';
import { checkRateLimit } from '../../lib/rate-limit';

const JUNK_SELECTORS = [
  'script', 'style', 'nav', 'header', 'footer', 'aside', 'iframe', 'noscript',
  '.ad', '.advertisement', '.banner', '.share', '.comments', '.related', '.sidebar',
  '.recommended', '.suggestions', '.read-more', '.also-read', '.te-puede-interesar',
  '.relacionados', '.comentarios', '.newsletter', '.subscription', '.social-share',
  '.sharing', '[class*="social"]', '[class*="share"]', '[class*="related"]',
  '[class*="recommended"]', '[id*="comments"]', '[id*="related"]',
  '.article-footer', '.entry-footer', '.post-footer',
  '.yarpp', '.jp-relatedposts', '.wppr-related',
];

function cleanText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function stripJunk($: cheerio.CheerioAPI, root: cheerio.Cheerio<any>) {
  root.find(JUNK_SELECTORS.join(',')).remove();
  // ponytail: removed find('*').each() wildcard traversal — junk selectors already handle
  // nav/footer/aside/ads/comments/social. Phrase-matching on every DOM element is O(n)
  // and rarely catches anything the selectors miss.
}

function extractWithCheerio($: cheerio.CheerioAPI): { bodyHtml: string; bodyText: string } {
  let bodyHtml = '';
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

  for (const sel of selectors) {
    const el = $(sel);
    if (el.length) {
      stripJunk($, el);
      const html = el.html() || '';
      const textLen = el.text().replace(/\s+/g, ' ').trim().length;
      if (textLen > 200) {
        bodyHtml = html;
        break;
      }
    }
  }

  if (!bodyHtml) {
    const body = $('body');
    stripJunk($, body);
    bodyHtml = body.html() || '';
  }

  bodyHtml = bodyHtml
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '');

  const bodyText = cleanText(bodyHtml);
  return { bodyHtml, bodyText };
}

export const GET: APIRoute = async ({ url, request }) => {
  const rateLimited = checkRateLimit(request, 'article', 30);
  if (rateLimited) return rateLimited;

  const target = url.searchParams.get('url');
  if (!target) {
    return new Response(JSON.stringify({ error: 'Missing url param' }), { status: 400 });
  }

  // ponytail: no KV cache — each unique URL = 1 KV write, unbounded cardinality.
  // dedupeFetch (in-memory) handles concurrent + same-session re-opens.
  const check = validateFetchUrl(target);
  if (!check.valid) {
    return new Response(JSON.stringify({ error: check.error }), { status: 400 });
  }
  if (check.url.hostname.includes('news.google.com')) {
    return new Response(JSON.stringify({
      error: 'google_news_unsupported',
      message: 'Google News utiliza URLs de redirect internos en su RSS (news.google.com/rss/articles/...) que no permiten acceder directamente al contenido de la fuente original. Esta es una limitación del sistema de RSS de Google News. Para leer el artículo completo, ábrelo en el sitio original.'
    }), { status: 400 });
  }

  try {
    const { html, failed } = await dedupeFetch(`article:${target}`, async () => {
      const res = await fetch(target, {
        headers: {
          'User-Agent': BROWSER_UA,
          'Accept': 'text/html,application/xhtml+xml',
        },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return { html: '', failed: true };
      return { html: await res.text(), failed: false };
    });

    if (failed) {
      return new Response(JSON.stringify({ error: 'Failed to fetch' }), { status: 502 });
    }

    let title = '';
    let description = '';
    let author = '';
    let publishedTime = '';
    let bodyHtml = '';
    let bodyText = '';

    // Primary: Readability (lazy loaded)
    try {
      const [{ Readability }, { parseHTML }] = await Promise.all([
        import('@mozilla/readability'),
        import('linkedom'),
      ]);
      const dom = parseHTML(html, target);
      const reader = new Readability(dom.document);
      const article = reader.parse();

      if (article && (article.textContent?.trim().length ?? 0) > 200) {
        title = cleanText(article.title || '');
        description = cleanText(article.excerpt || '');
        author = cleanText(article.byline || '');
        bodyHtml = article.content || '';
        bodyText = cleanText(article.textContent || '');
      }
    } catch {
      // Readability failed, fall through
    }

    // Fallback: cheerio selectors
    if (!bodyHtml) {
      const $ = cheerio.load(html);
      const fallback = extractWithCheerio($);

      title = title || cleanText($('meta[property="og:title"]').attr('content') || '') || cleanText($('title').text()) || '';
      description = description || cleanText($('meta[property="og:description"]').attr('content') || '');
      author = author || cleanText($('meta[name="author"]').attr('content') || '') || cleanText($('meta[property="article:author"]').attr('content') || '');
      publishedTime = $('meta[property="article:published_time"]').attr('content') || '';

      bodyHtml = fallback.bodyHtml;
      bodyText = fallback.bodyText;
    }

  bodyHtml = bodyHtml
    .slice(0, 60000)
    .replace(/class="[^"]*"|id="[^"]*"|<figure[^>]*>|<\/figure>/gi, '');

  const result = {
    title: (title || 'Artículo').slice(0, 300),
    description: description.slice(0, 500),
    author: author.slice(0, 100),
    publishedTime,
    bodyHtml,
    body: bodyText.slice(0, 30000),
      url: target,
    };
    return new Response(
      JSON.stringify(result),
      {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=3600',
        },
      }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Failed to fetch article' }), { status: 502 });
  }
};
