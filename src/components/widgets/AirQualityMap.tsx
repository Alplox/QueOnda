import { useEffect, useMemo, useRef, useState } from 'react';
import leafletCssUrl from 'leaflet/dist/leaflet.css?url';
import { AIR_STATUS, orderedRegions } from '@/lib/air-quality';
import type { AirStation } from '@/lib/air-quality';
import { addOpenFreeMapLayer } from './openfreemap-layer';

interface Props {
  stations: AirStation[];
}

const BANDS = [1, 2, 3, 4, 5] as const;

export function AirQualityMap({ stations }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<{ destroy: () => void } | null>(null);
  const groupRef = useRef<{ clearLayers: () => void } | null>(null);
  const [ready, setReady] = useState(false);

  const regions = useMemo(() => orderedRegions(stations), [stations]);

  const [region, setRegion] = useState('');
  const [comuna, setComuna] = useState('');
  const [hidden, setHidden] = useState<Set<number>>(new Set());
  const filtered = useMemo(() => {
    let list = stations;
    if (region) list = list.filter((s) => s.region === region);
    if (comuna) list = list.filter((s) => s.comuna === comuna);
    return list;
  }, [stations, region, comuna]);

  const presentBands = useMemo(() => {
    const set = new Set<number>();
    for (const s of filtered) {
      const code = s.pm25?.statusCode ?? s.pm10?.statusCode ?? 0;
      if (code >= 1) set.add(code);
    }
    return BANDS.filter((b) => set.has(b));
  }, [filtered]);

  const toggleBand = (b: number) =>
    setHidden((prev) => {
      const next = new Set(prev);
      next.has(b) ? next.delete(b) : next.add(b);
      return next;
    });

  // build the map ONCE — rebuilding per stations-change raced the markers effect
  // (it ran while mapRef was mid-rebuild and never retried), leaving an empty map
  useEffect(() => {
    if (!containerRef.current) return;
    let destroyed = false;

    (async () => {
      // ponytail: ?url import + <link> instead of import('*.css') — Vite's CSS preload helper
      // rejects on first load in the Workers SSR env, which killed the whole map init
      const L = await import('leaflet');
      if (destroyed || !containerRef.current) return;
      if (!document.querySelector('link[data-leaflet]')) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.dataset.leaflet = '';
        link.href = leafletCssUrl;
        document.head.appendChild(link);
      }

      const map = L.map(containerRef.current, {
        zoomControl: true,
        attributionControl: true,
        minZoom: 1,
        maxBounds: [[-85, -180], [85, 180]],
        maxBoundsViscosity: 1,
      }).setView([-35.5, -71], 4);

      const isDark = () => !document.documentElement.classList.contains('light-theme');
      const basemap = await addOpenFreeMapLayer(map, isDark());
      if (destroyed) {
        basemap.destroy();
        map.remove();
        return;
      }

      // swap basemap live on theme change
      const observer = new MutationObserver(() => basemap.setDark(isDark()));
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

      const group = L.layerGroup().addTo(map);
      groupRef.current = group;
      mapRef.current = {
        destroy: () => {
          observer.disconnect();
          basemap.destroy();
          map.remove();
          mapRef.current = null;
        },
      };
      setReady(true);
    })();

    return () => { destroyed = true; mapRef.current?.destroy(); };
  }, []);

  // if the section-level filter removed our selected region/comuna from the
  // incoming stations, drop the stale internal selection
  useEffect(() => {
    if (region && !stations.some((s) => s.region === region)) setRegion('');
    if (comuna && !stations.some((s) => s.comuna === comuna)) setComuna('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stations]);

  // render circles whenever filters change
  useEffect(() => {
    if (!ready || !mapRef.current || filtered.length === 0) return;
    (async () => {
      const L = await import('leaflet');
      groupRef.current?.clearLayers();
      const markers: L.CircleMarker[] = [];
      for (const s of filtered) {
        const code = s.pm25?.statusCode ?? s.pm10?.statusCode ?? 0;
        if (code < 1 || hidden.has(code)) continue;
        const color = s.pm25?.color ?? AIR_STATUS[code]?.color ?? 'var(--color-base-content)';
        const marker = L.circleMarker([s.lat, s.lon], {
          radius: 3 + code * 1.5,
          fillColor: color,
          color: '#ffffff',
          weight: 1,
          opacity: 0.9,
          fillOpacity: 0.85,
        });
        const createContent = () => {
          const content = document.createElement('div');
          content.style.cssText = 'font-family:sans-serif;font-size:12px;color:#222';
          const name = document.createElement('strong');
          name.textContent = s.nombre;
          const location = document.createElement('span');
          location.textContent = [s.comuna, s.region].filter(Boolean).join(' · ');
          content.append(name, document.createElement('br'), location);

          for (const [label, row] of [['MP 2,5', s.pm25], ['MP 10', s.pm10]] as const) {
            if (!row) continue;
            const line = document.createElement('div');
            const metric = document.createElement('strong');
            metric.textContent = `${label}:`;
            const detail = label === 'MP 2,5'
              ? ` ${row.value} µg/m³ — ${AIR_STATUS[row.statusCode]?.label ?? row.status}`
              : ` ${row.value} µg/m³`;
            line.append(metric, document.createTextNode(detail));
            content.append(document.createElement('br'), line);
          }

          if (s.pm25?.datetime) {
            const time = document.createElement('em');
            time.textContent = `${s.pm25.datetime} hrs.`;
            content.append(document.createElement('br'), time);
          }
          return content;
        };
        marker.bindTooltip(createContent(), { sticky: true });
        marker.bindPopup(createContent());
        marker.on('popupopen', () => marker.closeTooltip());
        markers.push(marker);
      }
      L.featureGroup(markers).addTo(groupRef.current as any);
    })();
  }, [ready, filtered, hidden]);

  if (stations.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <select
          value={region}
          onChange={(e) => { setRegion(e.target.value); setComuna(''); }}
          className="select select-xs select-bordered w-full min-w-0 truncate"
          aria-label="Filtrar estaciones por región"
        >
          <option value="">Todas las regiones</option>
          {regions.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        <select
          value={comuna}
          onChange={(e) => setComuna(e.target.value)}
          className="select select-xs select-bordered w-full min-w-0 truncate"
          aria-label="Filtrar estaciones por comuna"
        >
          <option value="">Todas las comunas</option>
          {(region ? stations.filter((s) => s.region === region) : stations)
            .map((s) => s.comuna)
            .filter((v, i, a) => a.indexOf(v) === i)
            .sort((a, b) => a.localeCompare(b, 'es'))
            .map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
        </select>
      </div>

      <div ref={containerRef} className="h-[340px] w-full rounded-xl border border-base-300 overflow-hidden" />

      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-base-content/70">
        {presentBands.map((b) => {
          const off = hidden.has(b);
          return (
            <button
              key={b}
              type="button"
              onClick={() => toggleBand(b)}
              aria-pressed={!off}
              className={`inline-flex items-center gap-1 cursor-pointer rounded-full px-2 py-0.5 border transition-colors active:scale-[0.96] ${
                off ? 'border-base-300 text-base-content/50 line-through' : 'border-base-content/10 hover:bg-base-300/40'
              }`}
            >
              <span
                className="inline-block h-2.5 w-2.5 rounded-full ring-1 ring-inset ring-black/20"
                style={{ background: off ? 'transparent' : AIR_STATUS[b].color }}
              />
              {AIR_STATUS[b].label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
