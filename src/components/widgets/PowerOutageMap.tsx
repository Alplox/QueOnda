import { useEffect, useMemo, useRef, useState } from 'react';
import leafletCssUrl from 'leaflet/dist/leaflet.css?url';
import { addOpenFreeMapLayer, type OpenFreeMapLayer } from './openfreemap-layer';

interface Comuna {
  region: string;
  comuna: string;
  affected: number;
  lat: number;
  lon: number;
}

interface Props {
  comunas: Comuna[];
  focusRegion?: string | null;
  focusRequest?: number;
}

// severity bands as fraction of the max-affected comuna
type Band = 'critical' | 'high' | 'medium' | 'low';
const bandOf = (ratio: number): Band =>
  ratio >= 0.1 ? 'critical' : ratio >= 0.03 ? 'high' : ratio >= 0.01 ? 'medium' : 'low';

const COLOR: Record<Band, string> = {
  critical: 'var(--color-error)',
  high: 'var(--color-warning)',
  medium: 'var(--color-primary)',
  low: 'var(--color-base-content)',
};

const BAND_LABEL: Record<Band, string> = {
  critical: '≥ 10% del máximo',
  high: '3–10%',
  medium: '1–3%',
  low: '< 1%',
};

export function PowerOutageMap({ comunas, focusRegion, focusRequest = 0 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<{ destroy: () => void; map: any } | null>(null);
  const lastFocusRequestRef = useRef(0);
  const groupRef = useRef<{ clearLayers: () => void } | null>(null);
  const [ready, setReady] = useState(false);
  const [mapError, setMapError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  const byRegion = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of comunas) m.set(c.region, (m.get(c.region) ?? 0) + 1);
    return m;
  }, [comunas]);

  const [region, setRegion] = useState('');
  const [comuna, setComuna] = useState('');
  const [hidden, setHidden] = useState<Set<Band>>(new Set());
  const filtered = useMemo(() => {
    let list = comunas;
    if (region) list = list.filter((c) => c.region === region);
    if (comuna) list = list.filter((c) => c.comuna === comuna);
    return list;
  }, [comunas, region, comuna]);

  const maxFiltered = useMemo(() => Math.max(1, ...filtered.map((c) => c.affected)), [filtered]);
  const toggleBand = (b: Band) =>
    setHidden((prev) => {
      const next = new Set(prev);
      next.has(b) ? next.delete(b) : next.add(b);
      return next;
    });

  // build the map once (rebuilt if comunas identity changes or on manual retry)
  useEffect(() => {
    if (!containerRef.current || comunas.length === 0) return;
    let destroyed = false;

    (async () => {
      let map: import('leaflet').Map | null = null;
      try {
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

        const container = containerRef.current;
        // Recover from a leaked init (e.g. StrictMode/HMR race where L.map ran but
        // cleanup didn't remove it): Leaflet throws "already initialized" otherwise.
        if ((container as any)._leaflet_id) {
          try { (L.DomUtil as any).get?.(container)?.remove?.(); } catch { /* ignore */ }
          delete (container as any)._leaflet_id;
          container.replaceChildren();
        }

        map = L.map(container, {
          zoomControl: true,
          attributionControl: true,
          minZoom: 1,
          maxBounds: [[-85, -180], [85, 180]],
          maxBoundsViscosity: 1,
        }).setView([-35.5, -71], 5);
        if (destroyed) { try { map.remove(); } catch {} return; }

        const isDark = () => !document.documentElement.classList.contains('light-theme');
        let basemap: OpenFreeMapLayer | null = null;
        try {
          basemap = await addOpenFreeMapLayer(map, isDark());
        } catch {
          // maplibre unavailable (stale Vite pre-bundle in dev, blocked CDN…) —
          // OSM raster fallback so markers still render instead of a dead map
          L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
          }).addTo(map);
        }
        if (destroyed) {
          try { basemap?.destroy(); } catch { /* already torn down */ }
          try { map.remove(); } catch {}
          return;
        }
        if (!containerRef.current) { try { basemap?.destroy(); } catch {} try { map.remove(); } catch {} return; }

        // swap vector basemap live on theme change (raster fallback stays as-is)
        let observer: MutationObserver | null = null;
        if (basemap) {
          const current = basemap;
          observer = new MutationObserver(() => current.setDark(isDark()));
          observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
        }

        const group = L.layerGroup().addTo(map);
        groupRef.current = group;
        mapRef.current = {
          destroy: () => {
            try { observer?.disconnect(); } catch { /* already torn down */ }
            try { basemap?.destroy(); } catch { /* already torn down */ }
            try { map?.remove(); } catch {}
            mapRef.current = null;
          },
          map,
        };
        setMapError(false);
        setReady(true);
      } catch (err) {
        // Never leave a half-built map on the container: L.map() succeeded but a
        // later step threw → the div keeps _leaflet_id and every re-init would die
        // with "Map container is already initialized". Remove it so retry works.
        console.error('PowerOutageMap init failed', err);
        try { map?.remove(); } catch { /* already torn down */ }
        mapRef.current = null;
        if (!destroyed) setMapError(true);
      }
    })();

    return () => { destroyed = true; try { mapRef.current?.destroy(); } catch { /* already torn down */ } };
    // Init una sola vez por contenedor/retry: no depende de `comunas` (los
    // marcadores los actualiza el efecto de abajo) para no destruir/recrear el
    // mapa WebGL en cada refresh de datos.
  }, [retryKey]);

  // render circles whenever filters change
  useEffect(() => {
    if (!ready || !mapRef.current || filtered.length === 0) return;
    (async () => {
      const L = await import('leaflet');
      groupRef.current?.clearLayers();
      const markers: L.CircleMarker[] = [];
      for (const c of filtered) {
        if (!Number.isFinite(c.lat) || !Number.isFinite(c.lon)) continue;
        const ratio = c.affected / maxFiltered;
        const band = bandOf(ratio);
        if (hidden.has(band)) continue;
        const marker = L.circleMarker([c.lat, c.lon], {
          radius: Math.max(3, 5 + ratio * 7),
          fillColor: COLOR[band],
          color: '#ffffff',
          weight: 1,
          opacity: 0.9,
          fillOpacity: 0.75,
        });
        const createContent = () => {
          const content = document.createElement('div');
          content.style.cssText = 'font-family:sans-serif;font-size:12px;color:#222';
          const place = document.createElement('strong');
          place.textContent = c.comuna;
          const region = document.createElement('span');
          region.textContent = c.region;
          const affected = document.createElement('strong');
          affected.textContent = `${c.affected.toLocaleString('es-CL')} clientes`;
          content.append(place, document.createElement('br'), region, document.createElement('br'), affected);
          return content;
        };
        marker.bindTooltip(createContent(), { sticky: true });
        marker.bindPopup(createContent());
        marker.on('popupopen', () => marker.closeTooltip());
        markers.push(marker);
      }
      L.featureGroup(markers).addTo(groupRef.current as any);
    })();
  }, [ready, filtered, maxFiltered, hidden]);

  // focus a region from the outside (pin button on a region row): filter to it
  // and fly there once the map is ready — same pattern as EmergencyMap focusId+focusRequest
  useEffect(() => {
    if (!ready || !mapRef.current) return;
    if (!focusRegion) return;
    if (focusRequest === lastFocusRequestRef.current) return;
    lastFocusRequestRef.current = focusRequest;
    setRegion(focusRegion);
    setComuna('');
    const pts = comunas
      .filter((c) => c.region === focusRegion)
      .map((c) => [Number(c.lat), Number(c.lon)] as [number, number])
      .filter(([lat, lon]) => Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180);
    if (pts.length === 0) return;
    (async () => {
      try {
        const L = await import('leaflet');
        const bounds = L.latLngBounds(pts);
        if (!bounds.isValid()) return;
        const c = bounds.getCenter();
        if (!Number.isFinite(c.lat) || !Number.isFinite(c.lng)) return;
        const map = mapRef.current?.map;
        if (!map) return;
        // El mapa puede estar abriéndose (grid 0fr→1fr, 300 ms): con tamaño 0
        // getBoundsZoom/fit/fly calculan NaN y corrompen Leaflet/GL. Esperar un
        // tamaño útil (tope ~450 ms) o abortar; nunca mover con tamaño 0.
        let ok = false;
        for (let i = 0; i < 30; i++) {
          try { map.invalidateSize({ animate: false }); } catch {}
          const s = map.getSize?.();
          if (s && s.x > 0 && s.y > 0) { ok = true; break; }
          await new Promise((r) => requestAnimationFrame(r));
          if (focusRequest !== lastFocusRequestRef.current) return;
        }
        if (!ok || !mapRef.current?.map) return;
        // Un solo punto (p. ej. Arica y Parinacota = 1 comuna) da bounds de área 0:
        // pad(0.3) de 0 y el zoom de flyToBounds degeneran a NaN. Volar al punto.
        const sw = bounds.getSouthWest();
        const ne = bounds.getNorthEast();
        const pointLike = pts.length === 1 || (Math.abs(sw.lat - ne.lat) < 1e-6 && Math.abs(sw.lng - ne.lng) < 1e-6);
        if (pointLike) {
          if (Number.isFinite(c.lat) && Number.isFinite(c.lng)) map.flyTo([c.lat, c.lng], 10, { duration: 0.8 });
        } else {
          const padded = bounds.pad(0.3);
          const pc = padded.getCenter();
          if (padded.isValid() && Number.isFinite(pc.lat) && Number.isFinite(pc.lng)) {
            map.flyToBounds(padded, { duration: 0.8 });
          }
        }
      } catch {
        /* no romper el mapa por un foco inválido */
      }
    })();
  }, [ready, focusRegion, focusRequest, comunas]);

  if (comunas.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <select
          value={region}
          onChange={(e) => { setRegion(e.target.value); setComuna(''); }}
          className="select select-xs select-bordered w-full min-w-0 truncate"
          aria-label="Filtrar por región"
        >
          <option value="">Todas las regiones</option>
          {[...byRegion.keys()].sort((a, b) => a.localeCompare(b, 'es')).map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        <select
          value={comuna}
          onChange={(e) => setComuna(e.target.value)}
          className="select select-xs select-bordered w-full min-w-0 truncate"
          aria-label="Filtrar por comuna"
        >
          <option value="">Todas las comunas</option>
          {(region ? comunas.filter((c) => c.region === region) : comunas)
            .map((c) => c.comuna)
            .filter((v, i, a) => a.indexOf(v) === i)
            .sort((a, b) => a.localeCompare(b, 'es'))
            .map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
        </select>
      </div>

      {mapError ? (
        <div className="h-[340px] w-full rounded-xl border border-base-300 overflow-hidden flex flex-col items-center justify-center gap-2 bg-base-200">
          <p className="text-xs text-base-content/70">No se pudo cargar el mapa.</p>
          <button
            type="button"
            onClick={() => { setMapError(false); setRetryKey((k) => k + 1); }}
            className="px-3 py-1.5 rounded-lg bg-primary text-primary-content text-xs font-semibold hover:opacity-90 active:scale-[0.97] transition-[opacity,transform] cursor-pointer"
          >
            Reintentar
          </button>
        </div>
      ) : (
        <div key={retryKey} ref={containerRef} className="h-[340px] w-full rounded-xl border border-base-300 overflow-hidden" />
      )}

      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-base-content/70">
        {(Object.keys(BAND_LABEL) as Band[]).map((b) => {
          const off = hidden.has(b);
          return (
            <button
              key={b}
              type="button"
              onClick={() => toggleBand(b)}
              aria-pressed={!off}
              className={`inline-flex items-center gap-1 cursor-pointer rounded-full px-2 py-0.5 border transition-colors active:scale-[0.96] ${
                off ? 'border-base-300 text-base-content/70 line-through' : 'border-base-content/10 hover:bg-base-300/40'
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
