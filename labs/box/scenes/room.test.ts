/**
 * @file Unit tests for the box room (labs/box/scenes/room.ts, PLAN.md §9.0, WP 2.7): each mover's path starts on its
 * numbered marker in labs/box/levels/room.txt and stays on the floor, clear of the walls, the low wall and the pillar;
 * 600 steps give the same hash three times; the movers move and lap; `box.room.speed` and `box.room.movers` change
 * the run.
 * @see labs/box/scenes/room.ts
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createHeadless, compileLevel } from '../../../engine';
import { lapLength, pathPoint, room, ROOM_PATHS } from './room';

const level = compileLevel(readFileSync('labs/box/levels/room.txt', 'utf8'), { file: 'room.txt' });

describe('the room', () => {
  it('starts each mover on its marker, and keeps its crate on open floor all the way round', () => {
    ROOM_PATHS.forEach((path, i) => {
      const marker = level.spawns.find((spawn) => spawn.name === String(i + 1))!;
      const [x, z] = pathPoint(path, 0);
      expect([x, z], `mover ${i + 1}`).toEqual([marker.position[0], marker.position[2]]);
      const half = 0.4;
      for (let s = 0; s < lapLength(path); s += 0.05) {
        const [px, pz] = pathPoint(path, s);
        for (const [dx, dz] of [
          [-half, -half],
          [half, -half],
          [-half, half],
          [half, half],
        ]) {
          const [col, row] = [Math.floor(px + dx * 0.99), Math.floor(pz + dz * 0.99)];
          expect(level.solid[row * level.cols + col], `mover ${i + 1} at ${s.toFixed(2)} m`).toBe(false);
        }
      }
    });
  });

  it('gives the same hash three times, and moves and laps its movers', async () => {
    const run = async () => {
      const engine = await createHeadless({ scene: room });
      engine.step(600);
      return {
        hash: engine.hash(),
        laps: engine.state('pathMover').entities.map((e) => (e.pathMover as { laps: number }).laps),
      };
    };
    const runs = [await run(), await run(), await run()];
    expect(new Set(runs.map((r) => r.hash)).size).toBe(1);
    expect(runs[0].laps).toEqual([1, 1, 0]); // 15 m in 10 s: the line (12 m) and circle (9.4 m) lap, the 16 m loop not yet
  });

  it('is tuned by box.room.speed and box.room.movers', async () => {
    const base = await createHeadless({ scene: room });
    const fast = await createHeadless({ scene: room, settings: { 'box.room.speed': 3 } });
    const two = await createHeadless({ scene: room, settings: { 'box.room.movers': 2 } });
    base.step(60);
    fast.step(60);
    expect(fast.hash()).not.toBe(base.hash());
    expect((fast.get(1)?.pathMover as { s: number }).s).toBeCloseTo(3, 9);
    expect(two.entities()).toHaveLength(2);
  });
});
