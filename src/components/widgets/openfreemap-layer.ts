import type * as L from 'leaflet';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

const STYLE_LIGHT = 'https://tiles.openfreemap.org/styles/positron';
const STYLE_DARK = 'https://tiles.openfreemap.org/styles/dark';
const ATTRIBUTION =
  '<a href="https://openfreemap.org/">OpenFreeMap</a> &copy; ' +
  '<a href="https://www.openmaptiles.org/">OpenMapTiles</a> &copy; ' +
  '<a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

let workerConfigured = false;

export interface OpenFreeMapLayer {
  setDark(dark: boolean): void;
  destroy(): void;
}

export async function addOpenFreeMapLayer(
  map: L.Map,
  initialDark: boolean,
): Promise<OpenFreeMapLayer> {
  const [{ setWorkerUrl }, { maplibreGL }] = await Promise.all([
    import('maplibre-gl'),
    import('@maplibre/maplibre-gl-leaflet'),
  ]);
  if (!workerConfigured) {
    setWorkerUrl(maplibreWorkerUrl);
    workerConfigured = true;
  }

  const layer = maplibreGL({
    style: initialDark ? STYLE_DARK : STYLE_LIGHT,
    interactive: false,
    attributionControl: false,
    fadeDuration: 0,
  }).addTo(map);
  map.attributionControl.addAttribution(ATTRIBUTION);

  let dark = initialDark;
  return {
    setDark(nextDark) {
      if (nextDark === dark) return;
      dark = nextDark;
      layer.getMaplibreMap().setStyle(dark ? STYLE_DARK : STYLE_LIGHT);
    },
    destroy() {
      map.attributionControl.removeAttribution(ATTRIBUTION);
      layer.remove();
    },
  };
}
