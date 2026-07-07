import { existsSync, renameSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = join(fileURLToPath(import.meta.url), '..', '..', 'dist');

if (!existsSync(join(dist, 'server'))) {
  process.exit(0);
}

// Move server/ -> _worker.js/
if (existsSync(join(dist, '_worker.js'))) {
  rmSync(join(dist, '_worker.js'), { recursive: true });
}
renameSync(join(dist, 'server'), join(dist, '_worker.js'));

// Rename entry.mjs -> index.js (Pages expects _worker.js/index.js)
const entryMjs = join(dist, '_worker.js', 'entry.mjs');
if (existsSync(entryMjs)) {
  renameSync(entryMjs, join(dist, '_worker.js', 'index.js'));
}

// Move client/* -> dist/
const clientDir = join(dist, 'client');
if (existsSync(clientDir)) {
  const entries = ['_astro', '.assetsignore', 'android-chrome-192x192.png',
    'android-chrome-512x512.png', 'apple-touch-icon.png', 'chile-flag.svg',
    'favicon-16x16.png', 'favicon-32x32.png', 'favicon.ico', 'og-image.png',
    'screenshot.jpeg', 'site.webmanifest', '_headers'];
  for (const entry of entries) {
    const src = join(clientDir, entry);
    if (existsSync(src)) {
      renameSync(src, join(dist, entry));
    }
  }
  rmSync(clientDir, { recursive: true });
}

// Remove generated wrangler.json inside _worker.js (ASSETS binding conflicts with Pages)
const wranglerJson = join(dist, '_worker.js', 'wrangler.json');
if (existsSync(wranglerJson)) {
  rmSync(wranglerJson);
}

// Remove .wrangler/ deploy config (points to server/wrangler.json which no longer exists)
const dotWrangler = join(dist, '..', '.wrangler');
if (existsSync(dotWrangler)) {
  rmSync(dotWrangler, { recursive: true });
}

console.log('✓ Restructured dist/ for Cloudflare Pages');
