import { useMemo } from 'react';
import type { SourceFeed } from '../../types';
import { CHILE_OUTLINE } from './chile-outline';

const REGIONS = [
  { key: 'arica-y-parinacota', label: 'Arica y Parinacota', nr: 'XV', cx: 96.6, cy: 20.6 },
  { key: 'tarapaca', label: 'Tarapacá', nr: 'I', cx: 101.3, cy: 56.5 },
  { key: 'antofagasta', label: 'Antofagasta', nr: 'II', cx: 107.2, cy: 125.2 },
  { key: 'atacama', label: 'Atacama', nr: 'III', cx: 92.1, cy: 207.6 },
  { key: 'coquimbo', label: 'Coquimbo', nr: 'IV', cx: 75.1, cy: 276.4 },
  { key: 'valparaiso', label: 'Valparaíso', nr: 'V', cx: 74.3, cy: 321 },
  { key: 'metropolitana', label: 'Metropolitana', nr: 'RM', cx: 80.2, cy: 339 },
  { key: 'ohiggins', label: "O'Higgins", nr: 'VI', cx: 73.2, cy: 357.3 },
  { key: 'maule', label: 'Maule', nr: 'VII', cx: 67.3, cy: 381.6 },
  { key: 'nuble', label: 'Ñuble', nr: 'XVI', cx: 61, cy: 398.2 },
  { key: 'biobio', label: 'Biobío', nr: 'VIII', cx: 54.6, cy: 414.8 },
  { key: 'araucania', label: 'La Araucanía', nr: 'IX', cx: 55.2, cy: 447.3 },
  { key: 'los-rios', label: 'Los Ríos', nr: 'XIV', cx: 50.9, cy: 476.2 },
  { key: 'los-lagos', label: 'Los Lagos', nr: 'X', cx: 48.1, cy: 517.4 },
  { key: 'aysen', label: 'Aysén', nr: 'XI', cx: 47.6, cy: 610.9 },
  { key: 'magallanes', label: 'Magallanes', nr: 'XII', cx: 71.4, cy: 736.5 },
];

// Generated from Natural Earth via Highcharts — 15 regions, 166 rings

const R = 9;

interface ChileMapProps {
  allSources: SourceFeed[];
  selectedRegion: string | null;
  onSelectRegion: (region: string | null) => void;
}

export function ChileMap({ allSources, selectedRegion, onSelectRegion }: ChileMapProps) {
  const regionCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const src of allSources) {
      if (src.region) counts.set(src.region, (counts.get(src.region) ?? 0) + 1);
    }
    return counts;
  }, [allSources]);

  return (
    <div className="relative w-full max-w-[180px] mx-auto">
      <svg viewBox="0 0 160 810" className="w-full h-auto" role="img" aria-label="Mapa de Chile">
        <path d={CHILE_OUTLINE} fill="var(--color-base-200)" stroke="var(--color-base-content)" strokeWidth="0.3" opacity="0.15" className="pointer-events-none" />
        {REGIONS.map((r) => {
          const count = regionCounts.get(r.key) ?? 0;
          const isSelected = selectedRegion === r.key;
          const hasNoSources = count === 0;
          return (
            <g
              key={r.key}
              onClick={() => { if (!hasNoSources) onSelectRegion(isSelected ? null : r.key); }}
              className={hasNoSources ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer'}
            >
              {isSelected && (
                <circle cx={r.cx} cy={r.cy} r={R + 3} fill="none" stroke="var(--color-primary)" strokeWidth="2" opacity="0.4" />
              )}
              <circle
                cx={r.cx}
                cy={r.cy}
                r={R}
                fill={isSelected ? 'var(--color-primary)' : 'var(--color-base-content)'}
                stroke={isSelected ? 'var(--color-primary)' : 'var(--color-base-content)'}
                opacity={isSelected ? 1 : 0.2}
                className={!hasNoSources ? 'transition-all hover:brightness-110' : ''}
              />
              <text
                x={r.cx}
                y={r.cy + 1}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize="6"
                fontWeight="700"
                fill={isSelected ? 'var(--color-primary-content)' : 'var(--color-base-content)'}
                opacity={isSelected ? 1 : 0.9}
              >
                {r.nr}
              </text>
              <text
                x={r.cx}
                y={r.cy + R + 8}
                textAnchor="middle"
                fontSize="5"
                fill="var(--color-base-content)"
                opacity="0.5"
              >
                {count}
              </text>
              <title>{r.label} ({count} fuentes)</title>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
