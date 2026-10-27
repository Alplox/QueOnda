import type { SourceFeed } from '../types';

/**
 * Helpers to tell an outlet's feeds apart and keep them together.
 *
 * Section feeds of an outlet are named "<Medio> - <Sección>" (e.g. "Ciper Chile - Radar"),
 * while the flagship feed usually carries either the bare outlet name or a generic
 * section such as "Noticias" / "Portada". `source` already holds the base name.
 */

const MAIN_FEED_NAME = /noticias|ultimas|portada|actualidad|general|principal|inicio|home/i;

export const nameCollator = new Intl.Collator('es', { sensitivity: 'base', numeric: true });

/** Accent/case-insensitive text, so "discusion" matches "La Discusión". */
export function foldAccents(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Slug-ish key: "La Tercera" → "latercera", "fastcheck.cl" → "fastcheckcl". */
function foldKey(s: string): string {
  return foldAccents(s).replace(/[^a-z0-9]/g, '');
}

export function feedUrlDepth(url: string): number {
  try { return new URL(url).pathname.split('/').filter(Boolean).length; } catch { return 99; }
}

export function mainFeedTier(s: SourceFeed): number {
  if (s.name === s.source) return 0;
  return MAIN_FEED_NAME.test(s.name) ? 1 : 2;
}

/** True when `a` is a better pick than `b` as the single headline feed of its outlet. */
export function isBetterMainFeed(a: SourceFeed, b: SourceFeed): boolean {
  const ta = mainFeedTier(a);
  const tb = mainFeedTier(b);
  if (ta !== tb) return ta < tb;
  const da = feedUrlDepth(a.url);
  const db = feedUrlDepth(b.url);
  if (da !== db) return da < db;
  return a.url.length < b.url.length;
}

/** Group key: the base name of the feed names, i.e. the outlet. */
export function outletKey(s: SourceFeed): string {
  return s.source || s.siteUrl || s.sourceKey;
}

/**
 * Keep every feed of an outlet together. The inventory is a concatenation of
 * category blocks (all `news`, then all `regional`) and a few feeds carry a
 * per-feed category that differs from their outlet's, so siblings otherwise
 * land hundreds of rows apart.
 */
export function groupByOutlet(sources: SourceFeed[]): Array<{ label: string; feeds: SourceFeed[] }> {
  const groups = new Map<string, SourceFeed[]>();
  for (const s of sources) {
    const key = outletKey(s);
    const list = groups.get(key);
    if (list) list.push(s); else groups.set(key, [s]);
  }
  return [...groups.entries()].map(([label, feeds]) => ({
    label,
    feeds: feeds.length > 1
      ? [...feeds].sort((a, b) => {
          const ta = mainFeedTier(a);
          const tb = mainFeedTier(b);
          if (ta !== tb) return ta - tb;
          return nameCollator.compare(a.name, b.name);
        })
      : feeds,
  }));
}

/**
 * Flat list ordered by outlet name: each group keeps its feeds together with the
 * flagship feed first, then A-Z. "za" is the exact reverse of that order.
 */
export function orderByOutlet(sources: SourceFeed[], direction: 'az' | 'za'): SourceFeed[] {
  const flat = groupByOutlet(sources)
    .sort((a, b) => nameCollator.compare(a.label, b.label))
    .flatMap(g => g.feeds);
  return direction === 'za' ? flat.reverse() : flat;
}

/**
 * One feed per outlet: the «principal» of each one (the same pick the
 * «Solo principales por sitio» toggle keeps). Used by the auto-skip, the `+`
 * button and «Cargar siguiente» so no path can load a subfeed by accident.
 */
export function flagshipFeeds(sources: SourceFeed[]): SourceFeed[] {
  const best = new Map<string, SourceFeed>();
  for (const s of sources) {
    const key = outletKey(s);
    const current = best.get(key);
    if (!current || isBetterMainFeed(s, current)) best.set(key, s);
  }
  return [...best.values()];
}

/** Best feed of the outlet named `alias` — used to resolve the default slots. */
export function resolveOutlet(sources: SourceFeed[], alias: string): SourceFeed | null {
  const token = foldKey(alias);
  let best: SourceFeed | null = null;
  for (const s of sources) {
    const fromName = foldKey(s.source ?? '').startsWith(token);
    let fromHost = false;
    if (!fromName) {
      try { fromHost = foldKey(new URL(s.siteUrl || s.url).hostname.replace(/^www\./, '')).startsWith(token); } catch { /* ignore */ }
    }
    if (!fromName && !fromHost) continue;
    if (!best || isBetterMainFeed(s, best)) best = s;
  }
  return best;
}
