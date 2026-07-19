import { useState, useEffect, useRef } from 'react';
import { toggleMuted, isMuted, play } from '@/lib/sound';
import { ChileFlag } from '../ChileFlag';

function useFooterReveal() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { el.classList.add('visible'); obs.disconnect(); } },
      { threshold: 0.15 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return ref;
}

export function Footer() {
  const [soundOff, setSoundOff] = useState(() => isMuted());
  const ref = useFooterReveal();

  function handleToggle() {
    const now = toggleMuted();
    setSoundOff(now);
    if (!now) play('interaction.tap');
  }

  return (
    <footer className="relative -mt-48">
      <div ref={ref} className="footer-reveal relative overflow-hidden">
        {/* Background image */}
        <div
          className="absolute inset-0 bg-cover bg-center bg-no-repeat"
          style={{ backgroundImage: 'url(/img-footer.avif)' }}
          aria-hidden="true"
        />
        {/* Dark overlay for readability */}
        <div className="absolute inset-0 bg-base-100/75" aria-hidden="true" />
        {/* Top fade into page */}
        <div className="absolute inset-x-0 top-0 h-48 bg-gradient-to-b from-base-100 to-transparent" aria-hidden="true" />

        <div className="relative max-w-7xl mx-auto px-4 pt-56 pb-10 md:pt-56 md:pb-14">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-12">
            {/* Col 1: Brand */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-base-content font-bold text-lg">¿Qué Onda?</span>
                <ChileFlag />
              </div>
              <p className="text-sm text-base-content/60 leading-relaxed">
                Chile en una sola página.<br />
                Sin anuncios, sin ruido.
              </p>
            </div>

            {/* Col 2: Links */}
            <div className="flex flex-col gap-2 text-sm">
              <a href="/todas-las-fuentes" onClick={() => play('interaction.tap')} className="text-base-content/70 hover:text-base-content transition-colors underline underline-offset-2">Todas las fuentes</a>
              <a href="https://github.com/Alplox/QueOnda" target="_blank" rel="noopener noreferrer" onClick={() => play('interaction.tap')} className="text-base-content/70 hover:text-base-content transition-colors underline underline-offset-2">⭐ Dar estrella en GitHub</a>
            </div>

            {/* Col 3: Sound */}
            <div className="md:text-right">
              <button
                onClick={handleToggle}
                className="flex items-center gap-2 text-sm text-base-content/70 hover:text-base-content transition-colors cursor-pointer md:ml-auto"
                title={soundOff ? 'Activar sonidos' : 'Silenciar sonidos'}
                aria-label={soundOff ? 'Activar sonidos' : 'Silenciar sonidos'}
              >
                {soundOff ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 5L6 9H2v6h4l5 4V5z" /><line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" />
                  </svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 5L6 9H2v6h4l5 4V5z" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
                  </svg>
                )}
                <span>{soundOff ? 'Sin sonido' : 'Sonido'}</span>
              </button>
            </div>
          </div>

          {/* Bottom bar */}
          <div className="mt-10 pt-6 border-t border-base-content/10 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-base-content/50">
            <span>© {new Date().getFullYear()} ¿Qué Onda? Hecho en Chile.</span>
            <span>Foto: <a href="https://unsplash.com/es/fotos/manada-de-caballos-en-arbustos-y-pastos-a-traves-de-la-montana-Zf2mL1gtaVg" target="_blank" rel="noopener noreferrer" className="hover:text-base-content underline underline-offset-2 transition-colors">modernwolo</a></span>
          </div>
        </div>
      </div>
    </footer>
  );
}
