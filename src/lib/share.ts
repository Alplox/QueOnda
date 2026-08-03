export interface SharePayload {
  title: string;
  text: string;
  url?: string;
}

export type ShareResult = 'shared' | 'copied' | 'failed';

function isTouchDevice(): boolean {
  return typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0;
}

export function canShareNative(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function';
}

export function canShareFiles(): boolean {
  return (
    canShareNative() &&
    typeof navigator.canShare === 'function' &&
    typeof File === 'function'
  );
}

export async function copyToClipboard(text: string): Promise<ShareResult> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return 'copied';
    }
  } catch {
    // fall through to execCommand fallback (mobile/older WebViews)
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok ? 'copied' : 'failed';
  } catch {
    return 'failed';
  }
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Mobile (touch) gets the native share sheet; desktop copies the URL directly.
export async function shareOrCopy(payload: SharePayload): Promise<ShareResult> {
  if (canShareNative() && isTouchDevice()) {
    try {
      await navigator.share({ title: payload.title, text: payload.text, url: payload.url });
      return 'shared';
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'failed';
    }
  }
  return copyToClipboard(payload.url || payload.text);
}

export function buildPageText(): SharePayload {
  return {
    title: '¿Qué Onda?',
    text: 'Noticias, TV en vivo, radios, finanzas, clima y más de Chile en una sola página. Sin anuncios, sin ruido.',
    url: 'https://queonda.pages.dev',
  };
}

export interface ShareableItem {
  mag?: number;
  place?: string;
  title: string;
  time?: number;
}

function fmtItemTime(t?: number): string {
  if (t == null) return '';
  return new Date(t).toLocaleString('es-CL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function buildEmergencySummary(items: ShareableItem[], alerts: ShareableItem[], powerCount?: number): SharePayload {
  const lines: string[] = ['🚨 Emergencias en Chile ahora mismo', ''];
  const eqs = items.slice(0, 6).map((i) => `• ${i.mag != null ? `M ${i.mag.toFixed(1)} — ` : ''}${i.place || i.title}${i.time ? ` · ${fmtItemTime(i.time)}` : ''}`);
  const als = alerts.slice(0, 4).map((a) => `• ${a.title}${a.time ? ` · ${fmtItemTime(a.time)}` : ''}`);
  if (eqs.length) lines.push('🌐 Sismos:', ...eqs, '');
  if (als.length) lines.push('🚨 Alertas SENAPRED:', ...als, '');
  if (powerCount != null && powerCount > 0) {
    if (lines[lines.length - 1] !== '') lines.push('');
    lines.push(`⚡ ${powerCount.toLocaleString('es-CL')} clientes sin suministro eléctrico`);
    lines.push('');
  }
  const generated = new Date().toLocaleString('es-CL', { weekday: 'short', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  lines.push(`Generado: ${generated}`, 'En vivo: https://queonda.pages.dev#emergencia');
  return { title: 'Emergencias Chile', text: lines.join('\n') };
}
