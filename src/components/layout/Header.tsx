import { useState, useEffect, useRef } from 'react';
import { ThemeSwitcher } from '../widgets/ThemeSwitcher';
import { SECTIONS, PRIMARY, OVERFLOW } from '../../lib/sections';
import { play } from '@/lib/sound';

export function Header() {
  const [visible, setVisible] = useState(true);
  const [isDrawerOpen, setDrawerOpen] = useState(false);
  const [isMoreOpen, setMoreOpen] = useState(false);
  const [activeSection, setActiveSection] = useState('');
  const lastScrollY = useRef(0);
  const moreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleScroll = () => {
      const currentY = window.scrollY;
      if (currentY < 56 || currentY < lastScrollY.current) {
        setVisible(true);
      } else if (currentY > lastScrollY.current) {
        setVisible(false);
      }
      lastScrollY.current = currentY;
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    const sections = document.querySelectorAll('section[id]');
    if (!sections.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const intersecting = entries.filter((e) => e.isIntersecting);
        if (intersecting.length > 0) {
          setActiveSection(intersecting[0].target.id);
        }
      },
      { rootMargin: '-80px 0px -65% 0px', threshold: 0 },
    );

    sections.forEach((s) => observer.observe(s));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  useEffect(() => {
    if (isDrawerOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isDrawerOpen]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawerOpen(false);
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, []);

  const handleNavClick = () => {
    play('navigation.forward');
    setVisible(true);
    setDrawerOpen(false);
    setMoreOpen(false);
  };

  return (
    <>
      <header
        className={`fixed top-0 left-0 right-0 z-50 bg-base-100/90 backdrop-blur-lg shadow-[0_1px_2px_-1px_var(--color-base-content)/0.08] transition-transform duration-300 ${
          visible ? 'translate-y-0' : '-translate-y-full'
        }`}
      >
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-1 min-w-0">
            <button
              onClick={() => { play(isDrawerOpen ? 'overlay.close' : 'overlay.open'); setDrawerOpen(!isDrawerOpen); }}
              className="md:hidden relative flex items-center justify-center w-9 h-9 text-base-content/70 hover:text-base-content rounded-lg hover:bg-base-200 transition-colors shrink-0"
              aria-label={isDrawerOpen ? 'Cerrar menú' : 'Abrir menú'}
            >
              <div className="relative w-5 h-5">
                <svg className="absolute inset-0 transition-all duration-200" style={{ opacity: isDrawerOpen ? 0 : 1, transform: `scale(${isDrawerOpen ? 0.25 : 1})` }} width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="3" y1="5" x2="17" y2="5" />
                  <line x1="3" y1="10" x2="17" y2="10" />
                  <line x1="3" y1="15" x2="17" y2="15" />
                </svg>
                <svg className="absolute inset-0 transition-all duration-200" style={{ opacity: isDrawerOpen ? 1 : 0, transform: `scale(${isDrawerOpen ? 1 : 0.25})` }} width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="5" y1="5" x2="15" y2="15" />
                  <line x1="15" y1="5" x2="5" y2="15" />
                </svg>
              </div>
            </button>

            <a href="#" onClick={() => play('interaction.tap')} className="flex items-center gap-1 text-xl font-bold text-base-content no-underline shrink-0 group/title">
              <span className="text-primary inline-block animate-[float_3s_ease-in-out_infinite] group-hover/title:animate-[float_1s_ease-in-out_infinite]">¿</span>
              <span>Qué Onda</span>
              <span className="text-primary inline-block animate-[float_3s_ease-in-out_infinite_0.5s] group-hover/title:animate-[float_1s_ease-in-out_infinite_0.5s]">?</span>
            </a>

            <nav className="hidden md:flex items-center gap-1 ml-2">
              {PRIMARY.map((section, i) => (
                <a
                  key={section.id}
                  href={`#${section.id}`}
                  onClick={handleNavClick}
                  style={{ animationDelay: `${i * 50}ms` }}
                  className={`px-3 py-1.5 text-sm rounded-lg whitespace-nowrap no-underline transition-transform active:scale-[0.97] opacity-0 animate-[fadeSlideIn_0.3s_ease-out_forwards] ${
                    activeSection === section.id
                      ? 'text-base-content font-semibold'
                      : 'text-base-content/70 hover:text-base-content hover:bg-base-200 hover:ring-1 hover:ring-inset hover:ring-base-content/[0.05]'
                    }`}
                  >
                    {section.label}
                  </a>
                ))}
              </nav>

              {OVERFLOW.length > 0 && (
              <div ref={moreRef} className="hidden md:relative md:block">
                <button
                  onClick={() => { play('overlay.expand'); setMoreOpen(!isMoreOpen); }}
                  className={`px-3 py-1.5 text-sm rounded-lg transition-colors whitespace-nowrap flex items-center gap-1 transition-transform active:scale-[0.97] ${
                    isMoreOpen
                      ? 'text-base-content bg-base-200'
                      : 'text-base-content/70 hover:text-base-content hover:bg-base-200 hover:ring-1 hover:ring-inset hover:ring-base-content/[0.05]'
                  }`}
                >
                  Más{' '}
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 12 12"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    className={`transition-transform ${isMoreOpen ? 'rotate-180' : ''}`}
                  >
                    <path d="M3 5l3 3 3-3" />
                  </svg>
                </button>
                {isMoreOpen && (
                  <div className="absolute top-full right-0 mt-1 w-40 bg-base-100 border border-base-300 rounded-xl shadow-2xl p-1.5 grid grid-cols-1 gap-0.5 z-50 animate-[fadeSlideIn_0.15s_ease-out]">
                    {OVERFLOW.map((section) => (
                      <a
                        key={section.id}
                        href={`#${section.id}`}
                        onClick={handleNavClick}
                        className={`px-3 py-2 text-sm rounded-lg transition-colors no-underline transition-transform active:scale-[0.97] ${
                           activeSection === section.id
                            ? 'text-base-content font-semibold bg-primary/10'
                            : 'text-base-content/70 hover:text-base-content hover:bg-base-200'
                        }`}
                      >
                        {section.label}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="shrink-0">
            <ThemeSwitcher />
          </div>
        </div>
      </header>

      {isDrawerOpen && (
        <div
          className="fixed inset-0 z-[55] bg-neutral/50 backdrop-blur-sm md:hidden"
          onClick={() => { play('overlay.close'); setDrawerOpen(false); }}
        />
      )}

      <div
        className={`fixed top-0 left-0 z-[60] h-full w-72 bg-base-100 border-r border-base-300 shadow-2xl transition-transform duration-300 md:hidden ${
          isDrawerOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between px-4 h-14 border-b border-base-300">
          <span className="text-lg font-bold text-base-content">Secciones</span>
          <button
            onClick={() => { play('overlay.close'); setDrawerOpen(false); }}
            className="flex items-center justify-center w-9 h-9 text-base-content/70 hover:text-base-content rounded-lg hover:bg-base-200 transition-colors"
            aria-label="Cerrar menú"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="5" y1="5" x2="15" y2="15" />
              <line x1="15" y1="5" x2="5" y2="15" />
            </svg>
          </button>
        </div>
        <nav className="p-3 space-y-0.5 overflow-y-auto h-[calc(100%-3.5rem)]">
          {SECTIONS.map((section) => (
            <a
              key={section.id}
              href={`#${section.id}`}
              onClick={handleNavClick}
               className={`block px-3 py-2.5 text-sm rounded-lg transition-colors no-underline transition-transform active:scale-[0.97] ${
                  activeSection === section.id
                   ? 'text-base-content font-semibold bg-primary/10'
                   : 'text-base-content/70 hover:text-base-content hover:bg-base-200'
              }`}
            >
              {section.label}
            </a>
          ))}
        </nav>
      </div>
    </>
  );
}
