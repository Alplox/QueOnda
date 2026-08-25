import { useEffect, useState } from 'react';
import { play } from '@/lib/sound';

export function BackToTop() {
  const [show, setShow] = useState(false);
  const [bottom, setBottom] = useState('24px');

  useEffect(() => {
    let raf = false;
    const update = () => {
      const bar = document.getElementById('footer-credits');
      const player = document.getElementById('sticky-radio-player');
      const vh = window.innerHeight;
      const btnH = 44; // h-11
      const btnInset = 24; // bottom-6
      let inset = btnInset;
      // Lift clear of the mobile bottom nav dock (<lg only) while it's
      // visible. Uses the sentinel (true rendered layout bottom) plus the
      // dock's live rendered top (includes its lift transform) — formulas
      // from offsetHeight/computed-bottom went stale once the dock gained
      // dynamic bottom offsets and lift transforms.
      const dock = document.getElementById('bottom-nav');
      if (dock && window.innerWidth < 1024 && !dock.inert) {
        // Final-position math: resolved bottom + offsetHeight + the dock's
        // dynamic lift (parsed from its inline transform — the radio
        // miniplayer keeps it permanently raised). Computed bottom alone
        // ignores transforms and left the arrow overlapping the dock.
        const resolvedInset = parseFloat(getComputedStyle(dock).bottom) || 12;
        const m = /translateY\(-([\d.]+)px\)/.exec(dock.style.transform);
        const liftPx = m ? parseFloat(m[1]) : 0;
        inset = Math.max(inset, resolvedInset + dock.offsetHeight + liftPx + 12);
      }
      // Lift clear of the sticky radio player when it's on-screen (z-[9999] would otherwise cover us)
      if (player) {
        const rect = player.getBoundingClientRect();
        if (rect.top < vh - 4) inset = Math.max(inset, vh - rect.top + 12); // 12px gap above the player
      }
      const btnTop = vh - inset - btnH;
      if (bar) {
        const rect = bar.getBoundingClientRect();
        // Only lift the button clear of the footer when it would actually overlap
        if (rect.top < btnTop + btnH) {
          inset = Math.max(inset, vh - rect.top - 12); // 12px gap above the credit bar
        }
      }
      setBottom(`${inset}px`);
    };
    update();
    const onScroll = () => {
      if (raf) return;
      raf = true;
      requestAnimationFrame(() => {
        raf = false;
        update();
      });
    };
    // Re-run when the dock shows/hides (auto-hide, sheet) so the button
    // restacks in the same frame instead of waiting for the next scroll
    const onDockVisibility = () => onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', update);
    document.addEventListener('dock:visibility', onDockVisibility);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', update);
      document.removeEventListener('dock:visibility', onDockVisibility);
    };
  }, []);

  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > 500);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const goTop = () => {
    play('interaction.tap');
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
  };

  return (
    <button
      type="button"
      onClick={goTop}
      aria-label="Volver arriba"
      title="Volver arriba"
      aria-hidden={!show}
      tabIndex={show ? 0 : -1}
      style={{ bottom }}
      className={`fixed right-5 z-40 flex items-center justify-center w-11 h-11 rounded-full bg-base-200 border border-base-300 text-base-content/70 hover:text-base-content hover:bg-base-300 shadow-xl transition-all duration-200 cursor-pointer ${
        show ? 'opacity-100 scale-100' : 'opacity-0 scale-90 pointer-events-none'
      }`}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 19V5" />
        <path d="M5 12l7-7 7 7" />
      </svg>
    </button>
  );
}
