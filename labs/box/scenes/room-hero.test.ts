/**
 * @file Unit tests for the room with a hero (labs/box/scenes/room-hero.ts, PLAN.md WP 3.10): the scene's copy of the
 * room is labs/box/levels/room.txt, character for character; the hero starts on the spawn; and the Box 2 replays
 * (tests/replays/box-2-*.replay.json) do what their descriptions say, read from the hero's state at their steps: the
 * walk goes round a square twice and back near the spawn, the dash covers its 3.25 m once however often it is pressed and
 * stops at the low wall, the jump lands on the low wall's top, off it and on it again. Each gives its golden hashes
 * (the walk three times), `__engine.anim()` shows his animator's layers and weights, and the scene's settings tune
 * him.
 * @see labs/box/scenes/room-hero.ts
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createHeadless, type Intents } from '../../../engine';
import type { AnimatorReport } from '../../../engine/sim-api';
import { ROOM_HERO_LEVEL, ROOM_TEXT, roomHero } from './room-hero';

/** The hero's state after `until` steps of the replay `name` (tests/replays/<name>.replay.json), and its hashes. */
async function play(name: string, until?: number) {
  const engine = await createHeadless({ scene: roomHero });
  const text = readFileSync(`tests/replays/${name}.replay.json`, 'utf8');
  type Run = { hash: string; hashes: Record<string, string> };
  const replay = engine.replay as (text: string, options: { until?: number }) => Promise<Run>;
  const run = await replay(text, { until });
  const [{ id }] = engine.entities('actor');
  const actor = engine.get(id)?.actor as Record<string, number | boolean>;
  const { hash, hashes } = run;
  return { hash, hashes, x: actor.x as number, y: actor.y as number, z: actor.z as number, actor };
}

/** The golden hashes of the replay `name` on this platform. */
const goldens = (name: string): Record<string, string> =>
  (JSON.parse(readFileSync(`tests/replays/${name}.replay.json`, 'utf8')) as { hashes: Record<string, object> }).hashes[
    `${process.platform}-${process.arch}`
  ] as Record<string, string>;

/** The low wall's top: its footprint (x 4–10, z 6–7) and height. */
const LOW_WALL = { x: [4, 10], z: [6, 7], top: 0.75 };

describe('the room with a hero', () => {
  it('holds its copy of the room to labs/box/levels/room.txt, and starts the hero on the spawn', async () => {
    expect(ROOM_TEXT, 'copy labs/box/levels/room.txt into ROOM_TEXT').toBe(
      readFileSync('labs/box/levels/room.txt', 'utf8'),
    );
    const boxes = ROOM_HERO_LEVEL.colliders.flatMap((c) => (c.shape === 'box' ? [c] : []));
    const lowWall = boxes.find((c) => c.min[0] === LOW_WALL.x[0] && c.min[2] === LOW_WALL.z[0])!;
    expect(lowWall.max).toEqual([LOW_WALL.x[1], LOW_WALL.top, LOW_WALL.z[1]]);
    const engine = await createHeadless({ scene: roomHero });
    engine.step(30);
    const actor = engine.get(1)?.actor as Record<string, number | boolean>;
    expect([actor.x, actor.z, actor.yaw, actor.grounded, actor.player]).toEqual([3.5, 2.5, 0, true, true]);
    expect(actor.y).toBeCloseTo(0, 3); // on the floor, to Rapier's single precision
  });

  it('walks a square twice and back to within 30 cm of the spawn, its goldens every run', async () => {
    const east = await play('box-2-walk', 78);
    expect(east.x - 3.5).toBeGreaterThan(3.5);
    const runs = [await play('box-2-walk'), await play('box-2-walk'), await play('box-2-walk')];
    expect(Math.hypot(runs[0].x - 3.5, runs[0].z - 2.5)).toBeLessThan(0.3); // each lap ends about 13 cm off
    for (const run of runs) expect(run.hashes).toEqual(goldens('box-2-walk'));
  });

  it('dashes 3.25 m beyond the walk once for two presses, and the low wall stops a dash', async () => {
    const [before, after] = [await play('box-2-dash', 40), await play('box-2-dash', 70)];
    // 30 steps of walking at 5 m/s (2.5 m), plus the dash's 0.2 s at 16.25 − 5 m/s (2.25 m): one dash, not two
    expect(after.x - before.x).toBeCloseTo(2.5 + 2.25, 1);
    const stopped = await play('box-2-dash', 380);
    expect(stopped.z).toBeCloseTo(LOW_WALL.z[1] + 0.28125 + 0.02, 2); // the wall's south face, plus radius and skin
    expect(stopped.y).toBeCloseTo(0, 3);
    expect((await play('box-2-dash')).hashes).toEqual(goldens('box-2-dash'));
  });

  it('jumps onto the low wall, off it, and onto it again', async () => {
    const apex = await play('box-2-jump', 125);
    expect(apex.y).toBeGreaterThan(1.4); // 9.375² / 60 = 1.46 m: well above the wall's 0.75 m
    const onTop = (s: { x: number; y: number; z: number; actor: Record<string, unknown> }) => {
      expect(s.y).toBeCloseTo(LOW_WALL.top, 3);
      expect(s.actor.grounded).toBe(true);
      expect(s.x > LOW_WALL.x[0] && s.x < LOW_WALL.x[1] && s.z > LOW_WALL.z[0] && s.z < LOW_WALL.z[1]).toBe(true);
    };
    onTop(await play('box-2-jump', 160));
    const down = await play('box-2-jump', 380);
    expect([down.actor.grounded, down.z > LOW_WALL.z[1]]).toEqual([true, true]);
    expect(down.y).toBeCloseTo(0, 3);
    const landed = await play('box-2-jump');
    onTop(landed);
    expect(landed.hashes).toEqual(goldens('box-2-jump'));
  });

  it("shows his animator's layers and weights through __engine.anim(), and asking changes nothing", async () => {
    const engine = await createHeadless({ scene: roomHero });
    const anim = engine.anim as (id?: number) => AnimatorReport;
    engine.step(30);
    expect(anim().weights.speed).toBe(0); // standing
    engine.step(30, { move: [1, 0] });
    const hash = engine.hash();
    const walking = anim();
    expect(anim(1)).toEqual(walking);
    expect(engine.hash()).toBe(hash);
    const stack = ['weights', 'base', 'override', 'solve', 'clips', 'additive', 'post', 'physics', 'secondary'];
    expect(walking.layers.map((layer) => layer.slot)).toEqual(stack);
    expect(walking.weights.speed).toBeGreaterThan(1); // 5 m/s: faster than his build's walk
    expect(walking.layers[1]).toEqual({ slot: 'base', by: 'humanoid', active: { speed: walking.weights.speed } });
    expect(() => anim(9)).toThrow(/SIM_BAD_ARGUMENT.*anim\(id\) got 9.*\(1\)/);
  });

  it('is tuned by box.roomHero.speed, box.roomHero.jump and box.roomHero.dash', async () => {
    const run = async (settings: Record<string, number>, steps: number, intents: Partial<Intents>) => {
      const engine = await createHeadless({ scene: roomHero, settings });
      engine.step(1);
      engine.step(steps, intents);
      return engine.get(1)?.actor as Record<string, number>;
    };
    const walk: Partial<Intents> = { move: [1, 0] };
    expect((await run({}, 30, walk)).vx).toBe(5);
    expect((await run({ 'box.roomHero.speed': 3 }, 30, walk)).vx).toBe(3);
    const jump: Partial<Intents> = { b: ['jump'] };
    const [high, low] = [await run({}, 12, jump), await run({ 'box.roomHero.jump': 6 }, 12, jump)];
    expect(high.y).toBeGreaterThan(low.y);
    expect((await run({ 'box.roomHero.dash': 0 }, 2, { p: ['dash'] })).dash).toBe(0);
  });
});
