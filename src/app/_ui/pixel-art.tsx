import { SPRITES, type SpriteName } from './pixel-sprites';
import { spriteRects } from './pixel-rects';

/** Screen pixels per art pixel. One size for every figure, so they read as one set. */
const SCALE = 3;

/**
 * A pixel-art figure, purely decorative (hidden from assistive technology).
 * Drawn at an integer scale with crisp edges so no pixel is ever blurred.
 */
export function PixelArt({ name, className }: { name: SpriteName; className?: string }) {
  const sprite = SPRITES[name];
  const width = sprite.rows[0].length;
  const height = sprite.rows.length;
  return (
    <svg
      className={['pixel-art', className].filter(Boolean).join(' ')}
      viewBox={`0 0 ${width} ${height}`}
      width={width * SCALE}
      height={height * SCALE}
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      {spriteRects(sprite).map((r) => (
        <rect key={`${r.x}-${r.y}`} x={r.x} y={r.y} width={r.width} height={1} fill={r.fill} />
      ))}
    </svg>
  );
}
