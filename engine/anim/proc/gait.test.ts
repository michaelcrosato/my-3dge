/**
 * @file Unit tests for the planted gait (engine/anim/proc/gait.ts, PLAN.md WP 10.1): a four-legged walk keeps its
 * diagonals apart, one group in the air at a time, and its planted feet still, and squares them up when it stops; a
 * faster body strides farther; six legs walk on tripods; feet stand on raised ground and grip a wall where one stands
 * between the hip and the spot; in the air every foot tucks, and lands where it is; uneven feet tilt the body.
 * @see engine/anim/proc/gait.ts
 */
import { describe, expect, it } from 'vitest';
import { Vector3 } from '../../core/math';
import type { GroundHit } from '../ik';
import { LegGait, type GaitBody, type GaitLeg, type GaitProbe } from './gait';

/** Four legs, the diagonals in two groups: left front with right back, right front with left back. */
const QUAD: GaitLeg[] = [-1, 1].flatMap(
  (side) =>
  [0.3, -0.3].map((z) => ({ hip: [0.12 * side, 0.4, z], rest: [0.15 * side, 0, z], group: side > 0 === z > 0 ? 0 : 1 }) as const), // prettier-ignore
);
/** Six legs, alternate tripods. */
const HEX: GaitLeg[] = [-1, 1].flatMap(
  (side) =>
  [0.25, 0, -0.25].map((z, k) => ({ hip: [0.08 * side, 0.15, z], rest: [0.3 * side, 0, z], group: (k + (side > 0 ? 1 : 0)) % 2 }) as const), // prettier-ignore
);

/** A floor at 0, a block 0.1 m high from z 2 to 3, and a wall at x `wall` facing +X; rays meet the nearest. */
function world(wall = Infinity): GaitProbe {
  return (o: Vector3, d: Vector3, max: number, hit: GroundHit) => {
    let best = Infinity;
    const take = (t: number, n: [number, number, number]) => {
      if (t >= 0 && t <= max && t < best) [best] = [t, hit.normal.set(...n)];
    };
    if (d.y < 0) {
      const t = -o.y / d.y;
      const z = o.z + d.z * t;
      if (!(z > 2 && z < 3)) take(t, [0, 1, 0]);
      const top = (0.1 - o.y) / d.y;
      const zt = o.z + d.z * top;
      if (zt > 2 && zt < 3) take(top, [0, 1, 0]);
    }
    if (d.x < 0 && Number.isFinite(wall)) take((wall - o.x) / d.x, [1, 0, 0]);
    if (best === Infinity) return false;
    hit.point.copy(o).addScaledVector(d, best);
    return true;
  };
}

/** Walks `gait` along +Z at `speed` for `steps` steps of `dt`, calling `each` after every step. */
function walk(
  gait: LegGait,
  speed: number,
  steps: number,
  each: (body: GaitBody) => void = () => {},
  dt = 1 / 60,
  probe?: GaitProbe,
) {
  const body = { position: new Vector3(), yaw: 0, velocity: new Vector3(0, 0, speed) };
  for (let i = 0; i < steps; i++) {
    body.position.addScaledVector(body.velocity, dt);
    gait.step(dt, body, probe);
    each(body);
  }
  return body;
}

describe('the planted gait', () => {
  it('walks four legs on alternating diagonals, its planted feet still', () => {
    const dog = new LegGait({ legs: QUAD });
    const was = dog.feet.map((foot) => ({ at: foot.position.clone(), planted: false })); // not yet stood
    let [most, landed] = [0, 0];
    walk(dog, 1.2, 180, () => {
      const up = dog.feet.flatMap((foot, i) => (foot.t >= 0 ? [QUAD[i].group] : []));
      expect(new Set(up).size).toBeLessThanOrEqual(1); // one diagonal at a time
      most = Math.max(most, up.length);
      dog.feet.forEach((foot, i) => {
        const planted = foot.t < 0;
        if (planted && was[i].planted) expect(foot.position.distanceTo(was[i].at)).toBe(0); // still while planted
        if (planted && !was[i].planted) landed++;
        was[i].planted = planted;
        was[i].at.copy(foot.position);
      });
    });
    expect(most).toBe(2);
    expect(landed).toBeGreaterThan(8); // each foot several times in 3 s
  });

  it('squares its feet up under it once it stops', () => {
    const dog = new LegGait({ legs: QUAD });
    const body = walk(dog, 1.2, 100);
    body.velocity.set(0, 0, 0);
    for (let i = 0; i < 60; i++) dog.step(1 / 60, body);
    const spot = new Vector3();
    dog.feet.forEach((foot, i) => expect(foot.position.distanceTo(dog.spot(i, body, 0, undefined, spot, new Vector3()))).toBeLessThanOrEqual(0.01)); // prettier-ignore
    expect(dog.lifted()).toBe(0);
  });

  it('strides farther the faster it goes, and walks six legs on tripods', () => {
    const stride = (speed: number) => {
      const gait = new LegGait({ legs: QUAD });
      const lengths: number[] = [];
      walk(gait, speed, 240, () => gait.feet.forEach((foot) => foot.t === -1 && foot.from.distanceTo(foot.to) > 0 && lengths.push(foot.from.distanceTo(foot.to)))); // prettier-ignore
      return lengths.reduce((a, b) => a + b, 0) / Math.max(1, lengths.length);
    };
    expect(stride(3)).toBeGreaterThan(stride(1) * 1.2);
    const bug = new LegGait({ legs: HEX });
    let most = 0;
    walk(bug, 0.8, 180, () => {
      const up = bug.feet.flatMap((foot, i) => (foot.t >= 0 ? [HEX[i].group] : []));
      expect(new Set(up).size).toBeLessThanOrEqual(1);
      most = Math.max(most, up.length);
    });
    expect(most).toBeLessThanOrEqual(3);
  });

  it('stands its feet on raised ground, and grips a wall that stands between a hip and its spot', () => {
    const dog = new LegGait({ legs: QUAD });
    walk(dog, 1, 150, () => {}, 1 / 60, world()); // its front feet onto the block from z 2
    const onBlock = dog.feet.filter((foot) => foot.t < 0 && foot.position.z > 2.05 && foot.position.z < 2.95);
    expect(onBlock.length).toBeGreaterThan(0);
    for (const foot of onBlock) expect(foot.position.y).toBeCloseTo(0.1, 9);
    const bug = new LegGait({ legs: HEX });
    walk(bug, 0.5, 60, () => {}, 1 / 60, world(-0.25)); // a wall at its right (−X): its right feet's spots inside it
    const right = bug.feet.filter((foot, i) => HEX[i].rest[0] < 0 && foot.t < 0);
    expect(right.length).toBeGreaterThan(0);
    for (const foot of right) expect([foot.position.x, foot.normal.x]).toEqual([expect.closeTo(-0.25, 9), 1]); // on its face
  });

  it('tucks every foot in the air, lands them where they are, and tilts the body by its feet', () => {
    const dog = new LegGait({ legs: QUAD });
    const body = walk(dog, 1, 30);
    body.position.y = 0.5;
    for (let i = 0; i < 20; i++) dog.fly(1 / 60, body);
    expect(dog.feet.every((foot) => foot.t === 2 && foot.position.y > 0.1)).toBe(true);
    expect(dog.lifted()).toBe(0);
    body.position.y = 0;
    dog.step(1 / 60, body, world());
    expect(dog.feet.every((foot) => foot.position.y === 0)).toBe(true); // landed where it was
    dog.feet[0].position.y = 0.1; // its left front foot on something
    const [pitch, roll] = dog.tilt();
    expect(pitch).toBeGreaterThan(0); // nose up
    expect(roll).toBeLessThan(0); // its right side up: the left front's side is −X here
  });
});
