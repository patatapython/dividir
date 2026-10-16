export function Stamp({ display = false, animated = false, sticker = false, tone = 'lima', children }: {
  display?: boolean; animated?: boolean; sticker?: boolean; tone?: 'lima' | 'arena'; children: React.ReactNode;
}) {
  const cls = [
    'stamp',
    display && 'stamp--display',
    animated && 'stamp--animated',
    sticker && 'stamp--sticker',
    sticker && tone === 'arena' && 'stamp--arena',
  ].filter(Boolean).join(' ');
  return <span className={cls}>{children}</span>;
}
