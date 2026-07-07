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
    <section id={id} className="scroll-mt-20">
      <div className="mb-5">
        <h2 className="text-2xl font-bold text-balance text-base-content">{letters}</h2>
        {subtitle && <p className="section-subtitle text-sm text-base-content/70 mt-1 text-pretty">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}
