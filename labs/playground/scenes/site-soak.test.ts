/**
 * @file The house's soak (PLAN.md WP 13.18, gate G11): the bot (engine/dev/bot.ts) tours every room of the house from
 * the front yard's spawn and back, turning its view the way it walks (`look`, as a player's mouse would), and the
 * tour's own intents, run again as a course (engine/dev/feel/run.ts), are measured by every camera's bounds
 * (labs/playground/courses/bounds.ts). Judged: no camera ever stands inside a wall (the gate's bound), and first person,
 * isometric and top-down keep all of theirs. The shooter's and the platformer's other bounds are watched for WP 13.27:
 * in the house's rooms their arms pull in at the walls until the player's chest leaves the picture (the shooter in
 * about 7% of the tour's frames, the platformer in most of them) and a door swinging into the shooter's ball cuts it
 * (ADR-0025 amendment 20).
 * @see labs/playground/scenes/site.ts
 */
import { describe, expect, it } from 'vitest';
import { defineCourse, runCourse } from '../../../engine';
import { runBot, type BotRun } from '../../../engine/dev/bot';
import { createSession } from '../../../engine/sim/session';
import { toWorld } from '../../../engine/sim-api';
import { cameraBounds } from '../courses/bounds';
import { SITE, SITE_STRUCTURES } from '../levels/site';
import { SITE_SCENES } from './site';

/** The house on the block. */
const HOUSE = SITE.structures[Object.keys(SITE_STRUCTURES).indexOf('house')];

/** The rooms in the tour's order: the ground floor, the basement, the upper floor, the attic. */
const TOUR = ['hall', 'living', 'dining', 'kitchen', 'bathroom', 'garage', 'stairwell', 'workshop', 'laundry', 'storage', 'crawlspace', 'landing', 'master', 'study', 'bedroom', 'washroom', 'attic']; // prettier-ignore

/** The cameras whose bounds but `inside` wait for WP 13.27, by name. */
const WATCHED = { shooter: 'WP 13.27', platformer: 'WP 13.27' };

describe("the house's soak", () => {
  it('tours every room from the front yard and back, no camera ever inside a wall', () => {
    const goals = TOUR.map((name) => {
      const room = HOUSE.level.rooms!.find((r) => r.name === name)!;
      const [x, z] = toWorld(HOUSE, room.position[0], room.position[2]);
      return { x, y: room.position[1] + HOUSE.at[1], z };
    });
    expect([...TOUR].sort()).toEqual(HOUSE.level.rooms!.map((r) => r.name).sort()); // every room, once
    const session = createSession(SITE_SCENES.frontyard, { seed: 1 });
    const steps: Record<string, unknown>[] = [];
    const run: BotRun = { world: session.world, step: (intents) => (steps.push({ move: null, b: null, look: null, ...(intents as object) }), session.step(intents)) }; // prettier-ignore
    const report = runBot(run, SITE, { to: goals, back: true, steps: 12_000, climb: 0.5, look: true });
    expect([report.status, report.reason, report.reached]).toEqual(['arrived', null, goals.length + 1]);
    const inputs: [number, Record<string, unknown>][] = [];
    steps.forEach((step, i) => {
      const last = i > 0 ? steps[i - 1] : { move: null, b: null, look: null };
      const change = Object.fromEntries(Object.entries(step).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(last[key]))); // prettier-ignore
      if (Object.keys(change).length) inputs.push([i, change]);
    });
    // Inside is judged for every camera, the watched ones' too.
    const measures = cameraBounds(2, { watch: WATCHED }).map(({ watch, ...m }) => (m.metric === 'cameraInside' || !watch ? m : { ...m, watch })); // prettier-ignore
    const course = defineCourse('course:playground-house-soak', { scene: SITE_SCENES.frontyard.id, seed: 1, steps: steps.length, inputs, measures }); // prettier-ignore
    const result = runCourse(course);
    const inside = result.results.filter((r) => r.metric === 'cameraInside');
    expect([inside.length, inside.filter((r) => r.value !== 0).map((r) => r.name)]).toEqual([5, []]);
    expect(result.results.filter((r) => !r.pass && !r.watch).map((r) => `${r.name} ${r.value}`)).toEqual([]);
    expect(result.pass).toBe(true);
  }, 600_000);
});
