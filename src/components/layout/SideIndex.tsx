import { useEffect, useState } from 'react';
import { SECTIONS } from '../../lib/sections';

export function SideIndex() {
  const [activeSection, setActiveSection] = useState('');
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const check = () => {
      const main = document.querySelector('main');
      if (!main) return;
      const mainRight = main.getBoundingClientRect().right;
      setVisible(window.innerWidth - mainRight >= 52);
    };

    check();
    const ro = new ResizeObserver(check);
    const main = document.querySelector('main');
    if (main) ro.observe(main);
    window.addEventListener('resize', check);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', check);
    };
  }, []);

  useEffect(() => {
    let raf = 0;
    const update = () => {
      const sectionList = Array.from(
        document.querySelectorAll('section[id]'),
      ) as HTMLElement[];
      if (!sectionList.length) return;
      const offset = 120;
      let active = sectionList[0].id;
      for (const s of sectionList) {
        if (s.getBoundingClientRect().top <= offset) {
          active = s.id;
        } else {
          break;
        }
      }
      // When scrolled to the bottom, the trailing sections sit below the
      // threshold band, so force the last one active to keep tracking.
      const scrollBottom =
        window.innerHeight + window.scrollY >=
        document.documentElement.scrollHeight - 80;
      if (scrollBottom) active = sectionList[sectionList.length - 1].id;
      setActiveSection(active);
    };

    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        update();
      });
    };

    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', update);
    // Re-measure after lazy sections hydrate and change document height.
    const ro = new ResizeObserver(update);
    const main = document.querySelector('main');
    if (main) ro.observe(main);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', update);
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <nav
      className={`fixed right-5 top-1/2 -translate-y-1/2 z-40 flex flex-col items-center gap-0.5 transition-opacity duration-300 ${
        visible ? 'opacity-100' : 'opacity-0 pointer-events-none'
      }`}
    >
      {SECTIONS.map((section) => {
        const isActive = activeSection === section.id;
        return (
          <a
            key={section.id}
            href={`#${section.id}`}
            className="relative flex items-center justify-center w-6 h-6 rounded-lg transition-all duration-200 group"
          >
            <span
              className={`rounded-full transition-all duration-200 ${
                isActive
                  ? 'w-2 h-2 bg-primary'
                  : 'w-1.5 h-1.5 bg-base-content/20 group-hover:bg-base-content/40'
              }`}
            />
            <span
              className={`absolute right-full mr-2 text-[11px] whitespace-nowrap leading-none py-1.5 px-2 rounded-lg border shadow-sm transition-all duration-200 ${
                isActive
                  ? 'text-base-content font-medium bg-primary/10 border-primary/20'
                  : 'text-base-content/60 bg-base-200 border-base-300'
              } opacity-0 pointer-events-none group-hover:opacity-100`}
            >
              {section.label}
            </span>
          </a>
        );
      })}
    </nav>
  );
}
