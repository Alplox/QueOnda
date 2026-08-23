import { useState, useEffect, useRef } from 'react';
import { play } from '@/lib/sound';

const THEMES = [
  { id: 'dark', label: 'Dark' },
  { id: 'light', label: 'Light' },
  { id: 'cupcake', label: 'Cupcake' },
  { id: 'bumblebee', label: 'Bumblebee' },
  { id: 'emerald', label: 'Emerald' },
  { id: 'corporate', label: 'Corporate' },
  { id: 'synthwave', label: 'Synthwave' },
  { id: 'retro', label: 'Retro' },
  { id: 'cyberpunk', label: 'Cyberpunk' },
  { id: 'valentine', label: 'Valentine' },
  { id: 'halloween', label: 'Halloween' },
  { id: 'garden', label: 'Garden' },
  { id: 'forest', label: 'Forest' },
  { id: 'aqua', label: 'Aqua' },
  { id: 'lofi', label: 'Lo-fi' },
  { id: 'pastel', label: 'Pastel' },
  { id: 'fantasy', label: 'Fantasy' },
  { id: 'wireframe', label: 'Wireframe' },
  { id: 'black', label: 'Black' },
  { id: 'luxury', label: 'Luxury' },
  { id: 'dracula', label: 'Dracula' },
  { id: 'cmyk', label: 'CMYK' },
  { id: 'autumn', label: 'Autumn' },
  { id: 'business', label: 'Business' },
  { id: 'acid', label: 'Acid' },
  { id: 'lemonade', label: 'Lemonade' },
  { id: 'night', label: 'Night' },
  { id: 'coffee', label: 'Coffee' },
  { id: 'winter', label: 'Winter' },
  { id: 'dim', label: 'Dim' },
  { id: 'nord', label: 'Nord' },
  { id: 'sunset', label: 'Sunset' },
  { id: 'caramellatte', label: 'Caramel Latte' },
  { id: 'abyss', label: 'Abyss' },
  { id: 'silk', label: 'Silk' },
];

function ThemePreview({ id }: { id: string }) {
  return (
    <div
      data-theme={id}
      aria-hidden="true"
      className="bg-base-100 grid shrink-0 grid-cols-2 gap-0.5 rounded-md p-1 shadow-sm ring-1 ring-inset ring-base-content/10"
    >
      <span className="bg-base-content size-1 rounded-full" />
      <span className="bg-primary size-1 rounded-full" />
      <span className="bg-secondary size-1 rounded-full" />
      <span className="bg-accent size-1 rounded-full" />
    </div>
  );
}

export function ThemeSwitcher() {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('dark');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const saved = localStorage.getItem('theme');
    if (saved && THEMES.some(t => t.id === saved)) {
      setCurrent(saved);
      document.documentElement.setAttribute('data-theme', saved);
      document.documentElement.classList.toggle('light-theme', getComputedStyle(document.documentElement).colorScheme.includes('light'));
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  function select(id: string) {
    play('interaction.tap');
    setCurrent(id);
    document.documentElement.setAttribute('data-theme', id);
    document.documentElement.classList.toggle('light-theme', getComputedStyle(document.documentElement).colorScheme.includes('light'));
    localStorage.setItem('theme', id);
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => { if (!open) play('overlay.open'); else play('overlay.close'); setOpen(p => !p); }}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="flex items-center gap-1.5 px-2 md:px-3 py-1.5 text-sm text-base-content/70 hover:text-base-content bg-base-200 hover:bg-base-300 hover:ring-1 hover:ring-inset hover:ring-base-content/[0.06] rounded-lg transition-all border border-base-300"
      >
        <span className="shrink-0">
          <ThemePreview id={current} />
        </span>
        <span className="hidden sm:inline">Tema</span>
        <svg className={`w-3.5 h-3.5 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="fixed md:absolute right-2 md:right-0 top-14 md:top-full md:mt-1 w-56 max-h-80 overflow-y-auto bg-base-300 border border-base-300 rounded-xl shadow-2xl z-[100] p-1.5 grid grid-cols-1 gap-0.5 animate-[fadeSlideIn_0.15s_ease-out]">
          {THEMES.map(theme => (
              <button
                key={theme.id}
                onClick={() => select(theme.id)}
                className={`flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-sm text-left transition-all ${
                  current === theme.id
                    ? 'bg-primary/25 text-base-content'
                    : 'text-base-content/70 hover:bg-base-200 hover:text-base-content hover:ring-1 hover:ring-inset hover:ring-base-content/[0.05]'
                }`}
              >
                <ThemePreview id={theme.id} />
                <span className="flex-1">{theme.label}</span>
                <svg
                  className={`w-3.5 h-3.5 text-primary shrink-0 ${current === theme.id ? 'visible' : 'invisible'}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  aria-hidden="true"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
              </button>
          ))}
        </div>
      )}
    </div>
  );
}