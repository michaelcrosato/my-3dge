/**
 * @file The filter chain's checks (PLAN.md WP 7.4; split from engine/gfx/post/filters.ts at its size cap in WP 13.24):
 * the posterize rule (levels per channel 0, or 8 and more, so dull colours keep their hue,
 * `shardfall:docs/HISTORY.md:424-426`) and every filter's colours (hex or a CSS name; WP 13.31: `colorFields`, the
 * fields whose unit is `#rrggbb`, engine/gfx/post/filterSchema.ts), as problems a look's check
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
import { FILTER_FIELDS, type FilterSpec } from './filters';
import { COLOR_UNIT } from './filterSchema';

/** Checks a level count: 0, or 8 and more (see the file comment). */
export function levelsProblem(levels: number, where: string): string | null {
  return levels > 0 && levels < 8
    ? `${where} is ${levels}: posterize with 0 (off) or 8 levels and more, so dull colours keep their hue`
    : null;
}

/**
 * Checks a colour: hex (`#rgb`, `#rrggbb`) or a CSS colour name three.js knows (`Color.NAMES`), or '' where `empty`
 * allows it (the outline's colour, whose '' darkens the surface instead). `new Color` also reads `rgb()` and `hsl()`;
 * a look writes those as hex, so data keeps one form of each colour, and they are refused too.
 */
export function colorProblem(color: string, where: string, empty = true): string | null {
  const known =
    (empty && color === '') ||
    /^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(color) ||
    Object.hasOwn(Color.NAMES, color.toLowerCase());
  if (known) return null;
  const give = empty ? " or '' to darken the surface" : '';
  return `${where} is ${JSON.stringify(color)}, which is no colour: give hex ('#1a1a2e') or a CSS colour name ('black')${give}`;
}

/**
 * Every colour field of the filters (the fields whose unit is `COLOR_UNIT`), as `[filter, field, empty]`: `empty`
 * when its default is '', so '' is a choice of its own (the outline's).
 */
export function colorFields(): readonly (readonly [string, string, boolean])[] {
  return Object.entries(FILTER_FIELDS).flatMap(([name, field]) =>
    Object.entries(field.properties as Record<string, { unit?: string; default?: unknown }>)
      .filter(([, f]) => f.unit === COLOR_UNIT)
      .map(([key, f]) => [name, key, f.default === ''] as const),
  );
}

/**
 * `spec` with every colour `colorProblem` refuses left out (so the outline darkens the surface, any other takes its
 * default), and the first such colour and where it was (null when there was none): a layer over a look (the setting
 * `post.filters`) is fixed and reported this way.
 */
export function fixColor(spec: FilterSpec): { spec: FilterSpec; dropped: { where: string; color: string } | null } {
  let out = spec;
  let dropped: { where: string; color: string } | null = null;
  for (const [name, key, empty] of colorFields()) {
    const filter = (out as Record<string, Record<string, unknown> | undefined>)[name];
    const value = filter?.[key];
    if (typeof value !== 'string' || !colorProblem(value, key, empty)) continue;
    const { [key]: _gone, ...kept } = filter ?? {};
    out = { ...out, [name]: kept };
    dropped ??= { where: `${name}.${key}`, color: value };
  }
  return { spec: out, dropped };
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
