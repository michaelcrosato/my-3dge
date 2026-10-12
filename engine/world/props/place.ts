/**
 * @file Placing props (PLAN.md WP 4.5): where a level puts them, the bodies they stand in the physics world with, and
 * where those without a body are drawn, as plain data, so a scene spawns props from level glyphs or from its own
 * data the same way. A placement is `{ prop, at, yaw }`: the prop by id, its base (m) and its turn about +Y (rad).
 *
 * - `levelProps(level)` lists the placements a compiled level makes: on each spawn point whose name a prop's
 *   `place.spawn` gives (on its floor), then under each light spot whose tag a prop's `place.light` gives (on the top
 *   of the spot's tile: the brazier's fire on its stand). A scene adds its own placements beside these.
 * - `propBody(placement)` is the body `physics.addBody` takes for it (engine/physics/world.ts): the prop's body type,
 *   its shape standing on the base (its origin `propCentre` up), turned by `yaw`, with the prop's material; `null`
 *   for a prop without a body.
 * - `propPose(placement)` is where it is drawn while no body moves it: its centre and its turn, as a body's pose
 *   reads (engine/gfx/props.ts draws props at either).
 *
 * Invariants: pure in the level and the registry; placements in the level's order (spawn points, then light spots,
 * each in reading order), the props each one places in id order; ids are asked of the entries' fields, never compared.
 *
 * @example
 * import { compileLevel } from '../level/compile';
 * const level = compileLevel('#####\n#.t.#\n#####\n', { file: 'nook.txt' });
 * levelProps(level); // [{ prop: 'prop:brazier', at: [2.5, 0.75, 1.5], yaw: 0 }]: on the brazier stand's top
 * propBody({ prop: 'prop:crate', at: [1, 0, 2], yaw: 0 })?.position; // [1, 0.375, 2]: the crate's centre
 * propBody({ prop: 'prop:brazier', at: [1, 0, 2], yaw: 0 }); // null: the fire has no body
 * @see engine/world/props/place.test.ts
 */
import { registry as sharedRegistry, type Registry } from '../../core/registry';
import type { CompiledLevel, Point3 } from '../level/types';
import { getProp, propCentre, propKind, type Prop } from './prop';

/**
 * A prop placed: `{ prop: 'prop:<id>', at: [x, y, z], yaw }`, its base at `at` (m) and its turn `yaw` about +Y
 * (rad), as `spawnProp` takes it and `levelProps` gives it.
 */
export interface PropPlacement {
  /** The prop, by id (`prop:crate`). */
  prop: string;
  /** Where its base stands (m). */
  at: Point3;
  /** Its turn about +Y (rad). */
  yaw: number;
}

/** A prop's collider, as `physics.addBody` takes it. */
export type PropCollider = {
  shape:
    | { type: 'box'; size: [number, number, number] }
    | { type: 'cylinder' | 'capsule'; radius: number; height: number }
    | { type: 'ball'; radius: number };
  density: number;
  friction: number;
  restitution: number;
};

/** A prop's body, as `physics.addBody` takes it (engine/physics/world.ts's `BodySpec`). */
export interface PropBody {
  type: 'dynamic' | 'fixed';
  /** Its centre (m). */
  position: [number, number, number];
  /** `[x, y, z, w]`. */
  rotation: [number, number, number, number];
  linearDamping: number;
  angularDamping: number;
  colliders: [PropCollider];
}

/** Where a prop is drawn: its centre (m) and its turn, `[x, y, z, w]`. */
export interface PropPose {
  position: [number, number, number];
  rotation: [number, number, number, number];
}

/** The placements `level` makes for the props of `registry` (the shared one by default); see the file comment. */
export function levelProps(
  level: Pick<CompiledLevel, 'spawns' | 'lights' | 'top' | 'cols'>,
  registry: Registry = sharedRegistry,
): PropPlacement[] {
  propKind(registry);
  const props = registry.list('prop') as unknown as Prop[];
  const out: PropPlacement[] = [];
  for (const spawn of level.spawns) {
    for (const prop of props) {
      if (prop.place.spawn && prop.place.spawn === spawn.name) out.push({ prop: prop.id, at: spawn.position, yaw: 0 });
    }
  }
  for (const spot of level.lights) {
    const [x, , z] = spot.position;
    const top = level.top[spot.row * level.cols + spot.col];
    for (const prop of props) {
      if (prop.place.light && prop.place.light === spot.tag) out.push({ prop: prop.id, at: [x, top, z], yaw: 0 });
    }
  }
  return out;
}

/** `placement`'s centre and turn, for `prop`. */
function poseOf(prop: Prop, { at, yaw }: PropPlacement): PropPose {
  return {
    position: [at[0], at[1] + propCentre(prop), at[2]],
    rotation: [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)],
  };
}

/** Where `placement` is drawn while no body moves it: the prop's centre and turn. */
export function propPose(placement: PropPlacement, registry: Registry = sharedRegistry): PropPose {
  return poseOf(getProp(placement.prop, registry), placement);
}

/** The body `physics.addBody` takes for `placement`, or `null` when its prop has none; see the file comment. */
export function propBody(placement: PropPlacement, registry: Registry = sharedRegistry): PropBody | null {
  const prop = getProp(placement.prop, registry);
  const { type, shape, size, radius, height, density, friction, restitution } = prop.body;
  if (type === 'none') return null;
  const collider: PropCollider['shape'] =
    shape === 'box'
      ? { type: shape, size: [size[0], size[1], size[2]] }
      : shape === 'ball'
        ? { type: shape, radius }
        : { type: shape, radius, height };
  const { linearDamping, angularDamping } = prop.body;
  return {
    type,
    ...poseOf(prop, placement),
    linearDamping,
    angularDamping,
    colliders: [{ shape: collider, density, friction, restitution }],
  };
}
