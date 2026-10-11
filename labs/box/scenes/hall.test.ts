/**
 * @file Unit tests for the hall with a hero (labs/box/scenes/hall.ts, PLAN.md WP 4.6): the scene's copy of the hall is
 * labs/box/levels/hall.txt, character for character; the hero starts on the spawn, on the dais's top; and the Box 3
 * replays of the hall (tests/replays/box-3-climb.replay.json, box-3-dais.replay.json) do what their descriptions say,
 * read from the hero's state at their steps: the climb ends on the west gallery, more than 0.9 m above the floor
 * (Done-when 2), having gone up the stairs' ramp; the dais walk goes round its top, down its slope to the floor and
 * back up without a jump, jumps over the rune circle and ends by the spawn. The runs repeat to the hash, and the
 * scene's settings tune him: with a take-off of 6 m/s he no longer jumps onto a gallery, as he does with his own.
 * @see labs/box/scenes/hall.ts
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createHeadless, floorHeight, tileAt, type Intents } from '../../../engine';
import { HALL_LEVEL, HALL_START, HALL_TEXT, hall } from './hall';

/** The hero's state after `until` steps of the replay `name` (tests/replays/<name>.replay.json). */
async function play(name: string, until?: number) {
  const engine = await createHeadless({ scene: hall });
  const text = readFileSync(`tests/replays/${name}.replay.json`, 'utf8');
  const replay = engine.replay as (text: string, options: { until?: number }) => Promise<{ hash: string }>;
  const run = await replay(text, { until });
  const [{ id }] = engine.entities('actor');
  const actor = engine.get(id)?.actor as Record<string, number | boolean>;
  return { hash: run.hash, x: actor.x as number, y: actor.y as number, z: actor.z as number, actor };
}

/** The glyph id of the tile under (x, z). */
function glyphAt(x: number, z: number): string {
  const { col, row } = tileAt(HALL_LEVEL, x, z)!;
  return HALL_LEVEL.legend[HALL_LEVEL.tiles[row * HALL_LEVEL.cols + col]].id;
}

describe('the hall with a hero', () => {
  it('holds its copy of the hall to labs/box/levels/hall.txt, and starts the hero on the dais', async () => {
    expect(HALL_TEXT, 'copy labs/box/levels/hall.txt into HALL_TEXT').toBe(
      readFileSync('labs/box/levels/hall.txt', 'utf8'),
    );
    expect(HALL_START).toEqual([32.5, 0.5, 24.5]);
    const engine = await createHeadless({ scene: hall });
    engine.step(30);
    const actor = engine.get(1)?.actor as Record<string, number | boolean>;
    expect([actor.x, actor.z, actor.yaw, actor.grounded, actor.player]).toEqual([32.5, 24.5, 0, true, true]);
    expect(actor.y).toBeCloseTo(0.5, 3); // on the dais's top, to Rapier's single precision
  });

  it('climbs the west stairs to the west gallery and ends on it, more than 0.9 m above the floor', async () => {
    const foot = await play('box-3-climb', 320);
    expect(glyphAt(foot.x, foot.z)).toBe('glyph:stairs');
    const halfway = await play('box-3-climb', 360);
    expect(glyphAt(halfway.x, halfway.z)).toBe('glyph:stairs');
    expect(halfway.y).toBeGreaterThan(0.5); // up the ramp, walking: no jump in this replay
    expect(halfway.y).toBeLessThan(0.9);
    expect(halfway.actor.grounded).toBe(true);
    const runs = [await play('box-3-climb'), await play('box-3-climb')];
    const end = runs[0];
    expect(glyphAt(end.x, end.z)).toBe('glyph:gallery');
    expect(end.x).toBeLessThan(HALL_LEVEL.ramps[0].tiles[0]); // west of the stairs: walked along the gallery
    expect(end.y - 0).toBeGreaterThan(0.9); // the hall's floor is at 0
    expect(end.y).toBeCloseTo(floorHeight(HALL_LEVEL, end.x, end.z), 3);
    expect(end.actor.grounded).toBe(true);
    expect(runs[1].hash).toBe(end.hash);
  });

  it('walks round the dais, down its slope and back up, jumps over the rune circle and ends by the spawn', async () => {
    const [cx, cz] = HALL_LEVEL.daises[0].center;
    const corner = await play('box-3-dais', 110);
    expect(corner.y).toBeCloseTo(0.5, 3);
    expect(Math.hypot(corner.x - cx, corner.z - cz)).toBeGreaterThan(3.5); // near the top's edge
    const down = await play('box-3-dais', 350);
    expect(down.y).toBeCloseTo(0, 3);
    expect(Math.hypot(down.x - cx, down.z - cz)).toBeGreaterThan(HALL_LEVEL.daises[0].baseRadius);
    const slope = await play('box-3-dais', 400);
    expect([slope.y > 0.2, slope.y < 0.5, slope.actor.grounded]).toEqual([true, true, true]); // walking up it
    const up = await play('box-3-dais', 430);
    expect(up.y).toBeCloseTo(0.5, 3);
    const jump = await play('box-3-dais', 470);
    expect(jump.y).toBeGreaterThan(1.4); // 0.5 m up, plus most of his 1.46 m apex
    const runs = [await play('box-3-dais'), await play('box-3-dais')];
    expect(Math.hypot(runs[0].x - HALL_START[0], runs[0].z - HALL_START[2])).toBeLessThan(0.3);
    expect(runs[0].y).toBeCloseTo(0.5, 3);
    expect(runs[1].hash).toBe(runs[0].hash);
  });

  it('is tuned by box.hall.speed, box.hall.jump and box.hall.dash: a lower take-off cannot reach the galleries', async () => {
    const run = async (settings: Record<string, number>, ...legs: [number, Partial<Intents>][]) => {
      const engine = await createHeadless({ scene: hall, settings });
      engine.step(1);
      for (const [steps, intents] of legs) engine.step(steps, intents);
      return engine.get(1)?.actor as Record<string, number>;
    };
    const walk: Partial<Intents> = { move: [1, 0] };
    expect((await run({}, [30, walk])).vx).toBe(5);
    expect((await run({ 'box.hall.speed': 3 }, [30, walk])).vx).toBe(3);
    expect((await run({ 'box.hall.dash': 0 }, [2, { p: ['dash'] }])).dash).toBe(0);
    // Up against the west gallery's front (z 5), then a jump onto it: 1.46 m of apex reaches its 1 m, 0.6 m does not.
    const legs: [number, Partial<Intents>][] = [
      [180, { move: [-0.8, -0.6] }],
      [130, { move: [0, -1] }],
      [1, { move: [0, -1], b: ['jump'], p: ['jump'] }],
      [40, { move: [0, -1], b: ['jump'] }],
      [30, {}],
    ];
    const [high, low] = [await run({}, ...legs), await run({ 'box.hall.jump': 6 }, ...legs)];
    expect(high.y).toBeCloseTo(1, 3);
    expect(high.z).toBeLessThan(5);
    expect(low.y).toBeCloseTo(0, 3);
    expect(low.z).toBeGreaterThan(5);
  });
});
