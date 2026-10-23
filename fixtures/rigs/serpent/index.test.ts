/**
 * @file Unit tests for the serpent (fixtures/rigs/serpent/index.ts, PLAN.md WP 10.1): its rig passes the check in every
 * state; slithering, its body winds where its head wound, a gap between segments along the way it went; risen, its
 * neck stands up the path behind its head; a hit flinches its head back along its body; its tail leaves a trail while
 * it moves, gone soon after it stops.
 * @see fixtures/rigs/serpent/index.ts
 */
import { describe, expect, it } from 'vitest';
import { rigCheck, Vector3 } from '../../../engine/sim-api';
import { Serpent, SERPENT, SERPENT_SIZE } from './index';

describe('the serpent', () => {
  it('passes the rig check in every state', () => {
    expect(rigCheck(SERPENT).problems.map((p) => p.message)).toEqual([]);
  });

  it('winds its body where its head wound, stands its neck up, flinches back, and trails its tail', () => {
    const snake = new Serpent();
    const heads: Vector3[] = [];
    for (let i = 0; i < 120; i++) {
      snake.step({ velocity: new Vector3(0.6 * Math.cos(2.5 * (i / 60)), 0, 1.4) });
      heads.push(snake.root.clone());
    }
    const body = snake.points().slice(3);
    const near = (p: Vector3) => Math.min(...heads.map((h) => Math.hypot(h.x - p.x, h.z - p.z)));
    for (const p of body) expect(near(p)).toBeLessThan(0.02); // on the way its head went
    expect(snake.trail.samples.length).toBeGreaterThan(5);
    for (let i = 0; i < 30; i++) snake.step();
    expect(snake.trail.samples.length).toBe(0); // gone after it stopped
    const cobra = new Serpent();
    for (let i = 0; i < 90; i++) cobra.step({ rise: 1 });
    const [head, neck] = [cobra.points()[1], cobra.points()[3]];
    expect(head.y).toBeCloseTo(SERPENT_SIZE.high, 2);
    expect(neck.y).toBeGreaterThan(SERPENT_SIZE.low + 0.1); // up the path behind it
    const hit = new Serpent();
    hit.step({ flinch: 2 });
    let back = 0;
    for (let i = 0; i < 20; i++) back = Math.min(back, hit.step().points()[1].z);
    expect(back).toBeLessThan(-0.02); // back along its body (−Z)
  });
});
