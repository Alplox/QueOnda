import dataSources from '../lib/data-sources.json';

interface Source { name: string; url: string; links?: { label: string; url: string }[] }

export function SectionSources({ section, inline, only }: { section: string; inline?: boolean; only?: string[] }) {
  const sec = (dataSources as any).sections?.[section];
  if (!sec) return null;
  let sources: Source[] = sec.sources ?? [];
  if (only && only.length) sources = sources.filter((s) => only.includes(s.name));
  if (sources.length === 0) return null;
  const label: string = sources.length === 1 ? 'Fuente' : 'Fuentes';
  const content = (
    <>
      {label}:{' '}
      {sources.map((s, i) => (
        <span key={s.name}>
          {i > 0 && <>{' · '}</>}
          <a
            href={s.url}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-base-content underline underline-offset-2 transition-colors"
          >
            {s.name}
          </a>
          {Array.isArray(s.links) && s.links.map((l: { label: string; url: string }) => (
            <span key={l.url}>
              {' · '}
              <a
                href={l.url}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-base-content underline underline-offset-2 transition-colors"
              >
                {l.label}
              </a>
            </span>
          ))}
        </span>
      ))}
    </>
  );
  if (inline) return <span className="text-right">{content}</span>;
  return <div className="mt-2 text-right text-[11px] text-base-content/70">{content}</div>;
}
