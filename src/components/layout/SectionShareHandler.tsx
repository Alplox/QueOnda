import { useEffect, useRef } from 'react';
import { play } from '@/lib/sound';
import { shareOrCopy } from '@/lib/share';

// One delegated listener for every [data-section-share] button rendered by <Section>.
// Lazy: a single client:idle island handles all section headers, zero per-section hydration.
export function SectionShareHandler() {
  const mounted = useRef(false);

  useEffect(() => {
    if (mounted.current) return;
    mounted.current = true;

    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const btn = target?.closest('button[data-section-share]') as HTMLButtonElement | null;
      if (!btn) return;
      const sectionId = btn.getAttribute('data-section-share');
      const title = btn.getAttribute('data-section-title') || 'Sección';
      if (!sectionId) return;

      const origin = window.location.origin;
      const url = `${origin}#${sectionId}`;
      shareOrCopy({ title, text: `${title} — ¿Qué Onda?`, url })
        .then((r) => {
          play(r === 'copied' || r === 'shared' ? 'interaction.confirm' : 'notification.error');
          showStatus(btn, r === 'copied' ? 'Enlace copiado' : r === 'shared' ? 'Compartido' : 'No se pudo compartir');
        });
    };

    const showStatus = (btn: HTMLButtonElement, msg: string) => {
      let span = btn.querySelector('span[data-section-status]') as HTMLSpanElement | null;
      if (!span) {
        span = document.createElement('span');
        span.setAttribute('data-section-status', '1');
        span.setAttribute('role', 'status');
        span.className =
          'absolute top-full right-0 mt-2 px-2.5 py-1 rounded-md text-[10px] font-semibold bg-primary text-primary-content shadow whitespace-nowrap opacity-0 transition-opacity duration-150';
        const parent = btn;
        parent.appendChild(span);
      }
      span.textContent = msg;
      span.style.opacity = '1';
      if ((span as unknown as { _t?: number })._t) clearTimeout((span as unknown as { _t: number })._t);
      (span as unknown as { _t?: number })._t = window.setTimeout(() => { span.style.opacity = '0'; }, 1600);
    };

    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);

  return null;
}
