/**
 * @file Props in a running scene (PLAN.md WP 4.6 core proposal, ADR-0008 amendment 5; WP 4.5's props as data):
 * `spawnProp(w, placement)` stands a prop (engine/world/props: its id, its base and its turn about +Y) in a scene: its
 * body in the scene's physics world (`propBody`: none for a prop without one, such as the brazier's fire) and an
 * entity with the component `sceneProp` (the prop's id, its body and its pose: its centre and its turn), so the sim
 * hashes, captures and restores it and the view draws it as the prop (engine/gfx/stageProps.ts, through the instanced
 * prop meshes). The system `props.readback` (phase `readback`, after the physics step) copies each body's pose into
 * its component, as `actors.readback` does an actor's feet.
 *
 * `hitProp(w, id, from, knock?)` hits a prop from `from` (a swing, a blast): it calls the prop's `hit` hook with the
 * means to knock it, engine/physics/bodies.ts's `knock` on its body with the caller's strength (`speed`, `up`,
 * `spin`) under the hook's own; the default hook knocks a dynamic prop away and leaves the others. Shared code calls
 * the hook and never compares ids. `removeProp(w, id)` removes the entity and its body.
 *
 * The component's name is `sceneProp`, as names are global and fixtures/scenes/physics-props declares its own `prop`.
 * Its `x` and `z` are metres, so the stage places it, and draws it as its prop instead of a stand-in.
 *
 * Invariants: everything a prop is in the sim is its component and its body; the readback writes only what the body
 * holds (its centre and turn), so a prop's component equals its body's pose after every step; the system is added
 * once per world, on the first spawn of a prop with a body. Ids are asked of the entries, never compared.
 *
 * @example
 * import { defineScene } from './scene';
 * import { physicsOf } from '../physics/world';
 * import { addLevelBodies } from './levelBodies';
 * defineScene('yard', {
 *   physics: true,
 *   setup(w) {
 *     // addLevelBodies(physicsOf(w), level); for (const placement of levelProps(level)) spawnProp(w, placement);
 *     spawnProp(w, { prop: 'prop:crate', at: [2, 0, 3], yaw: 0.4 });
 *   },
 * });
 * // after a step: w.get(id).sceneProp is { prop: 'prop:crate', body, x: 2, y: 0.375, z: 3, q: [0, 0.198…, 0, 0.980…] }
 * // hitProp(w, id, [1, 0, 3], { spin: w.rng('knock').range(-0.5, 0.5) }); // knocked east
 * @see engine/sim/props.test.ts
 */
import { codeError } from '../core/log';
import { registry as sharedRegistry, type Registry } from '../core/registry';
import { knock } from '../physics/bodies';
import { physicsOf } from '../physics/world';
import { propBody, propPose, type PropPlacement } from '../world/props/place';
import { getProp, type PropKnock } from '../world/props/prop';
import { defineComponent } from './state';
import type { World } from './world';

/** The component `sceneProp`'s fields. */
export const SCENE_PROP_FIELDS = {
  prop: { type: 'string', default: 'prop:crate', description: 'The prop it is, by id (engine/world/props).' },
  body: { type: 'integer', default: -1, minimum: -1, description: 'Its body in the physics world; −1: none.' },
  x: { type: 'number', default: 0, unit: 'm', description: 'Where its centre is, east: its body’s origin.' },
  y: { type: 'number', default: 0, unit: 'm', description: 'Where its centre is, up.' },
  z: { type: 'number', default: 0, unit: 'm', description: 'Where its centre is, south.' },
  q: {
    type: 'array',
    items: { type: 'number' },
    default: [0, 0, 0, 1],
    description: 'Its turn, a unit quaternion [x, y, z, w].',
  },
} as const;

/** The component `sceneProp`: a prop standing in a scene. */
export interface ScenePropComponent {
  prop: string;
  body: number;
  x: number;
  y: number;
  z: number;
  q: [number, number, number, number];
}

/** The components this module reads. */
export type ScenePropComponents = { sceneProp: ScenePropComponent };

/** Declares the component `sceneProp` on `registry` (once). */
export function definePropKinds(registry: Registry = sharedRegistry): void {
  if (registry.kinds().includes('component') && registry.has('component', 'sceneProp')) return;
  const description = 'A prop standing in a scene (spawnProp): its id, its body and its pose, its centre and turn.';
  defineComponent('sceneProp', { description, fields: SCENE_PROP_FIELDS }, registry);
}
definePropKinds();

/** Throws `SIM_BAD_ARGUMENT` for `id` when it is no prop. */
function propOf(w: World, id: number, where: string): ScenePropComponent {
  const data = (w.get(id) as Partial<ScenePropComponents> | undefined)?.sceneProp;
  if (!data) throw codeError('SIM_BAD_ARGUMENT', { where, value: String(id), expected: 'a prop’s id (spawnProp)' });
  return data;
}

/** The system `props.readback`: every prop with a body takes its body's pose, in id order. */
function readProps(w: World): void {
  const physics = physicsOf(w);
  for (const { sceneProp } of w.query('sceneProp') as unknown as ScenePropComponents[]) {
    if (sceneProp.body < 0) continue;
    const { position: p, rotation: r } = physics.readBody(sceneProp.body);
    [sceneProp.x, sceneProp.y, sceneProp.z] = [p.x, p.y, p.z];
    sceneProp.q = [r.x, r.y, r.z, r.w];
  }
}

/**
 * Stands a prop in the scene, `spawnProp(w, { prop: 'prop:<id>', at: [x, y, z], yaw })`: its base at `at` (m), turned
 * `yaw` about +Y (rad). It makes the prop's body (when it has one; the scene needs `physics: true` then) and an entity
 * with the component `sceneProp`, and returns the entity's id. A missing prop id warns and stands a crate (`getProp`).
 *
 * @example
 * // in a scene's setup, with physics: true and its level's bodies added (addLevelBodies(physicsOf(w), level)):
 * // const id = spawnProp(w, { prop: 'prop:crate', at: [2, 0, 3], yaw: Math.PI / 2 }); // on the floor at x 2, z 3
 * // labs/box/scenes/hall-props.ts places the hall's props this way, from levelProps and its own spots.
 */
export function spawnProp<C extends object>(world: World<C>, placement: PropPlacement): number {
  const w = world as unknown as World;
  const prop = getProp(placement.prop).id;
  const spec = propBody({ ...placement, prop });
  const { position, rotation } = spec ?? propPose({ ...placement, prop });
  const body = spec ? physicsOf(w).addBody(spec) : -1;
  if (spec && !w.systems.has('props.readback')) w.systems.add('props.readback', readProps, { phase: 'readback' });
  const [x, y, z] = position;
  return w.spawn({ sceneProp: { prop, body, x, y, z, q: rotation } });
}

/** Removes a prop: its entity and its body. Throws `SIM_BAD_ARGUMENT` for an id that is no prop. */
export function removeProp<C extends object>(world: World<C>, id: number): void {
  const w = world as unknown as World;
  const { body } = propOf(w, id, 'removeProp(w, id)');
  if (body >= 0) physicsOf(w).removeBody(body);
  w.despawn(id);
}

/**
 * Hits the prop `id` from `from` (m): calls its `hit` hook, whose `knock(more)` knocks its body away from `from` with
 * `strength` under `more` (engine/physics/bodies.ts's `knock`: 4.6875 m/s across, 2.5 m/s up, no twist by default).
 * Draw `spin` from a sim stream (`w.rng('knock').range(-0.5, 0.5)`). Throws `SIM_BAD_ARGUMENT` for an id that is no prop.
 */
export function hitProp<C extends object>(
  world: World<C>,
  id: number,
  from: readonly [number, number, number],
  strength: PropKnock = {},
): void {
  const w = world as unknown as World;
  const data = propOf(w, id, 'hitProp(w, id, from)');
  const prop = getProp(data.prop);
  const at: [number, number, number] = [from[0], from[1], from[2]];
  prop.hit({
    prop,
    body: data.body,
    from: at,
    knock: (more = {}) => {
      if (data.body >= 0) knock(physicsOf(w), data.body, at, { ...strength, ...more });
    },
  });
}
