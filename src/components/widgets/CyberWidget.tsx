import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type UIEvent } from 'react';
import type { Article } from '@/types';
import type { CyberBlock, CyberPayload } from '@/lib/cyber';
import { play } from '@/lib/sound';
import { idbGet, idbSet } from '@/lib/idb-cache';
import { subscribeAutoRefresh } from '@/lib/auto-refresh';
import { useErrorRetry } from '@/lib/retry';
import { foldAccents } from '@/lib/sources';
import { ArticleReader } from '../news/ArticleReader';
import { RetryHint } from '../RetryHint';
import { CyberAlertRow, CyberKevRow, fmtRelative, type ReadableItem } from './CyberRows';
import { SectionSources } from '../SectionSources';

const IDB_KEY = 'cyber';
const IDB_TTL = 15 * 60 * 1000;
const STALE_MS = 45 * 60 * 1000;
const KEV_BATCH = 20;

type Tab = 'alertas' | 'kev';

const TABS: Array<{ key: Tab; label: string; placeholder: string }> = [
  { key: 'alertas', label: 'Alertas Chile', placeholder: 'Buscar alerta, vendor o etiqueta…' },
  { key: 'kev', label: 'Vulnerabilidades', placeholder: 'Buscar CVE, producto o vendor…' },
];

async function fetchCyber(): Promise<CyberPayload> {
  const res = await fetch('/api/cyber', { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as CyberPayload;
  if (!data?.blocks) throw new Error('Respuesta inválida');
  return data;
}

export function CyberWidget() {
  const [payload, setPayload] = useState<CyberPayload | null>(null);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [error, setError] = useState(false);
  const [tab, setTab] = useState<Tab>('alertas');
  const [query, setQuery] = useState('');
  // Un flag por pestaña: el de una no puede filtrar las otras (si no, «Solo
  // ransomware» recortaba el conteo de «Alertas Chile»).
  const [criticalOnly, setCriticalOnly] = useState(false);
  const [ransomwareOnly, setRansomwareOnly] = useState(false);
  const [kevLimit, setKevLimit] = useState(KEV_BATCH);
  const [reader, setReader] = useState<Article | null>(null);
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ alertas: null, kev: null });

  const load = useCallback(async () => {
    try {
      const data = await fetchCyber();
      setPayload(data);
      setFetchedAt(Date.now());
      setError(false);
      void idbSet(IDB_KEY, data, IDB_TTL);
    } catch {
      setError(true);
    }
  }, []);

  // Phase 0: pintar desde IndexedDB antes de que el fetch termine.
  useEffect(() => {
    let cancelled = false;
    void idbGet<CyberPayload>(IDB_KEY).then((cached) => {
      if (cancelled || !cached?.data) return;
      setPayload((prev) => prev ?? cached.data);
      setFetchedAt((prev) => prev ?? cached.timestamp);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    void load();
    return subscribeAutoRefresh(() => { void load(); });
  }, [load]);

  const blocksFailed = Boolean(
    payload && (!payload.blocks.alerts.ok || !payload.blocks.kev.ok),
  );
  const { retrying, retryIn, retryNow } = useErrorRetry(error || blocksFailed, load);

  const q = foldAccents(query.trim());
  const alerts = payload?.alerts ?? [];
  const kevItems = payload?.kev.items ?? [];
  const kevRwDays = payload?.kev.ransomwareDays ?? 180;

  const criticalCount = useMemo(() => alerts.filter((a) => a.severity === 'critical').length, [alerts]);

  const filteredAlerts = useMemo(() => {
    return alerts.filter((a) => {
      if (criticalOnly && a.severity !== 'critical') return false;
      if (!q) return true;
      return foldAccents(`${a.title} ${a.vendor} ${a.tags.join(' ')}`).includes(q);
    });
  }, [alerts, criticalOnly, q]);

  const filteredKev = useMemo(() => {
    // El flag de ransomware es raro: la ventana de 30 días casi siempre da 0,
    // así que el filtro cambia a la ventana amplia que expone el servidor.
    const base = ransomwareOnly ? (payload?.kev.ransomwareRecent ?? []) : kevItems;
    return base.filter((k) => {
      if (!q) return true;
      return foldAccents(`${k.cve} ${k.vendor} ${k.product} ${k.name} ${k.description}`).includes(q);
    });
  }, [payload, kevItems, ransomwareOnly, q]);

  useEffect(() => {
    setKevLimit(KEV_BATCH);
  }, [tab, q, criticalOnly, ransomwareOnly]);

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const { key } = event;
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(key)) return;
    event.preventDefault();
    let next = index;
    if (key === 'ArrowRight') next = (index + 1) % TABS.length;
    else if (key === 'ArrowLeft') next = (index - 1 + TABS.length) % TABS.length;
    else if (key === 'Home') next = 0;
    else next = TABS.length - 1;
    const nextTab = TABS[next].key;
    setTab(nextTab);
    tabRefs.current[nextTab]?.focus();
  };

  const onPanelScroll = (event: UIEvent<HTMLDivElement>) => {
    const el = event.currentTarget;
    if (el.scrollTop + el.clientHeight < el.scrollHeight - 160) return;
    if (tab === 'kev') setKevLimit((n) => Math.min(n + KEV_BATCH, filteredKev.length));
  };

  const selectTab = (next: Tab) => {
    if (next === tab) return;
    play('interaction.tap');
    setTab(next);
  };

  const toggleCritical = () => {
    play('interaction.toggle');
    setCriticalOnly((v) => !v);
  };

  const toggleRansomware = () => {
    play('interaction.toggle');
    setRansomwareOnly((v) => !v);
  };

  // El conteo del encabezado es la entrada directa a las críticas: evita el
  // banner que repetía la primera alerta de la lista de abajo.
  const toggleCriticalFromSummary = () => {
    play('interaction.toggle');
    if (tab === 'alertas' && criticalOnly) {
      setCriticalOnly(false);
      return;
    }
    setTab('alertas');
    setCriticalOnly(true);
  };

  // Las alertas del CSIRT son HTML normal, así que el lector de artículos que
  // ya usa Noticias las puede extraer igual. NVD queda fuera: no es un
  // artículo, es una ficha.
  const openReader = useCallback((item: ReadableItem) => {
    play('interaction.tap');
    setReader({
      title: item.title,
      link: item.url,
      description: item.description ?? '',
      pubDate: item.published ?? new Date().toISOString(),
      source: item.source ?? 'Ciberseguridad',
      sourceKey: 'cyber',
    });
  }, []);

  const isStale = fetchedAt != null && Date.now() - fetchedAt > STALE_MS;
  const updatedLabel = payload ? fmtRelative(payload.updatedAt) : '';

  if (!payload) {
    return (
      <div className={error ? undefined : 'flex min-h-[633px] flex-col sm:min-h-[613px]'}>
        {!error && <p className="sr-only" role="status">Cargando ciberseguridad…</p>}
        <div className={`overflow-hidden rounded-xl border border-base-300 bg-base-200 shadow-sm ${error ? '' : 'flex flex-1 flex-col'}`}>
          <div className="flex items-center justify-between gap-2 border-b border-base-300 p-4">
            <p className="text-xs uppercase tracking-wider text-base-content/70">Ciberseguridad · Chile</p>
            <p className="text-[11px] text-base-content/70">{error ? 'Sin datos' : 'Cargando…'}</p>
          </div>

          {error ? (
            <div className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="text-sm text-base-content/80">No se pudieron cargar los datos de ciberseguridad.</p>
                <p className="mt-0.5"><RetryHint retrying={retrying} retryIn={retryIn} /></p>
              </div>
              <button
                type="button"
                onClick={retryNow}
                disabled={retrying}
                className="flex shrink-0 items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-content transition-[opacity,transform] hover:opacity-90 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {retrying ? 'Reintentando…' : 'Reintentar ahora'}
              </button>
            </div>
          ) : (
            /*
             * Pestañas + buscador + lista. La lista estira sus filas para llenar el
             * bloque: el real tiene ventana de `max-h-[440px]`, así que el alto no
             * depende de cuántas alertas haya.
             */
            <div className="flex flex-1 flex-col gap-2 p-3" aria-hidden="true">
              <div className="flex gap-2 animate-pulse">
                <div className="h-8 w-28 rounded-lg bg-base-300/60" />
                <div className="h-8 w-24 rounded-lg bg-base-300/60" />
                <div className="ml-auto h-8 w-40 rounded-lg bg-base-300/60" />
              </div>
              <div className="flex flex-1 flex-col gap-2 animate-pulse">
                {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
                  <div key={i} className="flex-1 rounded-lg bg-base-300/60" />
                ))}
              </div>
            </div>
          )}
        </div>
        <SectionSources section="cyber" />
      </div>
    );
  }

  const blocks: Record<Tab, CyberBlock> = {
    alertas: payload.blocks.alerts,
    kev: payload.blocks.kev,
  };
  const activeBlock = blocks[tab];

  const emptyMessage =
    tab === 'alertas'
      ? q || criticalOnly
        ? `Sin alertas que coincidan${query.trim() ? ` con «${query.trim()}»` : ''}.`
        : 'Sin alertas publicadas en este momento.'
      : q
        ? 'Sin vulnerabilidades que coincidan con el filtro.'
        : ransomwareOnly
          ? `Sin entradas de ransomware en los últimos ${kevRwDays} días.`
          : `Sin entradas nuevas en los últimos ${payload.kev.days} días.`;

  return (
    <>
      <div className="overflow-hidden rounded-xl border border-base-300 bg-base-200 shadow-sm">
        <div className="border-b border-base-300 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <p className="text-xs uppercase tracking-wider text-base-content/70">Ciberseguridad · Chile</p>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-base-content/70">
              <span>
                <strong className="font-semibold text-base-content">{alerts.length}</strong> alertas
                {criticalCount > 0 && (
                  <>
                    {' · '}
                    <button
                      type="button"
                      onClick={toggleCriticalFromSummary}
                      aria-pressed={tab === 'alertas' && criticalOnly}
                      title="Ver solo las alertas de severidad crítica"
                      className={`rounded-sm font-semibold text-error underline-offset-2 transition-colors hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
                        tab === 'alertas' && criticalOnly ? 'underline' : ''
                      }`}
                    >
                      {criticalCount} críticas
                    </button>
                  </>
                )}
              </span>
              <span aria-hidden="true">·</span>
              <span>
                <strong className="font-semibold text-base-content">{payload.kev.total}</strong> explotadas ({payload.kev.days} d)
              </span>
              <span aria-hidden="true">·</span>
              <span className={isStale ? 'font-semibold text-warning' : undefined} title={payload.updatedAt}>
                {updatedLabel}
                {isStale ? ' · desactualizado' : ''}
              </span>
            </div>
          </div>
        </div>

        {(error || isStale) && (
          <div
            className="mx-3 mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-base-content/80"
            role="status"
            aria-live="polite"
          >
            <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="font-semibold text-warning">⚠ Datos sin actualizar</span>
              <span>Última lectura {fetchedAt ? fmtRelative(new Date(fetchedAt).toISOString()) : 'desconocida'}.</span>
              <RetryHint retrying={retrying} retryIn={retryIn} />
            </span>
            <button
              type="button"
              onClick={retryNow}
              disabled={retrying}
              className="shrink-0 rounded-md border border-base-300 bg-base-100 px-2.5 py-1 text-[11px] font-semibold transition-colors hover:bg-base-200 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {retrying ? 'Reintentando…' : 'Actualizar'}
            </button>
          </div>
        )}

        <div className="border-b border-base-300 px-4 py-3">
          <div role="tablist" aria-label="Ciberseguridad" className="flex gap-1 overflow-x-auto">
            {TABS.map((t, index) => {
              const count = t.key === 'alertas' ? filteredAlerts.length : filteredKev.length;
              const selected = tab === t.key;
              return (
                <button
                  key={t.key}
                  ref={(el) => { tabRefs.current[t.key] = el; }}
                  type="button"
                  role="tab"
                  id={`cyber-tab-${t.key}`}
                  aria-selected={selected}
                  aria-controls={`cyber-panel-${t.key}`}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => selectTab(t.key)}
                  onKeyDown={(e) => onTabKeyDown(e, index)}
                  className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors active:scale-[0.96] ${
                    selected
                      ? 'bg-primary text-primary-content'
                      : 'bg-base-300 text-base-content/70 hover:text-base-content'
                  }`}
                >
                  {t.label}
                  <span className={`ml-1.5 tabular-nums ${selected ? 'text-primary-content/80' : 'text-base-content/70'}`}>{count}</span>
                </button>
              );
            })}
          </div>

          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <div className="relative min-w-[180px] flex-1">
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                aria-hidden="true"
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-base-content/70"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
              <label htmlFor="cyber-search">
                <span className="sr-only">Buscar en la sección de ciberseguridad</span>
                <input
                  id="cyber-search"
                  name="cyber-search"
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={TABS.find((t) => t.key === tab)?.placeholder}
                  className="w-full rounded-lg border border-base-300 bg-base-100 py-1.5 pl-8 pr-8 text-sm text-base-content placeholder:text-base-content/70 focus:border-primary focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary [&::-webkit-search-cancel-button]:appearance-none"
                />
              </label>
              {query && (
                <button
                  type="button"
                  onClick={() => { play('interaction.subtle'); setQuery(''); }}
                  aria-label="Limpiar búsqueda"
                  title="Limpiar búsqueda"
                  className="absolute right-1 top-1/2 -translate-y-1/2 rounded-md p-1 text-base-content/70 transition-colors hover:bg-base-200 hover:text-base-content"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={tab === 'kev' ? toggleRansomware : toggleCritical}
              aria-pressed={tab === 'kev' ? ransomwareOnly : criticalOnly}
              title={
                tab === 'kev'
                  ? `Ransomware confirmado en los últimos ${kevRwDays} días`
                  : 'Solo alertas de severidad crítica'
              }
              className={`shrink-0 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors active:scale-[0.96] ${
                (tab === 'kev' ? ransomwareOnly : criticalOnly)
                  ? 'border-error/40 bg-error/15 text-error'
                  : 'border-base-300 bg-base-100 text-base-content/70 hover:border-primary/30 hover:text-base-content'
              }`}
            >
              {tab === 'kev' ? 'Solo ransomware' : 'Solo críticas'}
            </button>
          </div>
        </div>

        <div
          role="tabpanel"
          id={`cyber-panel-${tab}`}
          aria-labelledby={`cyber-tab-${tab}`}
          tabIndex={0}
          onScroll={onPanelScroll}
          className="max-h-[440px] overflow-y-auto overscroll-contain p-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
        >
          <BlockNotice block={activeBlock} retrying={retrying} retryIn={retryIn} onRetry={retryNow} />

          {tab === 'kev' && !ransomwareOnly && (payload.kev.byVendor ?? []).length > 0 && (
            <div className="mb-2 flex flex-wrap items-center gap-1.5 px-1">
              <span className="text-[10px] uppercase tracking-wider text-base-content/70">Proveedor</span>
              {(payload.kev.byVendor ?? []).map((v) => {
                const active = q === foldAccents(v.vendor);
                return (
                  <button
                    key={v.vendor}
                    type="button"
                    aria-pressed={active}
                    onClick={() => {
                      play('interaction.subtle');
                      setQuery(active ? '' : v.vendor);
                    }}
                    className={`rounded-full border px-2 py-0.5 text-[11px] transition-colors active:scale-[0.96] ${
                      active
                        ? 'border-primary bg-primary text-primary-content'
                        : 'border-base-300 bg-base-100 text-base-content/70 hover:border-primary/40 hover:text-base-content'
                    }`}
                  >
                    {v.vendor}
                    <span className="ml-1 tabular-nums opacity-70">{v.count}</span>
                  </button>
                );
              })}
            </div>
          )}

          {tab === 'alertas' && filteredAlerts.length > 0 && (
            <div className="space-y-1.5">
              {filteredAlerts.map((a) => <CyberAlertRow key={a.id} alert={a} onOpen={openReader} />)}
            </div>
          )}

          {tab === 'kev' && filteredKev.length > 0 && (
            <div className="space-y-1.5">
              {filteredKev.slice(0, kevLimit).map((k) => <CyberKevRow key={k.cve} entry={k} />)}
            </div>
          )}

          {tab === 'kev' && filteredKev.length > kevLimit && (
            <LoadMore onClick={() => setKevLimit((n) => Math.min(n + KEV_BATCH, filteredKev.length))}>
              {filteredKev.length - kevLimit} más
            </LoadMore>
          )}

          {filteredAlerts.length === 0 && tab === 'alertas' && activeBlock.ok && <p className="px-2 py-6 text-center text-xs text-base-content/70">{emptyMessage}</p>}
          {filteredKev.length === 0 && tab === 'kev' && activeBlock.ok && <p className="px-2 py-6 text-center text-xs text-base-content/70">{emptyMessage}</p>}
        </div>
      </div>

      <SectionSources section="cyber" />

      {reader && (
        <ArticleReader url={reader.link} initialArticle={reader} onClose={() => setReader(null)} />
      )}
    </>
  );
}

function LoadMore({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <div className="flex justify-center py-2">
      <button
        type="button"
        onClick={onClick}
        className="rounded-lg border border-base-300 bg-base-100 px-3 py-1 text-[11px] font-medium text-base-content/70 transition-colors hover:text-base-content active:scale-[0.97]"
      >
        Cargar {children}
      </button>
    </div>
  );
}

function BlockNotice({
  block,
  retrying,
  retryIn,
  onRetry,
}: {
  block: CyberBlock;
  retrying: boolean;
  retryIn: number;
  onRetry: () => void;
}) {
  const failed = block.sources.filter((s) => !s.ok);
  if (failed.length === 0) return null;
  return (
    <div className="mx-1 mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warning/30 bg-warning/10 px-2.5 py-1.5 text-[11px] text-base-content/80">
      <span className="min-w-0">
        No se pudo actualizar {failed.map((s) => s.name).join(', ')}. <RetryHint retrying={retrying} retryIn={retryIn} />
      </span>
      <button
        type="button"
        onClick={onRetry}
        disabled={retrying}
        className="shrink-0 rounded-md border border-base-300 bg-base-100 px-2 py-0.5 text-[11px] font-semibold transition-colors hover:bg-base-200 disabled:cursor-not-allowed disabled:opacity-60"
      >
        Reintentar
      </button>
    </div>
  );
}


