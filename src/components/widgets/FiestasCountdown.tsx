import { useState, useEffect } from 'react';
import { play } from '@/lib/sound';
import { ChileFlag } from '../ChileFlag';

interface TimeLeft {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

function compute(): { timeLeft: TimeLeft | null; phase: 'before' | 'celebration' | 'after' } {
  const now = new Date();
  const year = now.getFullYear();
  const sep18 = new Date(year, 8, 18);
  const sep20 = new Date(year, 8, 20, 23, 59, 59);

  if (now >= sep18 && now <= sep20) {
    return { timeLeft: null, phase: 'celebration' };
  }

  const target = now < sep18 ? sep18 : new Date(year + 1, 8, 18);
  const diff = target.getTime() - now.getTime();
  return {
    timeLeft: {
      days: Math.floor(diff / 86400000),
      hours: Math.floor((diff % 86400000) / 3600000),
      minutes: Math.floor((diff % 3600000) / 60000),
      seconds: Math.floor((diff % 60000) / 1000),
    },
    phase: now < sep18 ? 'before' : 'after',
  };
}

const GUIRNALDA_COUNT = 32;

const EMOJI_SETS = [
  [
    { emoji: '🥟', label: 'Empanada' },
    { emoji: '🍹', label: 'Terremoto' },
    { emoji: '🪁', label: 'Volantín' },
    { emoji: '💃', label: 'Cueca' },
    { emoji: '🎪', label: 'Ramada' },
  ],
  [
    { emoji: '/chile-flag.svg', label: '¡Viva Chile!', isFlag: true },
    { emoji: '🥩', label: 'Asado' },
    { emoji: '🍹', label: 'Terremoto' },
    { emoji: '🍻', label: 'Salud' },
    { emoji: '🔥', label: '¡Se prendió!' },
  ],
  [
    { emoji: '🛌', label: 'Tuto' },
    { emoji: '🤢', label: 'Caña' },
    { emoji: '🥣', label: 'Mariscal' },
    { emoji: '💸', label: 'Pato' },
    { emoji: '🗓️', label: 'Próximo año' },
  ],
];

export function Garland({
  count = GUIRNALDA_COUNT,
  maxOffset,
  maxRotation,
  flagSize,
  uCount = 4,
  className = '',
}: {
  count?: number;
  maxOffset: number;
  maxRotation: number;
  flagSize: string;
  uCount?: number;
  className?: string;
}) {
  return (
    <div
      className={`flex justify-between items-start overflow-visible min-h-[14px] sm:min-h-[28px] select-none ${className}`}
    >
      {Array.from({ length: count }, (_, i) => {
        const t = i / (count - 1);
        const yOffset = maxOffset * Math.sin(Math.PI * uCount * t) ** 2;
        const rotation = -maxRotation * Math.sin(2 * Math.PI * uCount * t);

        return (
          <span
            key={i}
            className={`inline-block ${flagSize} leading-none transition-transform duration-700`}
            style={{
              transform: `translateY(${yOffset}px) rotate(${rotation}deg)`,
            }}
          >
            <ChileFlag />
          </span>
        );
      })}
    </div>
  );
}

export function FiestasCountdown() {
  const [data, setData] = useState(() => compute());
  const [emojiSetIndex, setEmojiSetIndex] = useState(0);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    setData(compute());
    const id = setInterval(() => setData(compute()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)');
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const { timeLeft, phase } = data;
  const currentEmojis = EMOJI_SETS[emojiSetIndex];
  const maxOffset = isMobile ? 6 : 14;
  const maxRotation = isMobile ? 5 : 12;
  const flagSize = isMobile ? 'text-[9px]' : 'text-lg';

  return (
    <div className="rounded-2xl bg-base-200 border border-base-300 shadow-lg p-6 sm:p-8 overflow-hidden relative">
      <Garland
        maxOffset={maxOffset}
        maxRotation={maxRotation}
        flagSize={flagSize}
        className="-mx-6 sm:-mx-8 mb-4 sm:mb-6"
      />

      <h3 className="text-xl font-bold text-center text-balance text-base-content mb-1">
        Fiestas Patrias
      </h3>
      <p className="text-sm text-center text-base-content/70 mb-6">
        {phase === 'celebration' ? '¡Estamos en fiestas!' : '¿Cuánto falta para el 18?'}
      </p>

      {phase === 'celebration' ? (
        <div className="text-center py-6 animate-[fadeSlideIn_0.6s_ease-out]">
          <span className="text-6xl block mb-4 animate-[float_2.5s_ease-in-out_infinite]">🎉</span>
          <p className="text-4xl font-bold text-primary">
            ¡Feliz 18!
          </p>
          <p className="text-sm text-base-content/70 mt-2">
            Que disfrutes estas Fiestas Patrias
          </p>
          <p className="text-xs text-base-content/70 mt-1">
            ¡Viva Chile!
          </p>
        </div>
      ) : timeLeft && timeLeft.days > 0 ? (
        <div className="text-center">
          <div className="text-6xl sm:text-7xl font-light tabular-nums text-base-content leading-none">
            {timeLeft.days}
          </div>
          <div className="text-[11px] font-semibold text-base-content/70 mt-1 uppercase tracking-[0.2em]">
            días
          </div>
          <div className="text-xs sm:text-sm text-base-content/40 mt-3 tabular-nums">
            {String(timeLeft.hours)}h <span className="mx-0.5">·</span>{' '}
            {String(timeLeft.minutes).padStart(2, '0')}m{' '}
            <span className="mx-0.5">·</span>{' '}
            {String(timeLeft.seconds).padStart(2, '0')}s
          </div>
        </div>
      ) : timeLeft ? (
        <div className="text-center">
          <div className="text-xs font-semibold text-primary mb-1 uppercase tracking-[0.2em]">
            Últimas horas
          </div>
          <div className="text-5xl sm:text-6xl font-light tabular-nums text-base-content leading-none">
            <span>{String(timeLeft.hours).padStart(2, '0')}</span>
            <span className="text-3xl sm:text-4xl align-middle text-base-content/30 mx-1">:</span>
            <span>{String(timeLeft.minutes).padStart(2, '0')}</span>
            <span className="text-3xl sm:text-4xl align-middle text-base-content/30 mx-1">:</span>
            <span>{String(timeLeft.seconds).padStart(2, '0')}</span>
          </div>
          <div className="text-xs text-base-content/70 mt-2">
            para el 18 de septiembre
          </div>
        </div>
      ) : null}

      {phase === 'after' && (
        <p className="text-center text-xs text-base-content/70 mt-3">
          Hasta el próximo 18 de septiembre
        </p>
      )}

      <div className="h-px bg-gradient-to-r from-transparent via-base-content/20 to-transparent my-6" />

      <button
        onClick={() => { play('interaction.tap'); setEmojiSetIndex(i => (i + 1) % EMOJI_SETS.length); }}
        className="w-full focus:outline-none"
      >
        <div
          key={emojiSetIndex}
          className="flex justify-center gap-5 text-xl animate-[fadeSlideIn_0.3s_ease-out]"
        >
          {currentEmojis.map(({ emoji, label, isFlag }) => (
            <span
              key={label}
              title={label}
              className="inline-block transition-transform duration-200 hover:scale-110 active:scale-95 cursor-pointer"
            >
              {isFlag ? <ChileFlag /> : emoji}
            </span>
          ))}
        </div>
      </button>
    </div>
  );
}
