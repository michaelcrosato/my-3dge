/**
 * @file Crowd bodies, sim-side (PLAN.md WP 5.7 core proposal, ADR-0008 amendment 6; §6.4; ADR-0009): what a member of
 * a crowd looks like, and its rig's step. An entity with the component `crowdBody` (`CROWD_BODY_FIELDS`) names its rig
 * (a humanoid in a build, a blob, a floater, a quadruped), where it stands and the rig's state as plain data; the
 * stage draws it
 * through a crowd (engine/gfx/stageCrowd.ts: instanced batches, each body posed at its band's detail), instead of a
 * stand-in.
 *
 * `stepCrowdBody(w, id, body, input)` is the rig's sim step (ADR-0009's `anim.step`: every tick, part of the hash),
 * for a system in the phase `anim`: it loads the rig from `body.state`, steps it with `input` and saves it back, and
 * moves the body to `input.at`. A humanoid's is its animator's (engine/anim/character.ts: the body states, its
 * breathing phase drawn from `rng.entity(id, 'anim')` at its first step, as an actor's); a blob's and a floater's are
 * theirs (engine/anim/blob.ts, floater.ts), the floater's clock spread from the same stream; a quadruped's is its own
 * (engine/anim/quadruped.ts, WP 13.21: its clock spread so, its feet on the world's ground where the world has
 * physics, a raycast through the group `world`, `crowdGround`). The first step fills an
 * empty `state` (a spawned body's default) with the rig at rest, turned to `body.yaw`. The rigs are pooled per world
 * and loaded at every step, so they keep no state of their own: a restore continues exactly.
 *
 * - `rig`: `humanoid` (its `look` is a build id, `build:chibi` when empty), `blob` (its `look` names its features:
 *   `horns`, `ears` or `wings`, none when empty; `size` its radius at rest, `BLOB.radius` when 0), `floater` or
 *   `quadruped` (told `input.quadruped`: to sit, what to look at and how hard to wag).
 * - `x`, `y`, `z` (m): a humanoid's, a blob's or a quadruped's feet, a floater's core; `yaw` (rad): where it faces
 *   (a humanoid's from `input.yaw`, a blob's look, a floater's and a quadruped's heading from their rigs).
 *
 * Invariants: everything a crowd body is in the sim is its component; the step writes only the component; footsteps
 * are not emitted (a crowd's would flood the events). The view poses rigs it loads from the component and never
 * writes it, so drawing, LOD and culling never change the hash.
 *
 * @example
 * import { createWorld } from './world';
 * const w = createWorld({ seed: 1 });
 * const id = w.spawn({ crowdBody: { rig: 'blob', x: 2, z: 3 } });
 * const body = w.get(id)!.crowdBody as CrowdBody;
 * w.run((w) => stepCrowdBody(w, id, body, { at: [2, 0, 3.05], velocity: [0, 0, 3] })); // a slime hopping south
 * [body.z, body.yaw]; // [3.05, 0]: moved, looking south
 * (body.state as { squash: number }).squash; // 0: the blob's state, at rest
 * @see engine/sim/crowdBodies.test.ts
 */
import { AnimatorPool, ANIMATOR_FIELDS, type AnimatorData } from '../anim/character';
import { Blob, type BlobInput, type BlobState } from '../anim/blob';
import { Floater, type FloaterState } from '../anim/floater';
import type { GaitProbe } from '../anim/proc/gait';
import { Quadruped, type QuadrupedState } from '../anim/quadruped';
import { STEP } from '../anim/humanoidRates';
import type { AnimatorInput } from '../anim/states';
import { codeError } from '../core/log';
import { Vector3 } from '../core/math';
import { copyValue, defineSchema } from '../core/schema';
import { hasPhysics, physicsOf } from '../physics/binding';
import type { Vec3Like } from '../physics/queries';
import { defineComponent } from './state';
import type { World } from './world';

/** The rigs a crowd body can have. */
export type CrowdRig = 'humanoid' | 'blob' | 'floater' | 'quadruped';

/** A crowd body's fields, for the component `crowdBody`: its rig and look, where it stands, its rig's state. */
export const CROWD_BODY_FIELDS = defineSchema({
  rig: {
    type: 'string',
    enum: ['humanoid', 'blob', 'floater', 'quadruped'],
    default: 'humanoid',
    description: 'Its rig: a humanoid (an animator), a blob, a floater or a quadruped.',
  },
  look: {
    type: 'string',
    default: '',
    description:
      'What it wears: a humanoid’s build id (build:chibi when empty), a blob’s features (horns, ears or wings; none when empty); a floater and a quadruped have none.',
  },
  size: {
    type: 'number',
    default: 0,
    minimum: 0,
    maximum: 100,
    unit: 'm',
    description: 'A blob’s radius at rest (BLOB.radius when 0); unused for the others.',
  },
  x: {
    type: 'number',
    default: 0,
    unit: 'm',
    description: 'Where it stands, east: a humanoid’s, blob’s or quadruped’s feet, a floater’s core.',
  },
  y: { type: 'number', default: 0, unit: 'm', description: 'Where it stands, up.' },
  z: { type: 'number', default: 0, unit: 'm', description: 'Where it stands, south.' },
  yaw: { type: 'number', default: 0, unit: 'rad', description: 'Where it faces: forward is (sin yaw, 0, cos yaw).' },
  state: {
    type: 'object',
    default: {},
    description:
      'Its rig’s state as plain data, written by stepCrowdBody: the animator’s data, the blob’s state, the floater’s or the quadruped’s; empty until its first step.',
  },
});

/** A crowd body: what `CROWD_BODY_FIELDS` holds. */
export interface CrowdBody {
  rig: CrowdRig;
  look: string;
  size: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  state: Record<string, unknown>;
}

/** The component `crowdBody`: an entity the stage draws through a crowd. */
export const CROWD_BODY = defineComponent('crowdBody', {
  description:
    'A crowd member’s look and rig: a humanoid, blob, floater or quadruped, where it stands, and its rig’s state, stepped by stepCrowdBody and drawn through a crowd.',
  fields: CROWD_BODY_FIELDS,
});

/** What a crowd body's rig is told each step (see the file comment). */
export interface CrowdBodyInput {
  /** Where it stands now (m): a humanoid's or a blob's feet, a floater's core. */
  at: Vec3Like;
  /** Its velocity (m/s): a humanoid walks at it, a blob looks along it (unless told), a floater turns and banks by it. */
  velocity?: Vec3Like;
  /** Where a humanoid faces (rad; the last when absent); a floater turns to it (else to its travel). */
  yaw?: number;
  /** A humanoid off its feet. */
  air?: boolean;
  /** A humanoid's other body states (engine/anim/states.ts: run, hurt, pose, stance…). */
  states?: AnimatorInput;
  /** A blob's input (engine/anim/blob.ts: squash, look, squint, flap, hang, a move) and a jolt to its squash (per s). */
  blob?: Omit<BlobInput, 'position'> & { kick?: number };
  /** A floater's swell, 0 to 1. */
  swell?: number;
  /** A quadruped's: sitting, a world point it looks at, how hard it wags (0 to 1); `air` tucks its feet. */
  quadruped?: { sit?: boolean; look?: Vec3Like | null; wag?: number };
}

/** A world's rigs: loaded from the components at every step, so they keep no state of their own. */
interface Rigs {
  animators: AnimatorPool;
  blobs: Map<number, Blob>;
  floater: Floater;
  quadruped: Quadruped;
  ground: GaitProbe | null;
  pruned: number;
}
const pools = new WeakMap<World, Rigs>();
const [at, velocity, look, seen] = [new Vector3(), new Vector3(), new Vector3(), new Vector3()];

/** The rigs of `w`; the animators of despawned entities forgotten once a step. */
function rigsOf(w: World): Rigs {
  let rigs = pools.get(w);
  if (!rigs)
    pools.set(
      w,
      (rigs = { animators: new AnimatorPool(), blobs: new Map(), floater: new Floater({ dt: w.dt }), quadruped: new Quadruped({ dt: w.dt }), ground: null, pruned: -1 }), // prettier-ignore
    );
  if (rigs.pruned !== w.tick) {
    rigs.animators.prune((id) => w.has(id));
    rigs.pruned = w.tick;
  }
  return rigs;
}

/** `value` as a point, into `out`; throws `CORE_BAD_SPEC` naming `what` unless it is three finite numbers. */
function pointOf(value: Vec3Like | undefined, what: string, where: string, out: Vector3): Vector3 {
  if (value === undefined) return out.set(0, 0, 0);
  const p = value as Partial<{ x: number; y: number; z: number }>;
  const [x, y, z] = Array.isArray(value) ? (value as readonly number[]) : [p?.x, p?.y, p?.z];
  if ([x, y, z].every(Number.isFinite)) return out.set(x!, y!, z!);
  const problems = `${what} is ${JSON.stringify(value)}: give three finite numbers, [x, y, z] or { x, y, z } in metres`;
  throw codeError('CORE_BAD_SPEC', { where, problems });
}

/** A humanoid's animator data at rest, in its build (`look`). */
function restingAnimator(body: CrowdBody): AnimatorData {
  const data = copyValue(
    Object.fromEntries(Object.entries(ANIMATOR_FIELDS).map(([key, field]) => [key, field.default])),
  ) as unknown as AnimatorData;
  data.build = body.look || 'build:chibi';
  return data;
}

/**
 * The rig's sim step for the crowd body `body` of entity `id` (see the file comment): loads it from `body.state`
 * (filling an empty one with the rig at rest), steps it with `input`, saves it back and moves the body to `input.at`.
 * Throws `CORE_BAD_SPEC` for an entity that does not live, or a point or velocity that is not three finite numbers.
 */
export function stepCrowdBody<C extends object>(
  world: World<C>,
  id: number,
  body: CrowdBody,
  input: CrowdBodyInput,
): void {
  const w = world as unknown as World;
  const where = `stepCrowdBody(w, ${id})`;
  if (!w.has(id)) {
    throw codeError('CORE_BAD_SPEC', { where, problems: `entity ${id} does not live: give the id of a live entity` });
  }
  pointOf(input.at ?? [Number.NaN, 0, 0], 'input.at', where, at);
  pointOf(input.velocity, 'input.velocity', where, velocity);
  const rigs = rigsOf(w);
  const empty = Object.keys(body.state).length === 0;
  if (body.rig === 'humanoid') {
    if (empty) body.state = restingAnimator(body) as unknown as Record<string, unknown>;
    const data = body.state as unknown as AnimatorData;
    const rng = w.rng.entity(id, 'anim');
    if (!data.started) [data.state.clock, data.started] = [rng.next() * STEP.clockSpread, true]; // as a humanoid does
    if (input.yaw !== undefined) body.yaw = input.yaw;
    const animator = rigs.animators.get(id, data, { rng, dt: w.dt });
    animator.step({ ...input.states, velocity, yaw: body.yaw, air: input.air ?? false }).save(data);
  } else if (body.rig === 'blob') {
    let blob = rigs.blobs.get(body.size);
    if (!blob) rigs.blobs.set(body.size, (blob = new Blob({ radius: body.size || undefined, dt: w.dt })));
    if (empty) body.state = { ...new Blob({ yaw: body.yaw }).state };
    Object.assign(blob.state, body.state as unknown as BlobState);
    const { kick, ...told } = input.blob ?? {};
    if (kick) blob.kick(kick);
    blob.step({ look: velocity.lengthSq() > 0 ? look.copy(velocity) : undefined, ...told, position: at });
    Object.assign(body.state, blob.state);
    body.yaw = Math.atan2(blob.state.lookX, blob.state.lookZ);
  } else if (body.rig === 'quadruped') {
    const dog = rigs.quadruped;
    if (empty) body.state = { ...new Quadruped({ yaw: body.yaw, clock: w.rng.entity(id, 'anim').next() * STEP.clockSpread }).state }; // prettier-ignore
    dog.state = body.state as unknown as QuadrupedState; // stepped in place
    const told = input.quadruped ?? {};
    const sees = told.look ? pointOf(told.look, 'input.quadruped.look', where, seen) : null;
    const probe = hasPhysics(w) ? (rigs.ground ??= crowdGround(w)) : undefined;
    dog.step({ position: at, velocity, yaw: input.yaw, air: input.air, sit: told.sit, look: sees, wag: told.wag, probe }); // prettier-ignore
    body.yaw = dog.state.yaw;
  } else {
    const floater = rigs.floater;
    if (empty)
      body.state = {
        ...new Floater({ yaw: body.yaw, clock: w.rng.entity(id, 'anim').next() * STEP.clockSpread }).state,
      };
    Object.assign(floater.state, body.state as unknown as FloaterState);
    floater.step({ position: at, velocity, yaw: input.yaw, swell: input.swell });
    Object.assign(body.state, floater.state);
    body.yaw = floater.state.yaw;
  }
  [body.x, body.y, body.z] = [at.x, at.y, at.z];
}

/** The ground for a crowd body's feet in `w`'s physics world: a raycast through the group `world` (a `GaitProbe`). */
export function crowdGround<C extends object>(world: World<C>): GaitProbe {
  const physics = physicsOf(world);
  return (origin, direction, distance, hit) => {
    const found = physics.raycast(origin, direction, { maxDistance: distance, groups: ['world'] });
    if (!found) return false;
    hit.point.copy(found.point);
    hit.normal.copy(found.normal);
    return true;
  };
}
