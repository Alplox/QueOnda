import { useEffect, useRef } from 'react';
import leafletCssUrl from 'leaflet/dist/leaflet.css?url';

interface RouteStop {
  stop_id: string;
  stop_name: string;
  stop_lat: number;
  stop_lon: number;
}

interface Props {
  stops: RouteStop[];
  routeName: string;
  onPickStop: (stopId: string) => void;
}

export function RouteMap({ stops, routeName, onPickStop }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<{ destroy: () => void } | null>(null);

  useEffect(() => {
    if (!containerRef.current || stops.length === 0) return;
    let destroyed = false;

    (async () => {
      const L = await import('leaflet');
      // ponytail: ?url import + <link> instead of unpkg CDN — same pattern as EmergencyMap/PowerOutageMap (reliable + theme-bundled)
      if (!document.querySelector('link[data-leaflet]')) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.dataset.leaflet = '';
        link.href = leafletCssUrl;
        document.head.appendChild(link);
      }

      if (destroyed || !containerRef.current) return;

      const map = L.map(containerRef.current, {
        zoomControl: true,
        attributionControl: true,
      }).setView([-33.45, -70.65], 12);

      const isDark = () => !document.documentElement.classList.contains('light-theme');
      const tileUrl = (dark: boolean) =>
        dark
          ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
          : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';

      const tiles = L.tileLayer(tileUrl(isDark()), {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
        maxZoom: 19,
      }).addTo(map);

      const observer = new MutationObserver(() => tiles.setUrl(tileUrl(isDark())));
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

      instanceRef.current = {
        destroy: () => { observer.disconnect(); map.remove(); instanceRef.current = null; },
      };

      const coords: [number, number][] = stops
        .filter(s => s.stop_lat && s.stop_lon)
        .map(s => [s.stop_lat, s.stop_lon]);

      if (coords.length < 2) return;

      L.polyline(coords, { color: '#e30613', weight: 3, opacity: 0.7 }).addTo(map);

      // markers at ~every 15 stops + first & last
      const step = Math.max(1, Math.floor(coords.length / 15));
      const markerIndices = new Set([0, coords.length - 1]);
      for (let i = step; i < coords.length - 1; i += step) markerIndices.add(i);

      for (const idx of markerIndices) {
        const s = stops[idx];
        const marker = L.circleMarker(coords[idx], {
          radius: 6,
          fillColor: '#e30613',
          color: '#fff',
          weight: 2,
          fillOpacity: 1,
        }).addTo(map);

        const cleanName = s.stop_name?.replace(/^[A-Z0-9]+-/, '') || s.stop_id;
        marker.bindPopup(`
          <div style="font-family:sans-serif;font-size:12px">
            <strong>${s.stop_id}</strong><br/>
            ${cleanName}<br/>
            <button
              onclick="window.__leafletPickStop__('${s.stop_id}')"
              style="margin-top:4px;padding:2px 8px;font-size:11px;cursor:pointer;background:#e30613;color:#fff;border:none;border-radius:4px"
            >Consultar llegada</button>
          </div>
        `);
      }

      map.fitBounds(coords);
    })();

    return () => { destroyed = true; instanceRef.current?.destroy(); };
  }, [stops, routeName]);

  // expose pickStop handler via window
  useEffect(() => {
    (window as any).__leafletPickStop__ = onPickStop;
    return () => { delete (window as any).__leafletPickStop__; };
  }, [onPickStop]);

  return (
    <div className="rounded-xl border border-base-300 overflow-hidden mb-2">
      <div ref={containerRef} className="h-[300px] w-full" />
    </div>
  );
}
