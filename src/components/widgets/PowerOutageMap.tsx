import { useEffect, useMemo, useRef, useState } from 'react';

interface Comuna {
  region: string;
  comuna: string;
  affected: number;
  lat: number;
  lon: number;
}

interface Props {
  comunas: Comuna[];
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

export function PowerOutageMap({ comunas }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<{ destroy: () => void } | null>(null);
  const groupRef = useRef<{ clearLayers: () => void } | null>(null);
  const [ready, setReady] = useState(false);

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

  // build the map once
  useEffect(() => {
    if (!containerRef.current || comunas.length === 0) return;
    let destroyed = false;

    (async () => {
      // ponytail: bundle the CSS so it's present before the map builds —
      // fetching it from unpkg at runtime raced the JS init and blanked tiles on slow/mobile nets
      const [L] = await Promise.all([import('leaflet'), import('leaflet/dist/leaflet.css')]);
      if (destroyed || !containerRef.current) return;

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
        destroy: () => {
          observer.disconnect();
          map.remove();
          mapRef.current = null;
        },
      };
      setReady(true);
    })();

    return () => { destroyed = true; mapRef.current?.destroy(); };
  }, [comunas]);

  // render circles whenever filters change
  useEffect(() => {
    if (!ready || !mapRef.current || filtered.length === 0) return;
    (async () => {
      const L = await import('leaflet');
      groupRef.current?.clearLayers();
      const markers: L.CircleMarker[] = [];
      for (const c of filtered) {
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
        const content = `<div style="font-family:sans-serif;font-size:12px;color:#222">
            <strong>${c.comuna}</strong><br/>
            <span>${c.region}</span><br/>
            <strong>${c.affected.toLocaleString('es-CL')} clientes</strong>
          </div>`;
        marker.bindTooltip(content, { sticky: true });
        marker.bindPopup(content);
        markers.push(marker);
      }
      L.featureGroup(markers).addTo(groupRef.current as any);
    })();
  }, [ready, filtered, maxFiltered, hidden]);

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
