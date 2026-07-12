import { emojiToPath } from '../lib/emoji';

export function Emoji({ emoji, className = 'inline-block h-[1em] align-text-bottom' }: { emoji: string; className?: string }) {
  return <img src={emojiToPath(emoji)} alt="" className={className} draggable={false} />;
}
