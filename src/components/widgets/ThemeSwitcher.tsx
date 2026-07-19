import { useState, useEffect, useRef } from 'react';
import { play } from '@/lib/sound';

const THEMES = [
  { id: 'dark', label: 'Dark', swatch: '#1d1d1d' },
  { id: 'light', label: 'Light', swatch: '#ffffff' },
  { id: 'cupcake', label: 'Cupcake', swatch: '#f0d6e8' },
  { id: 'bumblebee', label: 'Bumblebee', swatch: '#f5e642' },
  { id: 'emerald', label: 'Emerald', swatch: '#34d399' },
  { id: 'corporate', label: 'Corporate', swatch: '#4b6bfb' },
  { id: 'synthwave', label: 'Synthwave', swatch: '#ff7bed' },
  { id: 'retro', label: 'Retro', swatch: '#efd9b0' },
  { id: 'cyberpunk', label: 'Cyberpunk', swatch: '#ffb800' },
  { id: 'valentine', label: 'Valentine', swatch: '#e96d7b' },
  { id: 'halloween', label: 'Halloween', swatch: '#f28c18' },
  { id: 'garden', label: 'Garden', swatch: '#5e8d4a' },
  { id: 'forest', label: 'Forest', swatch: '#1a5c2a' },
  { id: 'aqua', label: 'Aqua', swatch: '#3abff8' },
  { id: 'lofi', label: 'Lo-fi', swatch: '#f5f5f5' },
  { id: 'pastel', label: 'Pastel', swatch: '#f4c2c2' },
  { id: 'fantasy', label: 'Fantasy', swatch: '#6f2da8' },
  { id: 'wireframe', label: 'Wireframe', swatch: '#d4d4d4' },
  { id: 'black', label: 'Black', swatch: '#000000' },
  { id: 'luxury', label: 'Luxury', swatch: '#c9a84c' },
  { id: 'dracula', label: 'Dracula', swatch: '#bd93f9' },
  { id: 'cmyk', label: 'CMYK', swatch: '#00b4d8' },
  { id: 'autumn', label: 'Autumn', swatch: '#d97a3e' },
  { id: 'business', label: 'Business', swatch: '#1c4e80' },
  { id: 'acid', label: 'Acid', swatch: '#84cc16' },
  { id: 'lemonade', label: 'Lemonade', swatch: '#f9e54a' },
  { id: 'night', label: 'Night', swatch: '#1e293b' },
  { id: 'coffee', label: 'Coffee', swatch: '#6f4e37' },
  { id: 'winter', label: 'Winter', swatch: '#9dd4ed' },
  { id: 'dim', label: 'Dim', swatch: '#334155' },
  { id: 'nord', label: 'Nord', swatch: '#88c0d0' },
  { id: 'sunset', label: 'Sunset', swatch: '#f97316' },
  { id: 'caramellatte', label: 'Caramel Latte', swatch: '#e8c49a' },
  { id: 'abyss', label: 'Abyss', swatch: '#0a1628' },
  { id: 'silk', label: 'Silk', swatch: '#e8dcd0' },
];

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
        className="flex items-center gap-2 px-3 py-1.5 text-sm text-base-content/70 hover:text-base-content bg-base-200 hover:bg-base-300 hover:ring-1 hover:ring-inset hover:ring-base-content/[0.06] rounded-lg transition-all border border-base-300"
      >
        <span
          className="w-3.5 h-3.5 rounded-full ring-1 ring-inset ring-base-content/10 shrink-0"
          style={{ background: THEMES.find(t => t.id === current)?.swatch }}
        />
        <span>Tema</span>
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
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-left transition-all ${
                  current === theme.id
                    ? 'bg-primary/25 text-base-content'
                    : 'text-base-content/70 hover:bg-base-200 hover:text-base-content hover:ring-1 hover:ring-inset hover:ring-base-content/[0.05]'
                }`}
              >
                <span
                  className={`w-4 h-4 rounded-full shrink-0 ${
                    current === theme.id ? 'ring-2 ring-primary ring-offset-2 ring-offset-base-300' : 'ring-1 ring-inset ring-base-content/10'
                  }`}
                  style={{ background: theme.swatch }}
                />
                <span className="flex-1">{theme.label}</span>
                {current === theme.id && (
                  <svg className="w-3.5 h-3.5 text-primary shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
          ))}
        </div>
      )}
    </div>
  );
}