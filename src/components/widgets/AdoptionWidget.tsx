import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { play } from '@/lib/sound';
import { SectionSources } from '../SectionSources';

interface Animal {
  id: number;
  nombre: string;
  tipo: string;
  edad: string;
  estado: string;
  genero: string;
  imagen: string;
  equipo: string;
  region: string;
  comuna: string;
  url: string;
}

const TIPOS = ['Todos', 'Perro', 'Gato', 'Conejo'] as const;
type Tipo = (typeof TIPOS)[number];

const API = 'https://huachitos.cl/api';
const DECK_SIZE = 5;
const HISTORY_LIMIT = 20;

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function AdoptionWidget() {
  const [all, setAll] = useState<Animal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [tipo, setTipo] = useState<Tipo>('Todos');
  const [deck, setDeck] = useState<Animal[]>([]);
  const [queue, setQueue] = useState<Animal[]>([]);
  const [discarded, setDiscarded] = useState<Animal[]>([]);
  const [batch, setBatch] = useState(0);
  const [flying, setFlying] = useState<'left' | 'right' | null>(null);
  const [hasInteracted, setHasInteracted] = useState(false);
  const [skipDir, setSkipDir] = useState<'left' | 'right'>('left');
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const movedRef = useRef(0);
  const dragRef = useRef({ x: 0, y: 0 });
  const topCardRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);

  const setOverlay = (opacity: number, animated = false) => {
    const el = overlayRef.current;
    if (!el) return;
    el.style.transition = animated ? 'opacity 150ms ease-out' : 'none';
    el.style.opacity = String(opacity);
  };
  const timerRef = useRef<number | null>(null);
  const deckRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLButtonElement>(null);

  const pool = useMemo(
    () => all.filter((a) => a.imagen && (tipo === 'Todos' || a.tipo === tipo)),
    [all, tipo],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');

    async function loadAnimals() {
      try {
        const firstRes = await fetch(`${API}/animales?page=1`);
        if (!firstRes.ok) throw new Error('Huachitos no respondió');
        const first = await firstRes.json();
        const list: Animal[] = first?.data ?? [];
        const lastPage = Number(first?.meta?.last_page ?? 1);

        if (lastPage > 1) {
          const rest = await Promise.all(
            Array.from({ length: lastPage - 1 }, (_, i) =>
              fetch(`${API}/animales?page=${i + 2}`)
                .then((r) => (r.ok ? r.json() : { data: [] }))
                .then((d) => (d?.data ?? []) as Animal[])
                .catch(() => [] as Animal[]),
            ),
          );
          for (const page of rest) list.push(...page);
        }

        if (!cancelled) setAll(list);
      } catch {
        if (!cancelled) setError('No se pudo cargar la lista de adopción');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadAnimals();
    return () => { cancelled = true; };
  }, [reload]);

  // Cada cambio de filtro (o la primera carga) reparte una baraja nueva.
  useEffect(() => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    if (!pool.length) {
      setDeck([]);
      setQueue([]);
      setDiscarded([]);
      setFlying(null);
      return;
    }

    const shuffled = shuffle(pool);
    setDeck(shuffled.slice(0, DECK_SIZE));
    setQueue(shuffled.slice(DECK_SIZE));
    setDiscarded([]);
    setBatch((b) => b + 1);
    if (topCardRef.current) topCardRef.current.style.transform = 'translate3d(0px, 0px, 0) rotate(0deg)';
    setFlying(null);
  }, [pool]);

  // Precarga las siguientes imágenes para evitar decodificación en pleno gesto.
  useEffect(() => {
    queue.slice(0, 3).forEach((a) => {
      const img = new Image();
      img.decoding = 'async';
      img.src = a.imagen;
      img.decode?.().catch(() => {});
    });
  }, [queue]);

  useEffect(() => () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
  }, []);

  useEffect(() => {
    if (deck.length === 0 && hasInteracted) endRef.current?.focus();
  }, [deck.length, hasInteracted]);

  const top = deck[0];

  const advance = (dir: 'left' | 'right') => {
    const el = topCardRef.current;
    if (!top || flying || !el) return;
    setHasInteracted(true);
    setFlying(dir);
    play('navigation.tab');

    el.style.transition = 'transform 280ms ease-in, opacity 220ms ease-out';
    el.style.transform = `translate3d(${dir === 'left' ? -140 : 140}%, 0, 0) rotate(${dir === 'left' ? -18 : 18}deg)`;
    el.style.opacity = '0';
    setOverlay(1);

    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      const rest = deck.slice(1);
      const [refill, ...remaining] = queue;
      setDeck(refill ? [...rest, refill] : rest);
      setQueue(remaining);
      setDiscarded((prev) => [top, ...prev].slice(0, HISTORY_LIMIT));
      setFlying(null);
      timerRef.current = null;
    }, 300);
  };

  const restore = (animal: Animal) => {
    if (!animal) return;
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setFlying(null);
    if (topCardRef.current) {
      topCardRef.current.style.transform = 'translate3d(0px, 0px, 0) rotate(0deg)';
      topCardRef.current.style.opacity = '1';
    }
    setDiscarded((prev) => prev.filter((a) => a.id !== animal.id));

    const without = deck.filter((a) => a.id !== animal.id);
    const nextDeck = [animal, ...without];
    if (nextDeck.length > DECK_SIZE) {
      const displaced = nextDeck.pop();
      if (displaced) setQueue((prev) => [displaced, ...prev]);
    }

    setDeck(nextDeck);
    setBatch((b) => b + 1);
    setHasInteracted(true);
    play('notification.info');
    window.setTimeout(() => deckRef.current?.focus(), 0);
  };

  const reshuffle = () => {
    if (!pool.length) return;
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    const shuffled = shuffle(pool);
    setDeck(shuffled.slice(0, DECK_SIZE));
    setQueue(shuffled.slice(DECK_SIZE));
    setDiscarded([]);
    setBatch((b) => b + 1);
    if (topCardRef.current) {
      topCardRef.current.style.transform = 'translate3d(0px, 0px, 0) rotate(0deg)';
      topCardRef.current.style.opacity = '1';
    }
    setFlying(null);
    setHasInteracted(false);
    play('overlay.open');
    window.setTimeout(() => deckRef.current?.focus(), 0);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('a,button')) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    startRef.current = { x: e.clientX, y: e.clientY };
    movedRef.current = 0;
    dragRef.current = { x: 0, y: 0 };
    if (topCardRef.current) topCardRef.current.style.transition = 'none';
    setOverlay(0);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!startRef.current) return;
    const dx = e.clientX - startRef.current.x;
    const dy = e.clientY - startRef.current.y;
    movedRef.current = dx;
    dragRef.current = { x: dx, y: dy };
    if (rafRef.current == null) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        const { x, y } = dragRef.current;
        if (topCardRef.current) {
          topCardRef.current.style.transform = `translate3d(${x}px, ${y}px, 0) rotate(${x * 0.06}deg)`;
        }
        setOverlay(Math.min(1, Math.max(0, (Math.abs(x) - 60) / 90)));
      });
    }
  };

  const onPointerUp = () => {
    if (!startRef.current) return;
    startRef.current = null;
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    const dx = movedRef.current;
    if (Math.abs(dx) > 150) {
      setOverlay(1);
      advance(dx > 0 ? 'right' : 'left');
    } else {
      setOverlay(0, true);
      if (topCardRef.current) {
        topCardRef.current.style.transition = 'transform 300ms cubic-bezier(0.2, 0.8, 0.2, 1)';
        topCardRef.current.style.transform = 'translate3d(0px, 0px, 0) rotate(0deg)';
      }
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[600px] flex-col">
        <div className="flex flex-1 flex-col items-center justify-center">
          <p className="sr-only" role="status">Cargando mascotas en adopción…</p>
          <div className="relative w-[min(86vw,320px)] aspect-[3/4]">
            {[2, 1, 0].map((i) => (
              <div
                key={i}
                className="absolute inset-0 rounded-3xl border border-base-300 bg-base-200 skel-shimmer"
                style={{ transform: `translateY(${i * 10}px) scale(${1 - i * 0.05})` }}
              />
            ))}
          </div>
        </div>
        <SectionSources section="adoption" />
      </div>
    );
  }

  if (error && !all.length) {
    return (
      <div className="flex min-h-[600px] flex-col">
        <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-base-300 bg-base-200 p-8 text-center">
          <p className="text-sm text-base-content/70">{error}</p>
          <p className="mt-2 text-xs text-base-content/60">
            También puedes ver los animales directamente en{' '}
            <a
              href="https://huachitos.cl"
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => play('interaction.confirm')}
              className="underline underline-offset-2 hover:text-base-content"
            >
              huachitos.cl
            </a>
            .
          </p>
          <button
            type="button"
            onClick={() => { play('interaction.tap'); setReload((n) => n + 1); }}
            className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-full bg-base-300 px-4 py-2 text-xs font-medium text-base-content transition-colors hover:bg-base-content/10 active:scale-[0.96]"
          >
            Reintentar
          </button>
        </div>
        <SectionSources section="adoption" />
      </div>
    );
  }

  return (
    <div className="flex min-h-[600px] flex-col">
      <div className="mb-3 flex flex-wrap gap-2">
        {TIPOS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => { play('navigation.tab'); setTipo(t); }}
            aria-pressed={tipo === t}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors active:scale-[0.96] ${
              tipo === t
                ? 'border-primary bg-primary text-primary-content'
                : 'border-base-300 bg-base-200 text-base-content hover:bg-base-300'
            }`}
          >
            {t}
          </button>
        ))}
        <span className="ml-auto self-center text-[11px] tabular-nums text-base-content/60">
          {pool.length} en adopción
        </span>
      </div>

      {pool.length === 0 ? (
        <div className="rounded-xl border border-base-300 bg-base-200 p-8 text-center text-sm text-base-content/70">
          No hay animales publicados en esta categoría.
        </div>
      ) : (
        <>
          <p id="adoption-swipe-hint" className="sr-only">
            Desliza la tarjeta a los lados, usa las flechas izquierda y derecha del teclado o el botón Saltar para pasar a la siguiente mascota.
          </p>

          <div className="relative w-full overflow-x-clip py-1">
            {deck.length === 0 ? (
              <div className="adoption-deck-in mx-auto flex aspect-[3/4] w-[min(86vw,320px)] flex-col items-center justify-center gap-3 rounded-3xl border border-dashed border-base-300 bg-base-200/60 p-6 text-center">
                <div className="flex items-center gap-1 text-primary" aria-hidden="true">
                  <svg className="h-8 w-8 -rotate-6" viewBox="-0.0 -12.5 257.9 257.9" fill="currentColor">
                    <g transform="translate(0.000000,233.000000) scale(0.100000,-0.100000)">
                      <path d="M833 2129 c-87 -43 -142 -143 -150 -272 -13 -197 77 -365 219 -413 177 -59 328 86 328 316 0 158 -88 318 -205 371 -55 26 -139 25 -192 -2z M1624 2096 c-130 -60 -215 -208 -218 -376 -2 -144 48 -239 148 -286 201 -94 414 130 393 411 -10 131 -55 211 -141 251 -65 30 -117 30 -182 0z M327 1655 c-51 -17 -83 -49 -115 -110 -23 -44 -26 -61 -26 -145 0 -75 5 -107 23 -153 49 -124 160 -217 260 -217 155 1 247 156 207 349 -26 126 -115 242 -211 274 -58 20 -87 21 -138 2z M2159 1591 c-49 -10 -98 -42 -153 -101 -184 -197 -127 -504 94 -504 179 0 335 238 291 445 -26 120 -117 183 -232 160z M1200 1369 c-69 -12 -170 -59 -228 -106 -24 -20 -74 -77 -111 -127 -37 -50 -116 -136 -175 -190 -167 -154 -208 -231 -209 -386 0 -155 65 -259 203 -324 59 -28 74 -31 165 -31 86 0 115 5 210 34 161 51 238 49 405 -10 117 -41 132 -44 230 -44 97 0 110 2 170 31 200 95 265 311 160 532 -23 49 -56 89 -148 180 -82 81 -131 140 -161 190 -81 139 -185 219 -320 248 -74 15 -111 16 -191 3z" />
                    </g>
                  </svg>
                  <svg className="h-6 w-6 -ml-1 mt-4 rotate-12" viewBox="-0.0 -12.5 257.9 257.9" fill="currentColor">
                    <g transform="translate(0.000000,233.000000) scale(0.100000,-0.100000)">
                      <path d="M833 2129 c-87 -43 -142 -143 -150 -272 -13 -197 77 -365 219 -413 177 -59 328 86 328 316 0 158 -88 318 -205 371 -55 26 -139 25 -192 -2z M1624 2096 c-130 -60 -215 -208 -218 -376 -2 -144 48 -239 148 -286 201 -94 414 130 393 411 -10 131 -55 211 -141 251 -65 30 -117 30 -182 0z M327 1655 c-51 -17 -83 -49 -115 -110 -23 -44 -26 -61 -26 -145 0 -75 5 -107 23 -153 49 -124 160 -217 260 -217 155 1 247 156 207 349 -26 126 -115 242 -211 274 -58 20 -87 21 -138 2z M2159 1591 c-49 -10 -98 -42 -153 -101 -184 -197 -127 -504 94 -504 179 0 335 238 291 445 -26 120 -117 183 -232 160z M1200 1369 c-69 -12 -170 -59 -228 -106 -24 -20 -74 -77 -111 -127 -37 -50 -116 -136 -175 -190 -167 -154 -208 -231 -209 -386 0 -155 65 -259 203 -324 59 -28 74 -31 165 -31 86 0 115 5 210 34 161 51 238 49 405 -10 117 -41 132 -44 230 -44 97 0 110 2 170 31 200 95 265 311 160 532 -23 49 -56 89 -148 180 -82 81 -131 140 -161 190 -81 139 -185 219 -320 248 -74 15 -111 16 -191 3z" />
                    </g>
                  </svg>
                </div>
                <p role="status" className="text-sm font-medium text-base-content">Ya viste todas las mascotas de esta categoría</p>
                <p className="text-xs text-base-content/60">Puedes empezar de nuevo con la baraja completa.</p>
                <button
                  ref={endRef}
                  type="button"
                  onClick={reshuffle}
                  className="mt-1 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-content transition-colors hover:bg-primary/90 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" />
                  </svg>
                  Rebarajar
                </button>
              </div>
            ) : (
              <div
                key={batch}
                ref={deckRef}
                className="adoption-deck-in relative mx-auto aspect-[3/4] w-[min(86vw,320px)] select-none rounded-3xl focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary [-webkit-tap-highlight-color:transparent]"
                role="group"
                aria-label="Baraja de mascotas en adopción"
                tabIndex={0}
                onKeyDown={(e) => {
                  if ((e.target as HTMLElement).closest('a,button')) return;
                  if (e.key === 'ArrowLeft') { e.preventDefault(); advance('left'); }
                  if (e.key === 'ArrowRight') { e.preventDefault(); advance('right'); }
                }}
              >
                {deck.map((a, index) => {
                  const isTop = index === 0;
                  const depth = index;
                  const dir = depth % 2 === 0 ? 1 : -1;
                  const behindTransform = `translate3d(${dir * (6 + depth * 7)}px, ${depth * 9}px, 0) scale(${1 - depth * 0.045}) rotate(${dir * (3 + depth * 1.5)}deg)`;

                  return (
                    <div
                      key={a.id}
                      ref={isTop ? topCardRef : undefined}
                      role={isTop ? 'article' : undefined}
                      aria-hidden={isTop ? undefined : true}
                      aria-label={isTop ? `${a.nombre}, ${a.tipo}, ${a.edad}, ${a.comuna}` : undefined}
                      aria-describedby={isTop ? 'adoption-swipe-hint' : undefined}
                      onDragStart={isTop ? (e) => e.preventDefault() : undefined}
                      onPointerDown={isTop ? onPointerDown : undefined}
                      onPointerMove={isTop ? onPointerMove : undefined}
                      onPointerUp={isTop ? onPointerUp : undefined}
                      onPointerCancel={isTop ? onPointerUp : undefined}
                      className={`absolute inset-0 select-none overflow-hidden rounded-3xl bg-base-300 ring-1 ring-base-content/10 ${
                        isTop
                          ? 'cursor-grab touch-none active:cursor-grabbing [-webkit-tap-highlight-color:transparent] will-change-transform shadow-lg'
                          : 'pointer-events-none shadow-lg'
                      }`}
                      style={{
                        zIndex: deck.length + 1 - index,
                        transform: isTop
                          ? 'translate3d(0px, 0px, 0) rotate(0deg)'
                          : behindTransform,
                        transition: 'transform 320ms cubic-bezier(0.2, 0.8, 0.2, 1)',
                      }}
                    >
                      <img
                        src={a.imagen}
                        alt={isTop ? `${a.nombre}, ${a.tipo}, ${a.edad}, ${a.comuna}` : ''}
                        draggable={false}
                        loading="eager"
                        className="h-full w-full object-cover"
                        decoding="async"
                      />

                      {!isTop && <div className="absolute inset-0 bg-black/40" />}

                      {isTop && (
                        <>
                          <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 bg-gradient-to-b from-black/80 to-transparent p-3 text-white">
                            <span className="rounded-full bg-black/45 px-2.5 py-1 text-[11px] font-medium backdrop-blur-sm">
                              {a.tipo}
                            </span>
                            <span className="rounded-full bg-black/45 px-2.5 py-1 text-[11px] font-medium backdrop-blur-sm">
                              {a.edad}
                            </span>
                          </div>

                          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/85 to-transparent p-4 pt-24 text-white">
                            <h3 className="text-balance text-xl font-semibold leading-tight">{a.nombre}</h3>
                            <p className="mt-0.5 text-xs text-white/80">
                              {a.edad} · {a.genero} · {a.comuna}
                            </p>
                            {a.equipo && (
                              <p className="mt-0.5 truncate text-[11px] text-white/65">{a.equipo}</p>
                            )}
                            <a
                              href={a.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={() => play('notification.success')}
                              className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-content transition-colors hover:bg-primary/90 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-content"
                            >
                              Ir a adoptar
                              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="M5 12h14M13 6l6 6-6 6" />
                              </svg>
                            </a>
                          </div>

                          {isTop && (
                            <div
                              ref={overlayRef}
                              style={{ opacity: 0 }}
                              className="pointer-events-none absolute inset-0 rounded-3xl border-4 border-red-500/70 bg-red-500/15"
                            >
                              <div className="absolute inset-0 flex items-center justify-center">
                                <svg className="h-16 w-16 text-red-500/90" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                  <polyline points="3 6 5 6 21 6" />
                                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                                  <path d="M10 11v6M14 11v6" />
                                  <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                                </svg>
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {deck.length > 0 && !hasInteracted && (
            <div className="mt-3 flex justify-center">
              <p className="inline-flex items-center gap-2 rounded-full border border-base-300 bg-base-200 px-3 py-1.5 text-[11px] font-medium text-base-content/70 sm:text-xs">
                <span className="adoption-swipe-left inline-block text-sm font-bold text-primary" aria-hidden="true">←</span>
                <span>Desliza la tarjeta a los lados</span>
                <span className="adoption-swipe-right inline-block text-sm font-bold text-primary" aria-hidden="true">→</span>
              </p>
            </div>
          )}

          {deck.length > 0 && (
            <div className="mt-4 flex items-center justify-center">
              <button
                type="button"
                onClick={() => {
                  advance(skipDir);
                  setSkipDir((d) => (d === 'left' ? 'right' : 'left'));
                }}
                className="inline-flex items-center gap-1.5 rounded-full border border-base-300 bg-base-200 px-4 py-2 text-xs font-medium text-base-content transition-colors hover:bg-base-300 active:scale-[0.96]"
                aria-label="Saltar la tarjeta"
              >
                Saltar
              </button>
            </div>
          )}

          {discarded.length > 0 && (
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  const animal = discarded[0];
                  if (animal) restore(animal);
                }}
                className="inline-flex shrink-0 items-center gap-1 rounded-full border border-base-300 bg-base-200 px-2.5 py-1.5 text-[11px] font-medium text-base-content transition-colors hover:bg-base-300 active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M3 7v6h6M21 17a9 9 0 0 0-15-6.7L3 13" />
                </svg>
                Deshacer
              </button>
              <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                <span className="shrink-0 text-[11px] text-base-content/60">Descartadas</span>
                {discarded.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => restore(a)}
                    aria-label={`Recuperar a ${a.nombre}`}
                    title={a.nombre}
                    className="h-9 w-9 shrink-0 overflow-hidden rounded-lg border border-base-300 bg-base-200 transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  >
                    <img src={a.imagen} alt="" loading="lazy" className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <SectionSources section="adoption" />
    </div>
  );
}
