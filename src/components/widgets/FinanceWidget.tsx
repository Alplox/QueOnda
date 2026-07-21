import { useEffect, useState } from 'react';
import { idbGet, idbSet } from '../../lib/idb-cache';

const IDB_KEY = 'finance';
const IDB_TTL = 30 * 60 * 1000; // 30 min

interface Indicator { value: number; date: string; }
interface FinanceData { uf: Indicator; dolar: Indicator; euro: Indicator; ipc: Indicator; utm: Indicator; }
type IndicatorKey = keyof FinanceData;
const ALL_KEYS: IndicatorKey[] = ['uf', 'dolar', 'euro', 'ipc', 'utm'];

async function fetchMindicadorClient(): Promise<Partial<FinanceData>> {
  const res = await fetch('https://mindicador.cl/api', { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`${res.status}`);
  const data = await res.json();
  return {
    uf: data.uf?.valor != null ? { value: data.uf.valor, date: data.uf.fecha } : undefined,
    dolar: data.dolar?.valor != null ? { value: data.dolar.valor, date: data.dolar.fecha } : undefined,
    euro: data.euro?.valor != null ? { value: data.euro.valor, date: data.euro.fecha } : undefined,
    ipc: data.ipc?.valor != null ? { value: data.ipc.valor, date: data.ipc.fecha } : undefined,
    utm: data.utm?.valor != null ? { value: data.utm.valor, date: data.utm.fecha } : undefined,
  };
}

async function fetchDolarApiClient(): Promise<Partial<FinanceData>> {
  const res = await fetch('https://cl.dolarapi.com/v1/cotizaciones', { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`${res.status}`);
  const items: Array<{ moneda: string; ultimoCierre: number; fechaActualizacion: string }> = await res.json();
  const result: Partial<FinanceData> = {};
  for (const item of items) {
    if (item.moneda === 'USD' && item.ultimoCierre != null) result.dolar = { value: item.ultimoCierre, date: item.fechaActualizacion };
    else if (item.moneda === 'EUR' && item.ultimoCierre != null) result.euro = { value: item.ultimoCierre, date: item.fechaActualizacion };
  }
  if (result.dolar?.value == null && result.euro?.value == null) throw new Error('no indicators');
  return result;
}

async function fetchFinanceClient(): Promise<FinanceData | null> {
  const merged: Partial<FinanceData> = {};
  for (const fn of [fetchMindicadorClient, fetchDolarApiClient]) {
    try {
      const data = await fn();
      for (const key of ALL_KEYS) { if (!merged[key] && data[key]?.value != null) merged[key] = data[key] as Indicator; }
      if (ALL_KEYS.every(k => merged[k]?.value != null)) break;
    } catch {}
  }
  return ALL_KEYS.some(k => merged[k]?.value != null) ? merged as FinanceData : null;
}

async function fetchFinanceServer(): Promise<FinanceData | null> {
  try { const r = await fetch('/api/finance'); const j = await r.json(); return j.error ? null : j; } catch { return null; }
}

interface ItemDef {
  key: keyof FinanceData;
  label: string;
  prefix: string;
  suffix?: string;
  icon: React.ReactNode;
}

const icons = {
  uf: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  ),
  dolar: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="1" x2="12" y2="23" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  ),
  euro: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 5c-7-1-10 5-10 7s3 8 10 7" />
      <line x1="4" y1="12" x2="15" y2="12" />
      <line x1="4" y1="8" x2="11" y2="8" />
      <line x1="4" y1="16" x2="11" y2="16" />
    </svg>
  ),
  ipc: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  ),
  utm: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  ),
};

const ITEMS: ItemDef[] = [
  { key: 'uf', label: 'UF', prefix: '$', icon: icons.uf },
  { key: 'dolar', label: 'USD', prefix: '$', icon: icons.dolar },
  { key: 'euro', label: 'EUR', prefix: '$', icon: icons.euro },
  { key: 'ipc', label: 'IPC', prefix: '', suffix: '%', icon: icons.ipc },
  { key: 'utm', label: 'UTM', prefix: '$', icon: icons.utm },
];

function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr.slice(0, 10);
    return d.toLocaleDateString('es-CL', { day: 'numeric', month: 'short' });
  } catch {
    return dateStr.slice(0, 10);
  }
}

function SkeletonCard() {
  return (
    <div className="rounded-xl bg-base-200 border border-base-300 p-4 animate-pulse">
      <div className="flex items-center gap-1.5 mb-2">
        <div className="w-4 h-4 rounded bg-base-300" />
        <div className="h-3 w-10 bg-base-300 rounded" />
      </div>
      <div className="h-7 w-28 bg-base-300 rounded mb-1.5" />
      <div className="h-2.5 w-16 bg-base-300 rounded" />
    </div>
  );
}

function ValueCard({ item, value, date, index }: { item: ItemDef; value: number; date: string; index: number }) {
  return (
    <div
      className="rounded-xl bg-base-200 border border-base-300 p-4 transition-all duration-200 hover:scale-[1.02] hover:shadow-md opacity-0 animate-[fadeSlideIn_0.35s_ease-out_forwards] min-w-0"
      style={{ animationDelay: `${index * 70}ms` }}
    >
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className="text-base-content/50">{item.icon}</span>
        <span className="text-xs text-base-content/70 uppercase tracking-wider">{item.label}</span>
      </div>
      <p className="text-xl sm:text-2xl font-semibold text-base-content font-mono tabular-nums tracking-tight break-words leading-tight">
        {item.prefix}
        {value.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        {item.suffix}
      </p>
      {date && (
        <p className="text-[10px] text-base-content/50 mt-1">{formatDate(date)}</p>
      )}
    </div>
  );
}

const SOURCES = [
  { name: 'mindicador.cl', url: 'https://mindicador.cl' },
  { name: 'Boostr', url: 'https://docs.boostr.cl/reference/economy-info' },
  { name: 'findic.cl', url: 'https://findic.cl' },
  { name: 'SII', url: 'https://zeus.sii.cl/admin/rss/sii_ind_rss.xml' },
  { name: 'DolarApi', url: 'https://dolarapi.com/docs/chile/' },
];

function SourceAttribution() {
  return (
    <div className="mt-2 text-right text-[10px] text-base-content/50">
      Fuentes:{' '}
      {SOURCES.map((s, i) => (
        <span key={s.name}>
          {i > 0 && <>{' · '}</>}
          <a href={s.url} target="_blank" rel="noopener noreferrer" className="hover:text-base-content underline underline-offset-2 transition-colors">{s.name}</a>
        </span>
      ))}
    </div>
  );
}

export function FinanceWidget() {
  const [data, setData] = useState<FinanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [stale, setStale] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let resolved = false;

    // Phase 0: IDB cache → instant render
    idbGet<FinanceData>(IDB_KEY).then(cached => {
      if (cancelled || !cached?.data) return;
      resolved = true;
      setData(cached.data);
      setLoading(false);
    });

    // Phase 1: background fetch → update
    fetchFinanceClient()
      .then(async result => {
        if (cancelled) return;
        const data = result ?? await fetchFinanceServer();
        if (data) {
          idbSet(IDB_KEY, data, IDB_TTL);
          setData(data);
        }
        if (!resolved) setLoading(false);
        resolved = true;
      })
      .catch(() => {
        if (!cancelled && !resolved) setError(true);
      })
      .finally(() => { if (!cancelled && !resolved) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 sm:gap-3">
          {ITEMS.map((item) => <SkeletonCard key={item.key} />)}
        </div>
        <SourceAttribution />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div>
        <p className="text-xs text-base-content/50 pb-1">Indicadores no disponibles</p>
        <SourceAttribution />
      </div>
    );
  }

  return (
    <div>
      {stale && (
        <p className="text-xs text-warning mb-2">Datos con posible retraso</p>
      )}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 sm:gap-3">
        {ITEMS.map((item, i) => {
          const indicator = data?.[item.key];
          if (!indicator?.value) return null;
          return <ValueCard key={item.key} item={item} value={indicator.value} date={indicator.date} index={i} />;
        })}
      </div>
      <SourceAttribution />
    </div>
  );
}
