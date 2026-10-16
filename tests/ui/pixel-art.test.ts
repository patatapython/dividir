import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PixelArt } from '../../src/app/_ui/pixel-art';
import { SPRITES, type Sprite } from '../../src/app/_ui/pixel-sprites';
import { spriteRects } from '../../src/app/_ui/pixel-rects';

/** Paints the rects back onto an empty grid: what the SVG will actually show. */
function repaint(sprite: Sprite): string[][] {
  const grid = sprite.rows.map((row) => [...row].map(() => '.'));
  for (const r of spriteRects(sprite)) {
    const key = Object.keys(sprite.palette).find((k) => sprite.palette[k] === r.fill)!;
    for (let x = r.x; x < r.x + r.width; x++) {
      expect(grid[r.y][x], `overlap at ${x},${r.y}`).toBe('.');
      grid[r.y][x] = key;
    }
  }
  return grid;
}

describe('pixel sprites', () => {
  it.each(Object.entries(SPRITES))('%s is a rectangle of known colours', (_, sprite) => {
    const width = sprite.rows[0].length;
    for (const row of sprite.rows) {
      expect(row).toHaveLength(width);
      for (const ch of row) if (ch !== '.') expect(sprite.palette).toHaveProperty(ch);
    }
  });

  it.each(Object.entries(SPRITES))('%s is drawn pixel for pixel, each pixel once', (_, sprite) => {
    expect(repaint(sprite).map((row) => row.join(''))).toEqual([...sprite.rows]);
  });

  it('joins neighbouring pixels of one colour into one rect per run', () => {
    const sprite: Sprite = { palette: { '@': '#000000', a: '#ff0000' }, rows: ['@@a.@', 'aaaa.'] };
    expect(spriteRects(sprite)).toEqual([
      { x: 0, y: 0, width: 2, fill: '#000000' },
      { x: 2, y: 0, width: 1, fill: '#ff0000' },
      { x: 4, y: 0, width: 1, fill: '#000000' },
      { x: 0, y: 1, width: 4, fill: '#ff0000' },
    ]);
  });
});

describe('PixelArt', () => {
  it('is decorative, crisp and drawn at a whole number of screen pixels per art pixel', () => {
    const html = renderToStaticMarkup(createElement(PixelArt, { name: 'beer' }));
    const { rows } = SPRITES.beer;
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('shape-rendering="crispEdges"');
    expect(html).toContain(`viewBox="0 0 ${rows[0].length} ${rows.length}"`);
    const width = Number(html.match(/ width="(\d+)"/)![1]);
    expect(width % rows[0].length).toBe(0);
  });
});
