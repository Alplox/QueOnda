import { useEffect, useRef } from 'react';
import leafletCssUrl from 'leaflet/dist/leaflet.css?url';
import { addOpenFreeMapLayer } from './openfreemap-layer';

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
  const onPickStopRef = useRef(onPickStop);
  onPickStopRef.current = onPickStop;

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
        minZoom: 1,
        maxBounds: [[-85, -180], [85, 180]],
        maxBoundsViscosity: 1,
      }).setView([-33.45, -70.65], 12);

      const isDark = () => !document.documentElement.classList.contains('light-theme');
      const basemap = await addOpenFreeMapLayer(map, isDark());
      if (destroyed) {
        basemap.destroy();
        map.remove();
        return;
      }

      const observer = new MutationObserver(() => basemap.setDark(isDark()));
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

      instanceRef.current = {
        destroy: () => {
          observer.disconnect();
          basemap.destroy();
          map.remove();
          instanceRef.current = null;
        },
      };

      const locatedStops = stops.filter(stop => stop.stop_lat != null && stop.stop_lon != null);
      const coords: [number, number][] = locatedStops.map(stop => [stop.stop_lat, stop.stop_lon]);

      if (coords.length < 2) return;

      L.polyline(coords, { color: '#e30613', weight: 3, opacity: 0.7 }).addTo(map);

      // markers at ~every 15 stops + first & last
      const step = Math.max(1, Math.floor(coords.length / 15));
      const markerIndices = new Set([0, coords.length - 1]);
      for (let i = step; i < coords.length - 1; i += step) markerIndices.add(i);

      for (const index of markerIndices) {
        const stop = locatedStops[index];
        const marker = L.circleMarker(coords[index], {
          radius: 6,
          fillColor: '#e30613',
          color: '#fff',
          weight: 2,
          fillOpacity: 1,
        }).addTo(map);

        const cleanName = stop.stop_name.replace(/^[A-Z0-9]+-/, '') || stop.stop_id;
        const popup = document.createElement('div');
        popup.style.cssText = 'font-family:sans-serif;font-size:12px';
        const stopId = document.createElement('strong');
        stopId.textContent = stop.stop_id;
        const name = document.createElement('div');
        name.textContent = cleanName;
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = 'Consultar llegada';
        button.style.cssText = 'margin-top:4px;min-height:24px;padding:3px 8px;font-size:11px;cursor:pointer;background:#e30613;color:#fff;border:none;border-radius:4px';
        button.addEventListener('click', () => onPickStopRef.current(stop.stop_id));
        popup.append(stopId, name, button);
        marker.bindPopup(popup);
      }

      map.fitBounds(coords);
    })();

    return () => { destroyed = true; instanceRef.current?.destroy(); };
  }, [stops, routeName]);

  return (
    <div className="rounded-xl border border-base-300 overflow-hidden mb-2">
      <div ref={containerRef} className="h-[300px] w-full" />
    </div>
  );
}
