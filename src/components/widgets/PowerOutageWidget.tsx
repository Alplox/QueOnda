import { useCallback, useEffect, useMemo, useState } from 'react';
import { PowerOutageMap } from './PowerOutageMap';
import { PowerEvolutionChart } from './PowerEvolutionChart';
import { subscribeAutoRefresh } from '@/lib/auto-refresh';
import { play } from '@/lib/sound';

interface Comuna {
  region: string;
  comuna: string;
  affected: number;
  lat: number;
  lon: number;
}

interface SeriesPoint {
  t: number;
  v: number;
}

interface PowerData {
  affected: number;
  total: number;
  pct: number;
  updatedAt: number;
  regions: Array<{ region: string; affected: number }>;
  comunas: Comuna[];
  series: SeriesPoint[];
}

async function fetchPower(): Promise<PowerData | null> {
  try {
    const res = await fetch('/api/power', { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const data = await res.json();
    return data.affected != null ? data : null;
  } catch { return null; }
}

const miles = (n: number) => Number(n).toLocaleString('es-CL');
const maxAffected = (rows: Array<{ affected: number }>) => rows[0]?.affected ?? 1;

export function PowerOutageWidget() {
  const [data, setData] = useState<PowerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showMap, setShowMap] = useState(false);
  const [showChart, setShowChart] = useState(false);
  const [mapMounted, setMapMounted] = useState(false);
  const [chartMounted, setChartMounted] = useState(false);
  const [tab, setTab] = useState<'regiones' | 'comunas'>('regiones');

  // Keep map/chart mounted through their 300ms collapse so the exit animates like the weather map
  useEffect(() => {
    if (showMap) setMapMounted(true);
    else { const t = setTimeout(() => setMapMounted(false), 300); return () => clearTimeout(t); }
  }, [showMap]);
  useEffect(() => {
    if (showChart) setChartMounted(true);
    else { const t = setTimeout(() => setChartMounted(false), 300); return () => clearTimeout(t); }
  }, [showChart]);

  const refresh = useCallback(() => {
    fetchPower().then(d => {
      if (d) setData(d);
      setLoading(false);
    });
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => subscribeAutoRefresh(refresh), [refresh]);

  // prefetch leaflet JS at idle so opening the map doesn't wait for the ~144 KB chunk
  useEffect(() => {
    const id = requestIdleCallback(() => { import('leaflet').catch(() => {}); });
    return () => cancelIdleCallback(id);
  }, []);

  const topComunas = useMemo(() => data?.comunas.slice(0, 8) ?? [], [data]);

  if (loading) {
    return (
      <div className="mt-4 rounded-xl p-4 border border-base-300 shadow-sm animate-[fadeInUp_0.3s_ease-out]">
        <div className="flex items-center gap-2 animate-pulse">
          <div className="h-5 w-5 rounded-full bg-base-300" />
          <div className="h-4 w-40 bg-base-300 rounded" />
        </div>
        <div className="h-8 w-28 bg-base-300 rounded mt-3 animate-pulse" />
        <div className="h-2.5 bg-base-300 rounded w-full mt-3 animate-pulse" />
        <div className="h-2.5 bg-base-300 rounded w-3/4 mt-1.5 animate-pulse" />
      </div>
    );
  }

  if (!data || data.total === 0) return null;

  const rows = tab === 'regiones' ? data.regions : topComunas;

  return (
    <div className="mt-4 rounded-xl p-4 border border-base-300 shadow-sm bg-base-200 animate-[fadeInUp_0.3s_ease-out]">
      <div className="flex items-center justify-between gap-2">
        <p className="em-subhead !mb-0 !pb-1">
          <span><span className="mr-1.5" role="img" aria-label="rayo">⚡</span>Clientes sin suministro eléctrico</span>
          <span className="text-[10px] text-base-content/50">
            {new Date(data.updatedAt).toLocaleString('es-CL', {
              day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
            })}
          </span>
        </p>
      </div>

      <div className="flex items-baseline gap-3 mt-2 animate-[heroFadeUp_0.4s_ease-out]">
        <span className="text-3xl font-bold text-base-content tabular-nums">{miles(data.affected)}</span>
        <span className="text-base-content/70 text-sm font-normal"> de {miles(data.total)}</span>
        <span className={`text-sm font-medium ${data.pct >= 2 ? 'text-error' : 'text-base-content/70'}`}>
          ({data.pct.toFixed(2)}% del país)
        </span>
      </div>

      <div className="mt-3 text-[11px] text-base-content/70">
        ¿Corte de luz? Reporta:{' '}
        <a href="https://www.sec.cl/reclamo-por-corte-de-luz/" target="_blank" rel="noopener noreferrer"
          className="hover:text-base-content underline underline-offset-2 transition-colors">SEC</a>
        {' · '}
        <a href="https://sucursalvirtual.cge.cl/estas-sin-luz" target="_blank" rel="noopener noreferrer"
          className="hover:text-base-content underline underline-offset-2 transition-colors">CGE</a>
        {' · '}
        <a href="https://desconexiones.gruposaesa.cl/estoy-sin-luz" target="_blank" rel="noopener noreferrer"
          className="hover:text-base-content underline underline-offset-2 transition-colors">Grupo Saesa</a>
        {' · '}
        <a href="https://www.enel.cl/es/clientes/servicios-en-linea/solicitud-contacto.html" target="_blank" rel="noopener noreferrer"
          className="hover:text-base-content underline underline-offset-2 transition-colors">Enel</a>
        {' · '}
        <a href="https://www.chilquinta.cl/reportar-corte" target="_blank" rel="noopener noreferrer"
          className="hover:text-base-content underline underline-offset-2 transition-colors">Chilquinta</a>
      </div>

      <div className="mt-3">
        <div className="flex gap-1">
          <button
            onClick={() => setTab('regiones')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer active:scale-[0.96] ${
              tab === 'regiones'
                ? 'bg-primary text-primary-content'
                : 'bg-base-300 text-base-content/60 hover:text-base-content'
            }`}
          >
            Regiones
          </button>
          <button
            onClick={() => setTab('comunas')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer active:scale-[0.96] ${
              tab === 'comunas'
                ? 'bg-primary text-primary-content'
                : 'bg-base-300 text-base-content/60 hover:text-base-content'
            }`}
          >
            Comunas ({data.comunas.length})
          </button>
        </div>

        <div className="mt-2 space-y-1.5">
          {rows.map((r, i) => (
            <div key={(r as Comuna).comuna ?? r.region} className="flex items-center gap-2 text-xs animate-[fadeInUp_0.3s_ease-out_both]"
              style={{ animationDelay: `${i * 40}ms` }}>
              <span className="text-base-content/80 w-28 shrink-0 truncate">
                {(r as Comuna).comuna ?? r.region}
              </span>
              <div className="flex-1 h-1.5 rounded-full bg-base-300 overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${Math.max(3, (r.affected / maxAffected(rows)) * 100)}%` }}
                />
              </div>
              <span className="text-base-content/70 tabular-nums shrink-0">{miles(r.affected)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3">
        <button
          type="button"
          onClick={() => { play('interaction.toggle'); setShowMap(s => !s); }}
          aria-expanded={showMap}
          className="flex items-center gap-1 text-[10px] text-primary hover:text-base-content transition-[color,transform] active:scale-[0.96] cursor-pointer"
        >
          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
            className={`transition-transform duration-200 ${showMap ? 'rotate-90' : ''}`}>
            <path d="M9 18l6-6-6-6" />
          </svg>
          {showMap ? 'Ocultar mapa' : 'Ver mapa por comuna'}
        </button>
        <button
          type="button"
          onClick={() => { play('interaction.toggle'); setShowChart(s => !s); }}
          aria-expanded={showChart}
          className="flex items-center gap-1 text-[10px] text-primary hover:text-base-content transition-[color,transform] active:scale-[0.96] cursor-pointer"
        >
          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
            className={`transition-transform duration-200 ${showChart ? 'rotate-90' : ''}`}>
            <path d="M9 18l6-6-6-6" />
          </svg>
          {showChart ? 'Ocultar evolución' : 'Ver evolución'}
        </button>
      </div>

      <div className={`mt-2 grid transition-[grid-template-rows] duration-300 ease-out ${showMap ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
        <div className="overflow-hidden min-h-0">
          {mapMounted && (
            <div className="rounded-lg border border-base-300 overflow-hidden bg-base-100 p-3">
              <PowerOutageMap comunas={data.comunas} />
            </div>
          )}
        </div>
      </div>

      <div className={`mt-2 grid transition-[grid-template-rows] duration-300 ease-out ${showChart ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
        <div className="overflow-hidden min-h-0">
          {chartMounted && (
            <div className="rounded-lg border border-base-300 overflow-hidden bg-base-100 p-3">
              <PowerEvolutionChart series={data.series} />
            </div>
          )}
        </div>
      </div>

      <div className="mt-2 text-right text-[10px] text-base-content/50">
        Fuente:{' '}
        <a
          href="https://apps.sec.cl/INTONLINEv1/index.aspx"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-base-content underline underline-offset-2 transition-colors"
        >
          SEC
        </a>
      </div>
    </div>
  );
}
