/**
 * @file The filters Style Lab brought (PLAN.md WP 13.31; michaelcrosato/my-ai-3d-demo@34c6fa1, its registry under
 * src/runtime/registry/ and its post stages), as data like every other filter (engine/gfx/post/filterFields.ts): the
 * lens (`lens` distortion, `dof`, `tiltshift`, `flare`, `streaks`), the media (`sharpen`, `misregister`,
 * `watercolor`, `paper`), the tone (`split`, `selective`, `duotone`; the grade's further steps are `grade`'s) and the
 * display (`crt`, `vhs`, `speedlines`, `vignette`, `letterbox`). Each has a `scope` and an `amount` like the rest;
 * the ones that act on the camera or the screen take only `off` or `all`.
 *
 * Their numbers and defaults are Style Lab's, tuned there by hand, with two changes: sizes are in pixels at 1080
 * lines, scaled to the picture's lines, so a look keeps its feel at every resolution (Style Lab's `px@1080p`), and
 * brightness thresholds are in 0–1, since the composite works on display colours after the tone mapping where
 * Style Lab's camera stage saw the HDR light.
 *
 * Invariants: every number has its range; every default is a look that changes the picture when the filter is on, so
 * `{ scope: 'all' }` alone shows it; colours are hex strings (`#rrggbb`), sRGB.
 *
 * @example
 * import { chainOf } from './filters';
 * chainOf({ letterbox: { scope: 'all' } }).letterbox.aspect; // 2.39
 * @see engine/gfx/post/filters.test.ts
 * @see tests/e2e/filters.spec.ts
 */
import { color, filter, num, scope } from './filterSchema';

/** The paper kinds, in the composite's order (engine/gfx/post/shaders/media.ts `post_paper`). */
export const PAPER_KINDS = ['newsprint', 'coldpress', 'canvas', 'kraft'] as const;

/** The filters Style Lab brought (see the file comment), in no order: engine/gfx/post/filters.ts orders them. */
export const MORE_FILTER_FIELDS = {
  lens: filter('Lens distortion: barrel (above 0) or pincushion (below), zoomed so the corners stay filled.', {
    scope: scope(true),
    distortion: num('How far the picture bulges (above 0) or pinches (below).', 0.12, -0.5, 0.5),
  }),
  dof: filter('Depth of field: sharp round the focus, blurred nearer and farther, as a camera lens draws it.', {
    scope: scope(true),
    focus: num("The distance in focus; 0 focuses on what is at the screen's centre.", 0, 0, 500, 'm'),
    range: num('How deep the sharp zone is round the focus.', 8, 0.5, 60, 'm'),
    blur: num('The widest blur, in pixels at 1080 lines.', 6, 0, 24, 'px'),
  }),
  tiltshift: filter('Tilt-shift: a sharp horizontal band, the rest blurred, so the scene looks like a miniature.', {
    scope: scope(true),
    center: num('Where the sharp band sits, 0 the bottom of the screen and 1 its top.', 0.55, 0, 1),
    width: num("The sharp band's height, as a share of the screen's.", 0.18, 0.02, 0.8),
    blur: num('The blur away from the band, in pixels at 1080 lines.', 8, 0, 24, 'px'),
  }),
  flare: filter('Lens flare: ghosts of the brightest parts mirrored through the centre of the screen.', {
    scope: scope(true),
    intensity: num('How bright the ghosts are.', 0.6, 0, 3),
    threshold: num('The brightness a part must pass to cast a ghost, 0 to 1.', 0.8, 0, 1),
    spacing: num('How far apart the ghosts are.', 0.25, 0.05, 0.6),
  }),
  streaks: filter('Anamorphic streaks: bright parts drawn out sideways in a tinted line.', {
    scope: scope(true),
    intensity: num('How bright the streaks are.', 0.6, 0, 3),
    threshold: num('The brightness a part must pass to streak, 0 to 1.', 0.75, 0, 1),
    length: num('How far a streak reaches each side, in pixels at 1080 lines.', 48, 4, 160, 'px'),
    tint: color("The streaks' colour.", '#5f8dff'),
  }),
  sharpen: filter('Sharpen: an unsharp mask that crisps edges and texture.', {
    scope: scope(),
    strength: num('How much the edges are pushed.', 0.5, 0, 2),
    radius: num('How wide an edge counts, in pixels at 1080 lines.', 1, 0.5, 4, 'px'),
  }),
  misregister: filter('Print misregistration: the red and blue plates offset, as on a cheap print.', {
    scope: scope(),
    offset: num('How far the plates are out, in pixels at 1080 lines.', 1.2, 0, 8, 'px'),
    angle: num('Which way the plates are out.', 30, -180, 180, '°'),
  }),
  watercolor: filter('Watercolour: colour bleeds, darkens where washes meet, granulates in the paper and wobbles.', {
    scope: scope(),
    wobble: num('How far a hand-drawn wobble moves the picture, in pixels at 1080 lines.', 2.5, 0, 8, 'px'),
    bleed: num('How far colour bleeds, 0 to 1.', 0.3, 0, 1),
    edges: num('How dark the pigment pools at the edges of a wash, 0 to 1.', 0.45, 0, 1),
    granulation: num("How much pigment settles in the paper's dips, most in dark washes, 0 to 1.", 0.35, 0, 1),
  }),
  paper: filter('Paper or canvas under the picture: it tints and textures the light areas, ink stays dark.', {
    scope: scope(),
    kind: { type: 'string', enum: PAPER_KINDS, default: 'newsprint', description: 'Which paper.' },
    scale: num("The paper's grain size (1 is its own).", 1, 0.25, 4, '×'),
    strength: num('How much the paper shows, 0 to 1.', 0.4, 0, 1),
    color: color("The paper's colour.", '#f3ead3'),
  }),
  split: filter('Split toning: the shadows toward one colour and the highlights toward another.', {
    scope: scope(),
    shadows: color("The shadows' colour.", '#2e5f8a'),
    highlights: color("The highlights' colour.", '#ffb46b'),
    balance: num('Where shadows end and highlights begin: below 0 more highlight, above 0 more shadow.', 0, -1, 1),
  }),
  selective: filter('Selective colour: every colour but one turned grey (a red coat in a grey film).', {
    scope: scope(),
    hue: num('The hue kept: 0 red, 60 yellow, 120 green, 180 cyan, 240 blue, 300 magenta.', 25, 0, 360, '°'),
    range: num('How far round the kept hue still counts as it.', 35, 5, 120, '°'),
  }),
  duotone: filter('Gradient map: brightness mapped onto a dark, a middle and a light colour (duotone, tritone).', {
    scope: scope(),
    dark: color('The colour of black.', '#1b1442'),
    mid: color('The colour of mid grey.', '#b04a6f'),
    light: color('The colour of white.', '#fff1c9'),
  }),
  crt: filter("A CRT's glass: phosphor glow, an aperture grille and a flicker (curvature: screen; lines: scanlines).", {
    scope: scope(true),
    mask: num('How strongly the red, green and blue columns of the grille show, 0 to 1.', 0.25, 0, 1),
    glow: num('How much the phosphors glow into their neighbours, 0 to 1.', 0.25, 0, 1),
    flicker: num('How much the picture flickers, 0 to 1.', 0.1, 0, 1),
  }),
  vhs: filter('VHS tape: rows slipping sideways, colour bleeding to the right, snow in a rolling band.', {
    scope: scope(true),
    jitter: num('How far the rows slip, 0 to 1.', 0.5, 0, 1),
    bleed: num('How far colour smears, 0 to 1.', 0.5, 0, 1),
    noise: num('How strong the snow is, 0 to 1.', 0.3, 0, 1),
  }),
  speedlines: filter('Speed lines: comic-book streaks round a clear centre, redrawn 12 times a second.', {
    scope: scope(true),
    density: num('How many lines are drawn, 0 to 1.', 0.6, 0, 1),
    clear: num('How large the clear middle is, 0 to 0.9 of the way to the corners.', 0.35, 0, 0.9),
    x: num("The centre's place across the screen, 0 left to 1 right.", 0.5, 0, 1),
    y: num("The centre's place up the screen, 0 the bottom to 1 the top.", 0.5, 0, 1),
    color: color("The lines' colour.", '#ffffff'),
  }),
  vignette: filter('A vignette: the corners toward a colour, round or following the screen, soft or hard.', {
    scope: scope(true),
    strength: num('How far the corners go to the colour, 0 to 1.', 0.45, 0, 1),
    softness: num('How gradual it is: near 0 a hard edge, 1 the softest.', 0.5, 0.05, 1),
    roundness: num("1 a circle, 0 the screen's own shape.", 1, 0, 1),
    color: color("The corners' colour.", '#000000'),
  }),
  letterbox: filter('Letterbox bars that crop the picture to a film aspect ratio.', {
    scope: scope(true),
    aspect: num('The aspect ratio kept: 2.39 widescreen, 1.85 film, 1.33 old television.', 2.39, 1.2, 2.8),
    color: color("The bars' colour.", '#000000'),
  }),
} as const;
