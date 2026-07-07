import { useEffect, useState } from 'react';

interface Holiday {
  date: string;
  title: string;
  type: string;
  inalienable: boolean;
  extra: string;
}

function parseLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function getNextHoliday(holidays: Holiday[]): Holiday | null {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return holidays.find((h) => {
    const d = parseLocalDate(h.date);
    d.setHours(0, 0, 0, 0);
    return d >= today;
  }) || null;
}

function formatDate(dateStr: string): string {
  const d = parseLocalDate(dateStr);
  return d.toLocaleDateString('es-CL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

function isPast(dateStr: string): boolean {
  const d = parseLocalDate(dateStr);
  d.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d < today;
}

export function HolidaysWidget() {
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/holidays')
      .then((r) => r.json())
      .then((data) => setHolidays(data.holidays || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="animate-pulse">
        <div className="rounded-xl bg-base-200 border border-base-300 p-5 mb-4 space-y-2">
          <div className="h-3 bg-base-300 rounded w-24" />
          <div className="h-5 bg-base-300 rounded w-48" />
          <div className="h-3 bg-base-300 rounded w-36" />
        </div>
        <div className="space-y-1">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 p-2.5 rounded-xl">
              <div className="h-3 w-12 bg-base-300 rounded shrink-0" />
              <div className="h-3 bg-base-300 rounded flex-1" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (holidays.length === 0) {
    return (
      <div className="rounded-xl bg-base-200 border border-base-300 p-8 text-center text-base-content/70 text-sm">
        Feriados no disponibles
      </div>
    );
  }

  const next = getNextHoliday(holidays);
  const pastHolidays = holidays.filter((h) => isPast(h.date));

  return (
    <div>
      {next && (
        <div className="rounded-xl bg-base-200 border border-base-300 shadow-sm p-5 mb-4 opacity-0 animate-[fadeSlideIn_0.3s_ease-out_forwards]">
          <p className="text-xs text-base-content/70 uppercase tracking-wider mb-1">Próximo feriado</p>
          <p className="text-lg font-bold text-balance text-base-content">{next.title}</p>
          <p className="text-sm text-base-content/70 mt-0.5">{formatDate(next.date)}</p>
          {next.inalienable && (
            <span className="inline-block mt-2 badge badge-xs badge-primary animate-pulse">Irrenunciable</span>
          )}
        </div>
      )}

      <div className="space-y-1">
        {holidays.map((h, i) => {
          const past = isPast(h.date);
          return (
            <div
              key={i}
              style={{ animationDelay: `${i * 40}ms` }}
              className={`flex items-center gap-3 p-2.5 rounded-xl opacity-0 animate-[fadeSlideIn_0.3s_ease-out_forwards] ${
                past
                  ? 'opacity-40 hover:opacity-60 transition-opacity'
                  : 'hover:bg-base-200 hover:ring-1 hover:ring-inset hover:ring-base-content/[0.05] transition-colors'
              }`}
            >
              <span className={`text-xs font-mono w-12 text-right shrink-0 ${past ? 'text-base-content/30' : 'text-base-content/70'}`}>
                {parseLocalDate(h.date).toLocaleDateString('es-CL', { day: 'numeric', month: 'short' })}
              </span>
              <div className="min-w-0 flex-1">
                <p className={`text-sm truncate ${past ? 'text-base-content/70' : 'text-base-content'}`}>
                  {h.title}
                </p>
              </div>
              {h.inalienable && !past && (
                <span className="text-[10px] text-primary-content font-medium shrink-0 bg-primary px-2 py-0.5 rounded-full">
                  Irrenunciable
                </span>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-3 text-right text-[10px] text-base-content/70">
        Fuentes:{' '}
        <a href="https://docs.boostr.cl/reference/holidays" target="_blank" rel="noopener noreferrer" className="hover:text-base-content underline underline-offset-2 transition-colors">Boostr</a>
        {' · '}
        <a href="https://date.nager.at" target="_blank" rel="noopener noreferrer" className="hover:text-base-content underline underline-offset-2 transition-colors">Nager.Date</a>
      </div>
    </div>
  );
}
