/**
 * @file The house's soak (PLAN.md WP 13.18 and WP 13.27, gate G11): the bot (engine/dev/bot.ts) tours every room of the
 * house from the front yard's spawn and back, turning its view the way it walks (`look`, as a player's mouse would),
 * and the tour's own intents, run again as a course (engine/dev/feel/run.ts), are measured by every camera's bounds
 * (labs/playground/courses/bounds.ts). Judged, none watched: every camera keeps all of its bounds in every frame, none
 * ever inside a wall, the shooter's and the platformer's too, in rooms as small as the washroom, down the attic's
 * hatch and through the crawlspace (WP 13.27, ADR-0025 amendment 22: in the house's rooms their arms had pulled in at
 * the walls until the chest left the picture, the shooter in about 7% of the tour's frames and the platformer in most).
 * The block's cast lives through the same tour (WP 13.21): no neighbour and not the dog ever stuck (told to go and not
 * 0.3 m on for 8 s: the dog frees itself sooner, a door the bot opened having swung into it once), every neighbour
 * at each of its stops, and the dog with the player again once he stands.
 * @see labs/playground/scenes/site.ts
 */
import { describe, expect, it } from 'vitest';
import { defineCourse, runCourse } from '../../../engine';
import { runBot, type BotRun } from '../../../engine/dev/bot';
import { createSession } from '../../../engine/sim/session';
import { toWorld } from '../../../engine/sim-api';
import { DOG } from '../cast/dog';
import { NEIGHBOURS } from '../cast/neighbours';
import { cameraBounds } from '../courses/bounds';
import { SITE, SITE_STRUCTURES } from '../levels/site';
import { SITE_SCENES } from './site';

/** The house on the block. */
const HOUSE = SITE.structures[Object.keys(SITE_STRUCTURES).indexOf('house')];

type Cast = { id: number; actor: { x: number; z: number; player?: boolean; intents?: { move?: number[] } }; neighbour?: { index: number }; dog?: object; route?: { stop: number }; ragdoll?: object }; // prettier-ignore

/** Watches the block's cast in `world` each step: who was ever stuck (told to go, not 0.3 m on in 8 s), the stops reached. */ // prettier-ignore
function castWatch(world: { time: number; query(...names: string[]): readonly object[] }) {
  const seen = new Map<number, { name: string; x: number; z: number; since: number; stops: Set<number> }>();
  const stuck: string[] = [];
  const step = () => {
    for (const e of world.query('actor') as Cast[]) {
      if (!e.neighbour && !e.dog) continue;
      const name = e.dog ? 'dog' : NEIGHBOURS[e.neighbour!.index].name;
      let s = seen.get(e.id);
      if (!s) seen.set(e.id, (s = { name, x: e.actor.x, z: e.actor.z, since: world.time, stops: new Set() }));
      if (e.route) s.stops.add(e.route.stop);
      const told = Math.hypot(...(e.actor.intents?.move ?? [0, 0])) > 0.05 && !e.ragdoll;
      if (!told || Math.hypot(e.actor.x - s.x, e.actor.z - s.z) > 0.3) [s.x, s.z, s.since] = [e.actor.x, e.actor.z, world.time]; // prettier-ignore
      else if (world.time - s.since > 8 && !stuck.includes(name)) stuck.push(name);
    }
  };
  return { step, stuck, seen };
}

/** The rooms in the tour's order: the ground floor, the basement, the upper floor, the attic. */
const TOUR = ['hall', 'living', 'dining', 'kitchen', 'bathroom', 'garage', 'stairwell', 'workshop', 'laundry', 'storage', 'crawlspace', 'landing', 'master', 'study', 'bedroom', 'washroom', 'attic']; // prettier-ignore

describe("the house's soak", () => {
  it('tours every room from the front yard and back, every camera keeping its bounds', () => {
    const goals = TOUR.map((name) => {
      const room = HOUSE.level.rooms!.find((r) => r.name === name)!;
      const [x, z] = toWorld(HOUSE, room.position[0], room.position[2]);
      return { x, y: room.position[1] + HOUSE.at[1], z };
    });
    expect([...TOUR].sort()).toEqual(HOUSE.level.rooms!.map((r) => r.name).sort()); // every room, once
    const session = createSession(SITE_SCENES.frontyard, { seed: 1 });
    const steps: Record<string, unknown>[] = [];
    const cast = castWatch(session.world);
    const run: BotRun = { world: session.world, step: (intents) => (steps.push({ move: null, b: null, look: null, cam: null, ...(intents as object) }), session.step(intents), cast.step()) }; // prettier-ignore
    const report = runBot(run, SITE, { to: goals, back: true, steps: 12_000, climb: 0.5, look: true });
    expect([report.status, report.reason, report.reached]).toEqual(['arrived', null, goals.length + 1]);
    for (let k = 0; k < 15 * 60; k++, cast.step()) session.step({}); // he stands in the front yard
    expect(cast.stuck).toEqual([]);
    const people = [...cast.seen.values()].filter((s) => s.name !== 'dog');
    expect(people.map((s) => [s.name, [...s.stops].sort()])).toEqual(NEIGHBOURS.map((n) => [n.name, n.stops.map((_, i) => i)])); // prettier-ignore
    const [dog, me] = [(session.world.query('dog', 'actor') as unknown as Cast[])[0].actor, (session.world.query('actor') as unknown as Cast[]).find((e) => e.actor.player)!.actor]; // prettier-ignore
    expect(Math.hypot(dog.x - me.x, dog.z - me.z)).toBeLessThan(DOG.near + 0.5); // with him again
    const inputs: [number, Record<string, unknown>][] = [];
    steps.forEach((step, i) => {
      const last = i > 0 ? steps[i - 1] : { move: null, b: null, look: null, cam: null };
      const change = Object.fromEntries(Object.entries(step).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(last[key]))); // prettier-ignore
      if (Object.keys(change).length) inputs.push([i, change]);
    });
    const measures = cameraBounds(2);
    const course = defineCourse('course:playground-house-soak', { scene: SITE_SCENES.frontyard.id, seed: 1, steps: steps.length, inputs, measures }); // prettier-ignore
    const result = runCourse(course);
    const inside = result.results.filter((r) => r.metric === 'cameraInside');
    expect([inside.length, inside.filter((r) => r.value !== 0).map((r) => r.name)]).toEqual([5, []]);
    expect(result.results.filter((r) => !r.pass || r.watch).map((r) => `${r.name} ${r.value}`)).toEqual([]);
    expect(result.pass).toBe(true);
  }, 600_000);
});
