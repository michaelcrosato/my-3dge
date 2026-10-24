/**
 * @file The filter chain's checks (PLAN.md WP 7.4; split from engine/gfx/post/filters.ts at its size cap in WP 13.24):
 * the posterize rule (levels per channel 0, or 8 and more, so dull colours keep their hue,
 * `shardfall:docs/HISTORY.md:424-426`) and the outline's colour (hex or a CSS name), as problems a look's check
 * reports (engine/gfx/post/looks.ts) and as fixes the chain applies to the setting `post.filters`, a layer over a look,
 * reporting what it fixed (engine/gfx/post/chain.ts). filters.ts re-exports them.
 *
 * Invariants: pure; a fix leaves every other filter and field as it was.
 *
 * @example
 * levelsProblem(4, 'filters.palette.levels'); // '… posterize with 0 (off) or 8 levels and more …'
 * colorProblem('#1a1a2e', 'color'); // null
 * fixLevels({ palette: { levels: 4 } }).spec.palette?.levels; // 8
 * @see engine/gfx/post/filters.test.ts
 */
import { Color } from 'three/webgpu';
import type { FilterSpec } from './filters';

/** Checks a level count: 0, or 8 and more (see the file comment). */
export function levelsProblem(levels: number, where: string): string | null {
  return levels > 0 && levels < 8
    ? `${where} is ${levels}: posterize with 0 (off) or 8 levels and more, so dull colours keep their hue`
    : null;
}

/**
 * Checks an outline colour: '' (the line darkens the surface), hex (`#rgb`, `#rrggbb`) or a CSS colour name three.js
 * knows (`Color.NAMES`). `new Color` also reads `rgb()` and `hsl()`; a look writes those as hex, so data keeps one form
 * of each colour, and they are refused too.
 */
export function colorProblem(color: string, where: string): string | null {
  const known =
    color === '' || /^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(color) || Object.hasOwn(Color.NAMES, color.toLowerCase());
  return known
    ? null
    : `${where} is ${JSON.stringify(color)}, which is no colour: give hex ('#1a1a2e'), a CSS colour name ('black') or '' to darken the surface`;
}

/**
 * `spec` with an outline colour `colorProblem` refuses left out, so the line darkens the surface, and that colour (null
 * when there was none): a layer over a look (the setting `post.filters`) is fixed and reported this way.
 */
export function fixColor(spec: FilterSpec): { spec: FilterSpec; dropped: string | null } {
  const color = spec.outline?.color;
  if (color === undefined || !colorProblem(color, 'color')) return { spec, dropped: null };
  const { color: _dropped, ...outline } = spec.outline ?? {};
  return { spec: { ...spec, outline }, dropped: color };
}

/**
 * `spec` with every level count of 1–7 raised to 8 (see the file comment), and what was raised: a layer over a look
 * (the setting `post.filters`) is fixed and reported this way; looks are checked when they are defined.
 */
export function fixLevels(spec: FilterSpec): {
  spec: FilterSpec;
  raised: { name: 'pixel' | 'palette'; levels: number }[];
} {
  const out: FilterSpec = { ...spec };
  const raised: { name: 'pixel' | 'palette'; levels: number }[] = [];
  for (const name of ['pixel', 'palette'] as const) {
    const levels = spec[name]?.levels;
    if (levels === undefined || !levelsProblem(levels, name)) continue;
    out[name] = { ...spec[name], levels: 8 };
    raised.push({ name, levels });
  }
  return { spec: out, raised };
}
