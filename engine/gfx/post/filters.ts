/**
 * @file The filters (PLAN.md WP 7.4, §6.7, WP 13.31): what each one takes, as data. A filter chain is plain data
 * (`FILTER_FIELDS`, the `filters` of a look, engine/gfx/post/looks.ts): every filter has a `scope` (`off`, `all`, or
 * the characters, the objects, the environment and their pairs; engine/gfx/post/filterSchema.ts), an `amount` (how
 * much of it shows, 0 to 1, so blends and a look's strength fade it: engine/gfx/post/combine.ts) and its numbers.
 * The uniforms the composite reads them through are engine/gfx/post/filterUniforms.ts's: switching a filter, its
 * scope, its amount or a number is a uniform write, so nothing recompiles and no pipeline is built.
 *
 * The order (`FILTER_NAMES`, engine/gfx/post/composite.ts): the shading's (`ao`, `gi`, `ssr`, `air`, WP 11.5), `bloom`
 * and `aa` run before the composite, on the scene's light, and take only `off` or `all`. The composite then moves
 * where each pixel looks (`screen`'s curvature, `lens` distortion, `vhs`'s slip, `watercolor`'s wobble, `screen`'s
 * blocks and `pixel`'s), reads the picture there through the lens (`dof`, `tiltshift`, `misregister`, `chroma`,
 * `vhs`'s bleed, `sharpen`, then `flare` and `streaks` added), and draws over it: the media (`cel`, `pixel`,
 * `palette`, `watercolor`, `outline`, `stylize`, `paper`), the tone (`grade`, `split`, `selective`, `duotone`) and
 * the display (`scanlines`, `crt`, `speedlines`, both vignettes, `grain`, `vhs`'s snow, `letterbox`). Each filter's
 * own file says what it does: the first sixteen in engine/gfx/post/filterFields.ts, Style Lab's
 * (michaelcrosato/my-ai-3d-demo@34c6fa1) in engine/gfx/post/filterFieldsMore.ts and the WGSL under
 * engine/gfx/post/shaders/.
 *
 * Shardfall's lessons, kept: levels per channel are 0 (off) or 8 and more (24 suits pixel art), since fewer shift the
 * hue of dull colours (`shardfall:docs/HISTORY.md:424-426`; a grey floor went pink at 5–6 levels); the pixel filter
 * snaps the camera to its block grid (`snap`) while the environment is pixel art, so it does not shimmer as the
 * camera slides (engine/gfx/post/chain.ts's `snapBlock`). Carried from `my-3d2dge:src/stress-world/45-filters.js`
 * (cel, pixel, Bayer dither, the `keep(m)` scope) and `shardfall:crates/pav_render/src/scene.rs:409-500` (the first
 * filters' numbers and defaults, keys renamed).
 *
 * Invariants: every number has its range in the schema; `chainOf` gives a whole chain, every filter present and
 * every one left out off; a filter's amount of 1 changes nothing (`foldAmounts`).
 *
 * @example
 * chainOf({ letterbox: { scope: 'all' } }).letterbox.aspect; // 2.39
 * layerChain(chainOf({ grade: { scope: 'all' } }), { grade: { saturation: 0 } }).grade.saturation; // 0
 * @see engine/gfx/post/filters.test.ts
 * @see tests/e2e/post.spec.ts
 */
import { parse, type EntryOf, type Field, type Schema } from '../../core/schema';
import { CORE_FILTER_FIELDS as CORE } from './filterFields';
import { MORE_FILTER_FIELDS as MORE } from './filterFieldsMore';

export { SCOPES, SCREEN_SCOPES, scopeMask, COLOR_UNIT, type Scope } from './filterSchema';
export { PALETTES, STYLIZE_KINDS } from './filterFields';
export { PAPER_KINDS } from './filterFieldsMore';
export { AMOUNT_SLOTS, createFilterUniforms, writeFilters, type FilterUniforms } from './filterUniforms';
export { colorFields, colorProblem, fixColor, fixLevels, levelsProblem } from './filterChecks';

/** Every filter, in the composite's order (the shading's, bloom and aa run before it; see the file comment). */
export const FILTER_NAMES = [
  'ao',
  'gi',
  'ssr',
  'air',
  'bloom',
  'aa',
  'lens',
  'dof',
  'tiltshift',
  'flare',
  'streaks',
  'sharpen',
  'misregister',
  'cel',
  'pixel',
  'palette',
  'watercolor',
  'outline',
  'stylize',
  'paper',
  'grade',
  'split',
  'selective',
  'duotone',
  'scanlines',
  'crt',
  'vhs',
  'speedlines',
  'vignette',
  'grain',
  'chroma',
  'letterbox',
  'screen',
] as const;

/** A filter's name. */
export type FilterName = (typeof FILTER_NAMES)[number];

/** The filters of a chain, in `FILTER_NAMES`' order; see the file comment. */
export const FILTER_FIELDS = {
  ao: CORE.ao,
  gi: CORE.gi,
  ssr: CORE.ssr,
  air: CORE.air,
  bloom: CORE.bloom,
  aa: CORE.aa,
  lens: MORE.lens,
  dof: MORE.dof,
  tiltshift: MORE.tiltshift,
  flare: MORE.flare,
  streaks: MORE.streaks,
  sharpen: MORE.sharpen,
  misregister: MORE.misregister,
  cel: CORE.cel,
  pixel: CORE.pixel,
  palette: CORE.palette,
  watercolor: MORE.watercolor,
  outline: CORE.outline,
  stylize: CORE.stylize,
  paper: MORE.paper,
  grade: CORE.grade,
  split: MORE.split,
  selective: MORE.selective,
  duotone: MORE.duotone,
  scanlines: CORE.scanlines,
  crt: MORE.crt,
  vhs: MORE.vhs,
  speedlines: MORE.speedlines,
  vignette: MORE.vignette,
  grain: CORE.grain,
  chroma: CORE.chroma,
  letterbox: MORE.letterbox,
  screen: CORE.screen,
} as const satisfies Schema;

/** A filter chain: every filter with its scope, its amount and its numbers. */
export type FilterChain = EntryOf<typeof FILTER_FIELDS>;

/** Part of a chain: some filters, each with some of its fields (a look's `filters`, the setting `post.filters`). */
export type FilterSpec = { [K in FilterName]?: Partial<FilterChain[K]> };

/** `schema` with every default left out, so a value holds only what was given (`post.filters` layers it). */
export function partialSchema(schema: Schema): Schema {
  const strip = (field: Field): Field => {
    const { default: _left, ...rest } = field;
    return rest.properties ? { ...rest, properties: partialSchema(rest.properties) } : rest;
  };
  return Object.fromEntries(Object.entries(schema).map(([key, field]) => [key, strip(field)]));
}

/** A whole chain from part of one: every filter and field `spec` leaves out at its default (off). */
export function chainOf(spec: FilterSpec = {}): FilterChain {
  return parse(FILTER_FIELDS, spec, 'a filter chain');
}

/** `chain` with `over` laid on it, filter by filter and field by field. */
export function layerChain(chain: FilterChain, over: FilterSpec): FilterChain {
  const out: Record<string, unknown> = {};
  for (const name of FILTER_NAMES) out[name] = { ...chain[name], ...over[name] };
  return chainOf(out as FilterSpec);
}

/** Whether `chain` has every filter off, so it would leave the picture as the scene draws it (`look:clean`). */
export function isPlain(chain: FilterChain): boolean {
  return FILTER_NAMES.every((name) => chain[name].scope === 'off');
}

/**
 * `chain` with the amounts of the filters that run before the composite folded into their strengths (the shading's,
 * `bloom`'s; `aa` off under half its amount), as the chain hands them to their passes (engine/gfx/post/chain.ts):
 * the composite mixes its own filters by their amounts (engine/gfx/post/filterUniforms.ts).
 */
export function foldAmounts(chain: FilterChain): FilterChain {
  const { ao, gi, ssr, air, bloom, aa } = chain;
  if ([ao, gi, ssr, air, bloom, aa].every((f) => f.amount === 1)) return chain;
  return {
    ...chain,
    ao: { ...ao, strength: ao.strength * ao.amount },
    gi: { ...gi, strength: gi.strength * gi.amount },
    ssr: { ...ssr, strength: ssr.strength * ssr.amount },
    air: { ...air, haze: air.haze * air.amount, shafts: air.shafts * air.amount, halos: air.halos * air.amount },
    bloom: { ...bloom, strength: bloom.strength * bloom.amount },
    aa: aa.amount < 0.5 ? { ...aa, scope: 'off' } : aa,
  };
}
