/**
 * @file One-filter presets (PLAN.md WP 7.4): looks that set one filter or the shading, seeded from shardfall's tuned
 * `[[preset]]` tables (`shardfall:crates/pav_view/src/looks.toml:13-500`), keys renamed (engine/gfx/post/looks.ts
 * says what was left out), plus three from the prototype's filter panel (`my-3d2dge:src/stress-world/
 * 45-filters.js:21-24`: its comic cel, its dithered pixel look, FXAA). Each is `look:<group>/<name>`; its `group`
 * is the filter it sets. A preset that turns its filter off (`look:outline/none`) is the clean picture for that menu.
 *
 * Invariants: data only; each preset sets one filter (grain also sets chroma, as shardfall's grain section did) or
 * the style, with scope `all` when on.
 *
 * @example
 * PRESETS['look:palette/game-boy'].filters; // { palette: { scope: 'all', palette: 'gameboy', dither: 0.6 } }
 * Object.keys(PRESETS).length; // 66
 * @see engine/gfx/post/looks.test.ts
 */
import type { LookSpec } from './looks';

const pixel = (description: string, size: number, levels: number, outline: boolean): LookSpec => ({
  description,
  group: 'pixel',
  filters: { pixel: { scope: 'all', size, levels, outline } },
});
const outline = (description: string, width: number, darken: number | null): LookSpec => ({
  description,
  group: 'outline',
  filters: { outline: darken === null ? { scope: 'off' } : { scope: 'all', width, darken } },
});
const stylize = (description: string, style: 'paint' | 'halftone' | 'ascii' | 'sketch', size: number, color: number) =>
  ({ description, group: 'stylize', filters: { stylize: { scope: 'all', style, size, mix: 1, color } } }) as LookSpec;
const palette = (description: string, name: string, levels: number, dither: number): LookSpec => ({
  description,
  group: 'palette',
  filters: { palette: { scope: 'all', palette: name as 'none', levels, dither } },
});
const grade = (description: string, temperature: number, tint: number, contrast: number, brightness: number, saturation: number): LookSpec => ({ description, group: 'grade', filters: { grade: { scope: 'all', temperature, tint, contrast, brightness, saturation } } }); // prettier-ignore
const scanlines = (description: string, strength: number, period: number): LookSpec => ({
  description,
  group: 'scanlines',
  filters: { scanlines: { scope: 'all', strength, period } },
});
const grain = (description: string, amount: number, chroma: number): LookSpec => ({
  description,
  group: 'grain',
  filters: {
    grain: amount > 0 ? { scope: 'all', amount } : { scope: 'off' },
    chroma: chroma > 0 ? { scope: 'all', amount: chroma } : { scope: 'off' },
  },
});
const screen = (description: string, curvature: number, vignette: number, pixelate: number): LookSpec => ({
  description,
  group: 'screen',
  filters: { screen: { scope: 'all', curvature, vignette, pixelate } },
});
const glow = (description: string, strength: number, threshold: number): LookSpec => ({
  description,
  group: 'bloom',
  filters: { bloom: { scope: 'all', strength, threshold } },
});

/** The presets, by id (see the file comment). */
export const PRESETS: Record<string, LookSpec> = {
  'look:pixel/fine': pixel('3 px blocks, no outline.', 3, 0, false),
  'look:pixel/classic': pixel('4 px blocks with a dark outline.', 4, 0, true),
  'look:pixel/bold': pixel('5 px blocks with a dark outline.', 5, 0, true),
  'look:pixel/chunky': pixel('6 px blocks with a dark outline.', 6, 0, true),
  'look:pixel/16-bit': pixel('4 px blocks, 24 shades per channel.', 4, 24, true),
  'look:pixel/8-bit': pixel('6 px blocks, 8 shades per channel.', 6, 8, true),
  'look:pixel/giant': pixel('10 px blocks.', 10, 0, true),
  'look:pixel/dithered': {
    description: "4 px blocks, 8 shades per channel, dithered: the prototype's pixel look.",
    group: 'pixel',
    filters: {
      pixel: { scope: 'all', size: 4, outline: false },
      palette: { scope: 'all', palette: 'none', levels: 8, dither: 0.35 },
    },
  },
  'look:shading/as-authored': { description: "Every material in the scene's own style.", group: 'shading' },
  'look:shading/cartoon': {
    description: 'Toon shading everywhere: two bands and a rim light.',
    group: 'shading',
    style: 'toon',
    toon: { bands: 2, rim: 0.4 },
  },
  'look:shading/toon-3-band': {
    description: 'Toon shading with three light bands.',
    group: 'shading',
    style: 'toon',
    toon: { bands: 3, rim: 0.25 },
  },
  'look:shading/flat-2d': { description: 'Flat colours with soft shadow tones.', group: 'shading', style: 'flat' },
  'look:shading/smooth-lit': { description: 'Smooth lighting with highlights.', group: 'shading', style: 'pbr' },
  'look:outline/none': outline('No outlines.', 1, null),
  'look:outline/thin': outline('1 px, a darker shade of the surface.', 1, 0.35),
  'look:outline/bold': outline('2 px, dark.', 2, 0.18),
  'look:outline/ink': outline('2 px, black.', 2, 0),
  'look:outline/heavy-ink': outline('3 px, black.', 3, 0),
  'look:cel/comic': {
    description: "Comic cel: four flat bands, pushed colour and ink lines (the prototype's cel look).",
    group: 'cel',
    filters: { cel: { scope: 'all', bands: 4, punch: 1.3, ink: 0.9, inkWidth: 1.5 } },
  },
  'look:stylize/off': { description: 'No painterly or print style.', group: 'stylize' },
  'look:stylize/oil-paint': stylize('Flat strokes that keep their edges (Kuwahara), brush streaks and canvas.', 'paint', 6, 1), // prettier-ignore
  'look:stylize/gouache': stylize('Small, crisp strokes.', 'paint', 3, 1),
  'look:stylize/thick-impasto': stylize('Broad strokes that flatten detail away.', 'paint', 8, 1),
  'look:stylize/underpainting': stylize('Brown paint before the colour goes on.', 'paint', 6, 0.15),
  'look:stylize/comic-print': stylize('Cyan, magenta, yellow and black dot screens on cream paper.', 'halftone', 7, 1),
  'look:stylize/fine-print': stylize('Small process-colour dots, like a magazine.', 'halftone', 4, 1),
  'look:stylize/newsprint': stylize('Black dots only.', 'halftone', 6, 0),
  'look:stylize/terminal': stylize('Green characters on black, picked by brightness.', 'ascii', 8, 0),
  'look:stylize/colour-ascii': stylize("Characters in the scene's colours.", 'ascii', 8, 1),
  'look:stylize/pencil': stylize('Graphite hatching and contours on paper.', 'sketch', 4, 0),
  'look:stylize/coloured-pencil': stylize("Hatching over paper tinted with the scene's colours.", 'sketch', 4, 1),
  'look:stylize/loose-sketch': stylize('Wide, quick hatching.', 'sketch', 7, 0.5),
  'look:palette/full-colour': { description: 'No colour reduction.', group: 'palette' },
  'look:palette/game-boy': palette('Four greens, dithered.', 'gameboy', 8, 0.6),
  'look:palette/pico-8': palette('The sixteen PICO-8 colours.', 'pico8', 8, 0.4),
  'look:palette/cga': palette('Black, cyan, magenta, white.', 'cga', 8, 0.7),
  'look:palette/1-bit': palette('Black and white, dithered.', '1bit', 8, 1),
  'look:palette/amber': palette('An amber terminal.', 'amber', 8, 0.5),
  'look:palette/posterize': palette('8 shades per channel, no dither.', 'none', 8, 0),
  'look:palette/512-colours': palette('8 shades per channel, dithered.', 'none', 8, 0.8),
  'look:grade/neutral': { description: 'No grading.', group: 'grade' },
  'look:grade/warm': grade('Golden hour.', 0.5, 0, 1.05, 1, 1.1),
  'look:grade/cool': grade('Blue and crisp.', -0.5, 0, 1.05, 1, 0.95),
  'look:grade/vivid': grade('Saturated and punchy.', 0, 0, 1.15, 1, 1.5),
  'look:grade/noir': grade('Black and white, hard contrast.', 0, 0, 1.35, 0.95, 0),
  'look:grade/faded': grade('Washed-out film.', 0.1, 0, 0.8, 1.08, 0.65),
  'look:grade/sepia': grade('An old photograph.', 0.9, 0.1, 1.05, 1, 0.25),
  'look:grade/night': grade('Dark and blue.', -0.6, 0, 1.1, 0.7, 0.8),
  'look:scanlines/fine': scanlines('Thin lines every 2 px.', 0.35, 2),
  'look:scanlines/soft': scanlines('Gentle lines every 3 px.', 0.25, 3),
  'look:scanlines/arcade': scanlines('Clear lines every 3 px.', 0.5, 3),
  'look:scanlines/heavy': scanlines('Dark lines every 4 px.', 0.85, 4),
  'look:grain/clean': grain('No grain or colour fringe.', 0, 0),
  'look:grain/film': grain('Fine film grain.', 0.35, 0),
  'look:grain/vhs': grain('Noise and colour fringes.', 0.5, 0.6),
  'look:grain/glitch': grain('Strong colour fringes.', 0.25, 1),
  'look:screen/flat-screen': { description: 'No curvature, vignette or low resolution.', group: 'screen' },
  'look:screen/soft-vignette': screen('Darker corners.', 0, 0.4, 1),
  'look:screen/crt': screen('A gently curved tube.', 0.12, 0.5, 1),
  'look:screen/old-tv': screen('A round tube with dark corners.', 0.3, 0.8, 1),
  'look:screen/low-res': screen('The whole screen at a third of its resolution.', 0, 0, 3),
  'look:bloom/no-glow': { description: 'Bloom off.', group: 'bloom' },
  'look:bloom/soft': glow('A little glow around bright things.', 0.35, 1.2),
  'look:bloom/dreamy': glow('Wide, soft glow.', 1, 0.6),
  'look:bloom/neon': glow('Strong glow on lights and spells.', 1.6, 0.9),
  'look:aa/smooth': {
    description: 'Edge smoothing (FXAA) over the whole picture.',
    group: 'aa',
    filters: { aa: { scope: 'all' } },
  },
};
