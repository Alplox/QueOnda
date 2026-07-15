// @ts-check
// Script to fetch Chilean public holidays from nager.at and regenerate src/lib/holidays.json
// Usage: node scripts/update-holidays-db.mjs

const NAGER_URL = 'https://date.nager.at/api/v3/publicholidays';
const OUTPUT_PATH = 'src/lib/holidays.json';
const INALIENABLE_DATES = new Set(['01-01', '05-01', '09-18', '09-19', '12-25']);

async function main() {
  const t0 = Date.now();
  const year = new Date().getFullYear();
  const url = `${NAGER_URL}/${year}/CL`;
  console.log(`[${new Date().toISOString()}] Fetching Chilean public holidays for ${year} from ${url}...`);

  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; holidays-db/1.0)' },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '(no body)');
    throw new Error(`Fetch failed: HTTP ${res.status} ${res.statusText} — URL: ${url}\nResponse: ${body.slice(0, 500)}`);
  }

  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error(`Unexpected upstream format: expected non-empty array, got ${typeof data} with ${Array.isArray(data) ? data.length : '?'} elements`);
  }

  const holidays = data
    .filter(h => h.global)
    .map(h => {
      const mmdd = h.date.slice(5);
      const inalienable = INALIENABLE_DATES.has(mmdd);
      return {
        date: h.date,
        title: h.localName,
        type: 'Civil',
        inalienable,
        extra: inalienable ? 'Civil e Irrenunciable' : 'Civil',
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  console.log(`  Received ${data.length} holidays, ${holidays.length} global`);

  if (holidays.length === 0) {
    throw new Error('Zero global holidays extracted — upstream format may have changed');
  }

  const fs = await import('fs');
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(holidays, null, 2) + '\n', 'utf-8');
  console.log(`Written to ${OUTPUT_PATH} (${(fs.statSync(OUTPUT_PATH).size / 1024).toFixed(1)}KB, ${holidays.length} holidays for ${year})`);
  console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().catch(err => {
  console.error(`\n[FAILED] ${err.message}`);
  if (err.cause) console.error(`  Caused by: ${err.cause}`);
  process.exit(1);
});
