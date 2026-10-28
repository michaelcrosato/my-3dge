/**
 * @file The actors' animators in the sim (PLAN.md WP 3.7, WP 7.8, WP 13.10; engine/sim/actors.ts adds them): the
 * systems `actors.anim`, each animated actor's animator stepped in id order, told its `states`, what its reactions'
 * and actions' beats tell it, and the controller's (`velocity`, `yaw`, `air`, `dash`; a movement model's duck as the
 * pose `crouch`), its events emitted with its feet (`at`) and its gait; and `actors.pose`, the `preciseHits` animators
 * posed where their feet are now, so their trail is sim data. Split from actors.ts at its line cap.
 *
 * Invariants: the animators are a pool per world, loaded from the components at every step, so they keep no state of
 * their own and a capture restores them; a breathing phase is drawn from `rng.entity(id, 'anim')` at the first step.
 *
 * @example
 * // spawnActor(w, { at, character, anim: {} }) adds both systems on the first animated spawn (engine/sim/actors.ts)
 * @see engine/sim/actors.test.ts
 */
import { AnimatorPool } from '../anim/character';
import { STEP } from '../anim/humanoid';
import { Vector3 } from '../core/math';
import type { ActorComponents } from './actors';
import { stepActorActions } from './actorActions';
import { stepReactions, type ReactionComponents } from './reactions';
import type { World } from './world';

/** The sim's animators, a pool per world: loaded from the components at every step, so they keep no state of their own. */
const pools = new WeakMap<World, AnimatorPool>();
const [velocity, feet] = [new Vector3(), new Vector3()];

/** The animated actors of `w`, and its pool (pruned of the despawned). */
function animated(w: World) {
  const pool = pools.get(w) ?? new AnimatorPool();
  pools.set(w, pool);
  pool.prune((id) => w.has(id));
  const actors = w.query('actor', 'animator') as unknown as (ActorComponents & Partial<ReactionComponents>)[];
  return [actors as (ActorComponents & Partial<ReactionComponents> & { id: number })[], pool] as const;
}

/**
 * The system `actors.anim`: each animator's step in id order, told its `states` and the controller's (`velocity`, `yaw`,
 * `air`, `dash`; a movement model's duck as the pose `crouch` where the states hold no pose), its breathing phase drawn
 * from `rng.entity(id, 'anim')` at its first step; emits its events. An actor's `reactions` step first, what their phase
 * tells the body laid over its `states`, then its `actions` (engine/sim/actorActions.ts), what their beat tells it laid
 * over those.
 */
export function stepAnimators(w: World): void {
  const [actors, pool] = animated(w);
  for (const entity of actors) {
    const { id, actor, animator: data, reactions, motion } = entity;
    const rng = w.rng.entity(id, 'anim');
    if (!data.started) [data.state.clock, data.started] = [rng.next() * STEP.clockSpread, true]; // as a humanoid does
    const animator = pool.get(id, data, { rng, dt: w.dt });
    velocity.set(actor.vx, actor.vy, actor.vz);
    const reacted = reactions ? { ...data.states, ...stepReactions(reactions, w.dt) } : data.states;
    const told = { ...reacted, ...stepActorActions(w, id, entity) };
    const ducked = motion?.duck === 'ducking' || motion?.duck === 'ducked'; // the movement model's crouch
    const pose = told.pose ?? (ducked ? 'crouch' : undefined);
    animator.step({ ...told, pose, velocity, yaw: actor.yaw, air: !actor.grounded, dash: actor.dash > 0 }).save(data);
    const [at, gait] = [[actor.x, actor.y, actor.z], motion?.gait];
    for (const { type, ...event } of animator.events) w.emit(type, { id, ...event, at, ...(gait ? { gait } : {}) });
  }
}

/** The system `actors.pose`: the `preciseHits` animators posed where their feet are now, so their trail is sim data. */
export function poseAnimators(w: World): void {
  const [actors, pool] = animated(w);
  for (const { id, actor, animator: data } of actors) {
    if (!data.preciseHits) continue;
    const animator = pool.get(id, data, { rng: w.rng.entity(id, 'anim'), dt: w.dt });
    animator.pose({ at: feet.set(actor.x, actor.y, actor.z), yaw: actor.yaw }).save(data);
  }
}
