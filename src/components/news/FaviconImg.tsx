import { useState } from 'react';

const FALLBACKS = [
  // icon.horse responde 200 (con un ícono genérico si no lo tiene) para todos
  // los dominios del inventario, así que va primero: si arrancaba por Google,
  // cada favicon ausente dejaba un error de red en consola (audit
  // `errors-in-console`) y en el panel Issues de DevTools.
  (d: string) => `https://icon.horse/icon/${d}`,
  (d: string) => `https://icons.duckduckgo.com/ip3/${d}.ico`,
  (d: string) => `https://www.google.com/s2/favicons?domain=https://${d}&sz=32`,
];

export function FaviconImg({ domain, className }: { domain: string; className?: string }) {
  const [index, setIndex] = useState(0);
  const src = FALLBACKS[index](domain);
  return (
    <img
      src={src}
      alt=""
      className={className ?? 'w-4 h-4 rounded shrink-0'}
      loading="lazy"
      decoding="async"
      onError={() => setIndex(i => Math.min(i + 1, FALLBACKS.length - 1))}
    />
  );
}
