/**
 * @file Things in a scene (PLAN.md WP 10.4; docs/PLAYGROUND.md §7.2, §7.3): `spawnThing(w, kind, at, yaw?,
 * components?)` stands a thing (engine/world/things.ts) as its kind's prop on its base at `at`, kinematic, its entity
 * holding the component `thing` (its track running through its body's centre) and any others the scene gives it. A
 * strike on it (engine/sim/interact.ts `strikeEntity`: a melee hit, a shot, a blast) is a hit, `strikeThing`: a point,
 * a blast all it has; its kind's hooks are called with the world and the entity (`hit` on every hit, `down` when it
 * goes down or breaks), and the events `thingHit`
 * `{ id, thing, outcome, hp, from }` and `thingDown` `{ id, thing, outcome }` go out for the view and the HUD. The
 * system `things` (phase `anim`, added with the first thing) stands back up the things whose `rise` is over (the hook
 * `up`, the event `thingUp` `{ id, thing }`) and drives each moving one's body to where its track has it at the step's
 * end (engine/physics/bodies.ts `driveBody`), so the physics step carries it there.
 *
 * Invariants: everything is in the component and the body; things step in id order; no random stream; a thing's kind
 * is asked of its entry (`getThing`), never compared by id.
 *
 * @example
 * // in a scene's setup: a target that drops at a hit, stands again 3 s later, and slides 4 m east and back
 * // defineThing('thing:popper', { prop: 'prop:playground-target', rise: 3, track: [4, 0, 0], speed: 1.5 });
 * // const target = spawnThing(w, 'thing:popper', [10, 0, 25]);
 * // strikeEntity(w, target, [0, 1.5, 0], true, 'shot'); // thingHit, thingDown: down, rising at w.time + 3
 * @see engine/sim/things.test.ts
 */
import type { EventMap } from '../core/events';
import { physicsOf } from '../physics/binding';
import { driveBody } from '../physics/bodies';
import { getProp, propCentre } from '../world/props/prop';
import { getThing, hitThing, stepThing, thingAt, thingState, THING_FIELDS, type Thing, type ThingHit, type ThingKind, type ThingOutcome } from '../world/things'; // prettier-ignore
import { defineStrikable } from './interact';
import { spawnProp, type ScenePropComponents } from './props';
import { defineComponent } from './state';
import type { World } from './world';

defineComponent('thing', {
  description: 'A thing that can be hit (WP 10.4): its hit points, its hits, standing or down, its track.',
  fields: THING_FIELDS,
});

/** A thing's entity as this module reads it. */
type ThingEntity = ScenePropComponents & { id: number; thing: Thing };

/** What a hook of `kind` is told about `entity` (engine/world/things.ts `ThingTouch`). */
const touchOf = (w: World, e: ThingEntity, kind: ThingKind, outcome: ThingOutcome | 'up', amount: number, from: readonly [number, number, number]) => ({ thing: e.thing, kind, world: w, entity: e.id, from: [from[0], from[1], from[2]] as [number, number, number], outcome, amount }); // prettier-ignore

/**
 * Stands a thing of `kind` (its id) on its base at `at` (m), turned `yaw` (rad), as its prop, with any further
 * `components` a scene gives it (a dummy's spring: labs/playground/cast/dummies.ts); returns its entity.
 */
export function spawnThing<C extends object, E extends EventMap>(
  world: World<C, E>,
  kind: string,
  at: readonly [number, number, number],
  yaw = 0,
  components: Readonly<Record<string, object>> = {},
): number {
  const w = world as unknown as World;
  const entry = getThing(kind);
  const centre: [number, number, number] = [at[0], at[1] + propCentre(getProp(entry.prop)), at[2]];
  const thing = thingState(entry, centre);
  const id = spawnProp(w, { prop: entry.prop, at: [at[0], at[1], at[2]], yaw }, { as: 'kinematic', components: { ...components, thing } }); // prettier-ignore
  if (!w.systems.has('things')) w.systems.add('things', stepThings, { phase: 'anim' });
  return id;
}

/**
 * Hits the thing `id` for `amount` points from `from` (m) at the world's time (see the file comment): returns what the
 * hit did, or null (no thing there, or one that is down).
 */
export function strikeThing<C extends object, E extends EventMap>(
  world: World<C, E>,
  id: number,
  amount: number,
  from: readonly [number, number, number],
): ThingHit | null {
  const w = world as unknown as World;
  const e = w.get(id) as unknown as ThingEntity | undefined;
  if (!e?.thing) return null;
  const kind = getThing(e.thing.thing);
  const hit = hitThing(e.thing, kind, amount, w.time);
  if (!hit) return null;
  kind.hit(touchOf(w, e, kind, hit.outcome, amount, from));
  w.emit('thingHit', { id, thing: kind.id, outcome: hit.outcome, hp: hit.hp, from: [from[0], from[1], from[2]] });
  if (hit.outcome === 'hit') return hit;
  kind.down(touchOf(w, e, kind, hit.outcome, amount, from));
  w.emit('thingDown', { id, thing: kind.id, outcome: hit.outcome });
  return hit;
}

/** The system `things`: each thing, in id order, stood back up when its rise is over and driven along its track. */
function stepThings(w: World): void {
  for (const e of w.query('thing') as unknown as ThingEntity[]) {
    const kind = getThing(e.thing.thing);
    if (stepThing(e.thing, kind, w.time, w.dt)) {
      kind.up(touchOf(w, e, kind, 'up', 0, [e.sceneProp.x, e.sceneProp.y, e.sceneProp.z]));
      w.emit('thingUp', { id: e.id, thing: kind.id });
    }
    if (kind.speed > 0 && e.sceneProp.body >= 0) driveBody(physicsOf(w), e.sceneProp.body, thingAt(e.thing, kind), e.sceneProp.q, w.dt); // prettier-ignore
  }
}

// a melee hit or a shot takes a point, a blast all it has
defineStrikable('thing', (w, id, from, _faced, force) => {
  const thing = (w.get(id) as unknown as ThingEntity | undefined)?.thing;
  if (thing) strikeThing(w, id, force === 'blast' ? thing.hp : 1, from);
});
