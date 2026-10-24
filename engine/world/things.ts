/**
 * @file Things (PLAN.md WP 10.4; doctrine: Common ground): what can be hit, as a range's targets and a ring's dummies
 * are. A thing counts its hits, goes down when its hit points run out and comes back up after its kind's `rise`
 * seconds with them whole again, or stays down for good (`rise` below 0: broken), and slides to and fro along its track
 * while it stands (a moving target). Its kind, the registry's `thing` (`defineThing(id, spec)`), holds its numbers, the
 * prop it stands as and its hooks, `hit`, `down` and `up`, which a scene calls with what happened (`ThingTouch`;
 * engine/sim/things.ts calls them on a strike); its state is plain data in a component (`THING_FIELDS`), moved on by
 * `hitThing` (a hit of so many points) and `stepThing` (standing back up, and the next place on its track, `thingAt`).
 *
 * Invariants: pure on the component: `hitThing` and `stepThing` read the kind and write only the thing, so the hash and
 * captures cover it; a thing that is down takes no hit; a hit counts whatever it takes; the track runs from where it
 * stood when made (`x0`, `y0`, `z0`) to that plus the kind's `track`, at `speed`, turning back at each end. Problems
 * raise `CORE_BAD_SPEC`; a missing id gets `thing:target` after a warning.
 *
 * Carried as a concept from shooting galleries' pop-up targets and fighting games' training dummies (the counts a
 * range's HUD keeps, the dummy that gets up again), and the hit hooks of my-3d2dge's `E.def` entities
 * (`src/emberdeep/00-core.js:76-87`): asked of the entry, never the id.
 *
 * @example
 * import { createRegistry } from '../core/registry';
 * const reg = createRegistry();
 * const kind = defineThing('thing:popper', { hp: 2, rise: 1, track: [4, 0, 0], speed: 2 }, reg);
 * const popper = thingState(kind, [0, 0, 10]);
 * hitThing(popper, kind, 1, 0.5); // { outcome: 'hit', hp: 1 }
 * hitThing(popper, kind, 1, 0.6); // { outcome: 'down', hp: 0 }
 * stepThing(popper, kind, 1.6, 1 / 60); // true: up again, its 2 points back
 * thingAt(popper, kind); // [0.033…, 0, 10]: sliding east at 2 m/s
 * @see engine/world/things.test.ts
 */
import { codeError } from '../core/log';
import { registry as sharedRegistry, type Entry, type Registry } from '../core/registry';
import { defineSchema } from '../core/schema';

/** Where a thing is: standing, down for a while, or broken for good. */
export type ThingStanding = 'up' | 'down' | 'broken';

/** What a hit did: struck it, put it down, or broke it. */
export type ThingOutcome = 'hit' | 'down' | 'broken';

/** What a hook is told (see the file comment): the thing, its kind, and what touched it. */
export interface ThingTouch {
  readonly thing: Thing;
  readonly kind: ThingKind;
  /** The sim's world it stands in (a `World`: unknown here, as world code never imports the sim), when there is one. */
  readonly world?: unknown;
  /** Its entity in that world. */
  readonly entity?: number;
  /** Where the hit came from (m). */
  readonly from: readonly [number, number, number];
  /** What the hit did, and the points it took (`up` for a thing standing back up: 0). */
  readonly outcome: ThingOutcome | 'up';
  readonly amount: number;
}

/** A `thing` kind's fields (see the file comment). */
export const THING_KIND_FIELDS = defineSchema({
  prop: { type: 'string', default: 'prop:crate', description: 'The prop it stands as (engine/world/props).' },
  hp: { type: 'number', default: 1, minimum: 0.001, description: 'The hit points it stands with.' },
  rise: { type: 'number', default: 3, unit: 's', description: 'How long it stays down before it stands back up (below 0: never, broken).' }, // prettier-ignore
  track: { type: 'array', items: { type: 'number' }, default: [0, 0, 0], unit: 'm', description: 'The far end of its track from where it stands, [x, y, z] (0: it stays put).' }, // prettier-ignore
  speed: { type: 'number', default: 0, minimum: 0, unit: 'm/s', description: 'How fast it slides along its track while it stands.' }, // prettier-ignore
  hit: { type: 'function', default: (touch: ThingTouch): void => void touch, description: 'What a hit does beyond counting: (touch) => void.' }, // prettier-ignore
  down: { type: 'function', default: (touch: ThingTouch): void => void touch, description: 'What going down does: (touch) => void.' }, // prettier-ignore
  up: { type: 'function', default: (touch: ThingTouch): void => void touch, description: 'What standing back up does: (touch) => void.' }, // prettier-ignore
});

/** A `thing` entry: see the file comment. */
export type ThingKind = Omit<Entry<typeof THING_KIND_FIELDS>, 'track' | 'hit' | 'down' | 'up'> & {
  readonly track: readonly [number, number, number];
  readonly hit: (touch: ThingTouch) => void;
  readonly down: (touch: ThingTouch) => void;
  readonly up: (touch: ThingTouch) => void;
};

/** What `defineThing` takes: any of the kind's fields, the rest at their defaults. */
export type ThingSpec = Partial<Omit<ThingKind, 'id' | 'kind'>>;

/** The component a thing's state lives in, for a scene: `defineComponent('thing', { description, fields: … })`. */
export const THING_FIELDS = defineSchema({
  thing: { type: 'string', default: 'thing:target', description: 'Its kind, by id (the registry’s `thing`).' },
  hp: { type: 'number', default: 1, description: 'The hit points it has left.' },
  state: { type: 'string', enum: ['up', 'down', 'broken'], default: 'up', description: 'Standing, down for a while, or broken for good.' }, // prettier-ignore
  hits: { type: 'integer', default: 0, minimum: 0, description: 'Hits taken, all told.' },
  hitAt: { type: 'number', default: -1, unit: 's', description: 'When it was last hit (−1: never).' },
  downAt: { type: 'number', default: -1, unit: 's', description: 'When it last went down (−1: never).' },
  x0: { type: 'number', default: 0, unit: 'm', description: 'Where its track starts, east: where it stood when made.' },
  y0: { type: 'number', default: 0, unit: 'm', description: 'Where its track starts, up.' },
  z0: { type: 'number', default: 0, unit: 'm', description: 'Where its track starts, south.' },
  along: { type: 'number', default: 0, minimum: 0, maximum: 1, description: 'How far along its track it is, 0 to 1.' },
  way: { type: 'integer', default: 1, minimum: -1, maximum: 1, description: 'Which way it slides: 1 toward the far end, −1 back.' }, // prettier-ignore
});

/** A thing's state (`THING_FIELDS` says what each field means). */
export interface Thing {
  thing: string;
  hp: number;
  state: ThingStanding;
  hits: number;
  hitAt: number;
  downAt: number;
  x0: number;
  y0: number;
  z0: number;
  along: number;
  way: number;
}

/** The problems of a kind beyond its fields: a track of three numbers. */
function thingProblems(kind: ThingKind): string[] {
  const ok = kind.track.length === 3 && kind.track.every((v) => Number.isFinite(v));
  return ok ? [] : [`track ${JSON.stringify(kind.track)} is not [x, y, z] in metres`];
}

/** Declares the kind `thing` on `registry`, with its default `thing:target`, unless it has it. */
export function thingKind(registry: Registry): void {
  if (registry.kinds().includes('thing')) return;
  registry.defineKind('thing', {
    description: 'Things that can be hit: a range’s targets, a ring’s dummies; they count hits, go down and come back up, and slide along a track.', // prettier-ignore
    fields: THING_KIND_FIELDS,
    fallback: 'thing:target',
    defineWith: "defineThing('<id>', { prop: 'prop:<id>', hp: 1, rise: 3 })",
    check: (entry) => thingProblems(entry as unknown as ThingKind),
  });
  registry.def('thing', 'thing:target', {});
}
thingKind(sharedRegistry);

/** Defines a kind of thing on `registry` (the shared one by default) and returns it. Throws `CORE_BAD_SPEC` naming each problem. */ // prettier-ignore
export function defineThing(id: string, spec: ThingSpec, registry: Registry = sharedRegistry): ThingKind {
  thingKind(registry);
  return registry.def('thing', id, { ...spec } as Record<string, unknown>) as unknown as ThingKind;
}

/** The kind of thing `id` of `registry` (the shared one by default); a missing id gives `thing:target`, with a warning. */ // prettier-ignore
export function getThing(id: string, registry: Registry = sharedRegistry): ThingKind {
  thingKind(registry);
  return registry.get('thing', id) as unknown as ThingKind;
}

/** A new thing of `kind` standing at `at` (m), its hit points whole, at its track's start. */
export function thingState(kind: ThingKind, at: readonly [number, number, number]): Thing {
  if (!at.every((v) => Number.isFinite(v))) throw codeError('CORE_BAD_SPEC', { where: `thingState(${kind.id}, at)`, problems: `${JSON.stringify(at)}: give [x, y, z] in metres` }); // prettier-ignore
  return { thing: kind.id, hp: kind.hp, state: 'up', hits: 0, hitAt: -1, downAt: -1, x0: at[0], y0: at[1], z0: at[2], along: 0, way: 1 }; // prettier-ignore
}

/** What `hitThing` did: the outcome and the hit points left. */
export interface ThingHit {
  readonly outcome: ThingOutcome;
  readonly hp: number;
}

/**
 * Hits `thing` for `amount` points at `time` (s): counts it and takes the points; at 0 it goes down (`down`), or breaks
 * (`broken`) when its kind never rises. Returns null, changing nothing, when it is not standing.
 */
export function hitThing(thing: Thing, kind: ThingKind, amount: number, time: number): ThingHit | null {
  if (!(Number.isFinite(amount) && amount >= 0)) throw codeError('CORE_BAD_SPEC', { where: 'hitThing(amount)', problems: `${amount}: give 0 points or more` }); // prettier-ignore
  if (thing.state !== 'up') return null;
  thing.hits++;
  thing.hitAt = time;
  thing.hp = Math.max(0, thing.hp - amount);
  if (thing.hp > 0) return { outcome: 'hit', hp: thing.hp };
  thing.state = kind.rise < 0 ? 'broken' : 'down';
  thing.downAt = time;
  return { outcome: thing.state === 'broken' ? 'broken' : 'down', hp: 0 };
}

/**
 * Moves `thing` on to `time` (s), a step of `dt` seconds: one down for its kind's `rise` stands back up, its hit points
 * whole (returns true then); one standing slides along its track at its kind's speed, turning back at each end.
 */
export function stepThing(thing: Thing, kind: ThingKind, time: number, dt: number): boolean {
  const rose = thing.state === 'down' && kind.rise >= 0 && time - thing.downAt >= kind.rise - 1e-9;
  if (rose) [thing.state, thing.hp] = ['up', kind.hp];
  const length = Math.hypot(...kind.track);
  if (thing.state !== 'up' || kind.speed <= 0 || length < 1e-9) return rose;
  let along = thing.along + (thing.way * kind.speed * dt) / length;
  // at an end it turns back, the rest of the step's way going back (a step longer than the track stops at the end)
  if (along > 1) [along, thing.way] = [Math.max(0, 2 - along), -1];
  else if (along < 0) [along, thing.way] = [Math.min(1, -along), 1];
  thing.along = along;
  return rose;
}

/** Where `thing` stands now (m): its track's start, `along` of the way to its far end. */
export function thingAt(thing: Thing, kind: ThingKind): [number, number, number] {
  const [dx, dy, dz] = kind.track;
  return [thing.x0 + dx * thing.along, thing.y0 + dy * thing.along, thing.z0 + dz * thing.along];
}
