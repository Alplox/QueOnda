import * as cheerio from 'cheerio';
import { validateFetchUrl } from './url-validator';

const MAX_SANITIZE_INPUT_LENGTH = 120_000;

const DROP_TAGS = [
  'script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button',
  'textarea', 'select', 'option', 'optgroup', 'template', 'noscript', 'svg',
  'math', 'canvas', 'video', 'audio', 'source', 'track', 'link', 'meta', 'base',
];

const SAFE_TAGS = new Set([
  'a', 'abbr', 'b', 'blockquote', 'br', 'caption', 'cite', 'code', 'col',
  'colgroup', 'dd', 'del', 'details', 'div', 'dl', 'dt', 'em', 'figcaption',
  'figure', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'ins',
  'kbd', 'li', 'mark', 'ol', 'p', 'pre', 'q', 's', 'samp', 'section', 'small',
  'span', 'strong', 'sub', 'summary', 'sup', 'table', 'tbody', 'td', 'tfoot',
  'th', 'thead', 'time', 'tr', 'u', 'ul', 'var', 'wbr',
]);

const GLOBAL_ATTRIBUTES = new Set(['dir', 'lang', 'title']);
const TAG_ATTRIBUTES: Record<string, ReadonlySet<string>> = {
  a: new Set(['href', 'hreflang', 'rel', 'target', 'type']),
  img: new Set(['alt', 'decoding', 'height', 'loading', 'referrerpolicy', 'src', 'width']),
  time: new Set(['datetime']),
  td: new Set(['colspan', 'headers', 'rowspan']),
  th: new Set(['abbr', 'colspan', 'headers', 'rowspan', 'scope']),
  col: new Set(['span']),
  colgroup: new Set(['span']),
  ol: new Set(['reversed', 'start', 'type']),
};

function isSafeArticleUrl(value: string, baseUrl: string, allowContactProtocols = false): boolean {
  const candidate = value.trim();
  if (!candidate || /[\u0000-\u001f\u007f]/.test(candidate)) return false;

  try {
    const parsed = new URL(candidate, baseUrl);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return validateFetchUrl(parsed.toString()).valid;
    }
    return allowContactProtocols && (parsed.protocol === 'mailto:' || parsed.protocol === 'tel:');
  } catch {
    return false;
  }
}

export function sanitizeArticleHtml(html: string, baseUrl: string): { html: string; text: string } {
  const $ = cheerio.load(html.slice(0, MAX_SANITIZE_INPUT_LENGTH), null, false);
  $(DROP_TAGS.join(',')).remove();

  $('*').each((_, element) => {
    if (element.type === 'comment') {
      $(element).remove();
      return;
    }
    if (!('attribs' in element)) return;

    const tagName = element.tagName.toLowerCase();
    if (!SAFE_TAGS.has(tagName)) {
      $(element).replaceWith($(element).contents());
      return;
    }

    const allowedAttributes = TAG_ATTRIBUTES[tagName];
    for (const attribute of Object.keys(element.attribs)) {
      const normalizedName = attribute.toLowerCase();
      const value = element.attribs[attribute] ?? '';
      const isAllowed = GLOBAL_ATTRIBUTES.has(normalizedName) || allowedAttributes?.has(normalizedName);
      const isUrlAttribute = normalizedName === 'href' || normalizedName === 'src';
      const isSafeUrl =
        (tagName === 'a' && normalizedName === 'href' && isSafeArticleUrl(value, baseUrl, true)) ||
        (tagName === 'img' && normalizedName === 'src' && isSafeArticleUrl(value, baseUrl));

      if (!isAllowed || isUrlAttribute && !isSafeUrl) {
        $(element).removeAttr(attribute);
      }
    }

    if (tagName === 'a' && element.attribs.href) {
      $(element).attr('target', '_blank');
      $(element).attr('rel', 'nofollow noopener noreferrer');
    }
    if (tagName === 'img' && element.attribs.src) {
      $(element).attr('loading', 'lazy');
      $(element).attr('decoding', 'async');
      $(element).attr('referrerpolicy', 'no-referrer');
    }
    if (tagName === 'img' && !element.attribs.src) {
      $(element).remove();
    }
  });

  return { html: $.html(), text: $.root().text() };
}
