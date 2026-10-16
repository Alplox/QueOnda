import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { play } from '@/lib/sound';

interface Props {
  videoId: string;
  title: string;
  author: string;
  /** URL canónica en youtube.com — se ofrece como salida al sitio original. */
  link: string;
  onClose: () => void;
}

/**
 * Reproductor embebido para no salir del dashboard. Mismo contrato de modal que
 * ArticleReader: portal, role=dialog, foco al abrir, trap de Tab, Escape, click
 * en el backdrop y foco restaurado al cerrar.
 */
export function VideoModal({ videoId, title, author, link, onClose }: Props) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = overlayRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    // El foco entra al botón de cerrar (no al iframe, que se llevaría el teclado).
    el?.querySelector<HTMLElement>('[data-autofocus]')?.focus?.();

    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      // Trap de Tab dentro del diálogo (el iframe del player también es alcanzable).
      if (e.key === 'Tab' && el) {
        const focusables = Array.from(
          el.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])'
          )
        ).filter((n) => n.offsetParent !== null || n === document.activeElement);
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (e.shiftKey && (active === first || active === el)) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
      }
    };

    window.addEventListener('keydown', handler);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      window.removeEventListener('keydown', handler);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus?.();
    };
  }, [onClose]);

  function handleOverlayClick(e: React.MouseEvent) {
    if (e.target === overlayRef.current) onClose();
  }

  return createPortal(
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-label="Reproductor de video"
      tabIndex={-1}
      onClick={(e) => { play('overlay.close'); handleOverlayClick(e); }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-neutral/70 backdrop-blur-sm p-3 sm:p-6 animate-[fadeSlideIn_0.2s_ease-out]"
    >
      <div className="relative w-full max-w-4xl rounded-xl bg-base-100 border border-base-300 shadow-2xl overflow-hidden animate-[fadeSlideIn_0.25s_ease-out] origin-center">
        <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-base-300">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-base-content line-clamp-2 leading-snug">{title}</p>
            {author && <p className="text-[10px] text-base-content/70 mt-0.5 truncate">{author}</p>}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <a
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => play('interaction.tap')}
              aria-label="Abrir en YouTube"
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded-full bg-primary text-primary-content hover:opacity-90 transition-all active:scale-[0.96]"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
              <span className="hidden sm:inline">Abrir en YouTube</span>
              <span className="sm:hidden">YouTube</span>
            </a>
            <button
              type="button"
              data-autofocus
              onClick={() => { play('overlay.close'); onClose(); }}
              className="p-1.5 rounded-lg hover:bg-base-200 hover:ring-1 hover:ring-inset hover:ring-base-content/[0.05] text-base-content/70 hover:text-base-content transition-all cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              aria-label="Cerrar"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="aspect-video bg-black">
          <iframe
            src={`https://www.youtube.com/embed/${encodeURIComponent(videoId)}?autoplay=1&rel=0`}
            title={title}
            className="w-full h-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
          />
        </div>
      </div>
    </div>,
    document.body
  );
}
