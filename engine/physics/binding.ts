/**
 * @file A physics world bound to a sim world (PLAN.md WP 3.1, §6.1): a scene with `physics: true` gets one
 * (`scenePhysics`, declaring `physics.gravity` on its registry if it lacks it); `attachPhysics` binds it to the sim
 * world and adds the system `physics`, in the phase of that name, after `ai` and `anim` and before `readback`; and
 * `physicsOf(w)` returns the bound world (engine/physics/world.ts `Physics`: its bodies and queries), or throws
 * `PHYSICS_NONE` naming the fix; `hasPhysics(w)` says whether there is one.
 *
 * Invariants: a sim world has at most one physics world, held weakly by the sim world (`bindPhysics`), so nothing here
 * keeps a finished run alive or enters the hash; the physics world's own state is hashed and captured through the sim
 * world's physics hook. Split from world.ts to keep each under 400 lines (ADR-0014 amendment 16).
 *
 * @example
 * import { createPhysics } from './world';
 * const w = { systems: { add: () => undefined } };
 * attachPhysics(w, createPhysics());
 * physicsOf(w).bodies().length; // 0: an empty physics world, bound
 * @see engine/physics/world.test.ts
 */
import { codeError, defineCodes } from '../core/log';
import type { Registry } from '../core/registry';
import { defineSettings } from '../core/settings';
import { PHYSICS_SETTINGS } from './params';
import { createPhysics, type Physics, type PhysicsStepper } from './world';

/** The codes this module raises, with their fixes. */
export const BINDING_CODES = defineCodes('physics', {
  PHYSICS_NONE: {
    template: '{what} has no physics world',
    fix: "give its scene a physics world, defineScene(id, { physics: true, setup(w) { physicsOf(w).addBody(…) } }), or pass createPhysics() as createWorld's or startScene's physics option",
  },
});

/** The physics world each sim world was given, by the sim world. */
const bound = new WeakMap<object, Physics>();

/** Binds a physics world to a sim world, so `physicsOf(w)` finds it (the scene does this when it starts). */
export function bindPhysics(owner: object, physics: Physics): void {
  bound.set(owner, physics);
}

/** Whether a sim world has a physics world bound to it. */
export function hasPhysics(w: object): boolean {
  return bound.has(w);
}

/** The physics world of a sim world: its bodies and queries. Throws `PHYSICS_NONE` for a scene without physics. */
export function physicsOf(w: object): Physics {
  const physics = bound.get(w);
  if (!physics) throw codeError('PHYSICS_NONE', { what: 'this world' });
  return physics;
}

/** For a scene that asks for physics: a new physics world, with `physics.gravity` declared on `registry` if it lacks it. */
export function scenePhysics(wanted: boolean, registry: Registry): Physics | undefined {
  if (!wanted) return undefined;
  const declared = registry.kinds().includes('setting') && registry.has('setting', 'physics.gravity');
  if (!declared) defineSettings(PHYSICS_SETTINGS, registry);
  return createPhysics();
}

/** A sim world as `attachPhysics` sees it: one that takes systems. */
interface SimWorld {
  readonly systems: { add(name: string, run: (w: PhysicsStepper) => void, options: { phase: 'physics' }): unknown };
}

/** Binds `physics` to a sim world and steps it there: the system `physics`, in the phase of that name. */
export function attachPhysics(w: SimWorld, physics: Physics): void {
  bindPhysics(w, physics);
  w.systems.add('physics', (sim) => physics.step(sim), { phase: 'physics' });
}
