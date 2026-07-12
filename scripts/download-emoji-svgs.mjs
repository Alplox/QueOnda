/**
 * Downloads Twemoji SVGs for all emojis used in FiestasCountdown card collection.
 * Run: node scripts/download-emoji-svgs.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'public', 'emoji');

const EMOJIS = [
  // FiestasCountdown card collection
  '🥟', '🍹', '🪁', '💃', '🎪', '🥩', '🔥', '🍻', '😴', '🤢',
  '🥣', '💸', '🗓️', '🌭', '🍟', '🫓', '☕', '🍞', '🧉', '🦙',
  '🦭', '🦅', '🗿', '🌶️', '🥪', '🥤', '🚌', '🚇', '🐕', '🦜',
  '🌧️', '🏔️', '🌊', '📢', '🤙', '🤑', '🧢', '🦆',
  // FiestasCountdown text + PREP_STATUS
  '🧊', '🍷', '🎉',
  // Festivities
  '🎄', '💕', '🎃',
  // ClientTV + ClientJobList
  '📁', '🔗', '📝', '📋',
  // TYPE_ICON
  '💧', '🌍', '💨', '🍽️', '⚙️',
];

function toCodepoints(emoji) {
  return [...emoji]
    .map(c => c.codePointAt(0).toString(16))
    .filter(c => c !== 'fe0f')
    .join('-');
}

async function download(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

await mkdir(OUT_DIR, { recursive: true });

const BASE = 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg';

let ok = 0, fail = 0;
for (const emoji of EMOJIS) {
  const cp = toCodepoints(emoji);
  const dest = join(OUT_DIR, `${cp}.svg`);
  try {
    const svg = await download(`${BASE}/${cp}.svg`);
    await writeFile(dest, svg, 'utf8');
    console.log(`✓ ${emoji} → ${cp}.svg`);
    ok++;
  } catch (e) {
    console.error(`✗ ${emoji} (${cp}): ${e.message}`);
    fail++;
  }
}

console.log(`\nDone: ${ok} downloaded, ${fail} failed`);
