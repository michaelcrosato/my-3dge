/**
 * @file The inspector member `feel(id?)` (PLAN.md §8.3, WP 3.2): an actor's feel meter report, `measureFeel`
 * (engine/sim/feelCourse.ts) over the actor's character at the run's rate and `physics.characterGravity`, holstered as
 * the actor is and tuned by the `movement.*` settings off their defaults (WP 13.3, 13.4); the first player when `id`
 * is absent, else `SIM_BAD_ARGUMENT` naming the actors' ids (`none` in a scene without one). WP 13.4's feel panel
 * (engine/dev/feel/panel.ts) reads `tune.settings()`, the numbers it tunes with their values and ranges, and
 * `tune.profile(base?, id?)`, the tuning as a `defineMovement` call and a camera preset (engine/dev/feel/profile.ts).
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
import { sameValue } from '../core/registry';
import type { FeelRow } from '../dev/feel/panel';
import { profileText, tunedSpec } from '../dev/feel/profile';
import { defineMember } from '../dev/members';
import type { FeelReport } from '../physics/feel';
import { getMovement } from '../physics/movement/profile';
import { movementOverrides, tuneCharacter } from '../physics/movement/settings';
import type { ActorComponents } from '../sim/actors';
import { measureFeel } from '../sim/feelCourse';

/** The namespaces of the settings the feel panel tunes: the shooter model's numbers, then the cameras'. */
export const TUNED_PREFIXES = ['movement.', 'cam.'] as const;

/** Whether the setting at `path` lies under one of `prefixes` (the feel panel's namespaces by default). */
const under = (path: string, prefixes: readonly string[] = TUNED_PREFIXES) => prefixes.some((prefix) => path.startsWith(prefix)); // prettier-ignore

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
    const tuned = tuneCharacter(
      actor.character,
      movementOverrides((path) => settings.get(path)),
    );
    return measureFeel(tuned, { hz: world.hz, gravity, holstered: found.motion?.holstered });
  },
});

defineMember('tune.settings', {
  help: 'The numbers the feel panel tunes: every number setting under movement. (the shooter model) and cam. (the cameras), with its value and declared range.', // prettier-ignore
  impl(host): FeelRow[] {
    const settings = host.session.settings;
    return host.registry.list('setting').flatMap((entry): FeelRow[] => {
      const e = entry as unknown as { id: string; type: string; default: number; minimum?: number; maximum?: number; unit?: string; description?: string }; // prettier-ignore
      if (e.type !== 'number' || !under(e.id)) return [];
      const { id: path, minimum, maximum, unit, description } = e;
      return [{ path, value: settings.get(path) as number, default: e.default, minimum, maximum, unit, description }];
    });
  },
});

defineMember('tune.profile', {
  help: "The run's tuning as data: a defineMovement call of a base profile with the movement settings off their defaults, then the camera settings that differ, a preset.", // prettier-ignore
  args: {
    base: { type: 'string', default: 'movement:apex', description: 'The profile tuned.' },
    id: { type: 'string', default: 'movement:playtest', description: 'The new profile’s id.' },
  },
  impl(host, base: string, id: string): string {
    const get = (path: string) => host.session.settings.get(path);
    const spec = tunedSpec(getMovement(base, host.registry), movementOverrides(get));
    const cameras = host.registry.list('setting').filter((e) => under(e.id, TUNED_PREFIXES.slice(1)) && !sameValue(get(e.id), (e as unknown as { default: unknown }).default)); // prettier-ignore
    return profileText(id, spec, Object.fromEntries(cameras.map((e) => [e.id, get(e.id)])));
  },
});
