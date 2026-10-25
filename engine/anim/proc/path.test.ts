/**
 * @file Unit tests for the path chain (engine/anim/proc/path.ts, PLAN.md WP 10.1): segments a gap apart behind a head
 * going straight; a head going round a circle with its body on the circle behind it; a reset laying the body out
 * along its back, or down a hole, until the path is long enough; a history that never grows past what the body needs;
 * tangents toward the head.
 * @see engine/anim/proc/path.ts
 */
import { describe, expect, it } from 'vitest';
import { Vector3 } from '../../core/math';
import { PathChain } from './path';

describe('the path chain', () => {
  it('starts with its head at the origin and its body along −Z', () => {
    const snake = new PathChain({ count: 3, gap: 0.5 });
    expect(snake.points.map((p) => p.toArray())).toEqual([
      [0, 0, 0],
      [0, 0, -0.5],
      [0, 0, -1],
    ]);
  });

  it('stands its segments a gap apart behind a head going straight, tangents toward it', () => {
    const snake = new PathChain({ count: 6, gap: 0.25 }).reset(new Vector3(0, 0.1, 0), new Vector3(0, 0, -1));
    for (let i = 1; i <= 90; i++) snake.step(new Vector3(0, 0.1, i * 0.03));
    snake.points.forEach((p, k) => expect(p.distanceTo(new Vector3(0, 0.1, 2.7 - k * 0.25))).toBeLessThan(1e-9));
    for (const t of snake.tangents) expect(t.distanceTo(new Vector3(0, 0, 1))).toBeLessThan(1e-9);
  });

  it('follows a head round a circle, its body on the circle behind it', () => {
    const snake = new PathChain({ count: 10, gap: 0.2 });
    const at = (a: number) => new Vector3(2 * Math.sin(a), 0, 2 - 2 * Math.cos(a));
    snake.reset(at(0), new Vector3(0, 0, -1));
    for (let i = 1; i <= 240; i++) snake.step(at(i * 0.01)); // 2.4 rad round, 4.8 m
    for (const p of snake.points) expect(Math.abs(p.distanceTo(new Vector3(0, 0, 2)) - 2)).toBeLessThan(0.002);
    for (let k = 1; k < 10; k++)
      expect(snake.points[k].distanceTo(snake.points[k - 1])).toBeCloseTo(4 * Math.sin(0.05), 2); // a chord
  });

  it('lays its body along its back until the path is long enough, and keeps no more history than it needs', () => {
    const worm = new PathChain({ count: 5, gap: 0.1 }).reset(new Vector3(0, 0.3, 0), new Vector3(0, -1, 0)); // down a hole
    expect(worm.points[4].distanceTo(new Vector3(0, -0.1, 0))).toBeLessThan(1e-12);
    worm.step(new Vector3(0, 0.45, 0)); // up out of it by 0.15: its first two segments above, the rest still down
    expect([worm.points[1].y, worm.points[4].y]).toEqual([expect.closeTo(0.35, 9), expect.closeTo(0.05, 9)]);
    for (let i = 1; i <= 2000; i++) worm.step(new Vector3(i * 0.02, 0.45, 0));
    expect(worm.history).toBe(Math.ceil((4 * 0.1) / 0.05) + 8); // the body's length in half gaps, and eight more
    const spread = worm.points[0].distanceTo(worm.points[4]);
    expect(spread).toBeCloseTo(0.4, 9); // straight behind: four gaps
  });
});
