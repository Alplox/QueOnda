// Shared Chile-local time parsing used by both the server (/api/emergency) and the
// client (EmergencyWidget) so that Boostr/Gael coordinates match by the same epoch.
//
// Gael/Boostr send "Fecha" / "date hour" as Chile local time with no offset; servers
// (Workers) run UTC, so a naive parse shifts every sismo by the TZ offset (looks
// "stale" by ~4h). This solves epoch = naive - offset(epoch) with 2 passes (DST-safe)
// and is host-TZ-independent because it's pure arithmetic relative to UTC.

const CHILE_TZ = 'America/Santiago';

const chileParts = new Intl.DateTimeFormat('en-US', {
  timeZone: CHILE_TZ,
  hour12: false,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

export function parseChileLocal(dateStr: string): number {
  const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return Date.parse(dateStr);
  const naive = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  const offset = (epoch: number) => {
    const p = chileParts.formatToParts(new Date(epoch));
    const get = (t: string) => Number(p.find((x) => x.type === t)?.value ?? 0);
    return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) - epoch;
  };
  let epoch = naive;
  for (let i = 0; i < 2; i++) epoch = naive - offset(epoch);
  return epoch;
}
