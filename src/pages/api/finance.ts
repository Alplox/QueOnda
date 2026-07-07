import type { APIRoute } from 'astro';
import { XMLParser } from 'fast-xml-parser';
import { getCached, getStaleCached, setCache } from '../../lib/cache';

const MINDICADOR_URL = 'https://mindicador.cl/api';
const BOOSTR_URL = 'https://api.boostr.cl/economy/indicators.json';
const FINDIC_URL = 'https://findic.cl/api/';
const SII_RSS_URL = 'https://zeus.sii.cl/admin/rss/sii_ind_rss.xml';
const DOLARAPI_URL = 'https://cl.dolarapi.com/v1/cotizaciones';

interface Indicator {
  value: number;
  date: string;
}

interface FinanceData {
  uf: Indicator;
  dolar: Indicator;
  euro: Indicator;
  ipc: Indicator;
  utm: Indicator;
}

type IndicatorKey = keyof FinanceData;
const ALL_KEYS: IndicatorKey[] = ['uf', 'dolar', 'euro', 'ipc', 'utm'];

async function fetchMindicador(): Promise<Partial<FinanceData>> {
  const res = await fetch(MINDICADOR_URL, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Mindicador returned ${res.status}`);
  const data = await res.json();
  return {
    uf: data.uf?.valor != null ? { value: data.uf.valor, date: data.uf.fecha } : undefined,
    dolar: data.dolar?.valor != null ? { value: data.dolar.valor, date: data.dolar.fecha } : undefined,
    euro: data.euro?.valor != null ? { value: data.euro.valor, date: data.euro.fecha } : undefined,
    ipc: data.ipc?.valor != null ? { value: data.ipc.valor, date: data.ipc.fecha } : undefined,
    utm: data.utm?.valor != null ? { value: data.utm.valor, date: data.utm.fecha } : undefined,
  };
}

async function fetchBoostr(): Promise<Partial<FinanceData>> {
  const res = await fetch(BOOSTR_URL, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Boostr returned ${res.status}`);
  const json = await res.json();
  if (json.status !== 'success' || !json.data) throw new Error('Boostr: invalid response');
  const d = json.data;
  return {
    uf: d.uf?.value != null ? { value: d.uf.value, date: d.uf.date } : undefined,
    dolar: d.dolar?.value != null ? { value: d.dolar.value, date: d.dolar.date } : undefined,
    euro: d.euro?.value != null ? { value: d.euro.value, date: d.euro.date } : undefined,
    ipc: d.ipc?.value != null ? { value: d.ipc.value, date: d.ipc.date } : undefined,
    utm: d.utm?.value != null ? { value: d.utm.value, date: d.utm.date } : undefined,
  };
}

async function fetchFindic(): Promise<Partial<FinanceData>> {
  const res = await fetch(FINDIC_URL, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Findic returned ${res.status}`);
  const data = await res.json();
  return {
    uf: data.uf?.valor != null ? { value: data.uf.valor, date: data.uf.fecha } : undefined,
    dolar: data.dolar?.valor != null ? { value: data.dolar.valor, date: data.dolar.fecha } : undefined,
    euro: data.euro?.valor != null ? { value: data.euro.valor, date: data.euro.fecha } : undefined,
    ipc: data.ipc?.valor != null ? { value: data.ipc.valor, date: data.ipc.fecha } : undefined,
    utm: data.utm?.valor != null ? { value: data.utm.valor, date: data.utm.fecha } : undefined,
  };
}

async function fetchSiiRss(): Promise<Partial<FinanceData>> {
  const res = await fetch(SII_RSS_URL, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`SII RSS returned ${res.status}`);
  const xml = await res.text();
  const parser = new XMLParser({ isArray: (tag) => tag === 'item' });
  const data = parser.parse(xml);
  const items: Array<{ title?: string; description?: string }> = data?.rss?.channel?.item ?? [];
  const result: Partial<FinanceData> = {};
  const pubDate = data?.rss?.channel?.pubDate;
  for (const item of items) {
    const title = (item.title || '').trim();
    const desc = (item.description || '').trim();
    const match = desc.match(/CLP\s*-\s*\$\s*([\d,.]+)/);
    if (!match) continue;
    const value = parseFloat(match[1].replace(/\./g, '').replace(',', '.'));
    if (title === 'DOLAR OBSERVADO') {
      result.dolar = { value, date: pubDate || '' };
    } else if (title === 'U.F.') {
      result.uf = { value, date: pubDate || '' };
    } else if (title.startsWith('U.T.M.')) {
      result.utm = { value, date: pubDate || '' };
    }
  }
  if (result.dolar?.value == null && result.uf?.value == null) throw new Error('SII RSS: no indicators found');
  return result;
}

async function fetchDolarApi(): Promise<Partial<FinanceData>> {
  const res = await fetch(DOLARAPI_URL, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`DolarAPI returned ${res.status}`);
  const items: Array<{ moneda: string; ultimoCierre: number; fechaActualizacion: string }> = await res.json();
  const result: Partial<FinanceData> = {};
  for (const item of items) {
    if (item.moneda === 'USD' && item.ultimoCierre != null) {
      result.dolar = { value: item.ultimoCierre, date: item.fechaActualizacion };
    } else if (item.moneda === 'EUR' && item.ultimoCierre != null) {
      result.euro = { value: item.ultimoCierre, date: item.fechaActualizacion };
    }
  }
  if (result.dolar?.value == null && result.euro?.value == null) throw new Error('DolarAPI: no indicators found');
  return result;
}

export const GET: APIRoute = async () => {
  const cached = await getCached<FinanceData>('finance');
  if (cached) {
    return new Response(JSON.stringify(cached), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=1800' },
    });
  }

  const merged: Partial<FinanceData> = {};
  let anySuccess = false;
  const fetchers = [fetchMindicador, fetchBoostr, fetchFindic, fetchSiiRss, fetchDolarApi];

  for (const fetchFn of fetchers) {
    try {
      const data = await fetchFn();
      anySuccess = true;
      for (const key of ALL_KEYS) {
        if (!merged[key] && data[key]?.value != null) {
          merged[key] = data[key] as Indicator;
        }
      }
      if (ALL_KEYS.every(k => merged[k]?.value != null)) break;
    } catch (err) {
      console.error(`Finance: ${fetchFn.name} failed:`, err);
    }
  }

  if (anySuccess && ALL_KEYS.some(k => merged[k]?.value != null)) {
    const finance = merged as FinanceData;
    await setCache('finance', finance, 30 * 60 * 1000);
    return new Response(JSON.stringify(finance), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=1800' },
    });
  }

  const stale = await getStaleCached<FinanceData>('finance');
  if (stale) {
    return new Response(JSON.stringify({ ...stale, stale: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ error: 'Indicadores no disponibles' }), {
    status: 502,
    headers: { 'Content-Type': 'application/json' },
  });
};
