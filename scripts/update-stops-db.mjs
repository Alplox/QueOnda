// @ts-check
// Script to download DTPM GTFS and generate stops-database.json
// Usage: node scripts/update-stops-db.mjs

const OUTPUT_PATH = 'src/lib/stops-database.json';

async function fetchLatestGtfsUrl() {
  const res = await fetch('https://dtpm.cl/index.php/gtfs-vigente');
  const html = await res.text();
  const m = html.match(/href="(\/descargas\/gtfs\/[^"]+)"/);
  if (!m) throw new Error('Could not find GTFS download link on DTPM page');
  return `https://www.dtpm.cl${m[1]}`;
}

/** @param {string} csv @returns {{ header: string[], rows: Record<string, string>[] }} */
function parseCSV(csv) {
  const lines = csv.split('\n').filter(l => l.trim());
  if (lines.length < 2) return { header: [], rows: [] };
  const header = lines[0].split(',').map(h => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    /** @type {string[]} */
    const vals = [];
    let cur = '', inQuote = false;
    for (const ch of lines[i]) {
      if (ch === '"') { inQuote = !inQuote; continue; }
      if (ch === ',' && !inQuote) { vals.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    vals.push(cur.trim());
    if (vals.length === header.length) {
      /** @type {Record<string, string>} */
      const row = {};
      header.forEach((h, j) => { row[h] = vals[j]; });
      rows.push(row);
    }
  }
  return { header, rows };
}

async function main() {
  console.log('Fetching latest GTFS URL...');
  const gtfsUrl = await fetchLatestGtfsUrl();
  console.log(`Downloading ${gtfsUrl}...`);
  const res = await fetch(gtfsUrl);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  console.log(`Downloaded ${(buf.byteLength / 1024 / 1024).toFixed(1)} MB`);

  const { default: yauzl } = await import('yauzl');
  const { Buffer } = await import('buffer');
  const fs = await import('fs');

  /** @type {Record<string, string>} */
  const fileData = {};

  await /** @type {Promise<void>} */ (new Promise((resolve, reject) => {
    yauzl.fromBuffer(Buffer.from(buf), { lazyEntries: true }, (err, zip) => {
      if (err) return reject(err);
      let remaining = 4;
      zip.readEntry();
      zip.on('entry', entry => {
        const name = /** @type {string} */ (entry.fileName);
        if (!['routes.txt', 'stops.txt', 'trips.txt', 'stop_times.txt'].includes(name)) {
          zip.readEntry();
          return;
        }
        /** @type {Buffer[]} */
        const chunks = [];
        zip.openReadStream(entry, (err, rs) => {
          if (err) return reject(err);
          rs.on('data', c => chunks.push(c));
          rs.on('end', () => {
            fileData[name] = Buffer.concat(chunks).toString('utf-8');
            remaining--;
            if (remaining === 0) resolve();
            else zip.readEntry();
          });
        });
      });
      zip.on('error', reject);
    });
  }));

  console.log('Parsing routes...');
  const routes = parseCSV(fileData['routes.txt']).rows
    .filter(r => !/^L\d|^MT/.test(r.route_id))
    .reduce((acc, r) => { acc[r.route_id] = r.route_short_name || r.route_id; return acc; }, /** @type {Record<string, string>} */ ({}));
  const routeIds = new Set(Object.keys(routes));
  console.log(`  ${routeIds.size} bus routes`);

  console.log('Parsing stops...');
  /** @type {Record<string, { stop_name: string, stop_lat: number, stop_lon: number }>} */
  const stops = {};
  for (const r of parseCSV(fileData['stops.txt']).rows) {
    stops[r.stop_id] = {
      stop_name: r.stop_name,
      stop_lat: parseFloat(r.stop_lat),
      stop_lon: parseFloat(r.stop_lon),
    };
  }
  console.log(`  ${Object.keys(stops).length} stops`);

  console.log('Parsing trips...');
  /** @type {Record<string, Set<string>>} */
  const tripsByRoute = {};
  for (const r of parseCSV(fileData['trips.txt']).rows) {
    if (!routeIds.has(r.route_id)) continue;
    if (!tripsByRoute[r.route_id]) tripsByRoute[r.route_id] = new Set();
    tripsByRoute[r.route_id].add(r.trip_id);
  }
  const allTripIds = new Set();
  for (const trips of Object.values(tripsByRoute)) {
    for (const t of trips) allTripIds.add(t);
  }
  console.log(`  ${allTripIds.size} trips for ${Object.keys(tripsByRoute).length} routes`);

  console.log('Parsing stop_times...');
  /** @type {Record<string, Array<{ stop_id: string, sequence: number }>>} */
  const stopTimesByTrip = {};
  let stCount = 0;
  for (const r of parseCSV(fileData['stop_times.txt']).rows) {
    if (!allTripIds.has(r.trip_id)) continue;
    stCount++;
    if (!stopTimesByTrip[r.trip_id]) stopTimesByTrip[r.trip_id] = [];
    stopTimesByTrip[r.trip_id].push({ stop_id: r.stop_id, sequence: parseInt(r.stop_sequence) || 0 });
  }
  console.log(`  ${stCount} stop_times entries`);

  console.log('Building route→stops mapping...');
  /** @type {Record<string, string[]>} */
  const stopsByRoute = {};
  for (const [routeId, tripIds] of Object.entries(tripsByRoute)) {
    const seen = new Set();
    const ordered = [];
    for (const tripId of tripIds) {
      const sts = (stopTimesByTrip[tripId] || []).sort((a, b) => a.sequence - b.sequence);
      for (const st of sts) {
        if (!seen.has(st.stop_id)) {
          seen.add(st.stop_id);
          ordered.push(st.stop_id);
        }
      }
    }
    stopsByRoute[routes[routeId]] = ordered;
  }

  console.log('Writing output...');
  const output = {
    routes: stopsByRoute,
    stops: stops,
  };
  const json = JSON.stringify(output);
  fs.writeFileSync(OUTPUT_PATH, json, 'utf-8');
  const sizeKB = (json.length / 1024).toFixed(0);
  const routeCount = Object.keys(stopsByRoute).length;
  const stopCount = Object.keys(stops).length;
  console.log(`Written to ${OUTPUT_PATH} (${sizeKB} KB, ${routeCount} routes, ${stopCount} stops)`);
}

main().catch(err => {
  console.error('Failed:', err);
  process.exit(1);
});
