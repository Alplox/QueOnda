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
          'absolute -top-7 -right-2 px-2.5 py-1 rounded-md text-[10px] font-semibold bg-primary text-primary-content shadow whitespace-nowrap opacity-0';
        btn.appendChild(span);
      }
      span.textContent = msg;
      // reset to hidden, force reflow, then replay the pop animation
      span.classList.add('opacity-0');
      span.classList.remove('queonda-toast');
      void span.offsetWidth;
      span.classList.remove('opacity-0');
      span.classList.add('queonda-toast');
    };

    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);

  return null;
}
