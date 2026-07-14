// @ts-check
// Script to fetch feeds-database.json and regenerate src/lib/feeds-database.ts
// Usage: node scripts/update-feeds-db.mjs

const FEEDS_DB_URL = 'https://raw.githubusercontent.com/alplox/awesome-chilean-rss/main/feeds-database.json';
const OUTPUT_PATH = 'src/lib/feeds-database.json';
const PROXY_FEED_PATTERN = /google news|bing news|mastodon/i;

/** @param {string} name */
function getBaseName(name) {
  const idx = name.indexOf(' - ');
  return idx > 0 ? name.slice(0, idx).trim() : name.trim();
}

/** @param {string} name */
function slugifyBaseName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9áéíóúüñ]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/á/g, 'a').replace(/é/g, 'e').replace(/í/g, 'i')
    .replace(/ó/g, 'o').replace(/ú/g, 'u').replace(/ü/g, 'u').replace(/ñ/g, 'n');
}

async function main() {
  const t0 = Date.now();
  console.log(`[${new Date().toISOString()}] Fetching feeds-database.json from ${FEEDS_DB_URL}...`);
  const res = await fetch(FEEDS_DB_URL, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36' },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '(no body)');
    throw new Error(`Fetch failed: HTTP ${res.status} ${res.statusText} — URL: ${FEEDS_DB_URL}\nResponse: ${body.slice(0, 500)}`);
  }
  const data = await res.json();
  if (!data.sites || !Array.isArray(data.sites) || data.sites.length === 0) {
    throw new Error(`Unexpected upstream format: no "sites" array found. Keys: ${Object.keys(data).join(', ')}`);
  }
  console.log(`  Received ${data.sites.length} sites from upstream`);

  const allFeeds = [];
  /** @type {Record<string, import('../src/types').SourceFeed[]>} */
  const categories = {};
  const seenUrls = new Set();
  const keyCounts = new Map();

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
      const feedKey = count > 0 ? `${baseKey}-${count}` : baseKey;

      const sourceFeed = {
        name: feed.name,
        url: feed.rss_url,
        siteUrl: site.url,
        sourceKey: feedKey,
        source: base,
        region: site.region || null,
      };

      allFeeds.push(sourceFeed);

      if (effectiveCat) {
        if (!categories[effectiveCat]) categories[effectiveCat] = [];
        categories[effectiveCat].push(sourceFeed);
      }
    }
  }

  // Only include categories used by the app
  const ALLOWED_CATEGORIES = new Set(['news', 'regional', 'sports']);
  const categoriesKeys = Object.keys(categories).filter(c => ALLOWED_CATEGORIES.has(c)).sort();
  const catFeedSet = new Set();
  for (const cat of categoriesKeys) {
    for (const f of categories[cat]) catFeedSet.add(f.sourceKey + '|' + f.url);
  }
  const filteredFeeds = allFeeds.filter(f => catFeedSet.has(f.sourceKey + '|' + f.url));
  const totalFeeds = filteredFeeds.length;
  console.log(`Extracted ${allFeeds.length} total, ${totalFeeds} in app categories (${categoriesKeys.join(', ')})`);
  if (totalFeeds === 0) throw new Error('Zero feeds extracted — upstream format may have changed');

  // Generate compact TypeScript file
  const lines = [];
  lines.push('// @generated');
  lines.push(`// Generated on ${new Date().toISOString()} by scripts/update-feeds-db.mjs`);
  lines.push('// Do not edit manually. Run `node scripts/update-feeds-db.mjs` to regenerate.');
  lines.push('import type { SourceFeed } from \'../types\';');
  lines.push('');

  const fs = await import('fs');

  // Build the JSON object
  const dbData = {
    feeds: filteredFeeds,
    /** @type {Record<string, import('../src/types').SourceFeed[]>} */
    categories: {},
  };
  for (const cat of categoriesKeys) {
    dbData.categories[cat] = categories[cat];
  }

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(dbData), 'utf-8');
  console.log(`Written to ${OUTPUT_PATH} (${(fs.statSync(OUTPUT_PATH).size / 1024).toFixed(0)}KB)`);
  console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().catch(err => {
  console.error(`\n[FAILED] ${err.message}`);
  if (err.cause) console.error(`  Caused by: ${err.cause}`);
  process.exit(1);
});
