/**
 * @file The first sixteen filters' fields (PLAN.md WP 7.4, WP 11.5; WP 13.31 adds to `grade` and `outline`): the
 * shading's (`ao`, `gi`, `ssr`, `air`), `bloom` and `aa`, which run before the composite and take only `off` or `all`,
 * and the composite's own (`cel`, `pixel`, `palette`, `outline`, `stylize`, `grade`, `scanlines`, `grain`, `chroma`,
 * `screen`). engine/gfx/post/filters.ts says what each does in the picture and in which order; the filters Style Lab
 * brought are engine/gfx/post/filterFieldsMore.ts's. Sizes are in the picture's own pixels, unless a field says
 * "at 1080 lines".
 *
 * WP 13.31 adds Style Lab's further grade (michaelcrosato/my-ai-3d-demo@34c6fa1, src/runtime/registry/grade.js:
 * lift, gamma, vibrance, hue, sepia, bleach bypass) and line options (src/runtime/registry/lines.js: distance fade,
 * wobble and boil), each defaulting to the value that leaves the picture as it was.
 *
 * Invariants: every number has its range; every new field's default changes nothing, so a look written before them
 * draws as it did.
 *
 * @example
 * CORE_FILTER_FIELDS.grade.properties.hue.default; // 0
 * @see engine/gfx/post/filters.test.ts
 */
import { COLOR_UNIT, filter, int, num, scope } from './filterSchema';

/** The fixed palettes (sRGB): Game Boy greens, PICO-8's sixteen, CGA, 1-bit, an amber terminal. */
export const PALETTES = ['none', 'gameboy', 'pico8', 'cga', '1bit', 'amber'] as const;

/** The painterly and print styles. */
export const STYLIZE_KINDS = ['paint', 'halftone', 'ascii', 'sketch'] as const;

/** The first sixteen filters (see the file comment); engine/gfx/post/filters.ts orders them with the rest. */
export const CORE_FILTER_FIELDS = {
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
      unit: COLOR_UNIT,
      description: "The line's colour: hex ('#1a1a2e') or a CSS colour name ('black'); '' darkens the surface instead.",
    },
    depth: num('The depth jump that makes an edge, as a share of the distance.', 0.02, 0.001, 1),
    crease: num('Neighbouring normals whose dot product falls below this make an edge.', 0.6, -1, 1),
    fade: num('How much the lines fade with distance, 0 to 1, from fadeStart to fadeEnd.', 0, 0, 1),
    fadeStart: num('Where the lines start to fade.', 25, 0, 500, 'm'),
    fadeEnd: num('Where they have faded by `fade`.', 120, 1, 2000, 'm'),
    wobble: num('How far the lines wobble, hand-drawn, in pixels at 1080 lines.', 0, 0, 4, 'px'),
    boil: num('How many times a second the wobble is redrawn (line boil); 0 keeps it still.', 0, 0, 24),
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
    lift: num('Raises (above 0) or deepens (below) the shadows, an offset on every channel.', 0, -0.3, 0.3),
    gamma: num('The midtones: above 1 darker, below 1 lighter (1 keeps them).', 1, 0.5, 2),
    vibrance: num('Saturates the duller colours most (above 0), or mutes them (below).', 0, -1, 1),
    hue: num('Turns every hue round the colour wheel.', 0, -180, 180, '°'),
    sepia: num('How far toward old-photograph sepia, 0 to 1.', 0, 0, 1),
    bleach: num(
      "Bleach bypass: the picture overlaid with its own grey, film's crushed, silvery look, 0 to 1.",
      0,
      0,
      1,
    ),
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
} as const;
