/**
 * @file Tests for projectiles (engine/world/projectiles.ts): `capsuleCast` meets a capsule's side, its end balls and
 * a ball target exactly, and gives 0 when already touching; a fast shot never tunnels (a 600 m/s bolt stops on a
 * 10 cm post; 3,000 seeded random shots at up to 3 km/s agree with the closest approach of each move, and stop at the
 * first contact; a shot down a line of thin posts stops at the first); gravity, life and piercing (each target once,
 * also while it straddles two steps); a wall stops a shot before the targets behind it; per-team targets; the hash
 * margin. engine/sim/hits.test.ts casts the walls through a physics world.
 */
import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import {
  capsuleCast,
  hurtNear,
  PROJECTILE,
  stepProjectiles,
  type HurtCapsule,
  type HurtSet,
  type Projectile,
} from './projectiles';
import { SpatialHash } from './spatial';

const DT = 1 / 60;

/** A shot with `fields` over the defaults. */
const shot = (fields: Partial<Projectile> = {}): Projectile => ({ ...PROJECTILE, ...fields });

/** A set of targets by id (1, 2, …), all in its hash. */
function set(targets: HurtCapsule[], margin?: number): HurtSet {
  const hash = new SpatialHash({ cell: 2 });
  targets.forEach((t, i) => hash.add(i + 1, t.x, t.z));
  return { hash, hurt: (id) => targets[id - 1], margin };
}

/** The distance from point p to a target's axis segment, minus nothing: the reference for the swept test. */
function axisDistance(p: readonly number[], t: HurtCapsule): number {
  const length = t.shape === 'ball' ? 0 : t.height;
  const y = Math.min(t.y + t.radius + length, Math.max(t.y + t.radius, p[1]));
  return Math.hypot(p[0] - t.x, p[1] - y, p[2] - t.z);
}

/** The point of a move at share s. */
const along = (from: readonly number[], d: readonly number[], s: number) => [0, 1, 2].map((k) => from[k] + d[k] * s);

/** The closest a move comes to a target's axis: a ternary search, the distance being convex along a straight move. */
function closest(from: readonly number[], d: readonly number[], t: HurtCapsule): number {
  let [lo, hi] = [0, 1];
  for (let i = 0; i < 200; i++) {
    const [m1, m2] = [lo + (hi - lo) / 3, hi - (hi - lo) / 3];
    if (axisDistance(along(from, d, m1), t) < axisDistance(along(from, d, m2), t)) hi = m2;
    else lo = m1;
  }
  return axisDistance(along(from, d, (lo + hi) / 2), t);
}

const xyz = (v: readonly number[]) => ({ x: v[0], y: v[1], z: v[2] });

describe('capsuleCast', () => {
  const post: HurtCapsule = { x: 0, y: 0, z: 5, radius: 0.25, height: 1.5 }; // axis from y 0.25 to 1.75

  it('meets the side of a capsule where the grown cylinder starts', () => {
    expect(capsuleCast(xyz([0, 1, 0]), xyz([0, 0, 10]), 0.05, post)).toBeCloseTo(0.47, 12); // z 4.7
    expect(capsuleCast(xyz([0.3, 1, 0]), xyz([0, 0, 10]), 0, post)).toBe(-1); // passes 5 cm wide
    expect(capsuleCast(xyz([0, 1, 0]), xyz([0, 0, 4]), 0.05, post)).toBe(-1); // stops short
  });

  it('meets the balls at its ends and a ball target', () => {
    expect(capsuleCast(xyz([0, 3, 5]), xyz([0, -2, 0]), 0, post)).toBeCloseTo((3 - 2) / 2, 12); // down onto its top
    expect(capsuleCast(xyz([0, 1.9, 0]), xyz([0, 0, 10]), 0, post)).toBeCloseTo(
      (5 - Math.sqrt(0.25 * 0.25 - 0.15 * 0.15)) / 10,
      12,
    ); // over the cylinder, into the top ball
    const slime: HurtCapsule = { x: 0, y: 0, z: 5, radius: 0.375, height: 1, shape: 'ball' };
    expect(capsuleCast(xyz([0, 0.375, 0]), xyz([0, 0, 10]), 0.125, slime)).toBeCloseTo(0.45, 12);
    expect(capsuleCast(xyz([0, 1, 0]), xyz([0, 0, 10]), 0, slime)).toBe(-1); // a ball ignores its height
  });

  it('gives 0 when the ball touches already, and −1 for no move', () => {
    expect(capsuleCast(xyz([0.2, 1, 5]), xyz([0, 0, 10]), 0, post)).toBe(0);
    expect(capsuleCast(xyz([0, 1, 4]), xyz([0, 0, 0]), 0.05, post)).toBe(-1);
  });
});

describe('a fast projectile never tunnels', () => {
  it('stops a 600 m/s bolt on a 10 cm post, where it touches', () => {
    const bolt = shot({ y: 1, vz: 600 }); // 10 m a step
    const targets = set([{ x: 0, y: 0, z: 6, radius: 0.1, height: 1.6 }]);
    const hits = stepProjectiles([bolt], { dt: DT, targets });
    expect(hits).toMatchObject([{ shot: 0, target: 1, body: -1, normal: null }]);
    expect(hits[0].share).toBeCloseTo(0.585, 12);
    expect([bolt.state, bolt.z, bolt.hit]).toEqual(['hit', hits[0].z, [1]]);
    expect(bolt.z).toBeCloseTo(5.85, 12);
  });

  it('agrees with the closest approach of 3,000 random moves at up to 3 km/s', () => {
    const rng = new Rng(63);
    let touched = 0;
    for (let i = 0; i < 3000; i++) {
      const target: HurtCapsule = {
        x: rng.range(-1, 1),
        y: rng.range(-0.5, 0.5),
        z: rng.range(-1, 1),
        radius: rng.range(0.05, 0.5),
        height: rng.range(0, 1.5),
        shape: rng.chance(0.25) ? 'ball' : 'capsule',
      };
      const radius = rng.range(0, 0.1);
      const aim = [target.x + rng.range(-0.7, 0.7), target.y + rng.range(-0.5, 2), target.z + rng.range(-0.7, 0.7)];
      const heading = [rng.range(-1, 1), rng.range(-0.3, 0.3), rng.range(-1, 1)];
      const k = (rng.range(1, 3000) * DT) / Math.hypot(heading[0], heading[1], heading[2]); // the step's move
      const d = heading.map((h) => h * k);
      const late = rng.range(-0.2, 1.2); // where along the move it passes the aim
      const from = aim.map((a, j) => a - d[j] * late);
      const reach = target.radius + radius;
      const near = closest(from, d, target);
      const share = capsuleCast(xyz(from), xyz(d), radius, target);
      if (Math.abs(near - reach) < 1e-6) continue; // grazing: either answer is right
      expect(share >= 0, `move ${i}: closest ${near}, reach ${reach}`).toBe(near < reach);
      if (share < 0) continue;
      touched++;
      if (share === 0) {
        expect(axisDistance(from, target)).toBeLessThanOrEqual(reach); // touching as it starts
        continue;
      }
      expect(axisDistance(along(from, d, share), target)).toBeCloseTo(reach, 6); // on the surface…
      if (share > 1e-6) expect(axisDistance(along(from, d, share - 1e-6), target)).toBeGreaterThan(reach); // …first
    }
    expect(touched).toBeGreaterThan(400); // both answers are well represented: about 1 in 6 moves touches
  });

  it('stops a shot down a line of thin posts at the first, at any speed', () => {
    for (const speed of [30, 300, 3000]) {
      const posts = [3, 3.3, 3.6].map((z) => ({ x: 0, y: 0, z, radius: 0.02, height: 2 }));
      const bolt = shot({ y: 1, vz: speed, radius: 0 });
      const hits = [];
      for (let i = 0; i < 20 && bolt.state === 'flying'; i++)
        hits.push(...stepProjectiles([bolt], { dt: DT, targets: set(posts) }));
      expect(hits.map((h) => h.target)).toEqual([1]);
      expect(bolt.z).toBeCloseTo(2.98, 12);
    }
  });
});

describe('stepProjectiles', () => {
  it('falls under gravity, moving the step’s new velocity (semi-implicit Euler)', () => {
    const arrow = shot({ vx: 20, gravity: 9.81 });
    stepProjectiles([arrow], { dt: DT });
    expect([arrow.x, arrow.vy, arrow.y, arrow.age]).toEqual([20 * DT, -9.81 * DT, -9.81 * DT * DT, 1]);
  });

  it('expires after exactly its life in steps, and leaves stopped shots alone', () => {
    const bolt = shot({ vz: 1, life: 3 });
    let steps = 0;
    while (bolt.state === 'flying') {
      stepProjectiles([bolt], { dt: DT });
      steps++;
    }
    expect([steps, bolt.age, bolt.state]).toEqual([180, 180, 'expired']);
    expect(bolt.z).toBeCloseTo(3, 12); // it flew all 3 s
    const z = bolt.z;
    stepProjectiles([bolt], { dt: DT });
    expect([bolt.z, bolt.age]).toEqual([z, 180]);
  });

  it('pierces: strikes each target once, also one it is still inside, and stops at the one after', () => {
    const fat = { x: 0, y: 0, z: 1.2, radius: 0.5, height: 1 };
    const thin = { x: 0, y: 0, z: 3, radius: 0.1, height: 1 };
    const targets = set([fat, thin]);
    const lance = shot({ y: 1, vz: 30, pierce: 1 }); // 0.5 m a step: inside the fat one for two steps
    const hits = [];
    for (let i = 0; i < 10 && lance.state === 'flying'; i++)
      hits.push(...stepProjectiles([lance], { dt: DT, targets }));
    expect(hits.map((h) => h.target)).toEqual([1, 2]);
    expect([lance.state, lance.hit]).toEqual(['hit', [1, 2]]);
    expect(lance.z).toBeCloseTo(3 - 0.15, 12);
  });

  it('stops at a wall, hitting the targets before it and none behind it', () => {
    const targets = set([
      { x: 0, y: 0, z: 2, radius: 0.2, height: 1 },
      { x: 0, y: 0, z: 6, radius: 0.2, height: 1 },
    ]);
    const walls = () => ({ share: 0.4, body: 9, normal: [0, 0, -1] as const }); // at z 4
    const bolt = shot({ y: 1, vz: 600, pierce: 5 });
    const hits = stepProjectiles([bolt], { dt: DT, targets, walls });
    expect(hits.map((h) => [h.target, h.body, h.normal])).toEqual([
      [1, -1, null],
      [-1, 9, [0, 0, -1]],
    ]);
    expect(bolt.state).toBe('wall');
    expect(bolt.z).toBeCloseTo(4, 12);
  });

  it('asks each shot for its own targets, in shot order', () => {
    const hero = set([{ x: 0, y: 0, z: 2, radius: 0.3, height: 1 }]);
    const foes = set([{ x: 0, y: 0, z: -2, radius: 0.3, height: 1 }]);
    const shots = [shot({ team: 'foe', y: 1, vz: 120 }), shot({ team: 'hero', y: 1, vz: -120 })];
    const hits = stepProjectiles(shots, { dt: DT, targets: (s) => (s.team === 'hero' ? foes : hero) });
    expect(hits.map((h) => [h.shot, h.target])).toEqual([
      [0, 1],
      [1, 1],
    ]);
    const missed = [shot({ team: 'foe', y: 1, vz: -120 })];
    expect(stepProjectiles(missed, { dt: DT, targets: (s) => (s.team === 'hero' ? foes : hero) })).toEqual([]);
  });

  it('searches the hash past its reach by the set’s margin, and refuses a bad step', () => {
    const wide: HurtCapsule = { x: 0, y: 0, z: 2.9, radius: 2, height: 0 };
    expect(hurtNear(set([wide], 0), 0, 0, 1)).toEqual([]);
    expect(hurtNear(set([wide], 2), 0, 0, 1)).toEqual([1]);
    const crowd = Array.from({ length: 100 }, (_, i) => ({ x: (i % 10) * 0.1, y: 0, z: 0, radius: 0.1, height: 1 }));
    expect(hurtNear(set(crowd), 0, 0, 2)).toHaveLength(100); // past the first 64 it looks again
    expect(() => stepProjectiles([shot()], { dt: 0 })).toThrow(/CORE_BAD_SPEC.*dt 0 is no step/);
  });
});
