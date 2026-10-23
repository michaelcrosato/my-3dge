/**
 * @file Looks (PLAN.md WP 7.4, §6.6 kind `look`): a material style (WP 7.2, engine/gfx/materials/styles.ts) plus a
 * filter chain (engine/gfx/post/filters.ts), as data, and the sky that lights the scene (WP 7.8, a `sky` id,
 * engine/gfx/sky.ts). A look names what it changes; every filter it leaves out is off, and a style or sky of `''`
 * keeps the scene's own. The chain draws the look the setting `post.look` names (engine/gfx/post/chain.ts); switching
 * looks writes uniforms and re-points materials to styles the warm-up has already compiled, so it builds no
 * pipeline. A look's sky is shown by the pages `createEngine` starts (engine/app/look.ts): the stage's lights give way
 * to it (engine/gfx/stageSky.ts), which changes the shader key, so a look with another sky warms up before it draws.
 *
 * The entries are seeded from shardfall's tuned presets (`shardfall:crates/pav_view/src/looks.toml`, with
 * `look.rs:100-353`), keys renamed: its whole looks are here (`look:hd-2d`, `look:game-boy`…), and its one-section
 * presets are looks of their own, grouped by the filter they set (`look:palette/game-boy`, `look:stylize/oil-paint`,
 * engine/gfx/post/presets.ts). Its "objects" (characters and objects) is the scope `characters+objects`. Its air and
 * bounce light came with WP 11.5 (the `air` and `gi` sections, engine/gfx/post/shading.ts): the looks Sunbeams and
 * Lamplit fog, and their presets. Left out: styles that differ by part and the knobs WP 7.2's styles lack
 * (`flat_shadow`, `specular`, `exposure`), so four looks keep the scene's style where shardfall styled the parts
 * apart. One rename for the lesson: "64 colours" posterized to 4 levels, which shifts the hue of dull colours, so it
 * is `look:palette/512-colours`, at 8.
 *
 * Invariants: every look's levels are 0 or 8 and more (the kind's check); a missing id falls back to `look:clean`
 * with a warning naming the closest ids; looks read their fields, never their ids. A game's own look is scaffolded by
 * `node x new look labs/<lab>/looks/<name>` (tools/templates/look/).
 *
 * @example
 * import { createRegistry } from '../../core/registry';
 * const registry = createRegistry();
 * defineLooks(registry);
 * registry.get('look', 'look:game-boy').filters.palette.palette; // 'gameboy'
 * registry.list('look').length; // 98
 * @see engine/gfx/post/looks.test.ts
 * @see tests/e2e/post.spec.ts
 */
import { galleryField } from '../../core/gallery';
import { registry as sharedRegistry, type Entry, type Registry } from '../../core/registry';
import type { EntryOf, Schema } from '../../core/schema';
import { MATERIAL_STYLES } from '../materials/styles';
import { TOON_LOOK } from '../materials/toon';
import { colorProblem, FILTER_FIELDS, FILTER_NAMES, levelsProblem, type FilterSpec } from './filters';
import { PRESETS } from './presets';

/** Where a menu lists a look: `look` for a whole look, else the filter it presets, or `shading` for a style. */
export const LOOK_GROUPS = ['look', 'shading', ...FILTER_NAMES] as const;

/** The default of every filter: all of them off. */
const OFF = Object.fromEntries(Object.entries(FILTER_FIELDS).map(([name, field]) => [name, field.default]));

/** The fields of a `look` entry; see the file comment. */
export const LOOK_FIELDS = {
  description: { type: 'string', default: '', description: 'What it looks like, in plain sentences.' },
  group: {
    type: 'string',
    enum: LOOK_GROUPS,
    default: 'look',
    description: "Where a menu lists it: 'look' for a whole look, else the filter it presets ('shading' for a style).",
  },
  style: {
    type: 'string',
    enum: ['', ...MATERIAL_STYLES],
    default: '',
    description: "The material style everything is drawn in (lambert, toon, flat, pbr); '' keeps the scene's own.",
  },
  sky: {
    type: 'string',
    default: '',
    description:
      "The sky preset that lights the scene (a 'sky' id: sky:hall, the torch-lit hall); '' keeps the scene's own lights.",
  },
  toon: {
    type: 'object',
    default: { ...TOON_LOOK },
    description: "The toon style's bands and rim, used when the style is 'toon'.",
    properties: {
      bands: { type: 'integer', default: TOON_LOOK.bands, minimum: 2, maximum: 8, description: 'Bands of light.' },
      rim: { type: 'number', default: TOON_LOOK.rim, minimum: 0, maximum: 1, description: "The rim light's strength." },
    },
  },
  filters: {
    type: 'object',
    default: OFF,
    description: 'The filter chain: each filter it names, with its scope and numbers; the rest are off.',
    properties: FILTER_FIELDS,
  },
  gallery: galleryField({ camera: 'cam=iso' }),
} as const satisfies Schema;

/** A `look` entry. */
export type LookEntry = Entry<typeof LOOK_FIELDS>;

/** What `defineLook` takes: any of the fields, the filters as part of a chain. */
export type LookSpec = Partial<Omit<EntryOf<typeof LOOK_FIELDS>, 'filters' | 'toon'>> & {
  toon?: Partial<LookEntry['toon']>;
  filters?: FilterSpec;
};

/** The whole looks, from shardfall's `[[look]]` tables (see the file comment), and the clean picture. */
export const LOOKS: Record<string, LookSpec> = {
  'look:clean': { description: 'No filter: the picture as the scene draws it, in its own style.' },
  'look:pixel-heroes': {
    description: 'A clean, sharp world; the characters and objects are outlined pixel art.',
    filters: { pixel: { scope: 'characters+objects', size: 5, outline: true } },
  },
  'look:hd-2d': {
    description: 'Pixel-art characters and objects in a soft, glowing 3D world with dark corners.',
    filters: {
      pixel: { scope: 'characters+objects', size: 4, outline: true },
      bloom: { scope: 'all', strength: 1, threshold: 0.7 },
      screen: { scope: 'all', vignette: 0.55 },
      grade: { scope: 'environment', temperature: 0.25, saturation: 1.2, contrast: 1.08 },
    },
  },
  'look:pixel-world': {
    description: 'The environment is pixel art; the characters and objects stay sharp and inked.',
    filters: {
      pixel: { scope: 'environment', size: 5, outline: false },
      outline: { scope: 'characters+objects', width: 2, darken: 0 },
    },
  },
  'look:game-boy-world': {
    description:
      'The environment in four Game Boy greens; the characters and objects in full colour with ink outlines.',
    filters: {
      palette: { scope: 'environment', palette: 'gameboy', dither: 0.6 },
      outline: { scope: 'characters+objects', width: 2, darken: 0 },
    },
  },
  'look:game-boy': {
    description: 'Everything in four greens, pixelated and dithered.',
    filters: {
      pixel: { scope: 'all', size: 4, outline: false },
      palette: { scope: 'all', palette: 'gameboy', dither: 0.6 },
    },
  },
  'look:16-bit': {
    description: 'The whole scene as 16-bit pixel art with a slightly vivid grade.',
    filters: {
      pixel: { scope: 'all', size: 4, levels: 24, outline: true },
      grade: { scope: 'all', saturation: 1.15, contrast: 1.05 },
    },
  },
  'look:cartoon': {
    description: 'Toon shading everywhere, bold ink outlines and vivid colour.',
    style: 'toon',
    toon: { bands: 2, rim: 0.4 },
    filters: {
      outline: { scope: 'all', width: 2, darken: 0 },
      grade: { scope: 'all', saturation: 1.3, contrast: 1.1 },
    },
  },
  'look:comic-noir': {
    description: 'A black-and-white world; the characters and objects keep their colour, inked.',
    filters: {
      grade: { scope: 'environment', saturation: 0, contrast: 1.35, brightness: 0.95 },
      outline: { scope: 'all', width: 2, darken: 0 },
      screen: { scope: 'all', vignette: 0.5 },
    },
  },
  'look:flat-paper': {
    description: 'Flat colours, thin outlines and a faded grade, like a printed page.',
    style: 'flat',
    filters: {
      outline: { scope: 'all', width: 1, darken: 0.3 },
      grade: { scope: 'all', saturation: 0.8, contrast: 0.9, brightness: 1.05, temperature: 0.15 },
      grain: { scope: 'all', amount: 0.15 },
    },
  },
  'look:arcade-crt': {
    description: 'Low resolution on a curved tube with scanlines, glow and colour fringes.',
    filters: {
      screen: { scope: 'all', pixelate: 3, curvature: 0.15, vignette: 0.5 },
      scanlines: { scope: 'all', strength: 0.5, period: 3 },
      chroma: { scope: 'all', amount: 0.3 },
      bloom: { scope: 'all', strength: 0.8, threshold: 0.9 },
    },
  },
  'look:hologram-heroes': {
    description: 'Characters and objects flicker like holograms: cool, scanlined and fringed. The world stays clean.',
    filters: {
      scanlines: { scope: 'characters+objects', strength: 0.7, period: 3 },
      grain: { scope: 'characters+objects', amount: 0.4 },
      chroma: { scope: 'characters+objects', amount: 0.8 },
      grade: { scope: 'characters+objects', temperature: -0.8, tint: 0.3, brightness: 1.15 },
      bloom: { scope: 'all', strength: 0.9, threshold: 0.8 },
    },
  },
  'look:posterized-world': {
    description: 'The environment in a few flat shades; the characters and objects in full colour.',
    filters: { palette: { scope: 'environment', palette: 'none', levels: 8, dither: 0 } },
  },
  'look:oil-painting': {
    description: 'The whole scene in oil paint: flat strokes, brush streaks, canvas.',
    filters: {
      stylize: { scope: 'all', style: 'paint', size: 6, color: 1 },
      grade: { scope: 'all', saturation: 1.15 },
    },
  },
  'look:painted-world': {
    description: 'A painted backdrop; the characters and objects stay sharp and inked on top of it.',
    filters: {
      stylize: { scope: 'environment', style: 'paint', size: 7, color: 1 },
      outline: { scope: 'characters+objects', width: 2, darken: 0.15 },
    },
  },
  'look:comic-book': {
    description: 'Printed dots on the world, inked heroes, punchy colour.',
    filters: {
      stylize: { scope: 'environment', style: 'halftone', size: 6, color: 1 },
      outline: { scope: 'all', width: 2, darken: 0.08 },
      grade: { scope: 'characters+objects', saturation: 1.3, contrast: 1.1 },
    },
  },
  'look:newspaper': {
    description: 'Black dots on cream paper, everything.',
    filters: { stylize: { scope: 'all', style: 'halftone', size: 5, color: 0 } },
  },
  'look:hacker-terminal': {
    description: 'The game as green characters on a curved, scanlined screen.',
    filters: {
      stylize: { scope: 'all', style: 'ascii', size: 8, color: 0 },
      screen: { scope: 'all', curvature: 0.1, vignette: 0.5 },
      scanlines: { scope: 'all', strength: 0.3, period: 3 },
    },
  },
  'look:sketchbook': {
    description: 'Pencil hatching and contours on paper.',
    filters: { stylize: { scope: 'all', style: 'sketch', size: 4, color: 0 } },
  },
  'look:sketched-world': {
    description: 'A coloured-pencil world; the characters and objects inked on top of it.',
    filters: {
      stylize: { scope: 'environment', style: 'sketch', size: 4, color: 1 },
      outline: { scope: 'characters+objects', width: 2, darken: 0.1 },
    },
  },
  'look:sunbeams': {
    description: 'Dusty air, sunlight streaming through the gaps, a soft glow.',
    filters: {
      air: { scope: 'all', haze: 0.7, height: 6, shafts: 2.4, forward: 0.6, halos: 0.3 },
      bloom: { scope: 'all', strength: 0.6, threshold: 1 },
    },
  },
  'look:lamplit-fog': {
    description: 'A foggy night where every lamp glows in the air.',
    filters: {
      air: { scope: 'all', haze: 0.9, height: 3, shafts: 0.4, forward: 0.3, halos: 1.8 },
      grade: { scope: 'all', temperature: -0.25, brightness: 0.9 },
    },
  },
};

/** The levels a look sets that break the posterize rule, and an outline colour that is none, as problems. */
function checkLook(entry: LookEntry): string[] {
  const { pixel, palette, outline } = entry.filters;
  return [
    levelsProblem(pixel.levels, 'filters.pixel.levels'),
    levelsProblem(palette.levels, 'filters.palette.levels'),
    colorProblem(outline.color, 'filters.outline.color'),
  ].filter((problem): problem is string => problem !== null);
}

/** Declares the kind `look` and the built-in looks and presets on `registry`, unless it has them. */
export function defineLooks(registry: Registry = sharedRegistry): void {
  if (!registry.kinds().includes('look')) {
    registry.defineKind('look', {
      description:
        'Looks: a material style plus a filter chain (post-processing), and the sky that lights it, as whole looks or one-filter presets.',
      fields: LOOK_FIELDS,
      fallback: 'look:clean',
      check: (entry) => checkLook(entry as LookEntry),
      defineWith:
        "defineLook('look:<name>', { description, style, toon, sky, filters: { pixel: { scope, size }, … } })",
    });
  }
  for (const [id, spec] of Object.entries({ ...LOOKS, ...PRESETS })) {
    if (!registry.has('look', id)) registry.def('look', id, spec as Record<string, unknown>);
  }
}
defineLooks();

/** Declares a look (`look:<name>`); see `LOOK_FIELDS`. */
export function defineLook(id: string, spec: LookSpec, registry: Registry = sharedRegistry): LookEntry {
  return registry.def('look', id, spec as Record<string, unknown>) as LookEntry;
}
