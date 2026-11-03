/**
 * @file The composite's uniforms (PLAN.md WP 7.4, WP 13.31): one `vec4` per filter (a second, third or fourth for
 * the long ones), render-group uniforms set up once (`createFilterUniforms`), and `writeFilters`, which copies a
 * chain into them, so switching a filter, its scope, its amount or a number is a uniform write: nothing recompiles
 * and no pipeline is built. Split from engine/gfx/post/filters.ts at its size cap.
 *
 * Packing: a scoped filter's first component is its scope's mask (`scopeMask`), which the composite tests against
 * each pixel's part; a screen filter's is 7 when on. Colours go in as sRGB, since the composite works in display
 * colours. A filter's `amount` goes in `am0`–`am6`, four to a vector (`AMOUNT_SLOTS`), and the composite mixes its
 * result with what came in by it; the filters that move where a pixel looks (`screen`'s curvature, `lens`, `vhs`'s
 * slip, `watercolor`'s wobble) and the pixel art's blocks have their size scaled by it instead (blocks off below 0.5);
 * `grain` and `chroma` had an `amount` of their own before every filter had one, their strength, which serves.
 *
 * Invariants: written only by `writeFilters` (and the chain's per-frame numbers in `frame`); every filter off writes
 * zeros, so the composite returns the picture as it came; an amount of 1 changes nothing, exactly.
 *
 * @example
 * const uniforms = createFilterUniforms();
 * uniforms.pixel.value.toArray(); // [0, 4, 0, 1]: off (the mask 0), 4 px blocks, full colour, a rim
 * writeFilters(uniforms, null);
 * uniforms.am0.value.toArray(); // [1, 1, 1, 1]: every amount 1
 * @see engine/gfx/post/filters.test.ts
 * @see engine/gfx/post/composite.ts
 */
import { Color, SRGBColorSpace, Vector4 } from 'three/webgpu';
import { renderGroup, uniform } from 'three/tsl';
import { chainOf, type FilterChain, type FilterName } from './filters';
import { PALETTES, STYLIZE_KINDS } from './filterFields';
import { PAPER_KINDS } from './filterFieldsMore';
import { scopeMask } from './filterSchema';

/** A render-group `vec4` uniform. */
type Vec = ReturnType<typeof uniform<Vector4>>;

/** The composite filters' amount slots: `am<i>` and its component, four to a vector (see the file comment). */
export const AMOUNT_SLOTS: Readonly<Partial<Record<FilterName, readonly [number, 'x' | 'y' | 'z' | 'w']>>> = {
  cel: [0, 'x'],
  pixel: [0, 'y'],
  palette: [0, 'z'],
  outline: [0, 'w'],
  stylize: [1, 'x'],
  grade: [1, 'y'],
  scanlines: [1, 'z'],
  screen: [2, 'y'],
  dof: [2, 'z'],
  tiltshift: [2, 'w'],
  flare: [3, 'x'],
  streaks: [3, 'y'],
  sharpen: [3, 'z'],
  misregister: [3, 'w'],
  watercolor: [4, 'x'],
  paper: [4, 'y'],
  split: [4, 'z'],
  selective: [4, 'w'],
  duotone: [5, 'x'],
  crt: [5, 'y'],
  vhs: [5, 'z'],
  speedlines: [5, 'w'],
  vignette: [6, 'x'],
  letterbox: [6, 'y'],
};

/** The uniform names, in the composite's argument order (engine/gfx/post/composite.ts). */
export const FILTER_UNIFORMS = [
  'frame',
  'cel',
  'cel2',
  'pixel',
  'palette',
  'outline',
  'outline2',
  'outline3',
  'outline4',
  'stylize',
  'stylize2',
  'grade',
  'grade2',
  'grade3',
  'grade4',
  'scanlines',
  'grain',
  'screen',
  'lens',
  'dof',
  'tilt',
  'flare',
  'streaks',
  'streaks2',
  'sharpen',
  'misregister',
  'water',
  'water2',
  'paper',
  'paper2',
  'split',
  'split2',
  'split3',
  'selective',
  'duo1',
  'duo2',
  'duo3',
  'crt',
  'vhs',
  'speed',
  'speed2',
  'vig',
  'vig2',
  'letterbox',
  'am0',
  'am1',
  'am2',
  'am3',
  'am4',
  'am5',
  'am6',
] as const;

/**
 * The composite's uniforms (see the file comment). `frame` is (show, time in s, the dither's cells across and down):
 * `show` 0 is the picture, 1 the parts, 2 the normals, 3 the outline groups; the cells count blocks from where the
 * chain snapped the camera (engine/gfx/post/chain.ts). The rest pack each filter as `writeFilters` says.
 */
export type FilterUniforms = Record<(typeof FILTER_UNIFORMS)[number], Vec>;

/** Makes the composite's uniforms, every filter off. */
export function createFilterUniforms(): FilterUniforms {
  const uniforms = Object.fromEntries(
    FILTER_UNIFORMS.map((name) => [name, uniform(new Vector4()).setGroup(renderGroup)]),
  ) as FilterUniforms;
  writeFilters(uniforms, chainOf());
  return uniforms;
}

/** A colour field's sRGB components, 0 to 1 (black for '' or anything the checks let through that is no colour). */
function srgb(hex: string): [number, number, number] {
  if (!/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(hex) && !Object.hasOwn(Color.NAMES, hex.toLowerCase())) return [0, 0, 0];
  const c = new Color(hex).getRGB({ r: 0, g: 0, b: 0 }, SRGBColorSpace);
  return [c.r, c.g, c.b];
}

/** Writes `chain` into `uniforms` (null: every filter off): a uniform write per filter, nothing more. */
export function writeFilters(uniforms: FilterUniforms, chain: FilterChain | null): void {
  for (const name of FILTER_UNIFORMS) if (name !== 'frame') uniforms[name].value.set(0, 0, 0, 0);
  for (let i = 0; i <= 6; i++) uniforms[`am${i}` as 'am0'].value.set(1, 1, 1, 1);
  if (!chain) return;
  const u = uniforms;
  const m = (name: FilterName) => scopeMask(chain[name].scope as Parameters<typeof scopeMask>[0]);
  for (const [name, [i, axis]] of Object.entries(AMOUNT_SLOTS)) {
    u[`am${i}` as 'am0'].value[axis] = chain[name as FilterName].amount;
  }
  const { cel, pixel, palette, outline, stylize, grade, scanlines, grain, chroma, screen } = chain;
  u.cel.value.set(m('cel'), cel.bands, cel.punch, cel.ink);
  u.cel2.value.set(cel.inkWidth, 0, 0, 0);
  // The blocks cannot fade, so a pixel filter under half its amount is off (see the file comment).
  u.pixel.value.set(pixel.amount < 0.5 ? 0 : m('pixel'), pixel.size, pixel.levels, pixel.outline ? 1 : 0);
  u.palette.value.set(m('palette'), PALETTES.indexOf(palette.palette), palette.levels, palette.dither);
  u.outline.value.set(m('outline'), outline.width, outline.darken, outline.depth);
  const line = outline.color ? srgb(outline.color) : null;
  u.outline2.value.set(line?.[0] ?? 0, line?.[1] ?? 0, line?.[2] ?? 0, line ? 1 : 0);
  u.outline3.value.set(outline.crease, outline.fade, outline.fadeStart, outline.fadeEnd);
  u.outline4.value.set(outline.wobble, outline.boil, 0, 0);
  u.stylize.value.set(m('stylize'), STYLIZE_KINDS.indexOf(stylize.style) + 1, stylize.size, stylize.mix);
  u.stylize2.value.set(stylize.color, 0, 0, 0);
  u.grade.value.set(m('grade'), grade.temperature, grade.tint, grade.contrast);
  u.grade2.value.set(grade.brightness, grade.saturation, 0, 0);
  u.grade3.value.set(grade.lift, grade.gamma, grade.vibrance, grade.hue);
  u.grade4.value.set(grade.sepia, grade.bleach, 0, 0);
  u.scanlines.value.set(m('scanlines'), scanlines.strength, scanlines.period, 0);
  u.grain.value.set(m('grain'), grain.amount, m('chroma'), chroma.amount);
  const blocks = screen.amount < 0.5 ? 1 : screen.pixelate;
  u.screen.value.set(m('screen'), screen.curvature * screen.amount, screen.vignette, blocks);
  writeMore(u, chain, m);
}

/** The filters Style Lab brought (engine/gfx/post/filterFieldsMore.ts), as `writeFilters` packs them. */
function writeMore(u: FilterUniforms, chain: FilterChain, m: (name: FilterName) => number): void {
  const { lens, dof, tiltshift, flare, streaks, sharpen, misregister, watercolor, paper } = chain;
  const { split, selective, duotone, crt, vhs, speedlines, vignette, letterbox } = chain;
  u.lens.value.set(m('lens'), lens.distortion * lens.amount, 0, 0);
  u.dof.value.set(m('dof'), dof.focus, dof.range, dof.blur);
  u.tilt.value.set(m('tiltshift'), tiltshift.center, tiltshift.width, tiltshift.blur);
  u.flare.value.set(m('flare'), flare.intensity, flare.threshold, flare.spacing);
  u.streaks.value.set(m('streaks'), streaks.intensity, streaks.threshold, streaks.length);
  u.streaks2.value.set(...srgb(streaks.tint), 0);
  u.sharpen.value.set(m('sharpen'), sharpen.strength, sharpen.radius, 0);
  u.misregister.value.set(m('misregister'), misregister.offset, misregister.angle, 0);
  u.water.value.set(m('watercolor'), watercolor.wobble * watercolor.amount, watercolor.bleed, watercolor.edges);
  u.water2.value.set(watercolor.granulation, 0, 0, 0);
  u.paper.value.set(m('paper'), PAPER_KINDS.indexOf(paper.kind), paper.scale, paper.strength);
  u.paper2.value.set(...srgb(paper.color), 0);
  u.split.value.set(m('split'), split.balance, 0, 0);
  u.split2.value.set(...srgb(split.shadows), 0);
  u.split3.value.set(...srgb(split.highlights), 0);
  u.selective.value.set(m('selective'), selective.hue, selective.range, 0);
  u.duo1.value.set(...srgb(duotone.dark), m('duotone'));
  u.duo2.value.set(...srgb(duotone.mid), 0);
  u.duo3.value.set(...srgb(duotone.light), 0);
  u.crt.value.set(m('crt'), crt.mask, crt.glow, crt.flicker);
  u.vhs.value.set(m('vhs'), vhs.jitter * vhs.amount, vhs.bleed, vhs.noise);
  u.speed.value.set(m('speedlines'), speedlines.density, speedlines.clear, speedlines.x);
  u.speed2.value.set(speedlines.y, ...srgb(speedlines.color));
  u.vig.value.set(m('vignette'), vignette.strength, vignette.softness, vignette.roundness);
  u.vig2.value.set(...srgb(vignette.color), 0);
  u.letterbox.value.set(m('letterbox') > 0 ? letterbox.aspect : 0, ...srgb(letterbox.color));
}
