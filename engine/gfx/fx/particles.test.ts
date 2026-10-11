/**
 * @file Unit tests for the CPU particle pool (engine/gfx/fx/particles.ts), in Node: a burst starts its particles in
 * the area, at the velocity plus the spread, with lives in range, the same for the same stream; each frame applies
 * gravity, drag and the floor's bounce, and a particle leaves at the end of its life; a full pool drops and counts
 * the rest; prewarmed particles are born flying; the scale, the caller's velocity and colour change the burst.
 * @see engine/gfx/fx/particles.ts
 */
import { describe, expect, it } from 'vitest';
import { Rng } from '../../core/rng';
import { getEmitter, particleSpec, type ParticleSpec } from './emitters';
import { ParticlePool, type ParticleView } from './particles';

/** A spec: still, white, adding light, with `fields` changed. */
function spec(fields: Partial<ParticleSpec> = {}): ParticleSpec {
  return {
    ...{ area: [0, 0, 0], velocity: [0, 0, 0], spread: 0, gravity: 0, drag: 0, turbulence: 0, life: [1, 1] },
    ...{ size: [0.1, 0], c0: [1, 1, 1, 1], c1: [1, 1, 1, 0], additive: true, stretch: false, lands: false },
    ...{ floor: 0, bounce: 0.3, prewarm: 0 },
    ...fields,
  };
}

/** Every live particle of `pool`, read. */
const all = (pool: ParticlePool) => Array.from({ length: pool.count }, (_, i) => pool.read(i, {} as ParticleView));

describe('bursts', () => {
  it('start in the area, at the velocity plus the spread, living within the range', () => {
    const pool = new ParticlePool(100);
    const s = spec({ area: [0.5, 0.1, 0.2], velocity: [0, 3, 0], spread: 2, life: [0.5, 0.8] });
    expect(pool.burst(s, 50, [1, 2, 3], new Rng(4))).toBe(50);
    for (const p of all(pool)) {
      expect(Math.abs(p.x - 1)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(p.y - 2)).toBeLessThanOrEqual(0.1);
      expect(Math.abs(p.z - 3)).toBeLessThanOrEqual(0.2);
      expect(Math.hypot(p.vx, p.vy - 3, p.vz)).toBeLessThanOrEqual(2);
    }
    pool.update(0.49, 0);
    expect(pool.count).toBe(50);
    pool.update(0.32, 0);
    expect(pool.count).toBe(0);
  });

  it('give the same particles for the same stream', () => {
    const [a, b] = [new ParticlePool(64), new ParticlePool(64)];
    const s = particleSpec(getEmitter('emitter:smoke'));
    a.burst(s, 40, [0, 1, 0], new Rng(9));
    b.burst(s, 40, [0, 1, 0], new Rng(9));
    a.update(1 / 60, 0);
    b.update(1 / 60, 0);
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
  });

  it('drop and count the particles past the capacity', () => {
    const pool = new ParticlePool(10);
    expect(pool.burst(spec(), 25, [0, 0, 0], new Rng(1))).toBe(10);
    expect(pool.burst(spec(), 5, [0, 0, 0], new Rng(1))).toBe(0);
    expect(pool.stats()).toEqual({ live: 10, capacity: 10, born: 10, dropped: 20 });
  });

  it('scale the area, spread and sizes, add the caller’s velocity and replace the colours', () => {
    const pool = new ParticlePool(8);
    const s = spec({ area: [1, 0, 0], size: [0.1, 0.05], c0: [6, 3, 1, 1], c1: [2, 1, 0.5, 0] });
    pool.burst(s, 8, [0, 0, 0], new Rng(2), {
      scale: 2,
      velocity: [0, 0, 5],
      color: [
        [0, 1, 0],
        [0, 0, 1],
      ],
    });
    const [p] = all(pool);
    expect(p.size).toBeCloseTo(0.2, 12);
    expect(p.vz).toBe(5);
    expect([p.r, p.g, p.b, p.a]).toEqual([0, 6, 0, 1]); // green, as bright as the spec's birth colour
    expect(Math.max(...all(pool).map((q) => Math.abs(q.x)))).toBeGreaterThan(1); // the area doubled
  });

  it('are born flying when prewarmed', () => {
    const pool = new ParticlePool(50);
    pool.burst(spec({ velocity: [0, 0, 2], life: [2, 2], prewarm: 1 }), 50, [0, 0, 0], new Rng(3));
    const zs = all(pool).map((p) => p.z);
    expect(Math.min(...zs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...zs)).toBeLessThanOrEqual(2 * 0.95);
    expect(Math.max(...zs)).toBeGreaterThan(1);
  });
});

describe('a frame', () => {
  it('pulls by gravity and slows by drag', () => {
    const pool = new ParticlePool(2);
    pool.burst(spec({ velocity: [0, 4, 0], gravity: 10, life: [5, 5] }), 1, [0, 0, 0], new Rng(1));
    pool.burst(spec({ velocity: [2, 0, 0], drag: 1, life: [5, 5] }), 1, [0, 0, 0], new Rng(1));
    const dt = 1 / 600;
    for (let i = 0; i < 300; i++) pool.update(dt, i * dt);
    const [thrown, dragged] = all(pool);
    expect(thrown.vy).toBeCloseTo(4 - 10 * 0.5, 9);
    expect(thrown.y).toBeCloseTo(4 * 0.5 - 0.5 * 10 * 0.25, 1);
    expect(dragged.vx).toBeCloseTo(2 * Math.pow(1 - dt, 300), 12);
  });

  it('bounces a landing particle on its floor, keeping 0.7 of its slide', () => {
    const pool = new ParticlePool(1);
    const s = spec({ velocity: [1, -3, 0], lands: true, floor: 0.25, bounce: 0.5, life: [5, 5] });
    pool.burst(s, 1, [0, 1, 0], new Rng(1), { ground: 0 });
    const ys: number[] = [];
    let bounced: ParticleView | null = null;
    for (let i = 0; i < 60; i++) {
      pool.update(1 / 60, 0);
      const [p] = all(pool);
      ys.push(p.y);
      if (!bounced && p.vy > 0) bounced = p;
    }
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0.25);
    expect(bounced).toMatchObject({ y: 0.25, vy: 1.5, vx: 0.7 });
  });

  it('fades the colour and the size from birth to death, and says how it blends', () => {
    const pool = new ParticlePool(1);
    pool.burst(spec({ stretch: true, additive: false, life: [1, 1] }), 1, [0, 0, 0], new Rng(1));
    pool.update(0.5, 0);
    const [p] = all(pool);
    expect([p.size, p.a, p.additive, p.stretch]).toEqual([0.05, 0.5, false, true]);
  });
});
