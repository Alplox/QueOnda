import { emojiToPath } from '../lib/emoji';

export function Emoji({ emoji, className = 'inline-block h-[1em] w-auto align-text-bottom' }: { emoji: string; className?: string }) {
  return <img src={emojiToPath(emoji)} alt="" width={36} height={36} className={className} draggable={false} />;
}
