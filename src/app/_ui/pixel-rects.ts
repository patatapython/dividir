import type { Sprite } from './pixel-sprites';

export interface PixelRect { x: number; y: number; width: number; fill: string }

/** One rect per horizontal run of same-coloured pixels: a few hundred nodes instead of thousands. */
export function spriteRects(sprite: Sprite): PixelRect[] {
  const rects: PixelRect[] = [];
  sprite.rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const key = row[x];
      let end = x + 1;
      while (end < row.length && row[end] === key) end++;
      if (key !== '.') rects.push({ x, y, width: end - x, fill: sprite.palette[key] });
      x = end;
    }
  });
  return rects;
}
