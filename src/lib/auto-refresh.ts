// Shared auto-refresh for the emergency section — always on, no user toggle.
// Module singleton (same pattern as sound.ts): one interval + one focus/visibility
// listener drive every emergency island on the page. A 60s throttle bounds refocus
// spam, and the 5-min edge cache absorbs repeated hits regardless.
type Listener = () => void;

const listeners = new Set<Listener>();
let lastRefresh = 0;
const THROTTLE_MS = 60_000;
const INTERVAL_MS = 5 * 60_000;

function notify() {
  const now = Date.now();
  if (now - lastRefresh < THROTTLE_MS) return;
  lastRefresh = now;
  for (const fn of listeners) {
    try { fn(); } catch { /* one broken subscriber must not block the rest */ }
  }
}

function onVisibility() {
  if (!document.hidden) notify();
}

// ponytail: SSR guard — this module is evaluated on the server too, where there is no window
if (typeof window !== 'undefined') {
  setInterval(notify, INTERVAL_MS);
  window.addEventListener('focus', notify);
  document.addEventListener('visibilitychange', onVisibility);
}

export function subscribeAutoRefresh(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
