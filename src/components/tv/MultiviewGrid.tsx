import { useRef, useCallback, useState } from 'react';
import { MultiviewCell } from './MultiviewCell';
import type { Channel } from '../../types';
import { play } from '@/lib/sound';

export type MultiviewLayout = '1x3' | '2x2' | '2x3' | '3x3';

const LAYOUT_MAX: Record<MultiviewLayout, number> = {
  '1x3': 4, '2x2': 4, '2x3': 6, '3x3': 9,
};

export function maxSlots(layout: MultiviewLayout): number {
  return LAYOUT_MAX[layout];
}

interface Slot {
  channel: Channel;
  signalIndex: number;
}

interface Props {
  slots: Slot[];
  layout: MultiviewLayout;
  focusedSlot: number | null;
  onFocus: (index: number) => void;
  onRemove: (index: number) => void;
  onSignalChange: (index: number, signalIndex: number) => void;
  onReorder?: (fromIndex: number, toIndex: number) => void;
}

function EmptySlot({ index }: { index: number }) {
  return (
    <div className="relative rounded-xl border-2 border-dashed border-base-300/50 flex items-center justify-center aspect-video bg-base-100/50">
      <div className="text-center pointer-events-none">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="mx-auto mb-1 text-base-content/30">
          <path d="M12 5v14M5 12h14" />
        </svg>
        <p className="text-[9px] text-base-content/40">Agregar canal</p>
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

export function MultiviewGrid({ slots, layout, focusedSlot, onFocus, onRemove, onSignalChange, onReorder }: Props) {
  const gridRef = useRef<HTMLDivElement>(null);
  const dragIdxRef = useRef<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const handleDragStart = useCallback((e: React.PointerEvent, index: number) => {
    if (!gridRef.current || !onReorder) return;
    e.preventDefault();
    e.stopPropagation();
    dragIdxRef.current = index;
    setDragOverIndex(index);
    gridRef.current.setPointerCapture(e.pointerId);
    play('interaction.subtle');
  }, [onReorder]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (dragIdxRef.current === null) return;
    const target = slotIndexFromPoint(e.clientX, e.clientY);
    if (target !== null) setDragOverIndex(target);
  }, []);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    const fromIndex = dragIdxRef.current;
    dragIdxRef.current = null;
    setDragOverIndex(null);
    if (fromIndex === null) return;
    const target = slotIndexFromPoint(e.clientX, e.clientY);
    if (target !== null && target !== fromIndex && onReorder) {
      onReorder(fromIndex, target);
    }
  }, [onReorder]);

  function renderCell(index: number) {
    const s = slots[index];
    if (!s) return <EmptySlot index={index} />;
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
            onPointerDown={(ev) => handleDragStart(ev, index)}
            className="absolute -top-1 -left-1 z-30 w-5 h-5 flex items-center justify-center rounded-full bg-neutral/90 border border-white/15 text-white/50 hover:text-white hover:bg-neutral touch-none opacity-40 hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing"
            style={{ touchAction: 'none' }}
            title="Reordenar"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="9" cy="5" r="1.5"/><circle cx="15" cy="5" r="1.5"/>
              <circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/>
              <circle cx="9" cy="19" r="1.5"/><circle cx="15" cy="19" r="1.5"/>
            </svg>
          </button>
        )}
        {dragOverIndex === index && dragIdxRef.current !== null && dragIdxRef.current !== index && (
          <div className="absolute inset-0 z-20 rounded-xl ring-2 ring-primary ring-offset-2 ring-offset-base-100 pointer-events-none" />
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

  if (layout === '1x3') {
    return wrapper(
      <div className="grid grid-rows-[2fr_1fr] gap-2">
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
