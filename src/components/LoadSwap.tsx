import { useEffect, useState, type ReactNode } from 'react';

/**
 * Duración del fundido cruzado en ms. Debe ir con `.load-ghost-out`
 * (global.css): el esqueleto y el contenido se cruzan en el mismo tiempo.
 */
const FADE_MS = 220;

type LoadSwapProps = {
  /** true mientras no hay datos: se pinta `skeleton` en flujo. */
  loading: boolean;
  /** Esqueleto con el alto ya reservado del bloque real. */
  skeleton: ReactNode;
  /** Contenido real (sólo se monta cuando `loading` es false). */
  children: ReactNode;
  /** Texto que anuncia el lector de pantalla durante la carga. */
  label?: string;
  className?: string;
};

/**
 * Fundido cruzado carga → contenido.
 *
 * El esqueleto NO se desmonta en el instante en que llegan los datos: se queda
 * montado, encima del contenido, y se apaga con opacidad mientras el contenido
 * aparece debajo. Desmontarlo de golpe dejaba un hueco del color del fondo
 * entre el último `skel-shimmer` y el primer frame del contenido, que se lee
 * como un parpadeo (más notorio mientras más grande el bloque).
 *
 * Como es el mismo nodo durante carga y fundido, el pulso del esqueleto no se
 * reinicia: se apaga desde la fase en la que iba. No hay nada que esperar
 * porque el pulso es infinito, y el fundido arranca en el instante en que
 * llegan los datos (frame 0 propio, sin retardo).
 *
 * Ambos hijos comparten celda de grilla (`[grid-area:1/1]`), así el alto del
 * bloque durante el cruce es el mayor de los dos y no se duplica.
 */
export function LoadSwap({ loading, skeleton, children, label, className = '' }: LoadSwapProps) {
  const [wasLoading, setWasLoading] = useState(loading);
  const [ghost, setGhost] = useState(false);

  // Ajuste durante el render (patrón de React para props que cambian): así el
  // esqueleto entra en el MISMO commit que el contenido. Si esto se hiciera en
  // un efecto, el primer frame saldría sin esqueleto, volvería a montarse (con
  // el pulso reiniciado) y se vería un destello de más.
  if (loading !== wasLoading) {
    setWasLoading(loading);
    // Acaba de llegar el contenido → mantener el esqueleto el fundido.
    // Vuelve a cargar (reintento/refresco) → no hay nada que fundir.
    setGhost(!loading);
  }

  useEffect(() => {
    if (!ghost) return;
    const timer = window.setTimeout(() => setGhost(false), FADE_MS);
    return () => window.clearTimeout(timer);
  }, [ghost]);

  return (
    <div className={`grid min-w-0 ${className}`} aria-busy={loading || undefined}>
      {(loading || ghost) && (
        <div
          key="skeleton"
          aria-hidden={ghost ? true : undefined}
          className={`min-w-0 [grid-area:1/1] ${ghost ? 'load-ghost-out' : ''}`}
        >
          {loading && label && <p className="sr-only" role="status">{label}</p>}
          {skeleton}
        </div>
      )}
      {!loading && (
        <div key="content" className="min-w-0 [grid-area:1/1] load-in">
          {children}
        </div>
      )}
    </div>
  );
}
