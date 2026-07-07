import { useState } from 'react';
import { toggleMuted, isMuted, play } from '@/lib/sound';
import { ChileFlag } from '../ChileFlag';

export function Footer() {
  const [soundOff, setSoundOff] = useState(() => isMuted());

  function handleToggle() {
    const now = toggleMuted();
    setSoundOff(now);
    if (!now) play('interaction.tap');
  }

  return (
    <footer className="border-t border-base-300 py-8 mt-16">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-base-content/70">
          <div className="flex items-center gap-2">
            <span className="text-base-content font-bold">¿Qué Onda?</span>
            <span>- Chile en una sola página</span>
          </div>
          <div className="flex items-center gap-4">
            <button onClick={handleToggle}
              className="flex items-center gap-1.5 text-base-content/70 hover:text-base-content transition-colors cursor-pointer"
              title={soundOff ? 'Activar sonidos' : 'Silenciar sonidos'}
              aria-label={soundOff ? 'Activar sonidos' : 'Silenciar sonidos'}
            >
              {soundOff ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 5L6 9H2v6h4l5 4V5z" /><line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 5L6 9H2v6h4l5 4V5z" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
                </svg>
              )}
              <span className="text-xs">{soundOff ? 'Sin sonido' : 'Sonido'}</span>
            </button>
            <span className="text-base-content/70">|</span>
            <span>Hecho en Chile <ChileFlag /></span>
            <span className="text-base-content/70">|</span>
            <a href="/todas-las-fuentes" onClick={() => play('interaction.tap')} className="hover:text-base-content transition-colors no-underline">Todas las fuentes</a>
            <span className="text-base-content/70">|</span>
            <a href="https://github.com/Alplox/QueOnda" target="_blank" rel="noopener noreferrer" onClick={() => play('interaction.tap')} className="hover:text-base-content transition-colors underline underline-offset-2">⭐ Dar estrella en GitHub</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
