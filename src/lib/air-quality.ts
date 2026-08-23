export interface AirRow {
  value: number;
  status: string;
  statusCode: number;
  icap?: number;
  color: string;
  datetime: string;
}

export interface AirStation {
  key: string;
  nombre: string;
  comuna: string;
  region: string;
  regionIndex?: number;
  param?: 'PM25' | 'PM10';
  lat: number;
  lon: number;
  pm25?: AirRow;
  pm10?: AirRow;
}

export interface AirData {
  source: 'sinca' | 'open-meteo';
  updatedAt: number;
  stations: AirStation[];
}

// Official SINCA palette per ICAP state (statuscode 1-5)
export const AIR_STATUS: Record<number, { label: string; color: string }> = {
  1: { label: 'Bueno', color: '#2eae00' },
  2: { label: 'Regular', color: '#fbff00' },
  3: { label: 'Alerta', color: '#ff7d1c' },
  4: { label: 'Pre-emergencia', color: '#ff0931' },
  5: { label: 'Emergencia', color: '#8b0000' },
};

// ICAP MP2.5 bands (µg/m³, media móvil 24 h): bueno ≤50 · regular ≤80 ·
// alerta ≤110 · pre-emergencia ≤140 · emergencia >140 (DS 59/2023; verified
// against SINCA's own icap values: 50→100, 80→200, 110→300)
export function airStatusFromPm25(v: number): { status: string; statusCode: number; color: string } {
  const t = v <= 50 ? 1 : v <= 80 ? 2 : v <= 110 ? 3 : v <= 140 ? 4 : 5;
  return { status: AIR_STATUS[t].label.toLowerCase(), statusCode: t, color: AIR_STATUS[t].color };
}

// Sort key: worse state first, then higher concentration
export function airSeverity(s: AirStation): number {
  return (s.pm25?.statusCode ?? s.pm10?.statusCode ?? 0) * 100000 + (s.pm25?.value ?? s.pm10?.value ?? 0);
}

// Unique regions ordered north → south (SINCA regionindex; ties alphabetical)
export function orderedRegions(stations: AirStation[]): string[] {
  const m = new Map<string, number>();
  for (const s of stations) {
    if (!s.region) continue;
    m.set(s.region, Math.min(m.get(s.region) ?? 99, s.regionIndex ?? 99));
  }
  return [...m.keys()].sort((a, b) => (m.get(a)! - m.get(b)!) || a.localeCompare(b, 'es'));
}
