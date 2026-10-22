/**
 * @file Tests for hit queries (engine/sim/hits.ts): a cone takes a target whose footprint meets its sector (one the
 * centre-only `inArc` misses at the edge), not one behind, out of reach or outside its height window (a flyer over a
 * slash, a slime under an overhead strike), scaled by size; `coneHits` over a hash of 400 random targets equals the
 * exact test on all of them, ids ascending, with a measured slash; a weapon sweep strikes a capsule between its two
 * segments however fast it swung, misses one it passes over, and agrees with a dense sampling of the swept quad on
 * 400 random sweeps; `sweepHits` turns `Attack.sweep`'s quads into hits; `physicsWalls` stops a 1,000 m/s bolt on a
 * 2 cm wall (a ball cast, and a ray for a radius of 0); a fan meets the bodies in its reach and cone, nearest first,
 * each once, none through a wall.
 */
import { describe, expect, it } from 'vitest';
import { inArc, measureMove, type HitShape } from '../anim/moves';
import { Attack, type Sweep } from '../anim/attack';
import { Vector3 } from '../core/math';
import { Rng } from '../core/rng';
import { createPhysics } from '../physics/world';
import { PROJECTILE, stepProjectiles, type HurtCapsule, type HurtSet } from '../world/projectiles';
import { SpatialHash } from '../world/spatial';
import { coneHits, fanHits, inCone, physicsWalls, sweepHits, sweepTouches } from './hits';

const DT = 1 / 60;
/** A slash's shape, as `measureMove` gives one: 1.1 m out, 1.2 rad either side, from 0.6 to 1.4 m up. */
const SLASH: HitShape = { range: 1.1, halfAngle: 1.2, yMin: 0.6, yMax: 1.4 };
/** A walker: a 0.3 m capsule 1.6 m tall, its feet at (x, 0, z). */
const walker = (x: number, z: number, y = 0): HurtCapsule => ({ x, y, z, radius: 0.3, height: 1 });

/** A set of targets by id (1, 2, …). */
function set(targets: HurtCapsule[]): HurtSet {
  const hash = new SpatialHash({ cell: 2 });
  targets.forEach((t, i) => hash.add(i + 1, t.x, t.z));
  return { hash, hurt: (id) => targets[id - 1] };
}

/** A sweep from plain points. */
const sweep = (base0: number[], tip0: number[], base1: number[], tip1: number[]): Sweep => ({
  base0: new Vector3().fromArray(base0),
  tip0: new Vector3().fromArray(tip0),
  base1: new Vector3().fromArray(base1),
  tip1: new Vector3().fromArray(tip1),
});

describe('cones', () => {
  it('takes what is ahead within reach, not what is behind or beyond', () => {
    expect(inCone([0, 0, 0], 0, SLASH, walker(0, 1.2))).toBe(true);
    expect(inCone([0, 0, 0], Math.PI, SLASH, walker(0, 1.2))).toBe(false);
    expect(inCone([0, 0, 0], 0, SLASH, walker(0, 1.45))).toBe(false); // 1.1 + 0.3 = 1.4 m at most
    expect(inCone([0, 0, 0], 0, SLASH, walker(0.1, 0.1))).toBe(true); // standing on the attacker
    expect(inCone([0, 0, 0], 0, { ...SLASH, halfAngle: Math.PI }, walker(0, -1))).toBe(true); // a spin
  });

  it('meets the target’s footprint at the cone’s edge, where its centre is outside', () => {
    const [yaw, half] = [0, 0.5];
    const edge = new Vector3(Math.sin(half + 0.2), 0, Math.cos(half + 0.2)).multiplyScalar(1); // 0.2 rad outside
    const target = walker(edge.x, edge.z);
    expect(inArc(new Vector3(), yaw, edge, 1.1, half, 0.3)).toBe(false);
    expect(inCone([0, 0, 0], yaw, { ...SLASH, halfAngle: half }, target)).toBe(true); // 1 m × sin 0.2 < 0.3 m
    expect(inCone([0, 0, 0], yaw, { ...SLASH, halfAngle: half }, walker(edge.x * 2, edge.z * 2))).toBe(false);
  });

  it('keeps its height window: a flyer over a slash, a slime under an overhead strike', () => {
    const wisp: HurtCapsule = { x: 0, y: 1.6, z: 1, radius: 0.3, height: 0, shape: 'ball' }; // from 1.6 to 2.2 m
    const slime: HurtCapsule = { x: 0, y: 0, z: 1, radius: 0.375, height: 1, shape: 'ball' }; // up to 0.75 m
    expect(inCone([0, 0, 0], 0, SLASH, wisp)).toBe(false);
    expect(inCone([0, 0.5, 0], 0, SLASH, wisp)).toBe(true); // the attacker on a step
    expect(inCone([0, 0, 0], 0, { ...SLASH, yMin: 1, yMax: 2 }, slime)).toBe(false);
    expect(inCone([0, 0, 0], 0, SLASH, slime)).toBe(true);
    expect(inCone([0, 0, 0], 0, SLASH, wisp, 1.5)).toBe(true); // a big attacker: 0.9 to 2.1 m, 1.65 m out
    expect(inCone([0, 0, 0], 0, SLASH, walker(0, 1.8), 1.5)).toBe(true);
  });

  it('coneHits finds through the hash what the exact test finds over all, ids ascending', () => {
    const rng = new Rng(6);
    const targets = Array.from({ length: 400 }, () =>
      rng.chance(0.3)
        ? ({
            x: rng.range(-4, 4),
            y: rng.range(0, 2),
            z: rng.range(-4, 4),
            radius: 0.375,
            height: 0,
            shape: 'ball',
          } as const)
        : walker(rng.range(-4, 4), rng.range(-4, 4)),
    );
    const slash = measureMove('slash', { build: 'build:heroic', weapon: 'sword' });
    for (const [x, z, yaw] of [
      [0, 0, 0],
      [1, -2, 2],
      [-3, 3, -1],
    ]) {
      const found = coneHits(set(targets), [x, 0, z], yaw, slash);
      const all = targets.flatMap((t, i) => (inCone([x, 0, z], yaw, slash, t) ? [i + 1] : []));
      expect(found).toEqual(all);
      expect(found.length).toBeGreaterThan(0);
    }
  });
});

describe('weapon sweeps', () => {
  /** A blade 1 m up from 0.3 to 1.3 m out, turned `a` rad about the attacker at the origin. */
  const blade = (a: number) => [
    [0.3 * Math.sin(a), 1, 0.3 * Math.cos(a)],
    [1.3 * Math.sin(a), 1, 1.3 * Math.cos(a)],
  ];

  it('strikes a capsule it passed between two steps, where neither segment is near it', () => {
    const target = { x: 0, y: 0, z: 1, radius: 0.15, height: 1.2 }; // dead ahead
    const [[b0, t0], [b1, t1]] = [blade(-0.4), blade(0.4)]; // 46° in one step: each end 0.39 m from it
    const fast = sweep(b0, t0, b1, t1);
    expect(sweepTouches(sweep(b0, t0, b0, t0), target)).toBe(false);
    expect(sweepTouches(sweep(b1, t1, b1, t1), target)).toBe(false);
    expect(sweepTouches(fast, target)).toBe(true);
    expect(sweepTouches(fast, { ...target, y: 1.1 })).toBe(false); // over it: its lowest point 10 cm over the blade
    expect(sweepTouches(fast, { ...target, y: 1.1 }, 0.12)).toBe(true); // a blade 12 cm in half width reaches it
    expect(sweepTouches(fast, { ...target, z: 1.4 })).toBe(false); // 0.2 m past the chord (1.197 m): a step sweeps its chord
  });

  it('strikes with the segment alone on the window’s first step', () => {
    const [b, t] = blade(0);
    expect(sweepTouches(sweep(b, t, b, t), { x: 0.2, y: 0, z: 1, radius: 0.25, height: 1.2 })).toBe(true);
    expect(sweepTouches(sweep(b, t, b, t), { x: 0.3, y: 0, z: 1, radius: 0.25, height: 1.2 })).toBe(false);
  });

  it('agrees with a dense sampling of the swept quad on 400 random sweeps', () => {
    const rng = new Rng(11);
    let struck = 0;
    for (let i = 0; i < 400; i++) {
      const p = () => [rng.range(-1, 1), rng.range(0, 2), rng.range(-1, 1)];
      const [b0, t0, b1, t1] = [p(), p(), p(), p()];
      const target: HurtCapsule = {
        x: rng.range(-1, 1),
        y: rng.range(-0.5, 1),
        z: rng.range(-1, 1),
        radius: rng.range(0.05, 0.3),
        height: rng.range(0, 1),
      };
      const axis = (y: number) => [
        target.x,
        Math.min(target.y + target.radius + target.height, Math.max(target.y + target.radius, y)),
        target.z,
      ];
      let near = Infinity;
      for (const [a, b, c] of [
        [b0, t0, t1],
        [b0, t1, b1],
      ]) {
        for (let u = 0; u <= 120; u++) {
          for (let v = 0; u + v <= 120; v++) {
            const q = [0, 1, 2].map((k) => a[k] + ((b[k] - a[k]) * u) / 120 + ((c[k] - a[k]) * v) / 120);
            const s = axis(q[1]);
            // the axis is upright: its nearest point to q is at q's height, clamped to its ends
            near = Math.min(near, Math.hypot(q[0] - s[0], q[1] - s[1], q[2] - s[2]));
          }
        }
      }
      const step =
        Math.max(
          ...[b0, t0, b1, t1].flatMap((a) =>
            [b0, t0, b1, t1].map((b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])),
          ),
        ) / 120;
      if (Math.abs(near - target.radius) < step) continue; // too close to call at this sampling
      const touches = sweepTouches(sweep(b0, t0, b1, t1), target);
      expect(touches, `sweep ${i}: sampled ${near}, radius ${target.radius}`).toBe(near < target.radius);
      if (touches) struck++;
    }
    expect(struck).toBeGreaterThan(40);
  });

  it('sweepHits turns an attack’s sweeps into hits, ids ascending', () => {
    const attack = new Attack('slash');
    attack.start();
    const targets = set([
      { x: 0, y: 0, z: 1, radius: 0.3, height: 1 }, // ahead
      { x: 0, y: 0, z: -1, radius: 0.3, height: 1 }, // behind
      { x: -0.9, y: 0, z: 0.6, radius: 0.3, height: 1 }, // ahead and to the right (−x)
    ]);
    const struck = new Set<number>();
    for (let i = 0; i < 60 && attack.busy; i++) {
      attack.update(DT);
      const turn = -1.4 + 2.8 * (attack.active ? attack.u : attack.phase === 'recover' ? 1 : 0); // left to right
      const [base, tip] = blade(-turn).map((v) => new Vector3().fromArray(v));
      const swept = attack.sweep(base, tip);
      if (swept) for (const id of sweepHits(targets, swept)) struck.add(id);
    }
    expect([...struck].sort()).toEqual([1, 3]);
  });
});

describe('physicsWalls', () => {
  it('stops a 1,000 m/s bolt on a 2 cm wall, cast as a ball or as a ray', () => {
    const physics = createPhysics();
    physics.addBody({
      type: 'fixed',
      colliders: [{ shape: { type: 'box', size: [4, 4, 0.02] }, position: [0, 1, 5] }],
    });
    physics.step({ dt: DT, settings: { get: () => 9.81 } }); // queries see bodies from the step after they came
    const walls = physicsWalls(physics);
    for (const radius of [0.05, 0]) {
      const bolt = { ...PROJECTILE, y: 1, vz: 1000, radius }; // 16.7 m a step
      const hits = stepProjectiles([bolt], { dt: DT, walls });
      expect(hits).toMatchObject([{ target: -1, body: 0 }]);
      expect(hits[0].normal?.map((n) => Math.round(n * 1e6) / 1e6)).toEqual([0, 0, -1]); // Rapier's float32
      expect([bolt.state, bolt.z]).toEqual(['wall', expect.closeTo(4.99 - radius, 4)]);
    }
    expect(physicsWalls(physics, ['crowd'])({ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 10 }, 0)).toBeNull();
    physics.dispose();
  });
});

describe('fans', () => {
  it('meet the bodies in reach across their cone, nearest first, each once, none through a wall', () => {
    const physics = createPhysics();
    const post = (x: number, z: number) => physics.addBody({ type: 'fixed', colliders: [{ shape: { type: 'box', size: [0.2, 2, 0.2] }, position: [x, 1, z] }] }); // prettier-ignore
    const [near, far, wide, hidden] = [post(0, 0.8), post(0.3, 1.3), post(0.9, 0.9), post(-0.3, 1.4)];
    physics.addBody({ type: 'fixed', colliders: [{ shape: { type: 'box', size: [0.3, 2, 0.05] }, position: [-0.3, 1, 1.1] }] }); // prettier-ignore
    physics.step({ dt: DT, settings: { get: () => 9.81 } }); // queries see bodies from the step after they came
    const fan = { reach: 1.52, cone: Math.PI / 6, rays: 5, heights: [0.4, 1.4] };
    const hits = fanHits(physics, [0, 0, 0], 0, fan);
    expect(hits.map((h) => h.body)).toEqual([near, expect.any(Number), far]); // the wall before the hidden post
    expect(hits.map((h) => h.body)).not.toContain(hidden);
    expect(hits.map((h) => h.body)).not.toContain(wide); // 45° off
    expect(hits[0]).toMatchObject({ distance: expect.closeTo(0.7, 3), point: [expect.any(Number), 0.4, expect.closeTo(0.7, 3)] }); // prettier-ignore
    expect(fanHits(physics, [0, 0, 0], Math.PI / 4, { ...fan, cone: 0, rays: 1 }).map((h) => h.body)).toEqual([wide]);
    expect(fanHits(physics, [0, 0, 0], 0, { ...fan, reach: 0.6 })).toEqual([]);
    expect(() => fanHits(physics, [0, 0, 0], 0, { ...fan, rays: 0 })).toThrow(/SIM_BAD_ARGUMENT/);
    physics.dispose();
  });
});
