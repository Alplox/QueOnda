import type { MouseEvent } from 'react';
import type { CyberAlert, CyberSeverity, KevEntry } from '@/lib/cyber';

/** Fecha/hora estándar de obtención/publicación (sin abreviar a "hace X"). */
export function fmtAbsolute(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toLocaleString('es-CL', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** "2026-10-21" (fecha de CISA, sin hora) → "21 oct". */
export function fmtDay(day: string): string {
  const ms = Date.parse(`${day}T12:00:00Z`);
  if (!Number.isFinite(ms)) return day;
  return new Date(ms).toLocaleDateString('es-CL', { day: 'numeric', month: 'short' });
}

/** Lo mínimo que necesita el lector de artículos para abrir un feed en modal. */
export interface ReadableItem {
  title: string;
  url: string;
  description?: string;
  published?: string;
  source?: string;
}

const SEVERITY: Record<CyberSeverity, { label: string; className: string; dot: string }> = {
  critical: {
    label: 'Crítica',
    // El chip vive sobre base-100: con `bg-error/15` el texto quedaba en 4,29:1
    // a 10 px. Un fondo casi transparente mantiene el código de color y sube
    // el contraste por encima de 4,5:1 en todos los temas oscuros.
    className: 'bg-error/5 text-error border-error/35',
    dot: 'bg-error',
  },
  high: {
    label: 'Fraude',
    className: 'bg-warning/5 text-warning border-warning/35',
    dot: 'bg-warning',
  },
  info: {
    label: 'Info',
    className: 'bg-base-300/60 text-base-content/70 border-base-300',
    dot: 'bg-base-content/40',
  },
};

// La fila es un contenedor con dos acciones hermanas (nunca anidadas): el
// enlace que abre el sitio original y, si el feed se puede leer, el botón que
// abre el modal. Igual que las tarjetas de Noticias.
const ROW_SHELL =
  'group flex items-start gap-1 rounded-lg border border-base-300/70 bg-base-100 py-2 pl-2.5 transition-colors hover:border-primary/40';

const ROW_LINK =
  'min-w-0 flex-1 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

const META = 'mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-base-content/70';

const READER_BTN =
  'shrink-0 inline-flex items-center justify-center rounded-md p-1.5 text-base-content/70 transition-colors hover:bg-base-300/60 hover:text-primary active:scale-[0.95] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

function SeverityChip({ severity }: { severity: CyberSeverity }) {
  const config = SEVERITY[severity];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-[10px] font-semibold ${config.className}`}>
      <span className={`h-1 w-1 rounded-full ${config.dot}`} aria-hidden="true" />
      {config.label}
    </span>
  );
}

function pct(value: number): string {
  // EPSS nunca llega a 1 (0,99999 es lo máximo observable): redondearlo a 100 %
  // sugeriría certeza absoluta. El percentil sí puede ser 1 y se muestra tal cual.
  const shown = value < 1 ? Math.min(value, 0.999) : value;
  return `${new Intl.NumberFormat('es-CL', { maximumFractionDigits: 1 }).format(shown * 100)} %`;
}

function cvssLabel(value: number): string {
  return new Intl.NumberFormat('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value);
}

/** EPSS: probabilidad de explotación en 30 días. El color escala con el riesgo. */
function EpssChip({ epss, percentile }: { epss: number; percentile?: number }) {
  const className =
    epss >= 0.5
      ? 'border-error/35 bg-error/5 text-error'
      : epss >= 0.1
        ? 'border-warning/35 bg-warning/5 text-warning'
        : 'border-base-300 bg-base-300/60 text-base-content/70';
  return (
    <span
      className={`inline-flex items-center rounded-full border px-1.5 py-px text-[10px] font-semibold ${className}`}
      title={`EPSS: probabilidad de explotación en 30 días ${pct(epss)}${percentile != null ? ` · percentil ${pct(percentile)}` : ''}`}
    >
      EPSS {pct(epss)}
    </span>
  );
}

/** CVSS de NVD. El título lleva la severidad y el CWE para no sumar otra chip. */
function CvssChip({ cvss, severity, cwe }: { cvss: number; severity?: string; cwe?: string }) {
  return (
    <span
      className="inline-flex items-center rounded-full border border-base-300 bg-base-300/60 px-1.5 py-px text-[10px] font-semibold text-base-content/70"
      title={`CVSS ${cvssLabel(cvss)} · ${severity ?? 'sin severidad'}${cwe ? ` · ${cwe}` : ''}`}
    >
      CVSS {cvssLabel(cvss)}
    </span>
  );
}

function ReadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </svg>
  );
}

/**
 * El modal es la opción, no la puerta: el clic normal sigue abriendo el sitio
 * original en otra pestaña y este botón es para quien prefiere no salir.
 */
function ReaderButton({ title, onClick }: { title: string; onClick: (e: MouseEvent<HTMLButtonElement>) => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={READER_BTN}
      title="Leer en ventana flotante"
      aria-label={`Leer en modal: ${title}`}
    >
      <ReadIcon />
    </button>
  );
}

export function CyberAlertRow({ alert, onOpen }: { alert: CyberAlert; onOpen?: (item: ReadableItem, originRect: DOMRect) => void }) {
  return (
    <div className={`${ROW_SHELL} pr-1`}>
      <a href={alert.url} target="_blank" rel="noopener noreferrer" className={ROW_LINK}>
        <p className="text-sm font-medium leading-snug text-base-content text-pretty">{alert.title}</p>
        <div className={META}>
          <SeverityChip severity={alert.severity} />
          {alert.vendor && <span className="max-w-[45%] truncate">{alert.vendor}</span>}
          <span aria-hidden="true">·</span>
          <time dateTime={alert.published}>{fmtAbsolute(alert.published)}</time>
        </div>
      </a>
      {onOpen && (
        <ReaderButton
          title={alert.title}
          onClick={(e) => onOpen({ title: alert.title, url: alert.url, published: alert.published, source: 'CSIRT Nacional' }, e.currentTarget.getBoundingClientRect())}
        />
      )}
    </div>
  );
}

export function CyberKevRow({ entry }: { entry: KevEntry }) {
  // NVD es una ficha, no un artículo: no pasa por el lector.
  return (
    <a
      href={`https://nvd.nist.gov/vuln/detail/${entry.cve}`}
      target="_blank"
      rel="noopener noreferrer"
      className={`${ROW_SHELL} pr-2.5`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-mono text-[11px] font-semibold text-primary">{entry.cve}</span>
          {entry.ransomware && (
            <span className="inline-flex items-center gap-1 rounded-full border border-error/35 bg-error/5 px-1.5 py-px text-[10px] font-semibold text-error">
              <span className="h-1 w-1 rounded-full bg-error" aria-hidden="true" />
              Usada por ransomware
            </span>
          )}
          <span className="ml-auto shrink-0 text-[10px] text-base-content/70 transition-colors group-hover:text-primary">NVD ↗</span>
        </div>
        <p className="mt-0.5 text-sm font-medium leading-snug text-base-content text-pretty">{entry.name}</p>
        {(entry.epss != null || entry.cvss != null || entry.cwe) && (
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {entry.epss != null && <EpssChip epss={entry.epss} percentile={entry.epssPercentile} />}
            {entry.cvss != null && <CvssChip cvss={entry.cvss} severity={entry.cvssSeverity} cwe={entry.cwe} />}
            {entry.cwe && <span className="text-[10px] text-base-content/70">{entry.cwe}</span>}
          </div>
        )}
        {entry.descriptionEs && (
          <p className="mt-1 line-clamp-2 text-xs leading-snug text-base-content/70 text-pretty">{entry.descriptionEs}</p>
        )}
        <div className={META}>
          <span className="max-w-[50%] truncate">{entry.vendor}</span>
          {entry.product && (
            <>
              <span aria-hidden="true">·</span>
              <span className="max-w-[45%] truncate">{entry.product}</span>
            </>
          )}
          <span aria-hidden="true">·</span>
          <span>agregada {fmtDay(entry.added)}</span>
          {entry.due && (
            <>
              <span aria-hidden="true">·</span>
              <span>plazo {fmtDay(entry.due)}</span>
            </>
          )}
        </div>
      </div>
    </a>
  );
}

