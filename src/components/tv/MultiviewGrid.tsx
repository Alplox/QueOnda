import { useRef, useCallback, useState, useEffect } from 'react';
import { MultiviewCell } from './MultiviewCell';
import type { Channel } from '../../types';
import { play } from '@/lib/sound';

export type MultiviewLayout = '1x1' | '1x2' | '1x3' | '2x2' | '2x3' | '3x3';

const LAYOUT_MAX: Record<MultiviewLayout, number> = {
  '1x1': 2, '1x2': 3, '1x3': 4, '2x2': 4, '2x3': 6, '3x3': 9,
};

export function maxSlots(layout: MultiviewLayout): number {
  return LAYOUT_MAX[layout];
}

interface Slot {
  channel: Channel;
  signalIndex: number;
}

interface Props {
  slots: (Slot | null)[];
  layout: MultiviewLayout;
  focusedSlot: number | null;
  onFocus: (index: number) => void;
  onRemove: (index: number) => void;
  onSignalChange: (index: number, signalIndex: number) => void;
  onReorder?: (fromIndex: number, toIndex: number) => void;
  /** Arrastre externo de un canal desde la grilla hacia el multiview. */
  externalDragActive?: boolean;
  externalDragOver?: number | null;
}

function EmptySlot({ dropActive, dropHover }: { dropActive?: boolean; dropHover?: boolean }) {
  const active = !!dropActive;
  const hover = active && !!dropHover;
  return (
    <div
      className={`relative rounded-xl border-2 border-dashed flex items-center justify-center aspect-video transition-[border-color,background-color,transform,box-shadow] duration-150 ${
        hover
          ? 'border-primary bg-primary/15 shadow-[0_0_0_2px_color-mix(in_oklch,var(--color-primary)_35%,transparent)] scale-[1.02]'
          : active
            ? 'border-primary/70 bg-primary/5'
            : 'border-base-300/50 bg-base-100/50'
      }`}
      aria-label={active ? 'Espacio disponible: suelta aquí para agregar el canal' : undefined}
    >
      <div className="text-center pointer-events-none">
        {active ? (
          <>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`mx-auto mb-1 ${hover ? 'text-primary' : 'text-primary/80'}`}>
              <path d="M12 3v12" /><path d="m8 11 4 4 4-4" /><path d="M4 20h16" />
            </svg>
            <p className={`text-[11px] font-semibold ${hover ? 'text-primary' : 'text-primary/80'}`}>Soltar aquí</p>
          </>
        ) : (
          <>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="mx-auto mb-1 text-base-content/70">
              <path d="M12 5v14M5 12h14" />
            </svg>
            <p className="text-[11px] text-base-content/70">Agregar canal</p>
          </>
        )}
      </div>
    </div>
  );
}

function slotIndexFromPoint(x: number, y: number): number | null {
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  const slotEl = el.closest('[data-slot-index]');
  if (!slotEl) return null;
  const idx = parseInt(slotEl.getAttribute('data-slot-index') ?? '', 10);
  return isNaN(idx) ? null : idx;
}

export function MultiviewGrid({ slots, layout, focusedSlot, onFocus, onRemove, onSignalChange, onReorder, externalDragActive, externalDragOver, onDragOverPicker }: Props) {
  const gridRef = useRef<HTMLDivElement>(null);
  const dragIdxRef = useRef<number | null>(null);
  const dragGhostRef = useRef<HTMLElement | null>(null);
  const dragOverPickerRef = useRef(false);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const handleDragStart = useCallback((e: React.PointerEvent, index: number) => {
    if (!gridRef.current || !onReorder) return;
    e.preventDefault();
    e.stopPropagation();
    dragIdxRef.current = index;
    setDragOverIndex(index);
    gridRef.current.setPointerCapture(e.pointerId);
    play('interaction.subtle');

    const s = slots[index];
    if (s && !dragGhostRef.current) {
      const ghost = document.createElement('div');
      ghost.className = 'fixed z-[9999] w-20 h-20 rounded-xl bg-primary/80 text-primary-content flex items-center justify-center text-[11px] font-bold shadow-2xl pointer-events-none px-2 text-center leading-tight';
      ghost.textContent = s.channel.name.slice(0, 24);
      ghost.style.left = `${e.clientX - 40}px`;
      ghost.style.top = `${e.clientY - 40}px`;
      document.body.appendChild(ghost);
      dragGhostRef.current = ghost;
    }
  }, [onReorder, slots]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (dragIdxRef.current === null) return;
    if (dragGhostRef.current) {
      dragGhostRef.current.style.left = `${e.clientX - 40}px`;
      dragGhostRef.current.style.top = `${e.clientY - 40}px`;
    }
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const target = slotIndexFromPoint(e.clientX, e.clientY);
    if (target !== null) setDragOverIndex(target);
    const overPicker = target === null && !!el?.closest('[data-tv-channel-picker]');
    if (dragOverPickerRef.current !== overPicker) {
      dragOverPickerRef.current = overPicker;
      onDragOverPicker?.(overPicker);
    }
  }, [onDragOverPicker]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    const fromIndex = dragIdxRef.current;
    dragIdxRef.current = null;
    setDragOverIndex(null);
    if (dragOverPickerRef.current) {
      dragOverPickerRef.current = false;
      onDragOverPicker?.(false);
    }
    if (dragGhostRef.current) {
      dragGhostRef.current.remove();
      dragGhostRef.current = null;
    }
    if (fromIndex === null) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const target = slotIndexFromPoint(e.clientX, e.clientY);
    if (target !== null && target !== fromIndex && onReorder) {
      onReorder(fromIndex, target);
      return;
    }
    if (target === null && el?.closest('[data-tv-channel-picker]')) {
      onRemove(fromIndex);
      play('overlay.close');
    }
  }, [onReorder, onRemove, onDragOverPicker]);

  useEffect(() => () => {
    if (dragGhostRef.current) {
      dragGhostRef.current.remove();
      dragGhostRef.current = null;
    }
  }, []);

  const internalDragActive = dragOverIndex !== null;

  function renderCell(index: number) {
    const s = slots[index];
    const extActive = !!externalDragActive;
    const extHover = extActive && externalDragOver === index;
    const intHover = internalDragActive && dragOverIndex === index && dragIdxRef.current !== index;
    const dropHover = extHover || intHover;
    if (!s) return <EmptySlot dropActive={extActive || internalDragActive} dropHover={dropHover} />;
    return (
      <div className="relative group">
        <MultiviewCell
          channel={s.channel} signalIndex={s.signalIndex}
          focused={focusedSlot === index} onFocus={() => onFocus(index)}
          onRemove={() => onRemove(index)} onSignalChange={(si) => onSignalChange(index, si)}
        />
        {/* Drag handle — only if onReorder is provided */}
        {onReorder && (
          <button
            type="button"
            onPointerDown={(ev) => handleDragStart(ev, index)}
            aria-label="Reordenar canal (arrastrar)"
            className="absolute -top-1.5 -left-1.5 z-30 w-6 h-6 flex items-center justify-center rounded-full bg-neutral/90 border border-white/15 text-white/50 hover:text-white hover:bg-neutral touch-none opacity-40 hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing"
            style={{ touchAction: 'none' }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="9" cy="5" r="1.5"/><circle cx="15" cy="5" r="1.5"/>
              <circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/>
              <circle cx="9" cy="19" r="1.5"/><circle cx="15" cy="19" r="1.5"/>
            </svg>
          </button>
        )}
        {dropHover && (
          <div className="absolute inset-0 z-20 rounded-xl ring-2 ring-primary bg-primary/15 pointer-events-none flex items-center justify-center">
            <span className="rounded-full bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-content shadow">Soltar aquí</span>
          </div>
        )}
      </div>
    );
  }

  const wrapper = (content: React.ReactNode) => (
    <div
      ref={gridRef}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {content}
    </div>
  );

  const max = LAYOUT_MAX[layout];

  if (layout === '1x1') {
    return wrapper(
      <div className="grid grid-cols-1 gap-2">
        {[0, 1].map((i) => (
          <div key={i} data-slot-index={i}>{renderCell(i)}</div>
        ))}
      </div>
    );
  }

  if (layout === '1x2') {
    /* Filas por contenido: las celdas ya son 16:9, así que la de arriba mide el
       triple que las de abajo. Con `2fr 1fr` la fila inferior se estiraba a 2×
       su contenido (en 1x3 sobraba una franja muerta antes de la card de
       filtros, porque el `fr` se reparte sobre el alto máximo de la fila). */
    return wrapper(
      <div className="grid gap-2">
        <div data-slot-index={0}>{renderCell(0)}</div>
        <div className="grid grid-cols-2 gap-2">
          {[1, 2].map((i) => (
            <div key={i} data-slot-index={i}>{renderCell(i)}</div>
          ))}
        </div>
      </div>
    );
  }

  if (layout === '1x3') {
    /* Mismo criterio que 1x2: alto por contenido, no `2fr 1fr`. */
    return wrapper(
      <div className="grid gap-2">
        <div data-slot-index={0}>{renderCell(0)}</div>
        <div className="grid grid-cols-3 gap-2">
          {[1, 2, 3].map((i) => (
            <div key={i} data-slot-index={i}>{renderCell(i)}</div>
          ))}
        </div>
      </div>
    );
  }

  const gridClass: Record<string, string> = {
    '2x2': 'grid-cols-2',
    '2x3': 'grid-cols-2 sm:grid-cols-3',
    '3x3': 'grid-cols-2 sm:grid-cols-3',
  };

  const items: React.ReactNode[] = [];
  for (let i = 0; i < max; i++) {
    items.push(
      <div key={i} data-slot-index={i}>{renderCell(i)}</div>
    );
  }

  return wrapper(
    <div className={`grid gap-2 ${gridClass[layout]}`}>
      {items}
    </div>
  );
}
