// Canonical Chilean region data, north → south. Single source of truth for
// region ordering and labels — do not duplicate these lists in components.
// (chile-outline.ts intentionally stays separate: map geometry, not labels.)

export const REGION_SLUGS_NS = [
  'arica-y-parinacota', 'tarapaca', 'antofagasta', 'atacama', 'coquimbo',
  'valparaiso', 'metropolitana', 'ohiggins', 'maule', 'nuble',
  'biobio', 'araucania', 'los-rios', 'los-lagos', 'aysen', 'magallanes',
] as const;

export type RegionSlug = (typeof REGION_SLUGS_NS)[number];

export const REGION_LABELS: Record<string, string> = {
  'arica-y-parinacota': 'XV Arica y Parinacota',
  tarapaca: 'I Tarapacá',
  antofagasta: 'II Antofagasta',
  atacama: 'III Atacama',
  coquimbo: 'IV Coquimbo',
  valparaiso: 'V Valparaíso',
  metropolitana: 'RM Metropolitana',
  ohiggins: "VI O'Higgins",
  maule: 'VII Maule',
  nuble: 'XVI Ñuble',
  biobio: 'VIII Biobío',
  araucania: 'IX La Araucanía',
  'los-rios': 'XIV Los Ríos',
  'los-lagos': 'X Los Lagos',
  aysen: 'XI Aysén',
  magallanes: 'XII Magallanes',
};

const regionNsIndex = new Map<string, number>(REGION_SLUGS_NS.map((s, i) => [s, i]));

/** Index of a region slug in north → south order. Unknown slugs sort last. */
export function regionNsOrder(slug: string): number {
  return regionNsIndex.get(slug) ?? 999;
}

/**
 * Normalize a SEC `NOMBRE_REGION` display string to a canonical slug.
 * SEC spellings are inconsistent ("O`Higgins" with backtick, "Tarapaca" and
 * "Biobio" without accents), so match accent- and case-insensitively and fall
 * back to null instead of guessing.
 */
const SEC_REGION_SLUGS: Record<string, string> = {
  'arica y parinacota': 'arica-y-parinacota',
  tarapaca: 'tarapaca',
  antofagasta: 'antofagasta',
  atacama: 'atacama',
  coquimbo: 'coquimbo',
  valparaiso: 'valparaiso',
  metropolitana: 'metropolitana',
  ohiggins: 'ohiggins',
  maule: 'maule',
  nuble: 'nuble',
  biobio: 'biobio',
  araucania: 'araucania',
  'los rios': 'los-rios',
  'los lagos': 'los-lagos',
  aysen: 'aysen',
  magallanes: 'magallanes',
};

export function secRegionSlug(nombreRegion: string): string | null {
  const key = nombreRegion
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[`'’]/g, '')
    .replace(/^region (de |del )?/, '')
    .trim();
  return SEC_REGION_SLUGS[key] ?? null;
}
