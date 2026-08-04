// Manual canvas card for sharing the emergency section — no html2canvas dependency.
// ponytail: hand-drawn so we stay dependency-free; redesign lives in this one function.

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#ef4444',
  high: '#f59e0b',
  moderate: '#38bdf8',
  low: '#22c55e',
};

function cssVar(name: string, fallback: string): string {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  } catch {
    return fallback;
  }
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export interface ImageShareItem {
  severity: 'low' | 'moderate' | 'high' | 'critical';
  title: string;
  mag?: number;
  place?: string;
  time?: number;
}

function fmtTime(t?: number): string {
  if (t == null) return '';
  return new Date(t).toLocaleString('es-CL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export async function renderEmergencyCard(items: ImageShareItem[], alerts: ImageShareItem[], powerCount?: number): Promise<Blob> {
  const W = 1080;
  const H = 1350;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D not available');

  try {
    await document.fonts.load('700 58px Figtree');
    await document.fonts.load('500 27px Figtree');
  } catch {
    /* fonts may not be loaded yet — fall back to system stack */
  }

  const bg = cssVar('--color-base-200', '#101014');
  const fg = cssVar('--color-base-content', '#f5f5f4');
  const primary = cssVar('--color-primary', '#f59e0b');
  const font = 'Figtree, system-ui, sans-serif';

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = cssVar('--color-base-100', '#0a0a0a');
  ctx.fillRect(0, 0, W, 200);

  ctx.fillStyle = primary;
  ctx.fillRect(52, 52, 72, 10);

  ctx.textBaseline = 'top';
  ctx.fillStyle = fg;
  ctx.font = `700 58px ${font}`;
  ctx.fillText('¿Qué Onda? · Emergencias', 52, 76);

  ctx.globalAlpha = 0.7;
  ctx.font = `500 24px ${font}`;
  const dateStr = new Date().toLocaleString('es-CL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Santiago',
  });
  ctx.fillText(`Chile · ${dateStr}`, 52, 152);
  ctx.globalAlpha = 1;

  const footerY = H - 52;
  let y = 240;

  const drawHeader = (label: string) => {
    if (y + 46 > footerY) return false;
    ctx.fillStyle = fg;
    ctx.globalAlpha = 0.6;
    ctx.font = `700 22px ${font}`;
    ctx.fillText(label, 52, y);
    ctx.globalAlpha = 0.22;
    ctx.fillRect(52, y + 30, W - 104, 3);
    ctx.globalAlpha = 1;
    y += 50;
    return true;
  };

  const drawItem = (severity: string, label: string) => {
    ctx.font = `500 27px ${font}`;
    const lines = wrapText(ctx, label, W - 52 - 100).slice(0, 2);
    const block = lines.length * 34 + 24;
    if (y + block > footerY) return false;
    ctx.fillStyle = SEVERITY_COLORS[severity] ?? '#888888';
    ctx.beginPath();
    ctx.arc(66, y + 16, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = fg;
    lines.forEach((ln, i) => ctx.fillText(ln, 100, y + i * 34));
    y += block;
    return true;
  };

  const eqItems = items.slice(0, 5).map((i) => ({
    severity: i.severity,
    label: `${i.mag != null ? `M ${i.mag.toFixed(1)} — ` : ''}${i.place || i.title}${i.time ? ` · ${fmtTime(i.time)}` : ''}`,
  }));
  const alertItems = alerts.slice(0, 4).map((a) => ({ severity: a.severity, label: `${a.title}${a.time ? ` · ${fmtTime(a.time)}` : ''}` }));

  if (eqItems.length) { drawHeader('🌐 Sismos'); eqItems.forEach((i) => drawItem(i.severity, i.label)); }
  if (alertItems.length) { drawHeader('🚨 Alertas SENAPRED'); alertItems.forEach((i) => drawItem(i.severity, i.label)); }
  if (powerCount != null && powerCount > 0) {
    if (drawHeader('⚡ Sin suministro eléctrico')) {
      drawItem('high', `${powerCount.toLocaleString('es-CL')} clientes sin suministro eléctrico en Chile`);
    }
  }
  if (!eqItems.length && !alertItems.length && (powerCount == null || powerCount <= 0)) {
    ctx.globalAlpha = 0.6;
    ctx.font = `500 27px ${font}`;
    ctx.fillText('Sin emergencias activas en este momento.', 52, y);
    ctx.globalAlpha = 1;
  }

  ctx.globalAlpha = 0.7;
  ctx.font = `600 24px ${font}`;
  const genTime = new Date().toLocaleString('es-CL', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'America/Santiago',
  });
  ctx.fillText(`queonda.pages.dev · generado ${genTime}`, 52, H - 48);
  ctx.globalAlpha = 1;

  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png');
  });
}
