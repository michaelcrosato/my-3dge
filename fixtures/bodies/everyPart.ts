/**
 * @file The fixture body `body:everyPart` (PLAN.md WP 3.8): one part of every type and every kind of point, for the
 * puppet tests (engine/gfx/puppets/*.test.ts) and the puppets page (tests/pages/puppets.ts), so each shape, point
 * form, mirror and `on` option is compiled, skinned and instanced against a body whose lines never change with the
 * engine's own humanoid.
 *
 * - every part type: `limb`, `curve` (a claw from each hand), `ball` (a head, and an ellipsoid disc riding the root),
 *   `eye`, `box` (a chest plate and the feet), `cone` (horns), `blade` (from the right grip), `cape` (from the back
 *   socket) and `hair` (12 strands);
 * - every point: joints, sockets (`weaponR`, `back`, `eyeL`, `headTop`), `[f, r, u]` from the root, `lerp` and `off`;
 * - sizes in metres and in `[k, 'head' | 'limb' | 'torso']`; `{ on }` for the lower torso and the shoulders;
 * - `mirror`: legs, arms, claws, horns, eyes and feet written for the left side.
 *
 * Invariants: nothing is defined on import; `defineEveryPart(registry)` defines it once on a registry (twice throws
 * `CORE_DUPLICATE_ID`).
 *
 * @example
 * import { createRegistry } from '../../engine/core/registry';
 * const registry = createRegistry();
 * defineEveryPart(registry).mirror.length; // 8
 * @see engine/gfx/puppets/compile.test.ts
 */
import { defineBody, type Body, type BodySpec } from '../../engine';
import type { Registry } from '../../engine/core/registry';

/** The fixture body's id. */
export const EVERY_PART_ID = 'body:everyPart';

/** The fixture body (see the file comment). */
export const EVERY_PART: BodySpec = {
  description: 'A test body: one part of every type and every kind of point.',
  slots: { skin: '#d8b090', cloth: '#7a3040', metal: '#c0c8d0', hair: '#202028', horn: '#e0d8c0', eye: '#101014' },
  parts: [
    ['limb', ['off', 'spine0', 0, 0, 0.05], 'chest', [0.6, 'torso'], 0.13, 'cloth', { on: 'spine1' }],
    ['limb', 'chest', 'neck', 0.13, 0.12, 'cloth'],
    ['limb', 'upperArmL', 'upperArmR', [1, 'limb'], [1, 'limb'], 'cloth', { on: 'chest' }],
    ['limb', 'thighL', 'thighR', [1.2, 'limb'], [1.2, 'limb'], 'cloth', { on: 'pelvis' }],
    ['ball', ['off', 'head', 0, 0, [1, 'head']], [1, 'head'], 'skin'],
    ['box', 'chest', ['off', 'chest', 0, 0, 0.12], [1.2, 'torso'], 0.06, 'metal'],
    ['blade', 'weaponR', ['off', 'weaponR', 0.7, 0, 0], 0.05, 0.012, 'metal'],
    ['cape', 'back', ['off', 'back', -0.06, 0, -0.55], 0.32, 'cloth'],
    ['hair', ['off', 'head', 0, 0, [1, 'head']], [0.95, 'head'], 12, 0.12, 0.018, 'hair'],
    ['ball', [0, 0, 0.01], [0.25, 0.01, 0.25], 'cloth'],
  ],
  mirror: [
    ['limb', 'thighL', 'shinL', [1.3, 'limb'], [1.1, 'limb'], 'cloth'],
    ['limb', 'shinL', 'footL', [1.1, 'limb'], 0.05, 'skin'],
    ['box', 'footL', ['off', 'toeL', 0.03, 0, 0], 0.09, 0.05, 'skin'],
    ['limb', 'upperArmL', 'forearmL', [1, 'limb'], [0.9, 'limb'], 'skin'],
    ['limb', 'forearmL', 'handL', [0.9, 'limb'], [0.8, 'limb'], 'skin'],
    ['curve', 'handL', ['off', 'handL', 0.05, -0.3, 0], 0.3, 0.02, 0.006, 'horn'],
    ['cone', ['lerp', 'head', 'headTop', 0.8], ['off', 'headTop', 0.02, -0.12, 0.1], 0.03, 'horn'],
    ['eye', 'eyeL', 0.025, 'eye'],
  ],
};

/** Defines `body:everyPart` on `registry` and returns it. Throws `CORE_DUPLICATE_ID` the second time. */
export function defineEveryPart(registry: Registry): Body {
  return defineBody(EVERY_PART_ID, EVERY_PART, registry);
}
