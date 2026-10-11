/**
 * @file The inspector member `anim(id?)` (PLAN.md §8.3; WP 3.7's member, delivered at gate G3's review): an animated
 * actor's character animator as `Animator.inspect()` gives it (engine/anim/character.ts): its weights, each slot of
 * the layer stack with what is active in it, the effectors, sockets, events and trail. The first player actor with an
 * animator when `id` is absent, else `SIM_BAD_ARGUMENT` naming the animated actors' ids (`none` in a scene without
 * one). `get(id).animator` shows the same animator as the raw data the sim saves.
 *
 * The animator is made for the call from the actor's `animator` component (an `AnimatorPool` of its own, as the view's
 * puppets make theirs, engine/gfx/puppets/actors.ts) and posed where the actor stands, at full detail, so its
 * effectors and sockets are the tick's. Registered from here, an app module engine/app/headless.ts loads (as
 * engine/app/feelMember.ts is), so `createHeadless` and `window.__engine` both list it.
 *
 * Invariants: it reads the world only (no recorded operation) and never touches the sim's own animators, and posing
 * writes nothing that `save()` writes, so calling it never changes the run.
 *
 * @example
 * import { createRegistry } from '../core/registry';
 * import { createCharacter } from '../physics/character';
 * import { physicsOf } from '../physics/world';
 * import { defineActorKinds, spawnActor } from '../sim/actors';
 * import { defineScene } from '../sim/scene';
 * import { createHeadless } from './headless';
 * const registry = createRegistry();
 * defineActorKinds(registry);
 * const floor = { type: 'fixed', colliders: [{ shape: { type: 'box', size: [40, 1, 40] }, position: [0, -0.5, 0] }] };
 * const setup = (w) => {
 *   physicsOf(w).addBody(floor);
 *   spawnActor(w, { at: [0, 0, 0], character: createCharacter({ speed: 5 }), anim: {} });
 * };
 * defineScene('yard', { physics: true, setup }, registry);
 * const engine = await createHeadless({ scene: 'yard', registry });
 * engine.step(30, { move: [1, 0] });
 * engine.anim().layers[1].slot; // 'base': the locomotion, with the weights in play (`active: { speed: … }`)
 * @see engine/app/viewMembers.test.ts
 * @see labs/box/scenes/room-hero.test.ts
 */
import { AnimatorPool, type AnimatorReport } from '../anim/character';
import { codeError } from '../core/log';
import { Vector3 } from '../core/math';
import { defineMember } from '../dev/members';
import type { ActorComponents } from '../sim/actors';

defineMember('anim', {
  help: "An animated actor's animator: its weights, the layer stack slot by slot, effectors, sockets, events, trail.",
  args: {
    id: { type: 'integer', minimum: 1, description: 'The animated actor’s entity id; the first player when absent.' },
  },
  impl(host, id?: number): AnimatorReport {
    const { world } = host.session;
    const actors = (world.query('actor') as unknown as (Partial<ActorComponents> & { id: number })[]).filter(
      (e) => e.animator !== undefined,
    );
    const found = actors.find((e) => (id === undefined ? e.actor!.player : e.id === id));
    if (!found) {
      const ids = actors.map((e) => e.id).join(', ') || 'none';
      const expected = `an animated actor’s id (${ids})`;
      throw codeError('SIM_BAD_ARGUMENT', { where: 'anim(id)', value: String(id), expected });
    }
    const { actor, animator } = found as ActorComponents & { id: number };
    const at = new Vector3(actor.x, actor.y, actor.z);
    return new AnimatorPool().get(found.id, animator, { dt: world.dt }).pose({ at, yaw: actor.yaw }).inspect();
  },
});
