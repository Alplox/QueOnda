import type { APIRoute } from 'astro';
import { dedupeFetch, edgeCacheHeaders } from '../../lib/cache';

const DMC_URL = 'https://archivos.meteochile.gob.cl/portaldmc/meteochile/js/pronostico.js';

function decodeHtml(s: string): string {
  return s
    .replace(/&aacute;/g, 'á').replace(/&eacute;/g, 'é').replace(/&iacute;/g, 'í')
    .replace(/&oacute;/g, 'ó').replace(/&uacute;/g, 'ú').replace(/&ntilde;/g, 'ñ')
    .replace(/&uuml;/g, 'ü').replace(/&uuml;/g, 'ü').replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(parseInt(c)));
}

function extractStrArr(text: string, field: string): string[] {
  const m = text.match(new RegExp(field + '\\s*:\\s*\\[([^\\]]+)\\]'));
  if (!m) return [];
  return m[1].match(/"([^"]*?)"/g)?.map(s => decodeHtml(s.replace(/"/g, ''))) ?? [];
}

function extractIconMatrix(text: string): string[][] {
  const m = text.match(/icono\s*:\s*\[([\s\S]*?)\]\s*\n/);
  if (!m) return [];
  const rows: string[][] = [];
  const inner = m[1].match(/\[([^\]]+)\]/g);
  if (!inner) return [];
  for (const row of inner) {
    rows.push(row.match(/"([^"]*?)"/g)?.map(s => s.replace(/"/g, '')) ?? []);
  }
  return rows;
}

interface DmcForecast {
  indice: string;
  ciudad: string;
  region: string;
  fecha: string[];
  temperatura: string[];
  icono: string[][];
  texto: string[][];
}

export const GET: APIRoute = async () => {
  const forecasts = await dedupeFetch<Record<string, DmcForecast> | null>('dmc-forecast', async () => {
    try {
      const res = await fetch(DMC_URL, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) return null;
      const js = await res.text();

      // Extract each Pronostico.push({...}) block
      const blocks = js.match(/Pronostico\.push\(\{[\s\S]*?\}\);/g);
      if (!blocks) return null;

      const result: Record<string, DmcForecast> = {};
      for (const block of blocks) {
        const indiceM = block.match(/indice\s*:\s*"([^"]+)"/);
        const ciudadM = block.match(/ciudad\s*:\s*"([^"]+)"/);
        const regionM = block.match(/region\s*:\s*"([^"]+)"/);
        if (!indiceM) continue;

        const indice = indiceM[1];
        result[indice] = {
          indice,
          ciudad: decodeHtml(ciudadM?.[1] ?? indice),
          region: regionM?.[1] ?? '',
          fecha: extractStrArr(block, 'fecha'),
          temperatura: extractStrArr(block, 'temperatura'),
          icono: extractIconMatrix(block),
          texto: extractStrArr(block, 'texto').length > 0
            ? (() => {
                // texto is nested array — extract per-row
                const rows: string[][] = [];
                const m = block.match(/texto\s*:\s*\[([\s\S]*?)\]\s*\n/);
                if (m) {
                  const inner = m[1].match(/\[([^\]]+)\]/g);
                  if (inner) {
                    for (const row of inner) {
                      rows.push(row.match(/"([^"]*?)"/g)?.map(s => decodeHtml(s.replace(/"/g, ''))) ?? []);
                    }
                  }
                }
                return rows;
              })()
            : [],
        };
      }

      return Object.keys(result).length > 0 ? result : null;
    } catch {
      return null;
    }
  });

  return new Response(JSON.stringify({ forecasts }), {
    headers: edgeCacheHeaders(3600),
  });
};
