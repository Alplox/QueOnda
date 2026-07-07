import { BROWSER_UA } from './rss';

export const LINE_COLORS: Record<string, string> = {
  l1: '#e30613', l2: '#0055a5', l3: '#b1895c',
  l4: '#00843d', l4a: '#00a1e4', l5: '#f39200',
  l6: '#8c4799', l7: '#00bfb3',
};

export interface StopPrediction {
  route_id: string;
  direction: string;
  arrival_estimation: string;
  distance_km: string;
  is_live: boolean;
  serviceMessage?: string;
  isDetour?: boolean;
}

export interface StopInfo {
  id: string;
  name: string;
  predictions: StopPrediction[];
}

export interface PopularStop {
  code: string;
  name: string;
  comuna: string;
}

export const POPULAR_STOPS: PopularStop[] = [
  { code: 'PA1', name: 'Parada 1', comuna: '' },
  { code: 'PA10', name: 'Parada 10', comuna: '' },
  { code: 'PA100', name: 'Parada 100', comuna: '' },
  { code: 'PA101', name: 'Parada 101', comuna: '' },
  { code: 'PA102', name: 'Parada 102', comuna: '' },
  { code: 'PA103', name: 'Parada 103', comuna: '' },
  { code: 'PA104', name: 'Parada 104', comuna: '' },
  { code: 'PA105', name: 'Parada 105', comuna: '' },
  { code: 'PA106', name: 'Parada 106', comuna: '' },
  { code: 'PA107', name: 'Parada 107', comuna: '' },
  { code: 'PA108', name: 'Parada 108', comuna: '' },
  { code: 'PA109', name: 'Parada 109', comuna: '' },
  { code: 'PA11', name: 'Parada 11', comuna: '' },
  { code: 'PA111', name: 'Parada 111', comuna: '' },
  { code: 'PA112', name: 'Parada 112', comuna: '' },
  { code: 'PA114', name: 'Parada 114', comuna: '' },
  { code: 'PA115', name: 'Parada 115', comuna: '' },
  { code: 'PA116', name: 'Parada 116', comuna: '' },
  { code: 'PA117', name: 'Parada 117', comuna: '' },
  { code: 'PA118', name: 'Parada 118', comuna: '' },
  { code: 'PA119', name: 'Parada 119', comuna: '' },
  { code: 'PA12', name: 'Parada 12', comuna: '' },
  { code: 'PA120', name: 'Parada 120', comuna: '' },
  { code: 'PA121', name: 'Parada 121', comuna: '' },
  { code: 'PA122', name: 'Parada 122', comuna: '' },
  { code: 'PA123', name: 'Parada 123', comuna: '' },
  { code: 'PA124', name: 'Parada 124', comuna: '' },
  { code: 'PA125', name: 'Parada 125', comuna: '' },
  { code: 'PA126', name: 'Parada 126', comuna: '' },
  { code: 'PA127', name: 'Parada 127', comuna: '' },
  { code: 'PA128', name: 'Parada 128', comuna: '' },
  { code: 'PA129', name: 'Parada 129', comuna: '' },
  { code: 'PA13', name: 'Parada 13', comuna: '' },
  { code: 'PA130', name: 'Parada 130', comuna: '' },
  { code: 'PA131', name: 'Parada 131', comuna: '' },
  { code: 'PA132', name: 'Parada 132', comuna: '' },
  { code: 'PA133', name: 'Parada 133', comuna: '' },
  { code: 'PA134', name: 'Parada 134', comuna: '' },
  { code: 'PA135', name: 'Parada 135', comuna: '' },
  { code: 'PA136', name: 'Parada 136', comuna: '' },
  { code: 'PA137', name: 'Parada 137', comuna: '' },
  { code: 'PA138', name: 'Parada 138', comuna: '' },
  { code: 'PA139', name: 'Parada 139', comuna: '' },
  { code: 'PA14', name: 'Parada 14', comuna: '' },
  { code: 'PA140', name: 'Parada 140', comuna: '' },
  { code: 'PA141', name: 'Parada 141', comuna: '' },
  { code: 'PA142', name: 'Parada 142', comuna: '' },
  { code: 'PA143', name: 'Parada 143', comuna: '' },
  { code: 'PA144', name: 'Parada 144', comuna: '' },
  { code: 'PA145', name: 'Parada 145', comuna: '' },
  { code: 'PA146', name: 'Parada 146', comuna: '' },
];

let tokenCached: string | null = null;
let tokenFetchedAt = 0;
const TOKEN_TTL = 5 * 60 * 1000;

async function getRedToken(): Promise<string> {
  if (tokenCached && Date.now() - tokenFetchedAt < TOKEN_TTL) {
    return tokenCached;
  }

  const res = await fetch('https://www.red.cl/planifica-tu-viaje/cuando-llega/', {
    signal: AbortSignal.timeout(5000),
    headers: { 'User-Agent': BROWSER_UA },
  });
  const html = await res.text();
  const match = html.match(/\$jwt\s*=\s*'([^']+)'/);
  if (!match) throw new Error('No se encontró token JWT en red.cl');
  const decoded = Buffer.from(match[1], 'base64').toString('utf-8');
  tokenCached = decoded;
  tokenFetchedAt = Date.now();
  return decoded;
}

function processItem(item: any): StopPrediction[] {
  const code = item['codigorespuesta'];
  const servicioMsg = item['respuestaServicio'];

  const isNormal = code === '00' || code === '01';

  function dir() {
    if (!isNormal && servicioMsg) return '';
    const d = item['destino'] || '';
    return d ? `Hacia ${d}` : '';
  }

  function pred(est: string, dist: string, live: boolean, extra?: Partial<StopPrediction>): StopPrediction {
    return { route_id: item['servicio'], direction: dir(), arrival_estimation: est, distance_km: dist, is_live: live, ...extra };
  }

  if (!isNormal) {
    if (servicioMsg) {
      return [pred(servicioMsg, '', false, { serviceMessage: servicioMsg, isDetour: /desv[ií]o/i.test(servicioMsg) })];
    }
    if (code === '11') return [pred('Fuera de servicio', '', false, { serviceMessage: 'Fuera de servicio' })];
    if (code === '9' || code === '10') return [pred('No hay buses que se dirijan al paradero', '', false, { serviceMessage: 'No hay buses que se dirijan al paradero' })];
    return [];
  }

  const results: StopPrediction[] = [];
  for (const w of ['1', '2'] as const) {
    const hora = item[`horaprediccionbus${w}`];
    const dist = item[`distanciabus${w}`];
    if (!hora && !dist) continue;

    let arrival = '';
    let distKm = '';

    if (dist) {
      const km = dist / 1000;
      if (km < 0.05) {
        arrival = 'Llegando';
      } else {
        distKm = (Math.round(km * 100) / 100).toFixed(1);
        arrival = hora ? `${distKm} km (${hora})` : `${distKm} km`;
      }
    } else if (hora) {
      arrival = hora;
    }

    if (arrival) results.push(pred(arrival, distKm, code === '00'));
  }
  return results;
}

export async function fetchStopPredictions(stopId: string): Promise<StopInfo> {
  const token = await getRedToken();
  const res = await fetch(
    `https://www.red.cl/predictorPlus/prediccion?t=${encodeURIComponent(token)}&codsimt=${encodeURIComponent(stopId)}`,
    { signal: AbortSignal.timeout(5000), headers: { 'User-Agent': BROWSER_UA } }
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();

  if (!data['servicios']?.item?.length) {
    throw new Error('Sin predicciones para ese paradero');
  }

  const items = data['servicios']['item'] as any[];
  const predictions: StopPrediction[] = [];
  for (const item of items) {
    predictions.push(...processItem(item));
  }

  return {
    id: data['paradero'] || stopId,
    name: data['nomett'] || '',
    predictions,
  };
}

export interface MetroStation {
  name: string;
  line: string;
  status: number;
}

export async function fetchMetroStations(): Promise<{ lines: MetroStation[]; issues: boolean }> {
  try {
    const res = await fetch('https://api.xor.cl/red/metro-network', {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { lines: [], issues: false };
    const data = await res.json();
    return {
      lines: (data.lines || []).map((l: any) => ({
        name: l.name || l.nombre || '',
        line: l.line || l.linea || '',
        status: l.status ?? l.estado ?? 0,
      })),
      issues: data.issues ?? false,
    };
  } catch {
    return { lines: [], issues: false };
  }
}
