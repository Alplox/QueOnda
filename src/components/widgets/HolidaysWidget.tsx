import { useEffect, useMemo, useState } from 'react';
import { idbGet, idbSet } from '../../lib/idb-cache';
import { LoadSwap } from '@/components/LoadSwap';
import fallbackData from '../../lib/holidays.json';
import { SectionSources } from '../SectionSources';

const IDB_KEY = 'holidays';
const IDB_TTL = 365 * 24 * 60 * 60 * 1000; // 1 year — holidays change once a year

interface Holiday {
  date: string;
  title: string;
  type: string;
  inalienable: boolean;
  extra: string;
}

interface NagerHoliday {
  date: string;
  localName: string;
  global: boolean;
}

const INALIENABLE_DATES = new Set([
  '2026-01-01', '2026-05-01', '2026-09-18', '2026-09-19', '2026-12-25',
]);

function mapNagerHoliday(h: NagerHoliday): Holiday | null {
  if (!h.global) return null;
  const inalienable = INALIENABLE_DATES.has(h.date);
  return { date: h.date, title: h.localName, type: 'Civil', inalienable, extra: inalienable ? 'Civil e Irrenunciable' : 'Civil' };
}

function parseLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function startOfDay(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function isPast(dateStr: string): boolean {
  return startOfDay(parseLocalDate(dateStr)) < startOfDay(new Date());
}

function isToday(dateStr: string): boolean {
  return startOfDay(parseLocalDate(dateStr)).getTime() === startOfDay(new Date()).getTime();
}

function getNextHoliday(holidays: Holiday[]): Holiday | null {
  const today = startOfDay(new Date());
  return holidays.find((h) => startOfDay(parseLocalDate(h.date)) >= today) || null;
}

function daysUntil(dateStr: string): number {
  const diff = startOfDay(parseLocalDate(dateStr)).getTime() - startOfDay(new Date()).getTime();
  return Math.round(diff / 86400000);
}

function relativeLabel(dateStr: string): string {
  const n = daysUntil(dateStr);
  if (n <= 0) return 'Hoy';
  if (n === 1) return 'Mañana';
  return `en ${n} días`;
}

function formatDate(dateStr: string): string {
  const d = parseLocalDate(dateStr);
  return d.toLocaleDateString('es-CL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

function weekdayShort(dateStr: string): string {
  return parseLocalDate(dateStr).toLocaleDateString('es-CL', { weekday: 'short' }).replace('.', '');
}

function dayMonthShort(dateStr: string): string {
  return parseLocalDate(dateStr).toLocaleDateString('es-CL', { day: 'numeric', month: 'short' }).replace('.', '');
}

function monthKey(dateStr: string): string {
  const d = parseLocalDate(dateStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(dateStr: string): string {
  const raw = parseLocalDate(dateStr).toLocaleDateString('es-CL', { month: 'long', year: 'numeric' });
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function groupByMonth(holidays: Holiday[]): { key: string; label: string; items: Holiday[] }[] {
  const groups: { key: string; label: string; items: Holiday[] }[] = [];
  for (const h of holidays) {
    const key = monthKey(h.date);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(h);
    else groups.push({ key, label: monthLabel(h.date), items: [h] });
  }
  return groups;
}

export function HolidaysWidget() {
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let resolved = false;

    // Phase 0: IDB cache → instant render
    idbGet<Holiday[]>(IDB_KEY).then(cached => {
      if (cancelled || !cached?.data?.length) return;
      resolved = true;
      setHolidays(cached.data);
      setLoading(false);
    });

    // Phase 1: background fetch → update
    const year = new Date().getFullYear();
    fetch(`https://date.nager.at/api/v3/publicholidays/${year}/CL`, { signal: AbortSignal.timeout(8000) })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then((json: NagerHoliday[]) => {
        if (cancelled) return;
        const mapped = json.map(mapNagerHoliday).filter(Boolean) as Holiday[];
        const data = mapped.length > 0 ? mapped : (fallbackData as Holiday[]);
        idbSet(IDB_KEY, data, IDB_TTL);
        setHolidays(data);
        if (!resolved) setLoading(false);
        resolved = true;
      })
      .catch(() => {
        if (cancelled || resolved) return;
        setHolidays(fallbackData as Holiday[]);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const skeleton = (
    <div className="flex min-h-[881px] flex-col sm:min-h-[853px]">
      <div aria-hidden="true" className="flex flex-1 flex-col">
        <div className="rounded-xl bg-base-200 border border-base-300 p-5 mb-4 space-y-2">
          <div className="flex items-center justify-between">
            <div className="h-3 bg-base-300 rounded w-24 skel-shimmer" />
            <div className="h-5 bg-base-300 rounded w-16 skel-shimmer" />
          </div>
          <div className="h-5 bg-base-300 rounded w-48 skel-shimmer" />
          <div className="h-3 bg-base-300 rounded w-36 skel-shimmer" />
        </div>
        <div className="flex flex-1 flex-col gap-1">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="contents">
              {i === 0 || i === 4 || i === 7 ? (
                <div className="h-3 bg-base-300 rounded w-28 mt-3 mb-1 skel-shimmer" />
              ) : null}
              <div className="flex items-center gap-3 p-2.5 rounded-xl">
                <div className="h-3 w-[4.5rem] bg-base-300 rounded shrink-0 skel-shimmer" />
                <div className="h-3 bg-base-300 rounded flex-1 skel-shimmer" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const groups = useMemo(() => groupByMonth(holidays), [holidays]);

  const body = () => {
    if (holidays.length === 0) {
      return (
        <div className="rounded-xl bg-base-200 border border-base-300 p-8 text-center text-base-content/70 text-sm">
          Feriados no disponibles
        </div>
      );
    }

    const next = getNextHoliday(holidays);
    const remaining = holidays.filter((h) => !isPast(h.date)).length;
    const remainingIrr = holidays.filter((h) => !isPast(h.date) && h.inalienable).length;
    let todayMarkerShown = false;

    return (
      <div className="flex min-h-[881px] flex-col sm:min-h-[853px]">
        {next && (
          <div className="rounded-xl bg-base-200 border border-base-300 shadow-sm p-5 mb-4">
            <div className="flex items-start justify-between gap-3 mb-1">
              <p className="text-xs text-base-content/70 uppercase tracking-wider">Próximo feriado</p>
              <p className="text-sm font-semibold text-primary tabular-nums shrink-0">{relativeLabel(next.date)}</p>
            </div>
            <p className="text-lg font-bold text-balance text-base-content">{next.title}</p>
            <p className="text-sm text-base-content/70 mt-0.5">{formatDate(next.date)}</p>
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-base-content/70">
              {next.inalienable && (
                <span className="inline-flex items-center text-[11px] text-primary-content font-medium bg-primary px-2 py-0.5 rounded-full">
                  Irrenunciable
                </span>
              )}
              <span className="tabular-nums">Quedan {remaining} feriado{remaining === 1 ? '' : 's'} este año</span>
              {remainingIrr > 0 && (
                <span className="tabular-nums">· {remainingIrr} irrenunciable{remainingIrr === 1 ? '' : 's'}</span>
              )}
            </div>
          </div>
        )}

        <ul className="space-y-0.5" aria-label="Calendario de feriados">
          {groups.map((group) => (
            <li key={group.key} className="list-none">
              <p className="mt-3 mb-1 px-2.5 text-[11px] font-semibold uppercase tracking-wider text-base-content/60">
                {group.label}
              </p>
              <ul className="space-y-0.5">
                {group.items.map((h, i) => {
                  const past = isPast(h.date);
                  const today = isToday(h.date);
                  const showTodayMarker = !past && !todayMarkerShown;
                  if (showTodayMarker) todayMarkerShown = true;

                  return (
                    <li key={`${group.key}-${i}`} className="list-none">
                      {showTodayMarker && !today && (
                        <div className="flex items-center gap-2 px-2.5 py-1.5" aria-hidden="true">
                          <span className="h-px flex-1 bg-primary/40" />
                          <span className="text-[11px] font-medium text-primary">Hoy</span>
                          <span className="h-px flex-1 bg-primary/40" />
                        </div>
                      )}
                      <div
                        className={`flex items-center gap-3 p-2.5 rounded-xl ${
                          today
                            ? 'bg-primary/10 ring-1 ring-inset ring-primary/20'
                            : past
                              ? ''
                              : 'hover:bg-base-200 transition-colors'
                        }`}
                      >
                        <span
                          className={`text-xs tabular-nums w-[4.5rem] shrink-0 text-right ${
                            past ? 'text-base-content/45' : 'text-base-content/70'
                          }`}
                        >
                          <span className="inline-block w-7 text-left capitalize">{weekdayShort(h.date)}</span>
                          <span>{dayMonthShort(h.date)}</span>
                        </span>
                        <div className="min-w-0 flex-1">
                          <p
                            className={`text-sm text-pretty line-clamp-2 ${
                              past ? 'text-base-content/45' : today ? 'text-base-content font-medium' : 'text-base-content'
                            }`}
                          >
                            {h.title}
                          </p>
                        </div>
                        {h.inalienable && !past && (
                          <span className="text-[11px] text-primary-content font-medium shrink-0 bg-primary px-2 py-0.5 rounded-full">
                            Irrenunciable
                          </span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>

        <SectionSources section="holidays" />
      </div>
    );
  };

  return (
    <LoadSwap loading={loading} skeleton={skeleton} label="Cargando feriados…">
      {loading ? null : body()}
    </LoadSwap>
  );
}
