import { useEffect, useMemo, useRef, useState } from 'react';
import type * as L from 'leaflet';
import leafletCssUrl from 'leaflet/dist/leaflet.css?url';
import type { EmergencyItem } from './EmergencyWidget';

type Band = 'critical' | 'high' | 'moderate' | 'low';
const bandOf = (mag: number): Band => (mag >= 6 ? 'critical' : mag >= 5 ? 'high' : mag >= 4 ? 'moderate' : 'low');

const COLOR: Record<Band, string> = {
  critical: 'var(--color-error)',
  high: 'var(--color-warning)',
  moderate: 'var(--color-info)',
  low: 'var(--color-success)',
};

const BAND_LABEL: Record<Band, string> = {
  critical: 'M ≥ 6.0',
  high: 'M 5.0–5.9',
  moderate: 'M 4.0–4.9',
  low: 'M < 4.0',
};

export function EmergencyMap({ items, focusId }: { items: EmergencyItem[]; focusId: string | null }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<{ map: L.Map; destroy: () => void } | null>(null);
  const groupRef = useRef<{ clearLayers: () => void } | null>(null);
  const lastFocusedRef = useRef<string | null>(null);
  const [ready, setReady] = useState(false);
  const [hidden, setHidden] = useState<Set<Band>>(new Set());

  const withCoords = useMemo(() => items.filter((i) => i.lat != null && i.lon != null && i.mag !== undefined), [items]);
  const toggleBand = (b: Band) =>
    setHidden((prev) => {
      const next = new Set(prev);
      next.has(b) ? next.delete(b) : next.add(b);
      return next;
    });

  // build the map once
  useEffect(() => {
    if (!containerRef.current || withCoords.length === 0) return;
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
      }).setView([-35.5, -71], 5);

      const isDark = () => !document.documentElement.classList.contains('light-theme');
      const tileUrl = (dark: boolean) =>
        dark
          ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
          : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';

      const tiles = L.tileLayer(tileUrl(isDark()), {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
        maxZoom: 19,
      }).addTo(map);

      // swap basemap live on theme change
      const observer = new MutationObserver(() => tiles.setUrl(tileUrl(isDark())));
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

      const group = L.layerGroup().addTo(map);
      groupRef.current = group;
      mapRef.current = {
        map,
        destroy: () => {
          observer.disconnect();
          map.remove();
          mapRef.current = null;
        },
      };
      setReady(true);
    })();

    return () => { destroyed = true; mapRef.current?.destroy(); };
  }, [withCoords]);

  // render circles whenever items/filters change; focus the requested quake
  useEffect(() => {
    if (!ready || !mapRef.current || withCoords.length === 0) return;
    if (!focusId) lastFocusedRef.current = null;
    (async () => {
      const L = await import('leaflet');
      groupRef.current?.clearLayers();
      const markers: L.CircleMarker[] = [];
      const byId = new Map<string, L.CircleMarker>();
      for (const it of withCoords) {
        const band = bandOf(it.mag!);
        if (hidden.has(band)) continue;
        const marker = L.circleMarker([it.lat!, it.lon!], {
          radius: Math.max(3, 5 + (it.mag! - 1) * 2.5),
          fillColor: COLOR[band],
          color: '#ffffff',
          weight: 1,
          opacity: 0.9,
          fillOpacity: 0.75,
        });
        const t = new Date(it.time).toLocaleString('es-CL', {
          day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
        });
        const content = `<div style="font-family:sans-serif;font-size:12px;color:#222">
            <strong>M ${it.mag!.toFixed(1)} — ${it.place || it.title}</strong><br/>
            <span>${t}</span>${it.depth !== undefined ? `<br/><span>Prof: ${it.depth.toFixed(1)} km</span>` : ''}
          </div>`;
        marker.bindTooltip(content, { sticky: true });
        marker.bindPopup(content);
        marker.on('popupopen', () => marker.closeTooltip());
        markers.push(marker);
        byId.set(it.id, marker);
      }
      L.featureGroup(markers).addTo(groupRef.current as any);

      const focus = withCoords.find((i) => i.id === focusId);
      const focused = byId.get(focusId ?? '');
      if (focus && focused && focusId !== lastFocusedRef.current) {
        lastFocusedRef.current = focusId;
        mapRef.current?.map.flyTo([focus.lat!, focus.lon!], 7, { duration: 0.8 });
        focused.openPopup();
      }
    })();
  }, [ready, withCoords, hidden, focusId]);

  if (withCoords.length === 0) return null;

  return (
    <div className="space-y-2">
      <div ref={containerRef} className="h-[340px] w-full rounded-xl border border-base-300 overflow-hidden" />

      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-base-content/70">
        {(Object.keys(BAND_LABEL) as Band[]).map((b) => {
          const off = hidden.has(b);
          return (
            <button
              key={b}
              type="button"
              onClick={() => toggleBand(b)}
              className={`inline-flex items-center gap-1 cursor-pointer rounded-full px-2 py-0.5 border transition-colors active:scale-[0.96] ${
                off ? 'border-base-300 text-base-content/40 line-through' : 'border-base-content/10 hover:bg-base-300/40'
              }`}
            >
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: off ? 'transparent' : COLOR[b] }} />
              {BAND_LABEL[b]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
