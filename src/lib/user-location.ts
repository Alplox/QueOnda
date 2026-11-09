export interface UserLocation {
  name: string;
  lat: number;
  lon: number;
}

const KEY = 'user-location';
const LEGACY_WEATHER_KEY = 'weather-user-city';
export const USER_LOCATION_EVENT = 'user-location-change';

function isFiniteCoord(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Canonical user location, shared across widgets (Weather, Air Quality, etc.). */
export function getUserLocation(): UserLocation | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<UserLocation>;
      if (typeof p?.name === 'string' && isFiniteCoord(p.lat) && isFiniteCoord(p.lon)) {
        return { name: p.name, lat: p.lat, lon: p.lon };
      }
    }
  } catch { /* ignore */ }
  // Backward compat: Weather stores {name, lat, lon, data} under its own key.
  try {
    const raw = localStorage.getItem(LEGACY_WEATHER_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as { name?: string; lat?: number; lon?: number };
    if (typeof p?.name === 'string' && isFiniteCoord(p.lat) && isFiniteCoord(p.lon)) {
      return { name: p.name, lat: p.lat, lon: p.lon };
    }
  } catch { /* ignore */ }
  return null;
}

/** Persists the location and notifies other widgets in this tab. Skips the event when unchanged (avoids loops). */
export function setUserLocation(loc: UserLocation): void {
  const prev = getUserLocation();
  const same = prev
    && Math.abs(prev.lat - loc.lat) < 0.0001
    && Math.abs(prev.lon - loc.lon) < 0.0001
    && prev.name === loc.name;
  try { localStorage.setItem(KEY, JSON.stringify(loc)); } catch { /* quota / private mode */ }
  if (same) return;
  try {
    window.dispatchEvent(new CustomEvent<UserLocation>(USER_LOCATION_EVENT, { detail: loc }));
  } catch { /* no window in SSR — callers are client-only */ }
}

export function onUserLocationChange(cb: (loc: UserLocation) => void): () => void {
  const handler = (e: Event) => {
    const loc = (e as CustomEvent<UserLocation>).detail;
    if (loc && typeof loc.name === 'string') cb(loc);
  };
  window.addEventListener(USER_LOCATION_EVENT, handler);
  return () => window.removeEventListener(USER_LOCATION_EVENT, handler);
}

/** Haversine distance in km. */
export function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Reverse geocode coords → place name.
 * Open-Meteo has no /v1/reverse (404); BigDataCloud is free, keyless, CORS-open.
 * Returns null on failure so callers can fall back (e.g. "Mi ubicación") — the
 * actual data fetch should still proceed by coordinates.
 */
export async function reverseGeocodeName(lat: number, lon: number): Promise<string | null> {
  try {
    const res = await fetch(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=es`,
      { signal: AbortSignal.timeout(6000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const name = data.city || data.locality || data.principalSubdivision;
    return typeof name === 'string' && name.trim() ? name.trim() : null;
  } catch {
    return null;
  }
}

/** Human-readable geolocation error (Spanish), by PositionError code. */
export function geoErrorMessage(err: unknown): string {
  const code = (err as GeolocationPositionError | undefined)?.code;
  if (code === 1) return 'Permiso de ubicación bloqueado. Actívalo en el candado de la barra de direcciones y reintenta.';
  if (code === 3) return 'Tu ubicación tardó demasiado en responder. Reintenta.';
  return 'No se pudo obtener tu ubicación. Reintenta.';
}

/** Promisified getCurrentPosition with the project's standard options. */
export function requestPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    // 15 s: the browser permission prompt counts against the timeout.
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      timeout: 15000,
      maximumAge: 5 * 60 * 1000,
      enableHighAccuracy: false,
    });
  });
}
