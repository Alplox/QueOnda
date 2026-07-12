import { useEffect } from 'react';
import { ChileFlag } from '../ChileFlag';
import { emojiToPath } from '../../lib/emoji';

export interface CardData {
  emoji: string;
  name: string;
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
  image?: string;
  isFlag?: boolean;
  hp: number;
  type: string;
  attack: { name: string; damage: number };
}

export function EmojiCard({ card, flipping }: { card: CardData; flipping: boolean }) {
  useEffect(() => {
    import('hover-tilt/web-component');
  }, []);

  return (
    <div className={`emoji-card ${card.rarity} ${flipping ? 'flipping' : ''}`} data-type={card.type}>
      <hover-tilt shadow scale-factor={1.08} glare-intensity={1.5} class="[&::part(container)]:rounded-xl">
        <div className="emoji-card__face">
          <div className="emoji-card__art">
            <div className="emoji-card__name-overlay">
              <span className="emoji-card__name-text">{card.name}</span>
              <span className="emoji-card__hp-badge">
                <span className="emoji-card__hp-label">HP</span>
                <span className="emoji-card__hp-value">{card.hp}</span>
              </span>
            </div>

            {card.image ? (
              <img
                src={card.image}
                alt={card.name}
                className="absolute inset-0 z-[2] w-full h-full object-cover"
                draggable={false}
              />
            ) : card.isFlag ? (
              <div className="absolute inset-0 z-[2] flex items-center justify-center p-4">
                <ChileFlag className="w-full h-full object-contain" />
              </div>
            ) : (
              <img
                src={emojiToPath(card.emoji)}
                alt={card.name}
                className="absolute inset-0 z-[2] w-full h-full object-contain p-6 sm:p-8 select-none"
                draggable={false}
              />
            )}

            <div className="emoji-card__attack-overlay">
              <span className="emoji-card__attack-name">{card.attack.name}</span>
              <span className="emoji-card__attack-badge">
                <span className="emoji-card__attack-label">ATK</span>
                <span className="emoji-card__attack-damage">{card.attack.damage}</span>
              </span>
            </div>
          </div>
        </div>
      </hover-tilt>
    </div>
  );
}
