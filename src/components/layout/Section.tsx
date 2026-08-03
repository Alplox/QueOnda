import type { ReactNode } from 'react';

interface Props {
  id: string;
  title: string;
  subtitle?: string;
  children: ReactNode;
}

export function Section({ id, title, subtitle, children }: Props) {
  const letters = title.split('').map((char, i) => (
    <span
      key={i}
      className="letter"
      style={{ transitionDelay: `${i * 30}ms` }}
    >
      {char === ' ' ? '\u00A0' : char}
    </span>
  ));

  return (
    <section id={id} className="scroll-mt-[104px]">
      <div className="flex items-center justify-between gap-3 mb-5">
        <div>
          <div className="flex items-center gap-3 min-w-0">
            <h2 className="text-2xl font-bold text-balance text-base-content">{letters}</h2>
            <button
              type="button"
              data-section-share={id}
              data-section-title={title}
              aria-label={`Compartir sección ${title}`}
              title={`Compartir sección ${title}`}
              className="relative flex items-center justify-center w-9 h-9 text-base-content/70 hover:text-base-content rounded-lg hover:bg-base-200 transition-colors shrink-0 cursor-pointer"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="18" cy="5" r="3" />
                <circle cx="6" cy="12" r="3" />
                <circle cx="18" cy="19" r="3" />
                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
              </svg>
            </button>
          </div>
          {subtitle && <p className="section-subtitle text-sm text-base-content/70 mt-1 text-pretty">{subtitle}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}
