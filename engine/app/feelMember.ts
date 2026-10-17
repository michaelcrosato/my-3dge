/**
 * @file The inspector member `feel(id?)` (PLAN.md §8.3, WP 3.2): an actor's feel meter report, `measureFeel`
 * (engine/sim/feelCourse.ts) over the actor's character at the run's rate and `physics.characterGravity`, holstered as
 * the actor is (WP 13.3); the first player when `id` is absent, else `SIM_BAD_ARGUMENT` naming the actors' ids (`none`
 * in a scene without one).
 *
 * Registered from here, an app module that imports engine/dev/members.ts (which declares the kind) and that
 * engine/app/headless.ts loads, so `createHeadless` in Node and `window.__engine` in a page (engine/app/engine.ts
 * builds on it) list `feel` whatever the importer loaded first. The sim never imports `dev/`, so the member cannot
 * register from engine/sim/actors.ts without depending on import order.
 *
 * Invariants: it reads the world and the settings only (no recorded operation), so calling it never changes the run;
 * the course runs in a world of its own.
 *
 * @example
 * import { createRegistry } from '../core/registry';
 * import { createCharacter } from '../physics/character';
 * import { physicsOf } from '../physics/binding';
 * import { defineActorKinds, spawnActor } from '../sim/actors';
 * import { defineScene } from '../sim/scene';
 * import { createHeadless } from './headless';
 * const registry = createRegistry();
 * defineActorKinds(registry);
 * const floor = { type: 'fixed', colliders: [{ shape: { type: 'box', size: [40, 1, 40] }, position: [0, -0.5, 0] }] };
 * const setup = (w) => {
 *   physicsOf(w).addBody(floor);
 *   spawnActor(w, { at: [0, 0, 0], character: createCharacter({ speed: 5 }) });
 * };
 * defineScene('yard', { physics: true, setup }, registry);
 * const engine = await createHeadless({ scene: 'yard', registry });
 * engine.feel().topSpeed; // 5
 * @see engine/app/viewMembers.test.ts
 * @see engine/sim/actors.test.ts
 */
import { codeError } from '../core/log';
import { defineMember } from '../dev/members';
import type { FeelReport } from '../physics/feel';
import type { ActorComponents } from '../sim/actors';
import { measureFeel } from '../sim/feelCourse';

defineMember('feel', {
  help: "An actor's feel measured on a flat course: response, acceleration, stop, turn, jump apex, air time, reach; the shooter model's gaits, sprint, fatigue, strafe and lurch.",
  args: {
    id: { type: 'integer', minimum: 1, description: 'The actor’s entity id; the first player when absent.' },
  },
  impl(host, id?: number): FeelReport {
    const { world, settings } = host.session;
    const actors = world.query('actor') as unknown as (ActorComponents & { id: number })[];
    const found = actors.find((e) => (id === undefined ? e.actor.player : e.id === id));
    const actor = found?.actor;
    if (!actor) {
      const ids = actors.map((e) => e.id).join(', ') || 'none';
      throw codeError('SIM_BAD_ARGUMENT', { where: 'feel(id)', value: String(id), expected: `an actor’s id (${ids})` });
    }
    const gravity = settings.get('physics.characterGravity') as number;
    return measureFeel(actor.character, { hz: world.hz, gravity, holstered: found.motion?.holstered });
  },
});
