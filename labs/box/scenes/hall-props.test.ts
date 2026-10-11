/**
 * @file Unit tests for the hall with its props (labs/box/scenes/hall-props.ts, PLAN.md WP 4.6): the 300 seeded spots
 * keep the prototype's rules (floor or gallery tiles, the middle half of a tile, clear of the start and the dais, 60%
 * crates, stacks on a crate); the scene stands a fire on each brazier and `box.hallProps.count` crates and barrels,
 * from 10 to 300, which settle without falling through; the shove hits only what is in the hero's arc; and the knock
 * replay (tests/replays/box-3-knock.replay.json) does what its description says, read from the props' components at
 * its steps: the hero pushes a crate west, each shove knocks a crate more than 0.25 m (Done-when 3: about 3 m), he
 * thrusts his hands forward while he shoves, and pushes a barrel east. The runs repeat to the hash.
 * @see labs/box/scenes/hall-props.ts
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createHeadless, levelProps, type ScenePropComponent } from '../../../engine';
import { HALL_LEVEL, HALL_START } from './hall';
import { HALL_SPOTS, hallProps, inShove, SHOVE } from './hall-props';

/** A headless engine on the hall with its props. */
type Engine = Awaited<ReturnType<typeof createHeadless>>;

/** The props of `engine` in id order: the level's fires first, then the spots'. */
function props(engine: Engine): (ScenePropComponent & { id: number })[] {
  return engine
    .entities('sceneProp')
    .map(({ id }) => ({ id, ...(engine.get(id)?.sceneProp as unknown as ScenePropComponent) }));
}

/** The engine after `until` steps of the knock replay. */
async function play(until?: number): Promise<{ engine: Engine; hash: string }> {
  const engine = await createHeadless({ scene: hallProps });
  const text = readFileSync('tests/replays/box-3-knock.replay.json', 'utf8');
  const replay = engine.replay as (text: string, options: { until?: number }) => Promise<{ hash: string }>;
  return { engine, hash: (await replay(text, { until })).hash };
}

/** Spot `i`'s prop at `until` steps of the knock replay. */
async function spotAt(i: number, until: number) {
  const { engine } = await play(until);
  return props(engine)[levelProps(HALL_LEVEL).length + i];
}

/** How far a prop's centre went across the floor between two readings. */
const across = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(b.x - a.x, b.z - a.z);

describe('the hall with its props', () => {
  it("chooses 300 spots by the prototype's rules, the same every time", () => {
    expect(HALL_SPOTS).toHaveLength(300);
    const [cx, cz] = HALL_LEVEL.daises[0].center;
    let [crates, stacked] = [0, 0];
    HALL_SPOTS.forEach((spot, i) => {
      const [x, y, z] = spot.at;
      expect(['prop:crate', 'prop:barrel']).toContain(spot.prop);
      if (spot.prop === 'prop:crate') crates++;
      if (i % 5 === 4 && Math.abs(y - HALL_SPOTS[i - 1].at[1] - 12.2 / 16) < 1e-9) {
        stacked++;
        expect(HALL_SPOTS[i - 1].prop).toBe('prop:crate');
        expect(Math.hypot(x - HALL_SPOTS[i - 1].at[0], z - HALL_SPOTS[i - 1].at[2])).toBeLessThan(0.1);
        return;
      }
      const [col, row] = [Math.floor(x), Math.floor(z)];
      expect('.='.includes(HALL_LEVEL.map[row][col]), `spot ${i}`).toBe(true);
      expect(
        [x - col, z - row].every((f) => f >= 0.25 && f <= 0.75),
        `spot ${i}`,
      ).toBe(true);
      expect(y).toBe(HALL_LEVEL.map[row][col] === '=' ? 1 : 0);
      expect(Math.hypot(x - HALL_START[0], z - HALL_START[2])).toBeGreaterThanOrEqual(3.75);
      expect(Math.hypot(x - cx, z - cz)).toBeGreaterThanOrEqual(HALL_LEVEL.daises[0].baseRadius + 0.5);
    });
    expect(crates / 300).toBeGreaterThan(0.55);
    expect(crates / 300).toBeLessThan(0.7);
    expect(stacked).toBeGreaterThan(10);
    expect(HALL_SPOTS[0]).toEqual({
      prop: 'prop:crate',
      at: [30.685041963937692, 0, 37.42289994773455],
      yaw: 4.87778609027249,
    }); // the seed's first spot, as every load chooses it
  });

  it('stands a fire on every brazier and box.hallProps.count crates and barrels, which settle in the hall', async () => {
    const fires = levelProps(HALL_LEVEL);
    expect(fires).toHaveLength(30);
    for (const count of [10, 300]) {
      const engine = await createHeadless({ scene: hallProps, settings: { 'box.hallProps.count': count } });
      engine.step(120);
      const all = props(engine);
      expect(all.map((p) => p.prop)).toEqual([
        ...fires.map((p) => p.prop),
        ...HALL_SPOTS.slice(0, count).map((p) => p.prop),
      ]);
      expect(all.slice(0, 30).every((p) => p.body === -1)).toBe(true);
      for (const p of all.slice(30)) {
        expect(p.y, `prop ${p.id}`).toBeGreaterThan(0.3); // none through the floor
        expect(p.x > 1 && p.x < 63 && p.z > 1 && p.z < 43, `prop ${p.id}`).toBe(true);
      }
    }
    const engine = await createHeadless({ scene: hallProps });
    expect(props(engine)).toHaveLength(30 + 100); // 100 by default
  });

  it('shoves only what is within reach, in his arc and level with him', async () => {
    const hero = { x: 10, y: 0, z: 10, yaw: Math.PI / 2 }; // facing east
    const at = (dx: number, dy: number, dz: number) => ({ x: 10 + dx, y: dy, z: 10 + dz });
    expect(inShove(hero, at(1.5, 0.375, 0))).toBe(true); // a crate ahead
    expect(inShove(hero, at(1, 0.375, 1.2))).toBe(true); // ahead and aside, within 1.35 rad
    expect(inShove(hero, at(-1, 0.375, 0))).toBe(false); // behind him
    expect(inShove(hero, at(0, 0.375, 1.5))).toBe(false); // beside him, 1.57 rad off
    expect(inShove(hero, at(2, 0.375, 0))).toBe(false); // beyond its 1.94 m
    expect(inShove(hero, at(1, 2, 0))).toBe(false); // on a gallery above him
    expect(inShove({ ...hero, y: 1 }, at(1, 1.375, 0))).toBe(true); // on the gallery with him
    expect(SHOVE.reach).toBeCloseTo(1.94, 2);
    // The nearest of the first ten spots is more than 3.75 m away: a shove at the start reaches nothing.
    const run = async (shoves: boolean) => {
      const engine = await createHeadless({ scene: hallProps, settings: { 'box.hallProps.count': 10 } });
      engine.step(1);
      engine.step(1, shoves ? { p: ['attack'] } : {});
      engine.step(30);
      return props(engine).map((p) => [p.x, p.y, p.z]);
    };
    expect(await run(true)).toEqual(await run(false));
  });

  it('pushes a crate west, knocks it and another more than 0.25 m with a shove each, and pushes a barrel', async () => {
    const crate = 40; // HALL_SPOTS[40]: a crate 7.9 m west of the start, in his path
    const [start, pushed] = [await spotAt(crate, 20), await spotAt(crate, 140)];
    expect(start.prop).toBe('prop:crate');
    expect(start.x - pushed.x).toBeGreaterThan(2); // pushed, not knocked: the shove comes at step 190
    const [rest, shoved] = [await spotAt(crate, 190), await spotAt(crate, 240)];
    expect(start.x - rest.x).toBeGreaterThan(3.5); // 4 m before him, then it slid to rest
    expect(across(rest, shoved)).toBeGreaterThan(2.5); // Done-when 3: more than 0.25 m
    const { engine: mid } = await play(195);
    expect((mid.get(1)?.animator as { states: { pose?: string } }).states.pose).toBe('cast');
    const { engine: after } = await play(240);
    expect((after.get(1)?.animator as { states: { pose?: string } }).states.pose).toBeUndefined();
    const other = 69; // HALL_SPOTS[69]: a crate south-west of the dais
    const [still, knocked] = [await spotAt(other, 360), await spotAt(other, 420)];
    expect(still.prop).toBe('prop:crate');
    expect(across(still, knocked)).toBeGreaterThan(2.5);
    const barrel = 72; // HALL_SPOTS[72]: a barrel south of the dais
    const [standing, rolled] = [await spotAt(barrel, 440), await spotAt(barrel, 600)];
    expect(standing.prop).toBe('prop:barrel');
    expect(rolled.x - standing.x).toBeGreaterThan(3);
    const runs = [await play(), await play()];
    expect(runs[1].hash).toBe(runs[0].hash);
  });
});
