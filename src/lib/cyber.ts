import { XMLParser } from 'fast-xml-parser';
import { BROWSER_UA } from './ua';

/**
 * Ciberseguridad — capa de datos de /api/cyber.
 *
 * Dos bloques independientes, cada uno con su propio estado: si el CSIRT se cae,
 * las vulnerabilidades siguen sirviéndose (y viceversa). Nunca se inventa un
 * "0 alertas": un bloque caído viaja con ok:false y el widget lo dice.
 */

export type CyberSeverity = 'critical' | 'high' | 'info';

export interface CyberAlert {
  id: string;
  title: string;
  url: string;
  published: string;
  severity: CyberSeverity;
  vendor: string;
  tags: string[];
  source: string;
}

export interface KevEntry {
  cve: string;
  vendor: string;
  product: string;
  name: string;
  description: string;
  added: string;
  due: string;
  ransomware: boolean;
}

export interface CyberBlockSource {
  name: string;
  url: string;
  ok: boolean;
  count: number;
  error?: string;
}

export interface CyberBlock {
  ok: boolean;
  sources: CyberBlockSource[];
}

export interface CyberPayload {
  alerts: CyberAlert[];
  kev: {
    catalogVersion: string;
    total: number;
    days: number;
    items: KevEntry[];
    /** Entradas con uso confirmado por ransomware en una ventana más amplia. */
    ransomwareRecent: KevEntry[];
    ransomwareDays: number;
    byVendor: Array<{ vendor: string; count: number }>;
  };
  blocks: {
    alerts: CyberBlock;
    kev: CyberBlock;
  };
  updatedAt: string;
  /** true cuando el payload viene del snapshot durable (fuentes caídas). */
  stale?: boolean;
}

export const CYBER_CACHE_TTL_MS = 15 * 60 * 1000;
/** Un bloque caído se cachea poco: así se recupera solo al minuto siguiente. */
export const CYBER_DEGRADED_TTL_MS = 3 * 60 * 1000;
export const CYBER_LAST_GOOD_TTL_MS = 6 * 60 * 60 * 1000;

const FEED_TIMEOUT = 8000;
const KEV_TIMEOUT = 15000;
const KEV_DAYS = 30;
const KEV_FALLBACK_DAYS = 90;
const KEV_RW_DAYS = 180;
const KEV_MAX = 60;
const KEV_RW_MAX = 40;
const MAX_ALERTS = 25;

export const CSIRT_SITE = 'https://www.csirt.gob.cl/alertas/';
export const KEV_SITE = 'https://www.cisa.gov/known-exploited-vulnerabilities-catalog';

export const CYBER_ALERT_SOURCES = [
  { name: 'CSIRT Nacional', url: 'https://www.csirt.gob.cl/rss/alertas' },
] as const;

const KEV_URL = 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  ignoreDeclaration: true,
});

const CRITICAL_RE = /cr[ií]tica/i;
const FRAUD_RE = /fraudulent|phishing|ransomware|troyano|malware|fraude/i;

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function asString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  if (typeof value === 'object' && '#text' in (value as Record<string, unknown>)) {
    return String((value as Record<string, unknown>)['#text']);
  }
  return String(value);
}

function decodeEntities(text: string): string {
  if (!text.includes('&')) return text;
  return text
    .replace(/&#(\d+);/g, (_, c) => String.fromCodePoint(Number(c)))
    .replace(/&#x([0-9a-f]+);/gi, (_, c) => String.fromCodePoint(parseInt(c, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function cleanText(value: unknown, limit = 240): string {
  const plain = decodeEntities(asString(value))
    .replace(/<!\[CDATA\[/g, ' ')
    .replace(/\]\]>/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    // Restos de CDATA partido (`]]]]><![CDATA[>`) que quedan como `]>`.
    .replace(/[\]]{1,}>?$/, '')
    .trim();
  if (plain.length <= limit) return plain;
  return `${plain.slice(0, limit - 1).trimEnd()}…`;
}

function toIso(value: unknown): string {
  const raw = asString(value).trim();
  if (!raw) return new Date().toISOString();
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : new Date().toISOString();
}

function httpsUrl(url: string): string {
  const trimmed = url.trim();
  if (trimmed.startsWith('http://')) return `https://${trimmed.slice(7)}`;
  return trimmed;
}

function atomLink(entry: Record<string, unknown>): string {
  const link = entry.link;
  const candidates = asArray(link as unknown);
  if (candidates.length === 0) return '';
  const pick = candidates.find((l) => {
    if (typeof l === 'object' && l !== null) {
      const rel = (l as Record<string, unknown>)['@_rel'];
      return rel == null || rel === 'alternate';
    }
    return true;
  }) ?? candidates[0];
  if (typeof pick === 'string') return pick;
  if (pick && typeof pick === 'object') {
    const href = (pick as Record<string, unknown>)['@_href'];
    return typeof href === 'string' ? href : '';
  }
  return '';
}

function feedItems(xml: string): { items: Record<string, unknown>[]; format: 'rss' | 'atom' | 'none' } {
  const parsed = parser.parse(xml) as Record<string, any>;
  const rss = parsed?.rss?.channel?.item;
  if (rss) return { items: asArray(rss), format: 'rss' };
  const atom = parsed?.feed?.entry;
  if (atom) return { items: asArray(atom), format: 'atom' };
  return { items: [], format: 'none' };
}

function itemLink(item: Record<string, unknown>, format: 'rss' | 'atom' | 'none'): string {
  if (format === 'atom') return atomLink(item);
  return asString(item.link);
}

function itemDate(item: Record<string, unknown>, format: 'rss' | 'atom' | 'none'): string {
  return toIso(
    item.pubDate ?? item['dc:date'] ?? (format === 'atom' ? (item.updated ?? item.published) : undefined),
  );
}

function csirtSeverity(title: string, categories: string[]): CyberSeverity {
  const haystack = `${title} ${categories.join(' ')}`;
  if (CRITICAL_RE.test(haystack)) return 'critical';
  if (FRAUD_RE.test(haystack)) return 'high';
  return 'info';
}

/** Categorías del feed → vendor + etiquetas legibles, sin genéricos. */
function csirtTags(categories: string[]): { vendor: string; tags: string[] } {
  const cleaned = categories
    .map((c) => cleanText(c, 60))
    .filter((c) => c && !/^(alerta|alertas|vulnerabilidad|vulnerabilidades|aviso|avisos)$/i.test(c));
  const generic = /^php$/i;
  const tags = cleaned.filter((c) => !generic.test(c)).slice(0, 3);
  return { vendor: tags[0] ?? cleaned[0] ?? 'CSIRT', tags };
}

function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  return fetch(url, {
    headers: { 'User-Agent': BROWSER_UA, Accept: 'application/rss+xml, application/xml, application/atom+xml, application/json, */*' },
    signal: AbortSignal.timeout(ms),
  });
}

async function fetchCsirt(): Promise<{ alerts: CyberAlert[]; source: CyberBlockSource }> {
  const source = CYBER_ALERT_SOURCES[0];
  try {
    const res = await fetchWithTimeout(source.url, FEED_TIMEOUT);
    if (!res.ok) {
      return { alerts: [], source: { ...source, ok: false, count: 0, error: `HTTP ${res.status}` } };
    }
    const { items, format } = feedItems(await res.text());
    const alerts: CyberAlert[] = [];

    for (const item of items.slice(0, MAX_ALERTS)) {
      const title = cleanText(item.title, 160);
      const link = httpsUrl(itemLink(item, format));
      if (!title || !link) continue;
      const categories = asArray(item.category as unknown).map((c) => cleanText(c, 60));
      const { vendor, tags } = csirtTags(categories);
      alerts.push({
        id: link,
        title,
        url: link,
        published: itemDate(item, format),
        severity: csirtSeverity(title, categories),
        vendor,
        tags,
        source: 'CSIRT Nacional',
      });
    }

    alerts.sort((a, b) => Date.parse(b.published) - Date.parse(a.published));
    const ok = alerts.length > 0;
    return {
      alerts,
      source: {
        ...source,
        ok,
        count: alerts.length,
        error: ok ? undefined : items.length === 0 ? 'Formato no soportado' : 'Sin alertas',
      },
    };
  } catch (err) {
    return {
      alerts: [],
      source: {
        ...source,
        ok: false,
        count: 0,
        error: err instanceof Error && err.name === 'TimeoutError' ? 'Timeout' : 'No disponible',
      },
    };
  }
}

export async function fetchCyberAlerts(): Promise<{ alerts: CyberAlert[]; block: CyberBlock }> {
  const results = await Promise.allSettled(CYBER_ALERT_SOURCES.map(() => fetchCsirt()));
  const settled = results.map((r) =>
    r.status === 'fulfilled'
      ? r.value
      : { alerts: [] as CyberAlert[], source: { name: 'CSIRT Nacional', url: CSIRT_SITE, ok: false, count: 0, error: 'No disponible' } },
  );

  const alerts = settled.flatMap((s) => s.alerts);
  alerts.sort((a, b) => Date.parse(b.published) - Date.parse(a.published));

  const sources = settled.map((s) => s.source);
  return { alerts, block: { ok: sources.some((s) => s.ok), sources } };
}

interface RawKevEntry {
  cveID?: string;
  vendorProject?: string;
  product?: string;
  vulnerabilityName?: string;
  shortDescription?: string;
  dateAdded?: string;
  dueDate?: string;
  knownRansomwareCampaignUse?: string;
}

function kevAddedMs(value: string | undefined): number {
  if (!value) return 0;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(ms) ? ms : 0;
}

function toKevEntry(v: RawKevEntry): KevEntry {
  return {
    cve: cleanText(v.cveID, 24),
    vendor: cleanText(v.vendorProject, 60),
    product: cleanText(v.product, 80),
    name: cleanText(v.vulnerabilityName, 180),
    description: cleanText(v.shortDescription, 260),
    added: cleanText(v.dateAdded, 12),
    due: cleanText(v.dueDate, 12),
    ransomware: (v.knownRansomwareCampaignUse ?? '').toLowerCase() === 'known',
  };
}

const EMPTY_KEV = {
  catalogVersion: '',
  total: 0,
  days: KEV_DAYS,
  items: [] as KevEntry[],
  ransomwareRecent: [] as KevEntry[],
  ransomwareDays: KEV_RW_DAYS,
  byVendor: [] as Array<{ vendor: string; count: number }>,
};

export async function fetchKev(): Promise<{
  kev: CyberPayload['kev'];
  block: CyberBlock;
  fetchedAt: string;
}> {
  const source: CyberBlockSource = {
    name: 'CISA KEV',
    url: KEV_SITE,
    ok: false,
    count: 0,
  };

  try {
    const res = await fetchWithTimeout(KEV_URL, KEV_TIMEOUT);
    if (!res.ok) {
      source.error = `HTTP ${res.status}`;
      return { kev: EMPTY_KEV, block: { ok: false, sources: [source] }, fetchedAt: new Date().toISOString() };
    }

    const data = (await res.json()) as { catalogVersion?: string; vulnerabilities?: RawKevEntry[] };
    const raw = Array.isArray(data.vulnerabilities) ? data.vulnerabilities : [];
    const now = Date.now();

    // Una semana tranquila no debe dejar la pestaña vacía: si en 30 días hay
    // pocas entradas, se abre la ventana a 90.
    let days = KEV_DAYS;
    let inWindow = raw.filter((v) => kevAddedMs(v.dateAdded) >= now - KEV_DAYS * 86_400_000);
    if (inWindow.length < 10) {
      days = KEV_FALLBACK_DAYS;
      inWindow = raw.filter((v) => kevAddedMs(v.dateAdded) >= now - KEV_FALLBACK_DAYS * 86_400_000);
    }

    inWindow.sort((a, b) => kevAddedMs(b.dateAdded) - kevAddedMs(a.dateAdded));

    const vendorCounts = new Map<string, number>();
    for (const v of inWindow) {
      const vendor = cleanText(v.vendorProject, 60) || 'Sin vendor';
      vendorCounts.set(vendor, (vendorCounts.get(vendor) ?? 0) + 1);
    }

    const items: KevEntry[] = inWindow.slice(0, KEV_MAX).map(toKevEntry);

    // El flag de ransomware es raro (0–3 por mes): con la ventana de 30 días el
    // filtro quedaría siempre vacío, así que se expone una ventana aparte.
    const ransomwareRecent = raw
      .filter((v) => (v.knownRansomwareCampaignUse ?? '').toLowerCase() === 'known')
      .filter((v) => kevAddedMs(v.dateAdded) >= now - KEV_RW_DAYS * 86_400_000)
      .sort((a, b) => kevAddedMs(b.dateAdded) - kevAddedMs(a.dateAdded))
      .slice(0, KEV_RW_MAX)
      .map(toKevEntry);

    const ok = items.length > 0;
    source.ok = ok;
    source.count = items.length;
    if (!ok) source.error = 'Sin entradas en la ventana';

    return {
      kev: {
        catalogVersion: cleanText(data.catalogVersion, 32),
        total: inWindow.length,
        days,
        items,
        ransomwareRecent,
        ransomwareDays: KEV_RW_DAYS,
        byVendor: [...vendorCounts.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8)
          .map(([vendor, count]) => ({ vendor, count })),
      },
      block: { ok, sources: [source] },
      fetchedAt: new Date().toISOString(),
    };
  } catch (err) {
    source.error = err instanceof Error && err.name === 'TimeoutError' ? 'Timeout' : 'No disponible';
    return {
      kev: EMPTY_KEV,
      block: { ok: false, sources: [source] },
      fetchedAt: new Date().toISOString(),
    };
  }
}

/**
 * Payload completo de /api/cyber. Los dos bloques corren en paralelo y ninguno
 * puede tumbar al otro: un CSIRT caído devuelve block.ok=false y las
 * vulnerabilidades se sirven igual.
 */
export async function buildCyberPayload(): Promise<CyberPayload> {
  const [alertsResult, kevResult] = await Promise.allSettled([
    fetchCyberAlerts(),
    fetchKev(),
  ]);

  const alerts = alertsResult.status === 'fulfilled'
    ? alertsResult.value
    : { alerts: [] as CyberAlert[], block: { ok: false, sources: [{ name: 'CSIRT Nacional', url: CSIRT_SITE, ok: false, count: 0, error: 'No disponible' }] } };

  const kev = kevResult.status === 'fulfilled'
    ? kevResult.value
    : {
        kev: EMPTY_KEV,
        block: { ok: false, sources: [{ name: 'CISA KEV', url: KEV_SITE, ok: false, count: 0, error: 'No disponible' }] },
        fetchedAt: new Date().toISOString(),
      };

  return {
    alerts: alerts.alerts,
    kev: kev.kev,
    blocks: { alerts: alerts.block, kev: kev.block },
    updatedAt: kev.fetchedAt,
  };
}

/** true si algún bloque falló → TTL corto en /api/cyber para recuperarse pronto. */
export function isDegraded(payload: CyberPayload): boolean {
  return !payload.blocks.alerts.ok || !payload.blocks.kev.ok;
}
