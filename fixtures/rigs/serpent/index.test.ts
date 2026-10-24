/**
 * @file Unit tests for the serpent (fixtures/rigs/serpent/index.ts, PLAN.md WP 10.1): its rig passes the check in every
 * state; slithering, its body winds where its head wound, a gap between segments along the way it went, its crest's
 * spines standing over its back; risen, its neck curls up behind its head, and lowered, its whole body lies back where
 * it lay; a hit flinches its head back along its body; its tail leaves a trail while it moves, gone soon after it
 * stops.
 * @see fixtures/rigs/serpent/index.ts
 */
import { describe, expect, it } from 'vitest';
import { rigCheck, Vector3 } from '../../../engine/sim-api';
import { Serpent, SERPENT, SERPENT_SIZE } from './index';

const index = (name: string) => SERPENT.names.indexOf(name);
/** Its body's segments behind its head, the head's eye and its crest left out. */
const segments = (snake: Serpent) => snake.points().slice(index('segment1'), index('segment9') + 1);

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
    const near = (p: Vector3) => Math.min(...heads.map((h) => Math.hypot(h.x - p.x, h.z - p.z)));
    for (const p of segments(snake)) expect(near(p)).toBeLessThan(0.02); // on the way its head went
    for (const k of [0, 1, 2]) expect(snake.points()[index(`spine${k}`)].y).toBeCloseTo(SERPENT_SIZE.low + SERPENT_SIZE.spine, 3); // prettier-ignore
    expect(snake.trail.samples.length).toBeGreaterThan(5);
    for (let i = 0; i < 30; i++) snake.step();
    expect(snake.trail.samples.length).toBe(0); // gone after it stopped
    const cobra = new Serpent();
    for (let i = 0; i < 90; i++) cobra.step({ rise: 1 });
    const [head, neck] = [cobra.points()[1], cobra.points()[3]];
    expect(head.y).toBeCloseTo(SERPENT_SIZE.high, 2);
    expect(neck.y).toBeGreaterThan(SERPENT_SIZE.low + 0.1); // curled up behind it
    for (let i = 0; i < 120; i++) cobra.step(); // lowered again
    const lying = new Serpent();
    for (let i = 0; i < 210; i++) lying.step();
    cobra.points().forEach((p, k) => expect(p.distanceTo(lying.points()[k])).toBeLessThan(0.001)); // back where it lay
    for (const p of segments(cobra)) expect(p.y).toBeCloseTo(SERPENT_SIZE.low, 3);
    const hit = new Serpent();
    hit.step({ flinch: 2 });
    let back = 0;
    for (let i = 0; i < 20; i++) back = Math.min(back, hit.step().points()[1].z);
    expect(back).toBeLessThan(-0.02); // back along its body (−Z)
  });
});
