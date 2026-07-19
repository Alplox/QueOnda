import { useState, useEffect, useRef, useMemo, type CSSProperties } from 'react';
import { play } from '@/lib/sound';
import { EmojiCard, type CardData } from './EmojiCard';
import { Emoji } from '../Emoji';
import { splitEmojiText } from '../../lib/emoji';

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

const EMOJI_COLLECTION: CardData[] = [
  {
    emoji: '🥟',
    name: 'Empaná de Pino',
    rarity: 'common',
    hp: 50,
    type: 'Tierra',
    attack: { name: 'Charchazo de Aceituna', damage: 30 }
  },
  {
    emoji: '🍹',
    name: 'Terremoto XXL',
    rarity: 'common',
    hp: 60,
    type: 'Agua',
    attack: { name: 'Réplica Nivel 8', damage: 40 }
  },
  {
    emoji: '🪁',
    name: 'Volantín Curao',
    rarity: 'common',
    hp: 45,
    type: 'Aire',
    attack: { name: 'Hilo Curado', damage: 25 }
  },
  {
    emoji: '💃',
    name: 'Cuequero Brígido',
    rarity: 'rare',
    hp: 80,
    type: 'Fiesta',
    attack: { name: 'Zapateo Mortal', damage: 55 }
  },
  {
    emoji: '🎪',
    name: 'Ramada',
    rarity: 'common',
    hp: 50,
    type: 'Tierra',
    attack: { name: 'Sillazo de Fonda', damage: 30 }
  },
  {
    emoji: '🥩',
    name: 'Maestro Parrillero',
    rarity: 'common',
    hp: 55,
    type: 'Fuego',
    attack: { name: 'Chuletazo', damage: 35 }
  },
  {
    emoji: '🔥',
    name: 'Brasero',
    rarity: 'common',
    hp: 70,
    type: 'Fuego',
    attack: { name: 'Carbón Encendido', damage: 50 }
  },
  {
    emoji: '🍻',
    name: 'Salú Compadre',
    rarity: 'rare',
    hp: 80,
    type: 'Agua',
    attack: { name: '¡Al Seco!', damage: 60 }
  },
  {
    emoji: '😴',
    name: 'Tuto Post Asado',
    rarity: 'common',
    hp: 30,
    type: 'Tierra',
    attack: { name: 'Ronquido Sísmico', damage: 15 }
  },
  {
    emoji: '🤢',
    name: 'Caña Monumental',
    rarity: 'common',
    hp: 40,
    type: 'Agua',
    attack: { name: 'Guácala Suprema', damage: 20 }
  },
  {
    emoji: '🥣',
    name: 'Mariscal Levanta Muertos',
    rarity: 'common',
    hp: 45,
    type: 'Agua',
    attack: { name: 'Caldo Reparador', damage: 25 }
  },
  {
    emoji: '💸',
    name: 'Quedó Pato',
    rarity: 'common',
    hp: 50,
    type: 'Tierra',
    attack: { name: 'Billetera Vacía', damage: 30 }
  },
  {
    emoji: '🗓️',
    name: 'El Lunes Empiezo',
    rarity: 'rare',
    hp: 85,
    type: 'Fiesta',
    attack: { name: 'Patear pa\' Después', damage: 65 }
  },
  {
    emoji: '🇨🇱',
    name: 'Chile Campeón',
    rarity: 'legendary',
    isFlag: true,
    hp: 150,
    type: 'Fiesta',
    attack: { name: '¡Ceacheí!', damage: 99 }
  },
  {
    emoji: '🌭',
    name: 'Completo Italiano',
    rarity: 'common',
    hp: 55,
    type: 'Comida',
    attack: { name: 'Mayonesazo', damage: 35 }
  },
  {
    emoji: '🍟',
    name: 'Chorrillana',
    rarity: 'rare',
    hp: 90,
    type: 'Comida',
    attack: { name: 'Lluvia de Papas', damage: 60 }
  },
  {
    emoji: '🫓',
    name: 'Sopaipilla',
    rarity: 'common',
    hp: 45,
    type: 'Comida',
    attack: { name: 'Zapallo Giratorio', damage: 25 }
  },
  {
    emoji: '☕',
    name: 'Tecito',
    rarity: 'common',
    hp: 40,
    type: 'Agua',
    attack: { name: 'Hora de Once', damage: 20 }
  },
  {
    emoji: '🍞',
    name: 'Marraqueta',
    rarity: 'common',
    hp: 50,
    type: 'Tierra',
    attack: { name: 'Costra Crujiente', damage: 30 }
  },
  {
    emoji: '🧉',
    name: 'Mate del Sur',
    rarity: 'rare',
    hp: 80,
    type: 'Agua',
    attack: { name: 'Bombillazo', damage: 55 }
  },
  {
    emoji: '🦙',
    name: 'Llama Andina',
    rarity: 'rare',
    hp: 85,
    type: 'Tierra',
    attack: { name: 'Escupitajo Supremo', damage: 60 }
  },
  {
    emoji: '🦭',
    name: 'Lobo Marino',
    rarity: 'rare',
    hp: 95,
    type: 'Agua',
    attack: { name: 'Aletazo Costero', damage: 65 }
  },
  {
    emoji: '🦅',
    name: 'Cóndor',
    rarity: 'epic',
    hp: 110,
    type: 'Aire',
    attack: { name: 'Vuelo Cordillerano', damage: 75 }
  },
  {
    emoji: '🗿',
    name: 'Moái',
    rarity: 'legendary',
    hp: 140,
    type: 'Tierra',
    attack: { name: 'Mirada Milenaria', damage: 90 }
  },
  {
    emoji: '🌶️',
    name: 'Pebre',
    rarity: 'common',
    hp: 45,
    type: 'Fuego',
    attack: { name: 'Picor Nacional', damage: 30 }
  },
  {
    emoji: '🥪',
    name: 'Barros Luco',
    rarity: 'rare',
    hp: 80,
    type: 'Comida',
    attack: { name: 'Quesazo Derretido', damage: 55 }
  },
  {
    emoji: '🥤',
    name: 'Mote con Huesillo',
    rarity: 'rare',
    hp: 90,
    type: 'Agua',
    attack: { name: 'Huesillazo', damage: 60 }
  },
  {
    emoji: '🚌',
    name: 'Micro Amarilla',
    rarity: 'epic',
    hp: 120,
    type: 'Metal',
    attack: { name: 'Frenazo Brutal', damage: 80 }
  },
  {
    emoji: '🚇',
    name: 'Metro en Hora Punta',
    rarity: 'epic',
    hp: 100,
    type: 'Metal',
    attack: { name: 'Empujón Masivo', damage: 70 }
  },
  {
    emoji: '🐕',
    name: 'Quiltro',
    rarity: 'common',
    hp: 60,
    type: 'Tierra',
    attack: { name: 'Ladrido Callejero', damage: 35 }
  },
  {
    emoji: '🦜',
    name: 'Loro',
    rarity: 'common',
    hp: 45,
    type: 'Aire',
    attack: { name: 'Cahuín Infinito', damage: 30 }
  },
  {
    emoji: '🌧️',
    name: 'Invierno en Santiago',
    rarity: 'rare',
    hp: 90,
    type: 'Agua',
    attack: { name: 'Smog Húmedo', damage: 60 }
  },
  {
    emoji: '🏔️',
    name: 'Cordillera',
    rarity: 'epic',
    hp: 130,
    type: 'Tierra',
    attack: { name: 'Avalancha Andina', damage: 85 }
  },
  {
    emoji: '🌊',
    name: 'Pacífico',
    rarity: 'epic',
    hp: 120,
    type: 'Agua',
    attack: { name: 'Marejada', damage: 80 }
  },
  {
    emoji: '📢',
    name: 'Sapo',
    rarity: 'common',
    hp: 45,
    type: 'Fiesta',
    attack: { name: 'Acusete', damage: 25 }
  },
  {
    emoji: '🤙',
    name: 'Weón',
    rarity: 'rare',
    hp: 90,
    type: 'Fiesta',
    attack: { name: '¡Wena Weón!', damage: 65 }
  },
  {
    emoji: '🤑',
    name: 'Cuico',
    rarity: 'epic',
    hp: 100,
    type: 'Fiesta',
    attack: { name: 'Tarjeta Black', damage: 70 }
  },
  {
    emoji: '🧢',
    name: 'Flaite',
    rarity: 'epic',
    hp: 100,
    type: 'Fiesta',
    attack: { name: 'Puro Corte', damage: 70 }
  },
  {
    emoji: '🦆',
    name: 'Pato Yáñez',
    rarity: 'legendary',
    hp: 150,
    type: 'Fiesta',
    attack: { name: 'Celebración Prohibida', damage: 95 }
  },
];

const MESSAGES = [
  { text: 'Preparando las empanadas', emoji: '🥟' },
  { text: 'Calentando la parrilla', emoji: '🔥' },
  { text: 'Buscando el volantín', emoji: '🪁' },
  { text: 'Practicando cueca', emoji: '💃' },
  { text: 'Contando los días', emoji: '🇨🇱' },
];

const CELEBRATION_MESSAGES = [
  { text: '¡Que no pare la fiesta!', emoji: '🎉' },
  { text: '¡Salud con el terremoto!', emoji: '🍹' },
  { text: '¡A bailar cueca!', emoji: '💃' },
  { text: '¡Fuego a la parrilla!', emoji: '🔥' },
];

const PREP_STATUS: { threshold: number; emoji: string; text: string; color: string }[] = [
  { threshold: 120, emoji: '🧊', text: 'Aún falta bastante', color: 'text-base-content/50' },
  { threshold: 60, emoji: '🪁', text: 'Ya se empieza a sentir septiembre', color: 'text-base-content/60' },
  { threshold: 30, emoji: '🥟', text: 'Hora de pensar en las empanadas', color: 'text-base-content/70' },
  { threshold: 15, emoji: '🔥', text: 'Prendan la parrilla', color: 'text-base-content/80' },
  { threshold: 7, emoji: '🍷', text: 'Comprando el terremoto', color: 'text-primary' },
  { threshold: 3, emoji: '💃', text: '¡Ensayando cueca!', color: 'text-primary' },
  { threshold: 1, emoji: '🇨🇱', text: '¡Mañana comienza la fiesta!', color: 'text-primary' },
];

function getProgress(): number {
  const now = new Date();
  const year = now.getFullYear();
  const sep18 = new Date(year, 8, 18);
  const CYCLE = 362;

  if (now < sep18) {
    const start = new Date(year - 1, 8, 21);
    return Math.min(100, Math.max(0, ((now.getTime() - start.getTime()) / (CYCLE * 86400000)) * 100));
  }
  const start = new Date(year, 8, 21);
  return Math.min(100, Math.max(0, ((now.getTime() - start.getTime()) / (CYCLE * 86400000)) * 100));
}

function getColorClasses(days: number): string {
  if (days <= 1) return 'text-red-500';
  if (days <= 7) return 'text-red-400';
  if (days <= 15) return 'text-orange-400';
  if (days <= 50) return 'text-amber-400';
  return 'text-base-content';
}

export function Garland({ className = '', enhanced = false }: { className?: string; enhanced?: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const isMobile = width < 640;
  const flagW = isMobile ? 9 : 14;
  const flagH = isMobile ? 13 : 20;
  const flagCount = isMobile ? 16 : 28;
  const sag = isMobile ? 7 : 14;
  const swagCount = isMobile ? 1 : 2;
  const svgH = sag + flagH + 6;

  const { pathD, flags } = useMemo(() => {
    if (width < 10) return { pathD: '', flags: [] as { x: number; y: number; angle: number; swayStyle: CSSProperties }[] };

    const segW = width / swagCount;
    const a = (segW * segW) / (8 * sag);

    function catenaryY(localX: number): number {
      return a * (Math.cosh(segW / (2 * a)) - Math.cosh((localX - segW / 2) / a));
    }

    const sampleN = 60;
    let d = '';
    for (let s = 0; s < swagCount; s++) {
      const offsetX = s * segW;
      for (let i = 0; i <= sampleN; i++) {
        const t = i / sampleN;
        const lx = t * segW;
        const x = offsetX + lx;
        const y = catenaryY(lx);
        d += (s === 0 && i === 0 ? 'M ' : ' L ') + x.toFixed(1) + ' ' + y.toFixed(1);
      }
    }

    const result: { x: number; y: number; angle: number; swayStyle: CSSProperties }[] = [];
    for (let i = 0; i < flagCount; i++) {
      const t = (i + 0.5) / flagCount;
      const x = t * width;
      const segIndex = Math.min(Math.floor(x / segW), swagCount - 1);
      const localX = x - segIndex * segW;
      const y = catenaryY(localX);

      const dx = 2;
      const slope = (catenaryY(localX + dx) - catenaryY(localX)) / dx;
      const angle = Math.atan(slope) * 0.15 * (180 / Math.PI);

      const dir = i % 3 === 0 ? -1 : i % 3 === 1 ? 1 : (i % 2 === 0 ? -1 : 1);
      const swayX = dir * (1 + (i % 3) * 0.5);
      const swayR = dir * (1 + (i % 4) * 0.4);
      const dur = 4 + (i % 5) * 0.4;
      result.push({
        x, y, angle,
        swayStyle: {
          '--sway-x': `${swayX.toFixed(1)}px`,
          '--sway-r': `${swayR.toFixed(1)}deg`,
          animation: `garlandSway ${(dur / (enhanced ? 1.6 : 1)).toFixed(1)}s ease-in-out ${(i * 80)}ms infinite`,
          transformOrigin: '0px 0px',
          willChange: 'transform' as const,
        } as React.CSSProperties,
      });
    }

    return { pathD: d, flags: result };
  }, [width, sag, flagCount, swagCount, enhanced]);

  return (
    <div ref={containerRef} className={`overflow-visible select-none ${className ?? ''}`}>
      {width > 0 && (
        <svg
          viewBox={`0 0 ${width} ${svgH}`}
          width={width}
          height={svgH}
          className="block overflow-visible"
          aria-hidden="true"
        >
          <path
            d={pathD}
            fill="none"
            stroke="currentColor"
            strokeOpacity={0.15}
            strokeWidth={1}
          />
          {flags.map((f, i) => (
            <g
              key={i}
              transform={`translate(${f.x.toFixed(1)},${f.y.toFixed(1)}) rotate(${f.angle.toFixed(2)})`}
            >
              <line x1={0} y1={0} x2={0} y2={2} stroke="currentColor" strokeOpacity={0.2} strokeWidth={0.5} />
              <image
                href="/chile-flag.svg"
                x={-flagW / 2}
                y={2}
                width={flagW}
                height={flagH}
                style={f.swayStyle}
              />
            </g>
          ))}
        </svg>
      )}
    </div>
  );
}

export function FiestasCountdown() {
  const [data, setData] = useState<{ timeLeft: TimeLeft | null; phase: 'before' | 'celebration' | 'after' } | null>(null);
  const [cardIndex, setCardIndex] = useState(() => Math.floor(Math.random() * EMOJI_COLLECTION.length));
  const [isMobile, setIsMobile] = useState(false);
  const [secTick, setSecTick] = useState(0);
  const [msgIndex, setMsgIndex] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [flipping, setFlipping] = useState(false);
  const [revealing, setRevealing] = useState(false);

  useEffect(() => {
    setData(compute());
    const id = setInterval(() => {
      const next = compute();
      setData(prev => {
        if (prev?.timeLeft && next.timeLeft && prev.timeLeft.seconds !== next.timeLeft.seconds) {
          setSecTick(t => t + 1);
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)');
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    const id = setInterval(() => setMsgIndex(i => i + 1), 8000);
    return () => clearInterval(id);
  }, []);

  const { timeLeft, phase } = data ?? { timeLeft: null, phase: 'before' as const };
  const currentCard = EMOJI_COLLECTION[cardIndex];

  const rollDice = () => {
    if (spinning || flipping) return;
    play('interaction.tap');
    setFlipping(true);
    setSpinning(true);
    setTimeout(() => {
      setCardIndex(prev => {
        let next = prev;
        while (next === prev) next = Math.floor(Math.random() * EMOJI_COLLECTION.length);
        return next;
      });
      setFlipping(false);
      setRevealing(true);
      setTimeout(() => setRevealing(false), 450);
      setTimeout(() => setSpinning(false), 250);
    }, 200);
  };
  const enhanced = !!timeLeft && timeLeft.days < 7 && phase === 'before';

  const displayMessage = phase === 'celebration'
    ? CELEBRATION_MESSAGES[msgIndex % CELEBRATION_MESSAGES.length]
    : MESSAGES[msgIndex % MESSAGES.length];

  const colorClass = timeLeft ? getColorClasses(timeLeft.days) : 'text-base-content';

  const prepStatus = phase === 'before' && timeLeft
    ? PREP_STATUS.find(p => timeLeft.days >= p.threshold) ?? PREP_STATUS[PREP_STATUS.length - 1]
    : phase === 'celebration'
      ? { emoji: '🎉', text: '¡Estamos celebrando!', color: 'text-primary' }
      : { emoji: '😴', text: 'Recuperándose del 18...', color: 'text-base-content/50' };

  const celebrationStyle = phase === 'celebration'
    ? { animation: 'fadeSlideIn 0.6s cubic-bezier(0.22, 1, 0.36, 1) forwards', transform: 'scale(0.92)', opacity: 0 }
    : undefined;

  return (
    <div className="rounded-2xl bg-base-200 border border-base-300 shadow-lg p-6 sm:p-8 overflow-hidden relative">
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-20 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-red-500/10 blur-3xl" />
        <div className="absolute bottom-0 right-0 h-56 w-56 rounded-full bg-blue-500/10 blur-3xl" />
      </div>

      <div className="relative">
        <Garland className="-mx-6 sm:-mx-8 mb-4 sm:mb-6" enhanced={enhanced} />

        <h3 className="text-xl font-bold text-center text-balance text-base-content mb-1">
          Fiestas Patrias
        </h3>
        <p
          key={msgIndex}
          className="text-sm text-center text-base-content/70 mb-6 animate-[fadeSlideIn_0.5s_ease-out]"
        >
          <Emoji emoji={displayMessage.emoji} className="inline-block h-[1em] align-text-bottom" /> {displayMessage.text}
        </p>

        {!data ? (
          <div className="text-center py-6">
            <div className="text-6xl sm:text-7xl font-light tabular-nums text-base-content/20 leading-none">--</div>
          </div>
        ) : phase === 'celebration' ? (
          <div className="text-center py-6" style={celebrationStyle}>
            <Emoji emoji="🎉" className="inline-block h-16 sm:h-20 mb-4 [animation:float_3s_ease-in-out_infinite]" />
            <p className="text-5xl sm:text-6xl font-bold text-primary tracking-[-0.02em]">
              ¡VIVA CHILE!
            </p>
            <p className="text-sm text-base-content/70 mt-3">
              {splitEmojiText('Que no falten 🥟🍹🥩💃🔥').map((part, i) =>
                part.type === 'emoji' ? <Emoji key={i} emoji={part.emoji} className="inline-block h-[1em] align-text-bottom" /> : part.value
              )}
            </p>
          </div>
        ) : timeLeft && timeLeft.days > 0 ? (
          <div className="text-center">
            <div className={`text-6xl sm:text-7xl font-light tabular-nums leading-none tracking-[-0.02em] transition-colors duration-1000 ${colorClass}`}>
              {timeLeft.days}
            </div>
            <div className="text-[11px] font-semibold text-base-content/70 mt-1 uppercase tracking-[0.2em]">
              días
            </div>
            <div className="text-xs sm:text-sm text-base-content/40 mt-3 tabular-nums">
              {String(timeLeft.hours)}h <span className="mx-0.5">·</span>{' '}
              {String(timeLeft.minutes).padStart(2, '0')}m{' '}
              <span className="mx-0.5">·</span>{' '}
              <span key={`s-${secTick}`} style={{ animation: 'tickPop 0.25s ease-out' }}>
                {String(timeLeft.seconds).padStart(2, '0')}s
              </span>
            </div>
          </div>
        ) : timeLeft ? (
          <div className="text-center">
            <div className="text-xs font-semibold text-primary mb-1 uppercase tracking-[0.2em]">
              Últimas horas
            </div>
            <div className="text-5xl sm:text-6xl font-light tabular-nums text-primary leading-none tracking-[-0.02em]">
              <span key={`h-${secTick}`} style={{ animation: 'tickPop 0.25s ease-out' }}>
                {String(timeLeft.hours).padStart(2, '0')}
              </span>
              <span className="text-3xl sm:text-4xl align-middle text-base-content/30 mx-1">:</span>
              <span key={`m-${secTick}`} style={{ animation: 'tickPop 0.25s ease-out' }}>
                {String(timeLeft.minutes).padStart(2, '0')}
              </span>
              <span className="text-3xl sm:text-4xl align-middle text-base-content/30 mx-1">:</span>
              <span key={`s-${secTick}`} style={{ animation: 'tickPop 0.25s ease-out' }}>
                {String(timeLeft.seconds).padStart(2, '0')}
              </span>
            </div>
            <div className="text-xs text-base-content/70 mt-2">
              para el 18 de septiembre
            </div>
          </div>
        ) : null}

        {phase === 'before' && timeLeft && (
          <div className="mt-5">
            <div className="flex justify-between text-[10px] text-base-content/50 mb-1">
              <span>Hoy</span>
              <span>18 de septiembre</span>
            </div>
            <div className="h-1.5 rounded-full bg-base-300 overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all duration-1000"
                style={{ width: `${Math.min(99.5, getProgress())}%` }}
              />
            </div>
          </div>
        )}

        <p className={`text-center text-xs mt-4 transition-colors duration-1000 ${prepStatus.color}`}>
          <Emoji emoji={prepStatus.emoji} className="inline-block h-[1em] align-text-bottom" /> {prepStatus.text}
        </p>

        <div className="h-px bg-gradient-to-r from-transparent via-base-content/20 to-transparent my-5" />

        <div className="flex flex-col items-center gap-3">
          <EmojiCard card={currentCard} flipping={flipping} revealing={revealing} />
          <div className="flex items-center gap-3">
            <span className="text-xs text-base-content/50 tabular-nums">
              {cardIndex + 1}/{EMOJI_COLLECTION.length}
            </span>
            <button
              onClick={rollDice}
              disabled={spinning}
              className="group flex items-center gap-1.5 rounded-full border border-base-300 bg-base-200 px-3 py-1.5 text-xs font-semibold text-base-content transition-all duration-200 hover:border-primary hover:bg-primary/10 hover:text-primary active:scale-95 disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-primary/40"
              title="Elegir al azar"
            >
              <svg
                viewBox="0 0 24 24"
                fill="currentColor"
                className={`h-4 w-4 transition-transform duration-300 ${spinning ? 'animate-spin' : 'group-hover:rotate-45'}`}
              >
                <rect x="3" y="3" width="18" height="18" rx="3" fill="none" stroke="currentColor" strokeWidth="1.5" />
                <circle cx="8" cy="8" r="1.2" />
                <circle cx="16" cy="8" r="1.2" />
                <circle cx="8" cy="16" r="1.2" />
                <circle cx="16" cy="16" r="1.2" />
                <circle cx="12" cy="12" r="1.2" />
              </svg>
              Lanzar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
