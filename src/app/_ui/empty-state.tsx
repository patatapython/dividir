import { PixelArt } from './pixel-art';
import type { SpriteName } from './pixel-sprites';

export function EmptyState({ art, children }: { art?: SpriteName; children: React.ReactNode }) {
  return (
    <div className="empty-state">
      {art && <PixelArt name={art} className="empty-state-art" />}
      <div>{children}</div>
    </div>
  );
}
