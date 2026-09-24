// Temporary dock debugging overlay (?dockdebug=1).
// Renders an on-screen ring buffer of dock/sheet state transitions so
// device-specific behavior (Firefox Android APZ, dynamic toolbars) can be
// diagnosed without remote debugging. Remove once stable.

const MAX_ENTRIES = 60;

let logEl: HTMLPreElement | null = null;
let bodyEl: HTMLDivElement | null = null;
let minBtn: HTMLButtonElement | null = null;
let collapsed = false;
const entries: string[] = [];

function setCollapsed(v: boolean) {
  collapsed = v;
  if (bodyEl) bodyEl.style.display = v ? 'none' : 'block';
  if (minBtn) minBtn.textContent = v ? '+' : '–';
}

function enabled() {
  try {
    return new URLSearchParams(location.search).has('dockdebug');
  } catch {
    return false;
  }
}

function render() {
  if (!logEl) return;
  if (collapsed) return; // minimized: buffer keeps everything for the copy button
  // Append-only + selection-aware: rewriting textContent on every probe
  // wiped active text selections and hid mobile copy options mid-flow
  const sel = getSelection();
  if (sel && sel.toString().length > 0 && logEl.contains(sel.anchorNode)) return;
  const lines = logEl.textContent ? logEl.textContent.split('\n') : [];
  const last = entries[entries.length - 1];
  if (lines[lines.length - 1] === '' && lines.length > 1) lines.pop();
  if (lines[lines.length - 1] === last) return; // already rendered
  logEl.append(document.createTextNode(last + '\n'));
  // Trim overflow only when the user isn't selecting
  while (
    !sel?.toString() &&
    logEl.textContent &&
    logEl.textContent.split('\n').length > MAX_ENTRIES + 2 &&
    logEl.firstChild
  ) {
    logEl.removeChild(logEl.firstChild);
  }
}

export function dockDebug(label: string, detail?: () => string | string) {
  if (!enabled()) return;
  let d = '';
  if (typeof detail === 'function') {
    try {
      d = detail();
    } catch {
      d = '(detail threw)';
    }
  } else if (detail !== undefined) {
    d = detail;
  }
  const line = `${new Date().toISOString().slice(11, 23)} ${label}${d ? ' ' + d : ''}`;
  entries.push(line);
  while (entries.length > MAX_ENTRIES) entries.shift();
  render();
}

export function initDockDebugOverlay() {
  if (!enabled() || typeof document === 'undefined') return;
  // Periodic geometry probe: distinguishes a real DOM element occupying the
  // space (rect.top values) from a browser compositing ghost (nothing there)
  setInterval(() => {
    const sheet = document.getElementById('section-sheet');
    const dock = document.getElementById('bottom-nav');
    const btt = document.querySelector<HTMLButtonElement>('button[aria-label="Volver arriba"]');
    const player = document.getElementById('sticky-radio-player');
    const parts: string[] = [`probe y=${Math.round(window.scrollY)} vh=${window.innerHeight} lay=${document.documentElement.clientHeight} gap=${Math.max(0, window.innerHeight - document.documentElement.clientHeight)}`];
    if (sheet) {
      const r = sheet.getBoundingClientRect();
      const cs = getComputedStyle(sheet);
      parts.push(`sheet.top=${Math.round(r.top)} vis=${cs.visibility} display=${cs.display}`);
    }
    if (dock) {
      const r = dock.getBoundingClientRect();
      const cs = getComputedStyle(dock);
      parts.push(
        `dock.top=${Math.round(r.top)} h=${Math.round(r.height)} inert=${dock.inert} vis=${cs.visibility} tfm=${cs.transform === 'none' ? 'none' : 'yes'} btm=${cs.bottom}`,
      );
    }
    if (player) {
      const r = player.getBoundingClientRect();
      const cs = getComputedStyle(player);
      parts.push(
        `player.top=${Math.round(r.top)} h=${Math.round(r.height)} vis=${cs.visibility} display=${cs.display}`,
      );
    }
    if (btt) {
      const r = btt.getBoundingClientRect();
      const cs = getComputedStyle(btt);
      if (cs.opacity !== '0') parts.push(`backtotop.top=${Math.round(r.top)} bottom=${btt.style.bottom}`);
    }
    // Pairwise overlap detection between fixed bottom elements
    const boxes: Array<[string, DOMRect | null]> = [
      ['dock', dock?.getBoundingClientRect() ?? null],
      ['player', player?.getBoundingClientRect() ?? null],
      ['btt', btt && getComputedStyle(btt).opacity !== '0' ? btt.getBoundingClientRect() : null],
    ];
    for (let a = 0; a < boxes.length; a++) {
      for (let b = a + 1; b < boxes.length; b++) {
        const [na, ra] = boxes[a];
        const [nb, rb] = boxes[b];
        if (!ra || !rb) continue;
        if (ra.top < rb.bottom && rb.top < ra.bottom) {
          parts.push(`OVERLAP ${na}(${Math.round(ra.top)}-${Math.round(ra.bottom)}) x ${nb}(${Math.round(rb.top)}-${Math.round(rb.bottom)})`);
        }
      }
    }
    dockDebug('probe', () => parts.join(' | '));
    // Auto-minimize while the sheet is open so the overlay never covers
    // its close button
    const sheetRect = sheet?.getBoundingClientRect();
    if (sheet && sheetRect && !sheet.inert && sheetRect.top < window.innerHeight - 40 && !collapsed) {
      dockDebug('auto-minimizado (sheet abierto)');
      setCollapsed(true);
    }
  }, 700);

  const host = document.createElement('div');
  host.id = 'dock-debug-overlay';
  host.style.cssText =
    'position:fixed;top:0;left:0;z-index:2147483647;background:rgba(0,0,0,.82);color:#0f0;font:10px/1.35 monospace;padding:6px 8px;max-width:96vw;max-height:46vh;overflow:auto;border-radius:0 0 8px 0;pointer-events:auto;';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = 'copiar';
  btn.style.cssText =
    'position:sticky;top:0;float:right;margin:0 0 4px 8px;padding:4px 8px;font:bold 11px monospace;background:#0f0;color:#000;border:0;border-radius:4px;cursor:pointer;';
  minBtn = document.createElement('button');
  minBtn.type = 'button';
  minBtn.textContent = '–';
  minBtn.title = 'Minimizar/expandir log';
  minBtn.style.cssText =
    'position:sticky;top:0;float:right;margin:0 0 4px 4px;width:24px;padding:4px 0;font:bold 11px monospace;background:#0f0;color:#000;border:0;border-radius:4px;cursor:pointer;';
  minBtn.addEventListener('click', () => setCollapsed(!collapsed));
  bodyEl = document.createElement('div');
  bodyEl.style.cssText = 'clear:both;';
  logEl = document.createElement('pre');
  logEl.style.cssText = 'margin:0;white-space:pre-wrap;word-break:break-all;';
  bodyEl.append(logEl);
  host.append(minBtn, btn, bodyEl);
  document.body?.append(host);

  btn.addEventListener('click', async () => {
    const text = entries.join('\n');
    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = '¡copiado!';
    } catch {
      // Clipboard API blocked (common on mobile): fall back to a
      // full-screen textarea the user can copy from directly
      setCollapsed(false);
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText =
        'position:fixed;inset:0;z-index:2147483647;width:100%;height:100%;background:#000;color:#0f0;font:10px monospace;border:0;padding:8px;box-sizing:border-box;';
      ta.addEventListener('click', () => ta.remove());
      document.body.append(ta);
      ta.focus();
      ta.select();
      try {
        const legacyDocument = document as unknown as { execCommand: (command: string) => boolean };
        legacyDocument.execCommand('copy');
        btn.textContent = '¡copiado!';
        setTimeout(() => ta.remove(), 600);
      } catch {
        btn.textContent = 'toca fuera p/cerrar';
      }
    }
    setTimeout(() => (btn.textContent = 'copiar'), 1500);
  });
}
