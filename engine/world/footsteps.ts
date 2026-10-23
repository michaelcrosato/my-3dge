/**
 * @file Footsteps by surface and gait (PLAN.md WP 13.22, docs/PLAYGROUND.md §8.1): which effect a step plays, how
 * loud and at what pitch, from the surface tag under the foot (a level legend's `surface`, a terrain's: engine/world/
 * level/heights.ts `surfaceAt`, engine/world/siteQueries.ts `siteSurfaceBelow`) and how its walker moves.
 *
 * - `SURFACE_STEPS`: a tag's step, one of the engine's foley (engine/audio/data/foley.ts): wood, tile, carpet,
 *   concrete, grass, gravel and metal, each its own tag; `stone`, `rock` (a terrain's steep ground) and `asphalt` sound
 *   as concrete, `iron` and `steel` as metal, `dirt`, `sand` and `mud` as grass; `'*'`, any other tag, as concrete.
 * - `STEP_GAITS`: a gait's loudness and pitch: a crouch 0.3 (and a little lower, slower strikes), a walk 0.55, a run
 *   0.8, a sprint 1 (a little higher); a slide's feet make none (its scrape is its own sound). `stepGait(speed)` names
 *   the gait a walker moving at `speed` m/s has when nothing tells it: a walk under 2.6 m/s, a run under 5.4, then a
 *   sprint (between the movement model's walk, 1.7, its run, 4.4, and its sprint, 6.6).
 *
 * Invariants: pure: a function of the tag and the gait, so a run's footsteps are the same in Node and in Chromium;
 * tags are matched as written (the legends' are lower case words). Sim-side, beside the surfaces it hears, so a
 * scene's sound map reads it through engine/sim-api.ts: the effects are named by id, never imported.
 *
 * @example
 * footstepSound('carpet', 'walk'); // { sfx: 'sfx:stepCarpet', vol: 0.55, pitch: 1 }
 * footstepSound('stone', stepGait(5)); // { sfx: 'sfx:stepConcrete', vol: 0.8, pitch: 1.01 }: a run
 * footstepSound('wood', 'slide'); // null: no step
 * @see engine/world/footsteps.test.ts
 */

/** A walker's gait, as a step hears it: the movement model's (engine/physics/movement/model.ts `GAITS`) on its feet. */
export type StepGait = 'crouch' | 'walk' | 'run' | 'sprint' | 'slide';

/** Surface tag → the step it plays (see the file comment); `'*'` for any other tag. */
export const SURFACE_STEPS: Readonly<Record<string, string>> = Object.freeze({
  wood: 'sfx:stepWood',
  tile: 'sfx:stepTile',
  carpet: 'sfx:stepCarpet',
  concrete: 'sfx:stepConcrete',
  grass: 'sfx:stepGrass',
  gravel: 'sfx:stepGravel',
  metal: 'sfx:stepMetal',
  stone: 'sfx:stepConcrete',
  rock: 'sfx:stepConcrete',
  asphalt: 'sfx:stepConcrete',
  iron: 'sfx:stepMetal',
  steel: 'sfx:stepMetal',
  dirt: 'sfx:stepGrass',
  sand: 'sfx:stepGrass',
  mud: 'sfx:stepGrass',
  '*': 'sfx:stepConcrete',
});

/** Gait → a step's gain and pitch ratio, or null: no step (see the file comment). */
export const STEP_GAITS: Readonly<Record<StepGait, { readonly vol: number; readonly pitch: number } | null>> =
  Object.freeze({
    crouch: { vol: 0.3, pitch: 0.96 },
    walk: { vol: 0.55, pitch: 1 },
    run: { vol: 0.8, pitch: 1.01 },
    sprint: { vol: 1, pitch: 1.03 },
    slide: null,
  });

/** The gait a walker moving at `speed` m/s has when nothing tells it (see the file comment). */
export function stepGait(speed: number): StepGait {
  return speed < 2.6 ? 'walk' : speed < 5.4 ? 'run' : 'sprint';
}

/** The step a foot on `surface` plays at `gait`: its effect, gain and pitch ratio; null when the gait has none. */
export function footstepSound(surface: string, gait: StepGait): { sfx: string; vol: number; pitch: number } | null {
  const loud = STEP_GAITS[gait];
  const sfx = Object.hasOwn(SURFACE_STEPS, surface) ? SURFACE_STEPS[surface] : SURFACE_STEPS['*'];
  return loud ? { sfx, vol: loud.vol, pitch: loud.pitch } : null;
}
