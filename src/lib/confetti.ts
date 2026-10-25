/**
 * Estallido de confeti en canvas, sin dependencias: lo mínimo del
 * `ConfettiButton` de Evil Buttons (que usa `canvas-confetti`) para celebrar
 * la carta revelada en Fiestas Patrias.
 *
 * Un único canvas `fixed` compartido por todos los bursts; se retira del DOM
 * cuando no quedan partículas, así no deja un elemento pegado al `body`.
 * Respeta `prefers-reduced-motion`: con esa preferencia no se dibuja nada.
 */

export interface BurstOptions {
  /** Partículas del estallido. */
  count?: number;
  /** Paleta (por defecto: rojo, blanco y azul de la bandera + dorado y cromo). */
  colors?: string[];
  /** Apertura del cono de salida, en grados. */
  spread?: number;
  /** Velocidad inicial, px por frame a 60 fps. */
  velocity?: number;
  /** Gravedad por frame a 60 fps. */
  gravity?: number;
}

const DEFAULT_COLORS = ['#d52b1e', '#ffffff', '#0039a6', '#f2c94c', '#e8f0fa'];

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  rot: number;
  vrot: number;
  color: string;
  age: number;
  ttl: number;
}

let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let particles: Particle[] = [];
let raf = 0;
let lastTime = 0;

function getContext(): CanvasRenderingContext2D | null {
  if (ctx && canvas) return ctx;
  if (typeof document === 'undefined') return null;

  canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText =
    'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:60';
  document.body.appendChild(canvas);

  ctx = canvas.getContext('2d');
  return ctx;
}

function syncSize() {
  if (!canvas || !ctx) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.floor(window.innerWidth * dpr);
  const h = Math.floor(window.innerHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function stop() {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  particles = [];
  ctx = null;
  canvas?.remove();
  canvas = null;
}

function drawFrame(now: number) {
  if (!ctx || !canvas) return;

  // dt normalizado a 60 fps: si el equipo va lento, el confeti no se arrastra.
  const dt = Math.min(2.5, Math.max(0.2, (now - lastTime) / 16.6667)) || 1;
  lastTime = now;

  syncSize();

  const width = window.innerWidth;
  const height = window.innerHeight;
  ctx.clearRect(0, 0, width, height);

  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.age += dt;
    p.vy += 0.28 * dt;
    p.vx *= 1 - 0.012 * dt;
    p.vy *= 1 - 0.008 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rot += p.vrot * dt;

    if (p.age > p.ttl || p.y > height + 40 || p.x < -40 || p.x > width + 40) {
      particles.splice(i, 1);
      continue;
    }

    const fade = Math.min(1, (p.ttl - p.age) / (p.ttl * 0.35));
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.fillStyle = p.color;
    ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
    ctx.restore();
  }

  if (particles.length === 0) {
    stop();
    return;
  }
  raf = requestAnimationFrame(drawFrame);
}

/**
 * Lanza un burst desde `target` (o el centro de la pantalla si es null).
 * No hace nada en SSR ni con `prefers-reduced-motion`.
 */
export function burstConfetti(target: Element | null, options: BurstOptions = {}): void {
  if (typeof window === 'undefined') return;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

  const context = getContext();
  if (!context || !canvas) return;

  const {
    count = 40,
    colors = DEFAULT_COLORS,
    spread = 70,
    velocity = 12,
  } = options;

  syncSize();

  const rect = target?.getBoundingClientRect();
  const originX = rect && rect.width > 0 ? rect.left + rect.width / 2 : window.innerWidth / 2;
  const originY = rect && rect.height > 0 ? rect.top + rect.height * 0.38 : window.innerHeight / 2;

  for (let i = 0; i < count; i++) {
    const angle = -Math.PI / 2 + ((Math.random() - 0.5) * spread * Math.PI) / 180;
    const speed = velocity * (0.45 + Math.random() * 0.85);
    const size = 5 + Math.random() * 6;
    particles.push({
      x: originX + (Math.random() - 0.5) * 14,
      y: originY + (Math.random() - 0.5) * 8,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      w: size,
      h: size * (0.4 + Math.random() * 0.8),
      rot: Math.random() * Math.PI,
      vrot: (Math.random() - 0.5) * 0.4,
      color: colors[Math.floor(Math.random() * colors.length)],
      age: 0,
      ttl: 60 + Math.random() * 50,
    });
  }

  if (!raf) {
    lastTime = performance.now();
    raf = requestAnimationFrame(drawFrame);
  }
}
