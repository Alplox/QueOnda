export interface Festivity {
  message: string;
  emoji?: string;
  flagSvg?: string;
  theme?: string;
}

type Range = { mStart: number; dStart: number; mEnd: number; dEnd: number };

function inRange(today: Date, r: Range): boolean {
  const t = (today.getMonth() + 1) * 100 + today.getDate();
  const s = r.mStart * 100 + r.dStart;
  const e = r.mEnd * 100 + r.dEnd;
  return t >= s && t <= e;
}

const LIST: Array<{ range: Range; data: Festivity }> = [
  { range: { mStart: 12, dStart: 24, mEnd: 12, dEnd: 24 }, data: { message: '¡Feliz Nochebuena!', emoji: '🎄', theme: 'festive-navidad' } },
  { range: { mStart: 12, dStart: 25, mEnd: 12, dEnd: 25 }, data: { message: '¡Feliz Navidad!', emoji: '🎄', theme: 'festive-navidad' } },
  { range: { mStart: 12, dStart: 31, mEnd: 12, dEnd: 31 }, data: { message: '¡Feliz Año Nuevo!', emoji: '🎉', theme: 'festive-ano-nuevo' } },
  { range: { mStart: 1, dStart: 1, mEnd: 1, dEnd: 1 }, data: { message: '¡Feliz Año Nuevo!', emoji: '🎉', theme: 'festive-ano-nuevo' } },
  { range: { mStart: 9, dStart: 17, mEnd: 9, dEnd: 19 }, data: { message: '¡Felices Fiestas Patrias!', flagSvg: '/chile-flag.svg', theme: 'festive-patrias' } },
  { range: { mStart: 2, dStart: 14, mEnd: 2, dEnd: 14 }, data: { message: 'Feliz Día de San Valentín', emoji: '💕' } },
  { range: { mStart: 5, dStart: 1, mEnd: 5, dEnd: 1 }, data: { message: 'Feliz Día del Trabajador' } },
  { range: { mStart: 5, dStart: 21, mEnd: 5, dEnd: 21 }, data: { message: 'Feliz Día de las Glorias Navales' } },
  { range: { mStart: 10, dStart: 31, mEnd: 10, dEnd: 31 }, data: { message: '¡Feliz Halloween!', emoji: '🎃' } },
];

export function getTodayFestivity(): Festivity | null {
  const today = new Date();
  for (const entry of LIST) {
    if (inRange(today, entry.range)) return entry.data;
  }
  return null;
}
