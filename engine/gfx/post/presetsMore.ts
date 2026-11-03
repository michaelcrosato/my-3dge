/**
 * @file Style Lab's presets and looks (PLAN.md WP 13.31, WP 13.32): one-filter presets for the filters Style Lab
 * brought (michaelcrosato/my-ai-3d-demo@34c6fa1, its effect registry's defaults and its recipes; values retuned to
 * this engine's filters, engine/gfx/post/filterFieldsMore.ts), for the new numbers of `grade` and `outline`, and whole
 * looks built only by combining them (`combine`, engine/gfx/post/combine.ts), the way an agent makes a look of its
 * own: lay presets on, set an amount and pick their filters, add what is missing. Each preset is
 * `look:<group>/<name>` and sets its group's filter, scope `all`, as engine/gfx/post/presets.ts's do.
 *
 * Invariants: data only; a preset turns on only its own filter; a whole look here names only looks that exist.
 *
 * @example
 * STYLE_PRESETS['look:letterbox/widescreen'].filters; // { letterbox: { scope: 'all', aspect: 2.39 } }
 * COMBINED_LOOKS['look:cinematic'].combine?.length; // 4
 * @see engine/gfx/post/looks.test.ts
 * @see engine/gfx/post/combine.test.ts
 */
import type { FilterName, FilterSpec } from './filters';
import type { LookSpec } from './looks';

/** A preset of `group`'s filter: on everywhere, with `fields`. */
const one = <G extends FilterName>(group: G, description: string, fields: FilterSpec[G] = {}): LookSpec => ({
  description,
  group,
  filters: { [group]: { scope: 'all', ...fields } },
});

/** The one-filter presets (see the file comment). */
export const STYLE_PRESETS: Record<string, LookSpec> = {
  'look:lens/barrel': one('lens', 'A wide lens: the picture bulges gently toward its edges.', { distortion: 0.12 }),
  'look:lens/fisheye': one('lens', 'A fisheye: a strong bulge, the middle pushed toward you.', { distortion: 0.4 }),
  'look:dof/portrait': one('dof', 'A portrait lens: sharp on what is at the centre, the rest soft.', { range: 4, blur: 8 }), // prettier-ignore
  'look:tiltshift/miniature': one('tiltshift', 'A miniature: a sharp band across the middle, the rest blurred.', { center: 0.5, width: 0.16, blur: 10 }), // prettier-ignore
  'look:flare/sun': one('flare', 'Ghosts of the brightest lights across the lens.', { intensity: 0.8, threshold: 0.75 }), // prettier-ignore
  'look:streaks/anamorphic': one('streaks', 'Blue anamorphic streaks through bright lights.', { intensity: 0.7, threshold: 0.7, length: 64 }), // prettier-ignore
  'look:sharpen/crisp': one('sharpen', 'Crisper edges and texture.', { strength: 0.6 }),
  'look:misregister/risograph': one('misregister', 'Plates out of register, as on a risograph print.', { offset: 2 }),
  'look:watercolor/wash': one('watercolor', 'A watercolour wash: soft bleeds, darker edges, granulated pigment.'),
  'look:watercolor/wet': one('watercolor', 'Wet in wet: colour runs further, edges pool darker.', { wobble: 3.5, bleed: 0.6, edges: 0.6 }), // prettier-ignore
  'look:paper/newsprint': one('paper', 'Cheap newsprint under the picture.', { kind: 'newsprint' }),
  'look:paper/watercolour-paper': one('paper', 'Cold-pressed watercolour paper.', { kind: 'coldpress', strength: 0.5 }), // prettier-ignore
  'look:paper/canvas': one('paper', "A painter's canvas weave.", { kind: 'canvas', color: '#efe6d2' }),
  'look:paper/kraft': one('paper', 'Brown kraft paper.', { kind: 'kraft', color: '#c9a77c', strength: 0.55 }),
  'look:split/teal-orange': one('split', 'Teal shadows and warm highlights, the blockbuster grade.'),
  'look:split/moonlight': one('split', 'Deep blue shadows and pale highlights.', { shadows: '#24305e', highlights: '#b8d4ff', balance: 0.2 }), // prettier-ignore
  'look:selective/red': one('selective', 'Only the reds keep their colour.', { hue: 0, range: 30 }),
  'look:selective/green': one('selective', 'Only the greens keep their colour.', { hue: 120, range: 40 }),
  'look:duotone/dusk': one('duotone', 'Brightness mapped from violet through rose to cream.'),
  'look:duotone/ocean': one('duotone', 'Brightness mapped from navy through teal to foam.', { dark: '#051937', mid: '#2a7b9b', light: '#e0fbfc' }), // prettier-ignore
  'look:duotone/ember': one('duotone', 'Brightness mapped from soot through orange to gold.', { dark: '#1a0500', mid: '#b33a00', light: '#ffd27a' }), // prettier-ignore
  'look:crt/arcade-tube': one('crt', "An arcade tube's grille, glow and flicker.", { mask: 0.35, glow: 0.3 }),
  'look:vhs/worn-tape': one('vhs', 'A worn tape: slipping rows, smeared colour, snow.'),
  'look:speedlines/action': one('speedlines', 'Comic speed lines round the middle.'),
  'look:vignette/soft': one('vignette', 'Gently darker corners.', { strength: 0.35, softness: 0.7 }),
  'look:vignette/heavy': one('vignette', 'Dark, tight corners.', { strength: 0.7, softness: 0.4 }),
  'look:letterbox/widescreen': one('letterbox', 'Widescreen bars (2.39:1).', { aspect: 2.39 }),
  'look:letterbox/film': one('letterbox', 'Film bars (1.85:1).', { aspect: 1.85 }),
  'look:grade/bleach-bypass': one('grade', "Bleach bypass: film's crushed, silvery look.", { bleach: 0.6 }),
  'look:grade/lifted': one('grade', 'Lifted, milky shadows and soft midtones.', { lift: 0.06, gamma: 1.1, saturation: 0.9 }), // prettier-ignore
  'look:outline/hand-drawn': one('outline', 'A wobbly line that boils, redrawn 8 times a second.', { width: 2, darken: 0.2, wobble: 1.5, boil: 8 }), // prettier-ignore
};

/** The whole looks made by combining presets (see the file comment). */
export const COMBINED_LOOKS: Record<string, LookSpec> = {
  'look:cinematic': {
    description: 'A film: teal and orange, anamorphic streaks, soft corners and widescreen bars.',
    combine: [
      { look: 'look:split/teal-orange', amount: 0.8 },
      { look: 'look:streaks/anamorphic', amount: 0.6 },
      { look: 'look:vignette/soft' },
      { look: 'look:letterbox/widescreen' },
    ],
    filters: { grade: { scope: 'all', contrast: 1.1 } },
  },
  'look:miniature': {
    description: 'A model railway: tilt-shift blur, crisp and bright colours.',
    combine: [{ look: 'look:tiltshift/miniature' }, { look: 'look:sharpen/crisp', amount: 0.7 }],
    filters: { grade: { scope: 'all', saturation: 1.35, contrast: 1.1, vibrance: 0.3 } },
  },
  'look:storybook': {
    description: 'A storybook: watercolour on cold-pressed paper with a thin ink line.',
    // the wash wetter and the paper stronger than their presets, so it reads at the engine's lines (WP 13.31's review)
    combine: [
      {
        look: 'look:watercolor/wash',
        filters: { watercolor: { wobble: 4, bleed: 0.7, edges: 0.8, granulation: 0.7 } },
      },
      { look: 'look:paper/watercolour-paper', filters: { paper: { strength: 0.7 } } },
      { look: 'look:outline/thin' },
    ],
  },
  'look:vhs-tape': {
    description: 'A home video: worn tape, soft scanlines, noise and dark corners.',
    combine: [
      { look: 'look:vhs/worn-tape' },
      { look: 'look:scanlines/soft' },
      { look: 'look:grain/vhs', amount: 0.6 },
      { look: 'look:vignette/heavy', amount: 0.5 },
    ],
  },
  'look:red-coat': {
    description: 'A grey film where only red keeps its colour, grainy and dark at the edges.',
    combine: [
      { look: 'look:selective/red' },
      { look: 'look:grain/film' },
      { look: 'look:vignette/heavy', amount: 0.7 },
    ],
    filters: { grade: { scope: 'all', contrast: 1.2 } },
  },
  'look:riso-print': {
    description: 'A risograph print: ember duotone, plates out of register, newsprint.',
    combine: [{ look: 'look:duotone/ember' }, { look: 'look:misregister/risograph' }, { look: 'look:paper/newsprint' }],
  },
  'look:anime-action': {
    description: 'An action frame: comic cel bands, bold lines and speed lines.',
    combine: [
      { look: 'look:cel/comic' },
      { look: 'look:outline/bold', amount: 0.8 },
      { look: 'look:speedlines/action', amount: 0.8 },
    ],
  },
  'look:arcade-cabinet': {
    description: "An arcade cabinet: a curved tube's grille, glow and lines.",
    combine: [
      { look: 'look:screen/crt' },
      { look: 'look:crt/arcade-tube' },
      { look: 'look:scanlines/arcade' },
      { look: 'look:bloom/soft' },
    ],
  },
};
