/**
 * @file Unit tests for the planted gait (engine/anim/proc/gait.ts, PLAN.md WP 10.1): a four-legged walk keeps its
 * diagonals apart, one group in the air at a time, and its planted feet still, and squares them up when it stops; a
 * faster body strides farther; six legs walk on tripods; one group lifts at a time through a stop and a turn in place;
 * feet stand on raised ground and grip a wall where one stands between the hip and the spot; in the air every foot
 * tucks (at once, a gait that never stood), and lands where it is, on the floor after a drop at either rate; 60 and
 * 120 steps a second step alike through a hop and a walk eased in and out; uneven feet tilt the body; a gait saved
 * mid-step as plain data and loaded into another steps on alike.
 * @see engine/anim/proc/gait.ts
 */
import { describe, expect, it } from 'vitest';
import { Vector3 } from '../../core/math';
import type { GroundHit } from '../ik';
import { rateDrift, STATE_MATRIX } from '../stateMatrix';
import { GAIT_FOOT, LegGait, type GaitBody, type GaitLeg, type GaitProbe } from './gait';

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

  it('lifts one group at a time as it stops and as it turns where it stands, at 60 and 120 steps a second', () => {
    const together = (gait: LegGait, legs: GaitLeg[]) => new Set(gait.feet.flatMap((foot, i) => (foot.t >= 0 ? [legs[i].group] : []))).size > 1; // prettier-ignore
    for (const dt of [1 / 60, 1 / 120]) {
      const dog = new LegGait({ legs: QUAD });
      const body = { position: new Vector3(), yaw: 0, velocity: new Vector3(0, 0, 1.2) };
      let [both, turned] = [0, 0];
      for (let i = 0; i < Math.round(2 / dt); i++) {
        if (i === Math.round(1 / dt)) body.velocity.set(0, 0, 0); // it stops after a second
        dog.step(dt, { ...body, position: body.position.addScaledVector(body.velocity, dt) });
        if (together(dog, QUAD)) both++;
      }
      const bug = new LegGait({ legs: HEX });
      const still = { position: new Vector3(), yaw: 0, velocity: new Vector3() };
      for (let i = 0; i < Math.round(2 / dt); i++) {
        still.yaw += 2 * dt; // 2 rad/s where it stands
        bug.step(dt, still);
        if (together(bug, HEX)) both++;
        turned += bug.lifted() > 0 ? 1 : 0;
      }
      expect(both).toBe(0);
      expect(turned).toBeGreaterThan(Math.round(1 / dt)); // it kept stepping round
    }
  });

  it('lands from a drop on the floor under it, at 60 and 120 steps a second alike', () => {
    for (const dt of [1 / 60, 1 / 120]) {
      const dog = new LegGait({ legs: QUAD });
      const body = { position: new Vector3(0, 1, 0), yaw: 0, velocity: new Vector3(0, 0, 1) }; // on a ledge 1 m up
      for (let i = 0; i < Math.round(0.5 / dt); i++) dog.step(dt, { ...body, position: body.position.addScaledVector(body.velocity, dt) }); // prettier-ignore
      for (let time = dt; body.position.y > 0; time += dt) {
        body.position.addScaledVector(body.velocity, dt).y = Math.max(0, 1 - 4.905 * time * time); // off it, falling
        if (body.position.y > 0) dog.fly(dt, body);
      }
      dog.step(dt, body); // on the floor
      expect(dog.feet.map((foot) => foot.position.y)).toEqual([0, 0, 0, 0]);
    }
  });

  it('steps alike at 60 and 120 a second through a hop and through a walk eased in and out', () => {
    /** The feet each step for 3 s of a body at `body(t)` (its place along +Z, its height, their speeds, and whether it is up). */ // prettier-ignore
    const feet = (dt: number, body: (t: number) => { z: number; y: number; vz: number; vy: number; up: boolean }) => {
      const dog = new LegGait({ legs: QUAD });
      return Array.from({ length: Math.round(3 / dt) }, (_, i) => {
        const b = body((i + 1) * dt);
        const at = { position: new Vector3(0, b.y, b.z), yaw: 0, velocity: new Vector3(0, b.vy, b.vz) };
        if (b.up) dog.fly(dt, at);
        else dog.step(dt, at);
        return dog.feet.map((foot) => foot.position.clone());
      });
    };
    const hop = (t: number) => {
      const [tau, y] = [t - 0.5, 2.5 * (t - 0.5) - 4.905 * (t - 0.5) ** 2]; // off at 2.5 m/s up after 0.5 s
      const air = tau > 0 && y > 0; // down the step its arc meets the floor: a step apart at the two rates
      return { z: 1.2 * t, y: air ? y : 0, vz: 1.2, vy: air ? 2.5 - 9.81 * tau : 0, up: air };
    };
    const eased = (t: number) => {
      const [up, held, down] = [Math.min(t, 0.2), Math.max(0, Math.min(t - 0.2, 1)), Math.max(0, Math.min(t - 1.2, 0.5))]; // prettier-ignore
      const z = 7.5 * up * up + 3 * held + 3 * down - 3 * down * down; // 0.2 s up to 3 m/s, 1 s at it, 0.5 s down
      return { z, y: 0, vz: 15 * up - 6 * down, vy: 0, up: false };
    };
    for (const body of [hop, eased]) expect(rateDrift(feet(1 / 60, body), feet(1 / 120, body)).worst).toBeLessThan(STATE_MATRIX.rate); // prettier-ignore
  });

  it('tucks the feet of a gait that never stood under its hips at once, where it is', () => {
    const dog = new LegGait({ legs: QUAD });
    const body = { position: new Vector3(4, 2, -3), yaw: Math.PI / 2, velocity: new Vector3() };
    dog.fly(1 / 60, body);
    dog.feet.forEach((foot, i) => {
      const [h, r] = [QUAD[i].hip, QUAD[i].rest];
      const [x, y, z] = [0, 1, 2].map((k) => (h[k] + r[k]) / 2); // half way from the hip to its rest: the tuck
      expect(foot.position.distanceTo(new Vector3(4 + z, 2 + y, -3 - x))).toBeLessThan(1e-12); // turned to face +X
    });
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

  it('keeps a gait as plain data: saved mid-step and loaded into another, it steps on alike', () => {
    const [dog, copy] = [new LegGait({ legs: QUAD }), new LegGait({ legs: QUAD })];
    const body = { position: new Vector3(), yaw: 0.3, velocity: new Vector3(0.35, 0, 1.15) };
    const steps = (gaits: LegGait[]) => {
      body.position.addScaledVector(body.velocity, 1 / 60);
      for (const gait of gaits) gait.step(1 / 60, body);
    };
    for (let i = 0; i < 30 || !dog.feet.some((foot) => foot.t > 0.2 && foot.t < 0.8); i++) steps([dog]); // mid-step
    const state = JSON.parse(JSON.stringify(dog.save())) as ReturnType<LegGait['save']>;
    expect(state.feet).toHaveLength(QUAD.length * GAIT_FOOT);
    expect(copy.load(state).save()).toEqual(state); // every number taken back
    const feet = (gait: LegGait) => gait.feet.map((foot) => [...foot.position.toArray(), foot.t]);
    for (let i = 0; i < 90; i++) {
      if (i === 40) body.velocity.set(0.6, 0, 0.4); // a turn
      steps([dog, copy]);
      expect(feet(copy)).toEqual(feet(dog));
    }
    expect(copy.save()).toEqual(dog.save());
  });
});
