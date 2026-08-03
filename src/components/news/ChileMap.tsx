import { useMemo } from 'react';
import type { SourceFeed } from '../../types';
import { CHILE_OUTLINE, CHILE_REGIONS as REGIONS } from './chile-outline';

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
              onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !hasNoSources) { e.preventDefault(); onSelectRegion(isSelected ? null : r.key); } }}
              role="button"
              tabIndex={hasNoSources ? -1 : 0}
              aria-label={hasNoSources ? `${r.label} (sin fuentes)` : `${r.label}${isSelected ? ' (seleccionada)' : ''}`}
              className={hasNoSources ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2'}
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
