/**
 * @file The filters (PLAN.md WP 7.4, §6.7): what each one takes, as data, and the uniforms the composite reads them
 * through. A filter chain is plain data (`FILTER_FIELDS`, the `filters` of a look, engine/gfx/post/looks.ts): every
 * filter has a `scope` (`off`, `all`, or the characters, the objects, the environment and their pairs) and its
 * numbers. `createFilterUniforms` makes one set of uniforms, set up once; `writeFilters` copies a chain into them, so
 * switching a filter, its scope or a number is a uniform write: nothing recompiles and no pipeline is built.
 *
 * The composite applies them in a fixed order (engine/gfx/post/composite.ts): `cel` (light in flat bands that keep
 * each colour's hue, pushed colour, ink at sharp changes and round actors' silhouettes, the prototype's comic cel);
 * `pixel` (blocks on the scoped parts and on objects tagged pixel art, whole silhouettes stepping in blocks, a
 * one-block dark rim, the colours posterized) and `palette` (levels per channel or a fixed palette, with ordered
 * Bayer dithering); `outline` (edges from depth, crease and outline group); `stylize` (oil paint, CMYK halftone, ASCII
 * and pencil); `grade` (temperature, tint, contrast, brightness, saturation); then the screen: `scanlines`, `grain`
 * and `chroma` (colour fringes) by scope, and `screen` (CRT curvature, vignette, low resolution) over everything.
 * `bloom` runs before the composite, on the scene's light, and is never scoped; `aa` (engine/gfx/post/aa.ts) smooths
 * the picture before the filters, so blocks, dots and dither stay crisp. Those three take only `off` or `all`, and so
 * do the shading's (WP 11.5, engine/gfx/post/shading.ts: `ao`, `gi`, `ssr` and `air`), on the scene's light first.
 *
 * Shardfall's lessons, kept: levels per channel are 0 (off) or 8 and more (24 suits pixel art), since fewer shift the
 * hue of dull colours (`shardfall:docs/HISTORY.md:424-426`; a grey floor went pink at 5–6 levels); the pixel filter
 * snaps the camera to its block grid (`snap`) while the environment is pixel art, so it does not shimmer as the
 * camera slides (engine/gfx/post/chain.ts's `snapBlock`).
 *
 * Carried from `my-3d2dge:src/stress-world/45-filters.js` (cel, pixel, Bayer dither, the `keep(m)` scope) and
 * `shardfall:crates/pav_render/src/scene.rs:409-500` (the filters' numbers and defaults, keys renamed).
 *
 * Invariants: every number has its range in the schema; `scopeMask` gives 0 for `off` and 7 for `all`; the uniforms
 * are render-group uniforms, written only by `writeFilters` (and the chain's per-frame numbers).
 *
 * @example
 * scopeMask('characters+objects'); // 3
 * const uniforms = createFilterUniforms();
 * writeFilters(uniforms, chainOf({ pixel: { scope: 'environment', size: 6 } }));
 * uniforms.pixel.value.toArray(); // [4, 6, 0, 1]: environment, 6 px blocks, full colour, a rim
 * @see engine/gfx/post/filters.test.ts
 * @see tests/e2e/post.spec.ts
 */
import { Color, SRGBColorSpace, Vector4 } from 'three/webgpu';
import { renderGroup, uniform } from 'three/tsl';
import { parse, type EntryOf, type Field, type Schema } from '../../core/schema';
import { PART_BITS } from './mrt';

/** Where a filter applies: nowhere, everywhere, or one or two parts of the scene (engine/gfx/post/mrt.ts). */
export const SCOPES = [
  'off',
  'all',
  'characters',
  'objects',
  'environment',
  'characters+objects',
  'characters+environment',
  'objects+environment',
] as const;

/** A filter's scope. */
export type Scope = (typeof SCOPES)[number];

/** The scopes of the filters that cover the whole screen. */
export const SCREEN_SCOPES = ['off', 'all'] as const;

/** The fixed palettes (sRGB): Game Boy greens, PICO-8's sixteen, CGA, 1-bit, an amber terminal. */
export const PALETTES = ['none', 'gameboy', 'pico8', 'cga', '1bit', 'amber'] as const;

/** The painterly and print styles. */
export const STYLIZE_KINDS = ['paint', 'halftone', 'ascii', 'sketch'] as const;

/** Every filter, in the composite's order (the shading's, bloom and aa run before it). */
export const FILTER_NAMES = [
  'ao',
  'gi',
  'ssr',
  'air',
  'bloom',
  'aa',
  'cel',
  'pixel',
  'palette',
  'outline',
  'stylize',
  'grade',
  'scanlines',
  'grain',
  'chroma',
  'screen',
] as const;

/** A filter's name. */
export type FilterName = (typeof FILTER_NAMES)[number];

/** The bits of a scope: characters 1, objects 2, environment 4; `off` 0. */
export function scopeMask(scope: Scope): number {
  if (scope === 'off') return 0;
  if (scope === 'all') return 7;
  const bit = { characters: PART_BITS.character, objects: PART_BITS.object, environment: PART_BITS.environment };
  return scope.split('+').reduce((mask, part) => mask | bit[part as keyof typeof bit], 0);
}

const num = (description: string, value: number, minimum: number, maximum: number, unit?: string) =>
  ({ type: 'number', default: value, minimum, maximum, description, ...(unit ? { unit } : {}) }) as const;
const int = (description: string, value: number, minimum: number, maximum: number, unit?: string) =>
  ({ type: 'integer', default: value, minimum, maximum, description, ...(unit ? { unit } : {}) }) as const;
const scope = (screen = false) =>
  ({
    type: 'string',
    enum: screen ? SCREEN_SCOPES : SCOPES,
    default: 'off',
    description: screen
      ? "'all' turns it on over the whole picture; 'off' turns it off."
      : "Where it applies: 'off', 'all', or 'characters', 'objects', 'environment' or two of them joined by '+'.",
  }) as const;
/** An object field whose default holds every property's default. */
const filter = <const P extends Schema>(description: string, properties: P) => {
  const defaults = Object.fromEntries(Object.entries(properties).map(([key, field]) => [key, field.default]));
  return { type: 'object', default: defaults, description, properties } as const;
};

/** The filters of a chain; see the file comment. Sizes are in the picture's own pixels (px). */
export const FILTER_FIELDS = {
  ao: filter('Ambient occlusion (GTAO, engine/gfx/post/shading.ts): creases and corners darken; never scoped.', {
    scope: scope(true),
    strength: num('How dark the occlusion gets (1 is its full measure).', 1, 0, 2),
    radius: num('How far round a point it looks for what hides it.', 0.6, 0.05, 4, 'm'),
  }),
  gi: filter(
    'Bounce light (12 taps a pixel): lit surfaces colour their neighbours, with soft occlusion; never scoped.',
    {
      scope: scope(true),
      strength: num('How much bounced light adds.', 1, 0, 4),
      radius: num('How far light bounces.', 1.6, 0.1, 6, 'm'),
    },
  ),
  ssr: filter('Screen-space reflections on metal surfaces (SSRNode), blurred on rough ones; never scoped.', {
    scope: scope(true),
    strength: num('How strongly reflections show, 0 to 1.', 1, 0, 1),
    distance: num('How far a reflected ray travels.', 6, 0.5, 50, 'm'),
    thickness: num('How thick a surface counts as, for a ray passing behind it.', 0.15, 0.01, 2, 'm'),
  }),
  air: filter('Hazy air with light shafts where the sun breaks through, and halos round lamps; never scoped.', {
    scope: scope(true),
    haze: num('How thick the haze is.', 0.35, 0, 3),
    height: num('How high the haze reaches above the ground before it thins.', 4, 0.2, 20, 'm'),
    shafts: num('How bright sunlight shines through the haze (cut by shadows: light shafts).', 1, 0, 3),
    forward: num('How much the haze scatters light forward, toward the sun (0 evenly).', 0.4, -0.9, 0.95),
    halos: num('How strongly lamps glow in the air round them.', 0.3, 0, 3),
  }),
  bloom: filter("Bright parts glow (three.js's BloomNode), before the composite, never scoped.", {
    scope: scope(true),
    strength: num('How strongly the glow adds.', 0.6, 0, 3),
    threshold: num('The luminance a pixel must pass to glow.', 0.9, 0, 4),
    radius: num('How far the glow spreads, 0 to 1.', 0.4, 0, 1),
  }),
  aa: filter('Edge smoothing over the picture before the filters (engine/gfx/post/aa.ts).', { scope: scope(true) }),
  cel: filter('Comic cel: light in flat bands keeping each colour hue, pushed colour, ink at sharp changes.', {
    scope: scope(),
    bands: int('Bands of brightness.', 4, 2, 8),
    punch: num('Colour saturation after banding (1 keeps it).', 1.3, 0, 3),
    ink: num("How dark the ink lines are, 0 to 1 (the lines' opacity).", 0.9, 0, 1),
    inkWidth: num('How far apart the ink compares pixels.', 1.5, 0.5, 4, 'px'),
  }),
  pixel: filter('Pixel art: whole blocks on the scoped parts and on objects tagged pixel art.', {
    scope: scope(),
    size: int(
      'The block size; 0 takes the largest whole block giving the picture 240 to 360 lines (`artBlock`).',
      4,
      0,
      32,
      'px',
    ),
    levels: int(
      'Shades per channel for the blocks: 0 keeps every colour, else 8 or more (24 suits pixel art).',
      0,
      0,
      64,
    ),
    outline: { type: 'boolean', default: true, description: 'A dark one-block rim outside pixel-art silhouettes.' },
    snap: {
      type: 'boolean',
      default: true,
      description: 'Snap the camera to the block grid while the environment is pixel art, so it does not shimmer.',
    },
    smooth: {
      type: 'boolean',
      default: false,
      description:
        "Carry the snapped camera's sub-block remainder as a smooth offset of the whole picture on the page (its canvas needs a margin of two drawn pixels, `--my3dge-pixel` each).",
    },
  }),
  palette: filter('Colour reduction: levels per channel or a fixed palette, with ordered (Bayer) dithering.', {
    scope: scope(),
    palette: { type: 'string', enum: PALETTES, default: 'none', description: "A fixed palette, or 'none' for levels." },
    levels: int('Shades per channel without a palette: 0 keeps every colour, else 8 or more.', 8, 0, 64),
    dither: num('How much ordered dithering mixes neighbouring shades, 0 to 1.', 0, 0, 1),
  }),
  outline: filter('Outlines where depth jumps, surfaces crease or outline groups meet.', {
    scope: scope(),
    width: int('Line width.', 1, 1, 4, 'px'),
    lines: int(
      "Scale the width with the picture: `width` px at this many lines, in whole pixels; 0 doesn't.",
      0,
      0,
      2160,
    ),
    darken: num('The line is the surface times this (0 is black), unless a colour is given.', 0.35, 0, 1),
    color: {
      type: 'string',
      default: '',
      description: "The line's colour: hex ('#1a1a2e') or a CSS colour name ('black'); '' darkens the surface instead.",
    },
    depth: num('The depth jump that makes an edge, as a share of the distance.', 0.02, 0.001, 1),
    crease: num('Neighbouring normals whose dot product falls below this make an edge.', 0.6, -1, 1),
  }),
  stylize: filter('Painterly and print styles: oil paint, CMYK halftone, ASCII and pencil.', {
    scope: scope(),
    style: { type: 'string', enum: STYLIZE_KINDS, default: 'paint', description: 'Which style.' },
    size: num('The stroke, dot, character or hatching size.', 4, 1, 24, 'px'),
    mix: num('How much of the style shows over the picture, 0 to 1.', 1, 0, 1),
    color: num("How much of the picture's colour is kept, 0 to 1.", 1, 0, 1),
  }),
  grade: filter('Colour grading.', {
    scope: scope(),
    temperature: num('Warmer (above 0) or cooler (below).', 0, -1, 1),
    tint: num('Toward green (above 0) or away.', 0, -1, 1),
    contrast: num('Contrast round mid grey (1 keeps it).', 1, 0, 3),
    brightness: num('A multiplier on the colour (1 keeps it).', 1, 0, 3),
    saturation: num('0 is grey, 1 keeps the colour, more pushes it.', 1, 0, 3),
  }),
  scanlines: filter('Dark lines across the screen, as on a tube.', {
    scope: scope(),
    strength: num('How dark the lines are, 0 to 1.', 0.5, 0, 1),
    period: num('Lines this far apart.', 3, 1, 16, 'px'),
  }),
  grain: filter('Film grain that changes every frame.', {
    scope: scope(),
    amount: num('How strong the grain is, 0 to 1.', 0.35, 0, 1),
  }),
  chroma: filter('Colour fringes: red and blue pulled apart toward the screen edges.', {
    scope: scope(),
    amount: num('How far apart, 0 to 1.', 0.5, 0, 1),
  }),
  screen: filter('The screen itself: CRT curvature, a vignette, low resolution.', {
    scope: scope(true),
    curvature: num('Barrel curvature (0 is flat); black outside the tube.', 0, 0, 0.5),
    vignette: num('How dark the corners are, 0 to 1.', 0, 0, 1),
    pixelate: int('The whole screen in blocks this big (1 is off).', 1, 1, 16, 'px'),
  }),
} as const satisfies Schema;

/** A filter chain: every filter with its scope and numbers. */
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

export { colorProblem, fixColor, fixLevels, levelsProblem } from './filterChecks';

/** The composite's uniforms: one vec4 per filter (and a second for the long ones), render-group, set up once. */
export interface FilterUniforms {
  /**
   * (show, time in s, the dither's cells across and down): `show` 0 is the picture, 1 the parts, 2 the normals, 3 the
   * outline groups; the cells count blocks from where the chain snapped the camera (engine/gfx/post/chain.ts).
   */
  frame: ReturnType<typeof uniform<Vector4>>;
  /** (mask, bands, punch, ink). */
  cel: ReturnType<typeof uniform<Vector4>>;
  /** (ink width, 0, 0, 0). */
  cel2: ReturnType<typeof uniform<Vector4>>;
  /** (mask, block size, levels, rim 0 or 1). */
  pixel: ReturnType<typeof uniform<Vector4>>;
  /** (mask, palette index, levels, dither). */
  palette: ReturnType<typeof uniform<Vector4>>;
  /** (mask, width, darken, depth threshold). */
  outline: ReturnType<typeof uniform<Vector4>>;
  /** (r, g, b of the line's colour, 1 when a colour is given), sRGB. */
  outline2: ReturnType<typeof uniform<Vector4>>;
  /** (crease threshold, 0, 0, 0). */
  outline3: ReturnType<typeof uniform<Vector4>>;
  /** (mask, style 1–4, size, mix). */
  stylize: ReturnType<typeof uniform<Vector4>>;
  /** (colour kept, 0, 0, 0). */
  stylize2: ReturnType<typeof uniform<Vector4>>;
  /** (mask, temperature, tint, contrast). */
  grade: ReturnType<typeof uniform<Vector4>>;
  /** (brightness, saturation, 0, 0). */
  grade2: ReturnType<typeof uniform<Vector4>>;
  /** (mask, strength, period, 0). */
  scanlines: ReturnType<typeof uniform<Vector4>>;
  /** (grain mask, grain amount, chroma mask, chroma amount). */
  grain: ReturnType<typeof uniform<Vector4>>;
  /** (on, curvature, vignette, pixelate). */
  screen: ReturnType<typeof uniform<Vector4>>;
}

/** Makes the composite's uniforms, every filter off. */
export function createFilterUniforms(): FilterUniforms {
  const vec = () => uniform(new Vector4()).setGroup(renderGroup);
  const uniforms = {
    frame: vec(),
    cel: vec(),
    cel2: vec(),
    pixel: vec(),
    palette: vec(),
    outline: vec(),
    outline2: vec(),
    outline3: vec(),
    stylize: vec(),
    stylize2: vec(),
    grade: vec(),
    grade2: vec(),
    scanlines: vec(),
    grain: vec(),
    screen: vec(),
  };
  writeFilters(uniforms, chainOf());
  return uniforms;
}

/** Writes `chain` into `uniforms`: a uniform write per filter, nothing more. */
export function writeFilters(uniforms: FilterUniforms, chain: FilterChain): void {
  const { cel, pixel, palette, outline, stylize, grade, scanlines, grain, chroma, screen } = chain;
  uniforms.cel.value.set(scopeMask(cel.scope), cel.bands, cel.punch, cel.ink);
  uniforms.cel2.value.set(cel.inkWidth, 0, 0, 0);
  uniforms.pixel.value.set(scopeMask(pixel.scope), pixel.size, pixel.levels, pixel.outline ? 1 : 0);
  uniforms.palette.value.set(
    scopeMask(palette.scope),
    PALETTES.indexOf(palette.palette),
    palette.levels,
    palette.dither,
  );
  uniforms.outline.value.set(scopeMask(outline.scope), outline.width, outline.darken, outline.depth);
  // The composite works in display colours, so the line's colour goes in as sRGB.
  const line = outline.color ? new Color(outline.color).getRGB({ r: 0, g: 0, b: 0 }, SRGBColorSpace) : null;
  uniforms.outline2.value.set(line?.r ?? 0, line?.g ?? 0, line?.b ?? 0, line ? 1 : 0);
  uniforms.outline3.value.set(outline.crease, 0, 0, 0);
  const style = STYLIZE_KINDS.indexOf(stylize.style) + 1;
  uniforms.stylize.value.set(scopeMask(stylize.scope), style, stylize.size, stylize.mix);
  uniforms.stylize2.value.set(stylize.color, 0, 0, 0);
  uniforms.grade.value.set(scopeMask(grade.scope), grade.temperature, grade.tint, grade.contrast);
  uniforms.grade2.value.set(grade.brightness, grade.saturation, 0, 0);
  uniforms.scanlines.value.set(scopeMask(scanlines.scope), scanlines.strength, scanlines.period, 0);
  uniforms.grain.value.set(scopeMask(grain.scope), grain.amount, scopeMask(chroma.scope), chroma.amount);
  uniforms.screen.value.set(scopeMask(screen.scope), screen.curvature, screen.vignette, screen.pixelate);
}
