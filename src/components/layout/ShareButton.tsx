import { useRef, useState } from 'react';
import { play } from '@/lib/sound';
import { buildPageText, shareOrCopy } from '@/lib/share';

export function ShareButton() {
  const [feedback, setFeedback] = useState<null | 'copied' | 'failed'>(null);
  const timer = useRef<number | null>(null);

  const handleShare = async () => {
    const result = await shareOrCopy(buildPageText());
    if (result === 'shared') return;
    play(result === 'copied' ? 'interaction.confirm' : 'notification.error');
    setFeedback(result === 'copied' ? 'copied' : 'failed');
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setFeedback(null), 1600);
  };

  return (
    <button
      onClick={handleShare}
      className="relative flex items-center justify-center w-9 h-9 text-base-content/70 hover:text-base-content rounded-lg hover:bg-base-200 transition-colors shrink-0 cursor-pointer"
      aria-label={feedback === 'copied' ? 'Enlace copiado' : 'Compartir ¿Qué Onda?'}
      title="Compartir ¿Qué Onda?"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="18" cy="5" r="3" />
        <circle cx="6" cy="12" r="3" />
        <circle cx="18" cy="19" r="3" />
        <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
        <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
      </svg>
      {feedback && (
        <span
          role="status"
          className="absolute -top-2.5 -right-2 px-1.5 py-0.5 rounded-md text-[9px] font-semibold bg-primary text-primary-content shadow whitespace-nowrap"
        >
          {feedback === 'copied' ? '¡Copiado!' : 'Error'}
        </span>
      )}
    </button>
  );
}
