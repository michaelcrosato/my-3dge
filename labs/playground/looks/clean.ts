/**
 * @file The look `look:playground-clean`, the playground's default (docs/PLAYGROUND.md §5.2; the owner's direction of
 * 2026-11-03, ADR-0025 amendment 46): the picture as the scene draws it, unstyled: every material in the set's own
 * lit style (`style` left `''`), lit by the hour's sky (`sky:daylight`, engine/gfx/daylight.ts: the sun, the moon,
 * the ambient and the streetlights at dusk, as the other two looks have them), its dome as the day draws it (no
 * gradient), and edges smoothed (the `aa` filter: the engine's edge smoothing, FXAA unless the view setting `post.aa`
 * names another, engine/gfx/post/aa.ts), with no bands, ink, outline shells, pixels or grade. The engine's own `look:clean` would keep the stage's own lights (a
 * hemisphere and one sun under a plain background, engine/gfx/stageSky.ts), which the hour and the lamps never reach,
 * and smooth nothing.
 *
 * Invariants: data only, the kind's fields (`node x describe look`); the sky `sky:daylight`; the scene's own style;
 * every filter it leaves out off. The page draws it by default (labs/playground/main.ts); P steps on to the cel look,
 * then the pixel look.
 *
 * @example
 * look.id; // 'look:playground-clean'
 * look.filters.aa.scope; // 'all': its edges smoothed
 * @see labs/playground/looks/looks.test.ts
 * @see tests/e2e/playground-looks.spec.ts
 */
import { defineLook } from '../../../engine';

/** The look `look:playground-clean`: the scene's own lit materials under the hour's sky, edges smoothed, nothing else. */
export const look = defineLook('look:playground-clean', {
  description:
    "The playground clean, its default: the scene's own lit materials under the hour's sky, edges smoothed; no bands, ink, outlines or pixels.",
  sky: 'sky:daylight',
  filters: { aa: { scope: 'all' } },
});
