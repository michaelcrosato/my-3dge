/**
 * @file The physics parameters (PLAN.md WP 3.1, §6.5 item 5; doctrine: Reproducible): the one table of Rapier's
 * integration parameters, pinned rather than left to the release's defaults, and the world's gravity as a setting.
 *
 * `INTEGRATION_PARAMETERS` is applied to every physics world when it is made and again after a restore, so an upgrade
 * that moves a default cannot change play unnoticed: the values are Rapier 0.21's own defaults, written out (measured on
 * 0.21.0). The step length is not in it: the world steps at the sim's rate, `dt = 1 / hz`, set before every step.
 * Lengths are metres (`lengthUnit` 1), the units of the whole engine (§6.3).
 *
 * `physics.gravity` is the gravity bodies fall under, in m/s², straight down (−Y), read before every step: a scene
 * overrides it (`settings: { 'physics.gravity': 30 }`), `x sim --set` and `__engine.set` change it, and a change is
 * recorded like any other setting. Characters fall under their own gravity (WP 3.2), as in shardfall, where props at
 * 9.81 m/s² look right and characters at 32 m/s² feel right (§5.8). The prototype used 30 m/s² for everything.
 *
 * Carried from `my-3d2dge:src/stress-world/20-sim.js:29, 118-122` (one gravity, `numSolverIterations` 4, a length
 * unit), in SI units: the prototype's 480 units/s² with 16 units to the metre is the 30 m/s² above.
 *
 * @example
 * INTEGRATION_PARAMETERS.numSolverIterations; // 4
 * PHYSICS_SETTINGS['physics.gravity'].default; // 9.81
 * @see engine/physics/world.test.ts
 */
import type { Field } from '../core/schema';
import { defineSettings } from '../core/settings';

/** Rapier's integration parameters, pinned (Rapier 0.21.0's defaults, written out so an upgrade cannot move them). */
export const INTEGRATION_PARAMETERS = Object.freeze({
  /** Solver iterations per step: more is stiffer and slower (the prototype's `iters`). */
  numSolverIterations: 4,
  /** Projected Gauss–Seidel iterations inside each solver iteration. */
  numInternalPgsIterations: 1,
  /** Continuous collision detection substeps for bodies with CCD on (0 turns CCD off). */
  maxCcdSubsteps: 1,
  /** World units per metre: the engine works in metres. */
  lengthUnit: 1,
  /** The penetration the solver tolerates, as a fraction of the length unit. */
  normalizedAllowedLinearError: 0.005,
  /** How far ahead contacts are predicted, as a fraction of the length unit. */
  normalizedPredictionDistance: 0.02,
  /** The contacts' spring frequency (Hz): how fast penetrations are corrected. */
  contactNaturalFrequency: 30,
});

/** The physics settings, path → field; `defineSettings(PHYSICS_SETTINGS, registry)` declares them on another registry. */
export const PHYSICS_SETTINGS = {
  'physics.gravity': {
    type: 'number',
    default: 9.81,
    minimum: 0,
    maximum: 1000,
    unit: 'm/s²',
    description:
      'The gravity bodies fall under, straight down; characters have their own (physics.characterGravity, WP 3.2).',
  },
} as const satisfies Record<string, Field>;
defineSettings(PHYSICS_SETTINGS);
