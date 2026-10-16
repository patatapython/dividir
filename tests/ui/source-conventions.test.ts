import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Conventions the type system cannot see, checked over the source text itself (code and
// stylesheets: a comment is source text too).
const ROOTS = ['src/app', 'src/server', 'src/domain'];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(tsx?|css)$/.test(entry.name) ? [path] : [];
  });
}

function linesMatching(pattern: RegExp, except: string[] = []): string[] {
  return ROOTS.flatMap(sourceFiles)
    .filter((file) => !except.includes(file))
    .flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .flatMap((line, i) => (pattern.test(line) ? [`${file}:${i + 1}: ${line.trim()}`] : [])),
    );
}

describe('source conventions', () => {
  // A GroupCharge has ONE name in the interface: "gasto sin pagar" (T-32). The code says
  // `charge`, so any Spanish "cargo" in the sources is copy that drifted back.
  it('names a group charge "gasto sin pagar", never "cargo"', () => {
    expect(linesMatching(/\bcargos?\b/i)).toEqual([]);
  });

  // Real leftover money has ONE name in the interface: "Sobrante" (D-04, T-73). "Dinero de
  // nadie" described the internal model and "preexistente" was the bote's second name for
  // the same money; the code keeps `ownerless`/`carryIn`. The bote's own tagline "de todos
  // y de nadie" describes the communal kitty, not the leftover, and stays.
  it('names leftover money "Sobrante", never "dinero de nadie" or "preexistente"', () => {
    expect(linesMatching(/\b(dinero|extra) de nadie\b|preexistente/i)).toEqual([]);
  });

  // Type sizes (session 10, owner review): running text, controls and names are never
  // below 16px; smaller text exists only as a named step of the scale, so it stays a
  // decision (--fs-label for mono uppercase micro-labels, --fs-small for metadata).
  // An allowlist, not a pattern of bad values (loopback): a size is a scale token,
  // `inherit`, or a px/rem literal of at least 16px; em, %, clamp() or calc() would
  // hide the floor. The `font` shorthand may only reset (`inherit`), never set a size.
  it('sets font sizes only through the type scale or at 16px and above', () => {
    const declaration = /(?<![-\w])(font-size|fontSize|font)\s*:\s*([^;}]+)/g;
    const allowedSize = (value: string) => {
      const v = value.trim().replace(/^['"]|['"],?$/g, '');
      if (/^var\(--fs-[\w-]+\)$/.test(v) || v === 'inherit') return true;
      const literal = v.match(/^(\d+(?:\.\d+)?)(px|rem)$/) ?? v.match(/^(\d+(?:\.\d+)?)()$/);
      return !!literal && Number(literal[1]) * (literal[2] === 'rem' ? 16 : 1) >= 16;
    };
    const offending = linesMatching(/(?<![-\w])(font-size|fontSize|font)\s*:/).filter((line) => {
      if (/^src\/app\/globals\.css:\d+: --fs-/.test(line)) return false; // the scale itself
      return [...line.matchAll(declaration)].some(([, prop, value]) =>
        prop === 'font' ? value.trim().replace(/^['"]|['"],?$/g, '') !== 'inherit' : !allowedSize(value),
      );
    });
    expect(offending).toEqual([]);
  });

  // The allowlist above trusts any var(--fs-*): so the scale tokens themselves are held to
  // the floor here (session 11 loopback). A step is a px literal — only the two named
  // exceptions sit below 16px — or a clamp() whose minimum is at least 16px.
  it('defines every type-scale token at or above the 16px floor, bar the two named steps', () => {
    const css = readFileSync('src/app/globals.css', 'utf8');
    const tokens = [...css.matchAll(/(--fs-[\w-]+)\s*:\s*([^;]+);/g)].map(([, name, value]) => ({ name, value: value.trim() }));
    expect(tokens.map((t) => t.name)).toEqual(expect.arrayContaining(['--fs-label', '--fs-small', '--fs-body']));
    const BELOW_FLOOR = new Set(['--fs-label', '--fs-small']);
    const floorOf = (value: string) => {
      const literal = value.match(/^(\d+(?:\.\d+)?)px$/);
      if (literal) return Number(literal[1]);
      const clamp = value.match(/^clamp\(\s*(\d+(?:\.\d+)?)px\s*,/);
      return clamp ? Number(clamp[1]) : null;
    };
    const offending = tokens.filter((t) => {
      const floor = floorOf(t.value);
      return floor === null || (floor < 16 && !BELOW_FLOOR.has(t.name));
    });
    expect(offending).toEqual([]);
  });

  // An amount shown in euros goes through money-format (T-68): formatCents alone is the
  // bare figure an input holds, and gluing " €" onto it by hand duplicates the format.
  it('never glues the euro sign onto formatCents by hand', () => {
    expect(linesMatching(/formatCents\(.*€/, ['src/app/_ui/money-format.ts'])).toEqual([]);
  });
});
