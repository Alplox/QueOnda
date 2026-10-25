export interface SectionLink {
  id: string;
  label: string;
  /** Etiqueta corta para la barra superior (la larga no cabe en una línea). */
  navLabel?: string;
}

export const SECTIONS: SectionLink[] = [
  { id: 'emergencia', label: 'Emergencia' },
  { id: 'noticias', label: 'Noticias' },
  { id: 'tv', label: 'TV' },
  { id: 'radios', label: 'Radios' },
  { id: 'ciberseguridad', label: 'Ciberseguridad', navLabel: 'Ciber' },
  { id: 'finanzas', label: 'Finanzas' },
  { id: 'youtube', label: 'YouTube' },
  { id: 'spotify', label: 'Spotify' },
  { id: 'tendencias-web', label: 'Tendencias' },
  { id: 'clima', label: 'Clima' },
  { id: 'aire', label: 'Aire' },
  { id: 'transporte', label: 'Transporte' },
  { id: 'deportes', label: 'Deportes' },
  { id: 'trabajos', label: 'Trabajos' },
  { id: 'feriados', label: 'Feriados' },
  { id: 'fiestas-patrias', label: 'Fiestas' },
];

export const PRIMARY = SECTIONS.slice(0, 7);
export const OVERFLOW = SECTIONS.slice(7);
