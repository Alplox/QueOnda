import { useCallback, useEffect, useRef, useState } from 'react';
import { play } from '@/lib/sound';

// Reintento automático mientras un bloque está en error: 5 s → 10 s → 20 s → 30 s
// → 60 s (tope, se repite). Primero rápido porque el fallo típico es un corte
// momentáneo (red/CDN), y luego espaciado para no martillar el endpoint.
export const RETRY_BACKOFF_MS = [5_000, 10_000, 20_000, 30_000, 60_000];
export const retryDelayMs = (attempt: number) =>
  RETRY_BACKOFF_MS[Math.min(attempt, RETRY_BACKOFF_MS.length - 1)];

export interface ErrorRetry {
  /** Hay una petición de reintento en vuelo (manual o automática). */
  retrying: boolean;
  /** Segundos que faltan para el próximo reintento automático (0 = no hay). */
  retryIn: number;
  /** Reintento manual: no desmonta el bloque ni vuelve a skeleton. */
  retryNow: () => void;
}

// Un solo lugar para el «se cayó la carga»: cuenta atrás visible, backoff y
// guardia de petición en vuelo. `hasError` lo publica el widget desde su último
// fetch y `retry` debe ser estable (useCallback) — es el mismo fetch del bloque.
export function useErrorRetry(hasError: boolean, retry: () => Promise<void>): ErrorRetry {
  const [retrying, setRetrying] = useState(false);
  const [retryDue, setRetryDue] = useState<number | null>(null);
  const [failTick, setFailTick] = useState(0);
  const [clock, setClock] = useState(0);
  const attempt = useRef(0);

  // Un intento (manual o automático). El bloque sigue montado en todo momento:
  // nada de setLoading aquí, el skeleton solo es para la primera carga.
  const runAttempt = useCallback(
    async (resetBackoff: boolean) => {
      if (resetBackoff) attempt.current = 0;
      setRetryDue(null);
      setRetrying(true);
      try {
        await retry();
      } finally {
        setRetrying(false);
        // Un fallo con el error ya en true no cambia `hasError`; este tick rearma
        // el temporizador para que el backoff siga avanzando (5 s → 10 s → …).
        setFailTick((n) => n + 1);
      }
    },
    [retry],
  );

  const retryNow = useCallback(() => {
    if (retrying) return;
    play('interaction.tap');
    void runAttempt(true);
  }, [retrying, runAttempt]);

  useEffect(() => {
    if (!hasError) {
      attempt.current = 0;
      setRetryDue(null);
      return;
    }
    // Con la pestaña en segundo plano no se gastan intentos: al volver, el
    // auto-refresh compartido retoma la carga.
    if (typeof document !== 'undefined' && document.hidden) {
      setRetryDue(null);
      return;
    }
    const delay = retryDelayMs(attempt.current);
    setRetryDue(Date.now() + delay);
    setClock(Date.now());
    const t = window.setTimeout(() => {
      attempt.current += 1;
      void runAttempt(false);
    }, delay);
    return () => window.clearTimeout(t);
  }, [hasError, failTick, runAttempt]);

  // Tick del contador (solo mientras hay un reintento programado).
  useEffect(() => {
    if (!hasError || retryDue == null) return;
    const id = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [hasError, retryDue]);

  const retryIn = retryDue != null && clock > 0 ? Math.max(0, Math.ceil((retryDue - clock) / 1000)) : 0;

  return { retrying, retryIn, retryNow };
}
