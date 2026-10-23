import { useState, useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { play } from '@/lib/sound';

const THEMES = [
  { id: 'dark', label: 'Dark' },
  { id: 'light', label: 'Light' },
  { id: 'halloween', label: 'Halloween' },
  { id: 'cupcake', label: 'Cupcake' },
  { id: 'bumblebee', label: 'Bumblebee' },
  { id: 'emerald', label: 'Emerald' },
  { id: 'corporate', label: 'Corporate' },
  { id: 'synthwave', label: 'Synthwave' },
  { id: 'retro', label: 'Retro' },
  { id: 'cyberpunk', label: 'Cyberpunk' },
  { id: 'valentine', label: 'Valentine' },
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
  const [current, setCurrent] = useState('halloween');
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', onKey);
    // Land on the active theme so arrow keys and Tab start from a known place
    ref.current
      ?.querySelector<HTMLElement>('[role="option"][aria-selected="true"]')
      ?.focus();
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function handleListKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    const items = Array.from(
      e.currentTarget.querySelectorAll<HTMLElement>('[role="option"]'),
    );
    const idx = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = e.key === 'ArrowDown' ? idx + 1 : idx - 1;
      items[(next + items.length) % items.length]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      items[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      items[items.length - 1]?.focus();
    }
  }

  function select(id: string) {
    play('interaction.tap');
    setCurrent(id);
    document.documentElement.setAttribute('data-theme', id);
    document.documentElement.classList.toggle('light-theme', getComputedStyle(document.documentElement).colorScheme.includes('light'));
    localStorage.setItem('theme', id);
    setOpen(false);
    triggerRef.current?.focus();
  }

  return (
    <div ref={ref} className="relative">
      <button
        ref={triggerRef}
        onClick={() => { if (!open) play('overlay.open'); else play('overlay.close'); setOpen(p => !p); }}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls="theme-listbox"
        aria-label="Cambiar tema"
        className="flex items-center gap-1.5 px-2 md:px-3 py-1.5 text-sm text-base-content/70 hover:text-base-content bg-base-200 hover:bg-base-300 hover:ring-1 hover:ring-inset hover:ring-base-content/[0.06] rounded-lg transition-colors border border-base-300"
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
        <div
          id="theme-listbox"
          role="listbox"
          aria-label="Temas"
          onKeyDown={handleListKeyDown}
          className="fixed md:absolute right-2 md:right-0 top-14 md:top-full md:mt-1 w-56 max-h-80 overflow-y-auto bg-base-300 border border-base-300 rounded-xl shadow-2xl z-[100] p-1.5 grid grid-cols-1 gap-0.5 animate-[fadeSlideIn_0.15s_ease-out]"
        >
          {THEMES.map(theme => (
              <button
                key={theme.id}
                role="option"
                aria-selected={current === theme.id}
                tabIndex={-1}
                onClick={() => select(theme.id)}
                className={`flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-sm text-left transition-colors ${
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