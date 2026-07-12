export function emojiToPath(emoji: string): string {
  const cp = [...emoji]
    .map(c => c.codePointAt(0)!.toString(16))
    .filter(c => c !== 'fe0f')
    .join('-');
  return `/emoji/${cp}.svg`;
}

const EMOJI_RE = /[\p{Emoji_Presentation}\p{Extended_Pictographic}]/u;

export function splitEmojiText(text: string): Array<{ type: 'text'; value: string } | { type: 'emoji'; emoji: string }> {
  const parts: Array<{ type: 'text'; value: string } | { type: 'emoji'; emoji: string }> = [];
  let buf = '';
  for (const ch of text) {
    if (EMOJI_RE.test(ch)) {
      if (buf) { parts.push({ type: 'text', value: buf }); buf = ''; }
      parts.push({ type: 'emoji', emoji: ch });
    } else {
      buf += ch;
    }
  }
  if (buf) parts.push({ type: 'text', value: buf });
  return parts;
}
