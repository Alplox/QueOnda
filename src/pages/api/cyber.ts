import type { APIRoute } from 'astro';
import {
  buildCyberPayload,
  isDegraded,
  CYBER_CACHE_TTL_MS,
  CYBER_DEGRADED_TTL_MS,
  CYBER_LAST_GOOD_TTL_MS,
  type CyberPayload,
} from '../../lib/cyber';
import {
  getCached,
  setCache,
  dedupeFetch,
  edgeCacheHeaders,
  noStoreHeaders,
  setLastGood,
  getStaleCached,
} from '../../lib/cache';

const json = (data: unknown, headers: Record<string, string>) =>
  new Response(JSON.stringify(data), { headers });

export const GET: APIRoute = async () => {
  const cached = await getCached<CyberPayload>('cyber');
  if (cached) {
    return json(cached, edgeCacheHeaders(Math.round(CYBER_CACHE_TTL_MS / 1000)));
  }

  try {
    const data = await dedupeFetch('cyber-data', buildCyberPayload);

    // Nada se pudo leer: antes de fallar, servir el último snapshot completo.
    const empty = data.alerts.length === 0 && data.kev.items.length === 0;
    if (empty) {
      const stale = await getStaleCached<CyberPayload>('cyber');
      if (stale) return json({ ...stale, stale: true }, edgeCacheHeaders(300));
      return new Response(JSON.stringify({ error: 'Fuentes de ciberseguridad no disponibles' }), {
        status: 502,
        headers: noStoreHeaders(),
      });
    }

    // Un bloque caído no debe quedar pegado 15 min: TTL corto hasta que vuelva.
    const degraded = isDegraded(data);
    const ttl = degraded ? CYBER_DEGRADED_TTL_MS : CYBER_CACHE_TTL_MS;
    await setCache('cyber', data, ttl);
    if (!degraded) {
      await setLastGood('cyber', data, CYBER_LAST_GOOD_TTL_MS);
    }

    return json(data, edgeCacheHeaders(Math.round(ttl / 1000)));
  } catch {
    const stale = await getStaleCached<CyberPayload>('cyber');
    if (stale) return json({ ...stale, stale: true }, edgeCacheHeaders(300));
    return new Response(JSON.stringify({ error: 'Fuentes de ciberseguridad no disponibles' }), {
      status: 502,
      headers: noStoreHeaders(),
    });
  }
};
