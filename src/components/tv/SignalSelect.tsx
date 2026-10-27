import { play } from '@/lib/sound';

const SIGNAL_LABEL: Record<string, string> = {
  m3u8: 'HD', iframe: 'WEB', youtube: 'YT Live', 'youtube-vod': 'YT VOD', twitch: 'Twitch',
};

interface Props {
  signals: { type: string; url: string }[];
  signalIndex: number;
  onChange: (index: number) => void;
  className?: string;
}

/* Selector de señal compacto para los contenedores chicos (celdas del multiview
   y miniplayer). Ahí la fila de chips no cabe — empujaba el nombre y el botón de
   quitar fuera de la celda — y en embeds el pie lo ocupa la barra del player
   ajeno, así que el control vive arriba como un solo `select` de ancho fijo. */
export function SignalSelect({ signals, signalIndex, onChange, className = '' }: Props) {
  return (
    <select
      value={signalIndex}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => { e.stopPropagation(); play('interaction.tap'); onChange(Number(e.target.value)); }}
      aria-label="Señal del canal"
      title="Cambiar señal"
      className={`shrink-0 max-w-[78px] h-5 text-[9px] font-medium rounded px-0.5 border outline-none cursor-pointer [color-scheme:dark] focus-visible:ring-2 focus-visible:ring-primary ${className}`}
    >
      {signals.map((s, i) => (
        <option key={i} value={i}>{SIGNAL_LABEL[s.type] ?? s.type}</option>
      ))}
    </select>
  );
}
