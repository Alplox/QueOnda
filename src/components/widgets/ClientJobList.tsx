import { useEffect, useState, useMemo } from 'react';
import type { Job, JobSource } from '../../lib/jobs/types';
import { JOB_SOURCES } from '../../lib/jobs/types';

export function ClientJobList() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [sources, setSources] = useState<JobSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeSource, setActiveSource] = useState<JobSource | ''>('');
  const [remoteOnly, setRemoteOnly] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string | ''>('');

  useEffect(() => {
    loadJobs('');
  }, []);

  const loadJobs = (source: JobSource | '') => {
    setLoading(true);
    setError(null);
    const url = source ? `/api/jobs?source=${source}` : '/api/jobs';
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`Error ${r.status}`);
        return r.json();
      })
      .then((data) => {
        setJobs(data.jobs || []);
        setSources(data.sources || []);
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  };

  const handleSourceChange = (src: JobSource | '') => {
    setActiveSource(src);
    setActiveCategory('');
    setSearchQuery('');
    loadJobs(src);
  };

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const j of jobs) {
      if (j.category) set.add(j.category);
    }
    return [...set].sort();
  }, [jobs]);

  const filteredJobs = useMemo(() => {
    let result = jobs;
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(
        (j) => j.title.toLowerCase().includes(q) || j.company.toLowerCase().includes(q)
      );
    }
    if (remoteOnly) {
      result = result.filter((j) => j.remote);
    }
    if (activeCategory) {
      result = result.filter((j) => j.category === activeCategory);
    }
    return result;
  }, [jobs, searchQuery, remoteOnly, activeCategory]);

  const formatSalary = (s: NonNullable<Job['salary']>): string => {
    if (s.min == null && s.max == null) return '';
    const fmt = (n: number) => {
      if (s.currency === 'USD') return `$${n}`;
      if (s.currency === 'CLP') return `$${n.toLocaleString('es-CL')}`;
      return `$${n}`;
    };
    if (s.min != null && s.max != null) return `${fmt(s.min)}–${fmt(s.max)}`;
    if (s.min != null) return `Desde ${fmt(s.min)}`;
    return `Hasta ${fmt(s.max!)}`;
  };

  const timeAgo = (dateStr: string): string => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const days = Math.floor(diff / 86400000);
    if (days === 0) return 'Hoy';
    if (days === 1) return 'Ayer';
    if (days < 30) return `hace ${days} días`;
    return `hace ${Math.floor(days / 30)} meses`;
  };

  return (
    <div className="rounded-2xl bg-base-200 border border-base-300 overflow-hidden">
      {/* Top bar: source selector + remote toggle */}
      <div className="flex flex-wrap items-center gap-2 p-3 border-b border-base-300">
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-[10px] text-base-content/40 font-medium uppercase tracking-wider mr-1 shrink-0">
            Fuente:
          </span>
          <button
            onClick={() => handleSourceChange('')}
            className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors cursor-pointer ${
              activeSource === ''
                ? 'bg-primary text-primary-content border-primary'
                : 'bg-base-100 text-base-content/70 border-base-content/20 hover:border-base-content/30 hover:text-base-content/70'
            }`}
          >
            Todas
          </button>
          {JOB_SOURCES.map((sm) => {
            const active = activeSource === sm.key;
            const available = sources.includes(sm.key);
            return (
              <button
                key={sm.key}
                onClick={() => handleSourceChange(active ? '' : sm.key)}
                className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors cursor-pointer ${
                  active
                    ? 'bg-primary text-primary-content border-primary'
                    : available
                      ? 'bg-base-100 text-base-content/70 border-base-content/20 hover:border-base-content/30 hover:text-base-content/70'
                      : 'bg-base-100/50 text-base-content/30 border-base-content/10 line-through'
                }`}
              >
                {sm.label}
              </button>
            );
          })}
        </div>
        <button
          onClick={() => setRemoteOnly((r) => !r)}
          className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors cursor-pointer ml-auto ${
            remoteOnly
              ? 'bg-primary text-primary-content border-primary'
              : 'bg-base-100 text-base-content/70 border-base-content/20 hover:border-base-content/30'
          }`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="inline-block align-middle mr-1">
            <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
          </svg>
          Solo remoto
        </button>
      </div>

      {/* Search */}
      <div className="px-3 pt-3">
        <div className="relative">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar trabajos..."
             className="w-full text-sm bg-base-100 border border-base-300 rounded-xl px-3 py-2 pr-8 text-base-content placeholder:text-base-content/30 focus:outline-none focus:border-primary/50 transition-colors"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-base-content/30 hover:text-base-content/70 transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Category chips */}
      {categories.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-3 pt-2">
          <button
            onClick={() => setActiveCategory('')}
            className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors cursor-pointer ${
              activeCategory === ''
                ? 'bg-primary text-primary-content border-primary'
                : 'bg-base-100 text-base-content/40 border-base-content/20 hover:text-base-content/70'
            }`}
          >
            Todas
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(activeCategory === cat ? '' : cat)}
              className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors cursor-pointer ${
                activeCategory === cat
                  ? 'bg-primary text-primary-content border-primary'
                  : 'bg-base-100 text-base-content/40 border-base-content/20 hover:text-base-content/70'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      )}

      {/* Content */}
      <div className="p-3">
        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="animate-pulse rounded-xl bg-base-300/50 p-3 space-y-2">
                <div className="h-4 bg-base-300 rounded w-3/5" />
                <div className="h-3 bg-base-300 rounded w-2/5" />
                <div className="h-3 bg-base-300 rounded w-1/3" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="text-center py-8">
            <p className="text-sm text-base-content/70 mb-2">Error al cargar trabajos</p>
            <button
              onClick={() => loadJobs(activeSource)}
              className="text-xs px-3 py-1.5 rounded-lg bg-primary text-primary-content hover:bg-primary transition-colors"
            >
              Reintentar
            </button>
          </div>
        ) : filteredJobs.length === 0 ? (
          <div className="text-center py-10">
            <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-base-300 mb-2 text-base-content/40">
              <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="6" width="16" height="12" rx="2" />
                <path d="M7 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
              </svg>
            </div>
            <p className="text-sm text-base-content/70 font-medium">No se encontraron ofertas</p>
            <p className="text-xs text-base-content/30 mt-1">Prueba con otros filtros</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-[480px] overflow-y-auto pr-1">
            {filteredJobs.map((job, index) => (
              <a
                key={job.id}
                href={job.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block rounded-xl bg-base-100 border border-base-300 p-3 hover:border-primary/30 hover:bg-base-100 shadow-sm transition-colors duration-150 active:scale-[0.99] opacity-0 animate-[fadeSlideIn_0.35s_ease-out_forwards]"
                style={{ animationDelay: `${Math.min(index, 20) * 50}ms` }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-base-content truncate">{job.title}</p>
                    <p className="text-xs text-base-content/60 mt-0.5 truncate">{job.company}</p>
                  </div>
                  {job.remote && (
                    <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-primary text-primary-content font-medium">
                      Remoto
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 mt-1.5 text-[10px] text-base-content/70">
                  {job.salary && formatSalary(job.salary) && (
                    <span className="font-medium text-base-content/70">{formatSalary(job.salary)}</span>
                  )}
                  <span>{job.location}</span>
                  <span className="text-base-content/30">{timeAgo(job.publishedAt)}</span>
                  <span className="text-[9px] uppercase tracking-wider text-base-content/30 ml-auto">
                    {JOB_SOURCES.find((m) => m.key === job.source)?.label || job.source}
                  </span>
                </div>
                {job.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {job.tags.slice(0, 4).map((tag) => (
                      <span
                        key={tag}
                        className="text-[9px] px-1.5 py-0.5 rounded-md bg-base-200 text-base-content/70"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </a>
            ))}
          </div>
        )}
      </div>

      {/* Attribution */}
      <div className="px-3 pb-3 text-right text-[10px] text-base-content/70">
        Fuentes:{' '}
        {JOB_SOURCES.map((sm, i) => (
          <span key={sm.key}>
            {i > 0 && ' · '}
            <a
              href={sm.url}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-base-content underline underline-offset-2 transition-colors"
            >
              {sm.label}
            </a>
          </span>
        ))}
      </div>
      <div className="px-3 pb-3 text-right text-[10px] text-base-content/50 border-t border-base-300 pt-2">
        <a
          href="https://mis-recursos-webdev.pages.dev/#chile-focus"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-base-content underline underline-offset-2 transition-colors"
        >
          📋 Ir a portales de empleo en Chile
        </a>
      </div>
    </div>
  );
}
