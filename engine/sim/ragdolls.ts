/**
 * @file Ragdolls in the sim (PLAN.md WP 10.2; I-11): the hand-off from an actor's animation to its ragdoll and back.
 * `handOff(w, id, hit)` gives an actor with an animator over to physics: its body posed where it stands now (its
 * animator's, engine/anim/character.ts), the humanoid's ragdoll of that pose (engine/anim/ragdoll.ts `ragdollOf`) added
 * to the physics world (engine/physics/ragdoll.ts), every part moving as the body did plus the hit's `push` (m/s) and
 * `spin` (rad/s; by default a tip over the push, `RAGDOLL_SIM.tip`), its reactions down for as long as it takes
 * (`knockDown`, or `die` when `dead`) and the component `ragdoll` holding its ids and its parts' poses; event `ragdoll`
 * `{ id, dead }`. A hit on a ragdoll still falling adds its push to every part (a dead one's too); a dying one stays down.
 *
 * The system `ragdolls` (phase `readback`; `addRagdolls(w)` adds it in a scene's setup, so a capture restores into a
 * world of the same schedule, and `handOff` refuses a world without it) reads every ragdoll's parts into its
 * component once the world has stepped (the view lays them on the bones), keeps its actor's capsule under its pelvis
 * (the cameras follow it, and the actor does not move itself meanwhile: engine/sim/actors.ts), and counts the steps its
 * trunk (the pelvis and the chest) has lain still (`RAGDOLL_SIM.speed`): a limb still swinging is laid into the get-up as
 * the ragdoll fades out. Alive, once its trunk has lain still `RAGDOLL_SIM.settle` or it has fallen for
 * `RAGDOLL_SIM.longest`, it gets up: its parts leave the physics world, the actor stands where the humanoid lying as
 * it lies would and faces as it would (`ragdollRest`), and its reactions get up the way its chest lies
 * (`Reactions.getUp`); event `getUp` `{ id, lying }`. The component stays `RAGDOLL_SIM.rise` more, its last poses
 * kept, while the view fades the ragdoll out (engine/gfx/puppets/actors.ts). A dead one lies until it is removed
 * (`removeRagdollOf`; engine/sim/actors.ts `removeActor` takes its parts with the actor) or stood up (`standUp`,
 * which gets any ragdoll up now).
 *
 * Invariants: everything a ragdoll is lives in its component and in Rapier (its parts and joints), so a capture
 * restores it and it steps on exactly; ragdolls step in id order; no random stream (the pose comes from the
 * animator's data, never its entity's stream).
 *
 * @example
 * // in a scene's setup, after its actors: addRagdolls(w);
 * // in a rule, a blow hard enough: handOff(w, target, { push: [0, 1.5, 4] }); // it flies back off its feet
 * // a killing one: handOff(w, target, { push: [0, 0, 3], dead: true });
 * // (w.get(target) as { ragdoll: RagdollState }).ragdoll.rise; // −1 while it falls; the tick it got up after
 * @see engine/sim/ragdolls.test.ts
 */
import { AnimatorPool, type AnimatorData } from '../anim/character';
import { getBuild } from '../anim/builds';
import { RAGDOLL_FADE, ragdollOf, ragdollRest } from '../anim/ragdoll';
import { codeError } from '../core/log';
import { Vector3 } from '../core/math';
import { registry as sharedRegistry, type Registry } from '../core/registry';
import { defineSchema } from '../core/schema';
import { physicsOf } from '../physics/binding';
import type { Character } from '../physics/character';
import { bodyAt } from '../physics/characterBody';
import { vec, type Vec3Like } from '../physics/queries';
import { addRagdoll, ragdollSpeed, readRagdoll, removeRagdoll } from '../physics/ragdoll';
import { placeActor } from './actors';
import { reactTo } from './reactions';
import { defineComponent } from './state';
import type { World } from './world';

/** The hand-off's numbers: seconds, m/s, and the tip a push gives (rad/s for each m/s). */
export const RAGDOLL_SIM = {
  /** Below this speed (m/s, its trunk's fastest part's, engine/physics/ragdoll.ts `ragdollSpeed`) it lies still. */
  speed: 0.3,
  /** Seconds its trunk lies still before it gets up. */
  settle: 0.5,
  /** Seconds after which it gets up however it lies. */
  longest: 5,
  /** Seconds it stays as it gets up, while the view fades it out (engine/anim/ragdoll.ts `RAGDOLL_FADE`). */
  rise: RAGDOLL_FADE.out,
  /** The spin a push gives by default: rad/s about the push's level side for each m/s of it, tipping it over. */
  tip: 0.8,
} as const;

/** The component `ragdoll`'s fields. */
export const RAGDOLL_FIELDS = defineSchema({
  bodies: { type: 'array', items: { type: 'number' }, default: [], description: 'Its parts’ bodies, in engine/anim/ragdoll.ts `RAGDOLL_PARTS` order (none once it got up).' }, // prettier-ignore
  joints: { type: 'array', items: { type: 'number' }, default: [], description: 'The joints between its parts.' },
  poses: { type: 'array', items: { type: 'number' }, default: [], description: 'Its parts’ poses as the last step left them, 7 numbers a part: position, then rotation (x, y, z, w).' }, // prettier-ignore
  since: { type: 'number', default: 0, description: 'The step it was handed off on.' },
  still: { type: 'number', default: 0, description: 'Steps its trunk (the pelvis and the chest) has lain still.' },
  rise: { type: 'number', default: -1, description: 'The step it got up on; −1 while it falls or lies dead.' },
  dead: { type: 'boolean', default: false, description: 'Dead: it lies until it is removed.' },
  lying: { type: 'string', enum: ['up', 'down'], default: 'up', description: 'How it lay as it got up: on its back (up) or its face (down).' }, // prettier-ignore
});

/** The component `ragdoll`: an actor's body in physics' hands (see the file comment). */
export interface RagdollState {
  bodies: number[];
  joints: number[];
  poses: number[];
  since: number;
  still: number;
  rise: number;
  dead: boolean;
  lying: 'up' | 'down';
}

/** A hit that hands a body off: its push (m/s, added to how it moves), its spin (rad/s), and whether it kills. */
export interface RagdollHit {
  push?: Vec3Like;
  spin?: Vec3Like;
  dead?: boolean;
}

/** What the hand-off reads of an actor. */
type Body = {
  id: number;
  actor: { body: number; character: Character; x: number; y: number; z: number; yaw: number; vx: number; vy: number; vz: number }; // prettier-ignore
  animator: AnimatorData;
  ragdoll?: RagdollState;
};

/** Declares the component `ragdoll` on `registry` (the shared one by default), once. */
export function defineRagdollKinds(registry: Registry = sharedRegistry): void {
  if (registry.kinds().includes('component') && registry.has('component', 'ragdoll')) return;
  const description = 'An actor’s body in physics’ hands (engine/sim/ragdolls.ts): its parts, their poses, and when it gets up.'; // prettier-ignore
  defineComponent('ragdoll', { description, fields: RAGDOLL_FIELDS }, registry);
}
defineRagdollKinds();

/** The hand-off's animators, a pool per world, loaded from the components at every use (they keep nothing). */
const pools = new WeakMap<World, AnimatorPool>();
const [UP, push3, spin3, feet] = [new Vector3(0, 1, 0), new Vector3(), new Vector3(), new Vector3()];
const ticks = (w: World, seconds: number) => Math.round(seconds / w.dt);
/** How many of `RAGDOLL_PARTS` (engine/anim/ragdoll.ts) the trunk is: the pelvis and the chest, its first two. */
const TRUNK = 2;

/** Adds the system `ragdolls` to `w` (once), after the actors' readback: call it in a scene's setup. */
export function addRagdolls<C extends object>(world: World<C>): void {
  const w = world as unknown as World;
  if (!w.systems.has('ragdolls')) w.systems.add('ragdolls', stepRagdolls, { phase: 'readback' });
}

/** Gives actor `id` over to its ragdoll, as `hit` says (see the file comment); returns its component. */
export function handOff<C extends object>(world: World<C>, id: number, hit: RagdollHit = {}): RagdollState {
  const w = world as unknown as World;
  const e = w.get(id) as Partial<Body> | undefined;
  if (!e?.actor || !e.animator) throw codeError('SIM_BAD_ARGUMENT', { where: 'handOff(w, id)', value: String(id), expected: 'an actor with an animator (spawnActor with anim)' }); // prettier-ignore
  if (!w.systems.has('ragdolls')) throw codeError('SIM_BAD_ARGUMENT', { where: 'handOff(w)', value: 'a world without the system ragdolls', expected: 'a scene that calls addRagdolls(w) in its setup' }); // prettier-ignore
  const physics = physicsOf(w);
  const { actor, animator: data } = e;
  const given = vec(hit.push ?? [0, 0, 0], 'handOff(hit.push)');
  const push = push3.set(given.x, given.y, given.z);
  const yaw = actor.yaw;
  if (e.ragdoll && e.ragdoll.rise < 0) {
    for (const body of e.ragdoll.bodies) physics.setBody(body, { velocity: physics.readBody(body).velocity.add(push) });
    if (hit.dead && !e.ragdoll.dead) {
      e.ragdoll.dead = true;
      reactTo(w, id, (r) => r.die(push, yaw));
    }
    return e.ragdoll;
  }
  if (e.ragdoll) removeRagdollOf(w, id); // getting up: down again from where it stands
  const pool = pools.get(w) ?? new AnimatorPool();
  pools.set(w, pool);
  const animator = pool.get(id, data, { dt: w.dt }).pose({ at: feet.set(actor.x, actor.y, actor.z), yaw });
  const spec = ragdollOf(animator.body.build, animator.body.world);
  const turn = hit.spin ? vec(hit.spin, 'handOff(hit.spin)') : null;
  const spin = turn ? spin3.set(turn.x, turn.y, turn.z) : spin3.crossVectors(UP, push).multiplyScalar(RAGDOLL_SIM.tip);
  const velocity = [actor.vx + push.x, actor.vy + push.y, actor.vz + push.z] as const;
  const made = addRagdoll(physics, { ...spec, velocity, angularVelocity: [spin.x, spin.y, spin.z], group: 'corpse' });
  const ragdoll = w.add(id, 'ragdoll') as unknown as RagdollState;
  Object.assign(ragdoll, { bodies: [...made.bodies], joints: [...made.joints], poses: readRagdoll(physics, made), since: w.tick, still: 0, rise: -1, dead: hit.dead ?? false }); // prettier-ignore
  reactTo(w, id, (r) => (hit.dead ? r.die(push, yaw) : r.knockDown(push, yaw, Infinity)));
  w.emit('ragdoll', { id, dead: ragdoll.dead });
  return ragdoll;
}

/** Actor `id`'s ragdoll gets up now, the dead too, the way it lies (as the system's do); false: it has none falling. */
export function standUp<C extends object>(world: World<C>, id: number): boolean {
  const w = world as unknown as World;
  const e = w.get(id) as Partial<Body> | undefined;
  if (!e?.ragdoll || e.ragdoll.rise >= 0 || !e.actor || !e.animator) return false;
  e.ragdoll.dead = false;
  getUp(w, e as Body, e.ragdoll);
  return true;
}

/** Takes actor `id`'s ragdoll out (its parts, if any, and the component); a body without one is left alone. */
export function removeRagdollOf<C extends object>(world: World<C>, id: number): void {
  const w = world as unknown as World;
  const ragdoll = (w.get(id) as Partial<Body> | undefined)?.ragdoll;
  if (!ragdoll) return;
  removeRagdoll(physicsOf(w), ragdoll);
  w.remove(id, 'ragdoll');
}

/** The system `ragdolls`: every ragdoll's step, in id order (see the file comment). */
function stepRagdolls(w: World): void {
  const physics = physicsOf(w);
  for (const e of w.query('ragdoll', 'actor', 'animator') as unknown as Body[]) {
    const ragdoll = e.ragdoll!;
    if (ragdoll.rise >= 0) {
      if (w.tick - ragdoll.rise >= ticks(w, RAGDOLL_SIM.rise)) w.remove(e.id, 'ragdoll');
      continue;
    }
    readRagdoll(physics, ragdoll, ragdoll.poses);
    const trunk = ragdollSpeed(physics, { bodies: ragdoll.bodies.slice(0, TRUNK), joints: [] });
    ragdoll.still = trunk < RAGDOLL_SIM.speed ? ragdoll.still + 1 : 0;
    const [x, y, z] = ragdoll.poses;
    const floor = physics.raycast([x, y, z], [0, -1, 0], { maxDistance: 4, groups: ['world', 'prop'] });
    const ground = floor ? y - floor.distance : y - 0.15;
    const { actor } = e;
    physics.setBody(actor.body, { position: bodyAt(actor.character, [x, ground, z], 'the ragdoll’s pelvis'), velocity: [0, 0, 0] }); // prettier-ignore
    [actor.x, actor.y, actor.z, actor.vx, actor.vy, actor.vz] = [x, ground, z, 0, 0, 0];
    const age = w.tick - ragdoll.since;
    if (ragdoll.dead || (ragdoll.still < ticks(w, RAGDOLL_SIM.settle) && age < ticks(w, RAGDOLL_SIM.longest))) continue;
    getUp(w, e, ragdoll);
  }
}

/** A ragdoll at rest gets up (see the file comment). */
function getUp(w: World, e: Body, ragdoll: RagdollState): void {
  const rest = ragdollRest(getBuild(e.animator.build), ragdoll.poses);
  removeRagdoll(physicsOf(w), ragdoll);
  [ragdoll.bodies, ragdoll.joints, ragdoll.rise, ragdoll.lying] = [[], [], w.tick, rest.lying];
  try {
    placeActor(w, e.id, [rest.at.x, e.actor.y, rest.at.z], rest.yaw); // on the floor its pelvis lay over
  } catch {
    e.actor.yaw = rest.yaw; // no headroom where it would stand: it gets up where its capsule is
  }
  reactTo(w, e.id, (r) => r.getUp(rest.chest));
  w.emit('getUp', { id: e.id, lying: rest.lying });
}
