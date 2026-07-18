import { useState } from 'react';

const FALLBACKS = [
  (d: string) => `https://www.google.com/s2/favicons?domain=${d}&sz=16`,
  (d: string) => `https://icons.duckduckgo.com/ip3/${d}.ico`,
  (d: string) => `https://icon.horse/icon/${d}`,
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
