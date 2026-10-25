/**
 * @file Unit tests for the floater rig (engine/anim/floater.ts), PLAN.md WP 5.3: the hover holds my-3d2dge's wisp
 * height with its bob, the bank leans into turns within its bound, the motes orbit as `wispParts` placed them, and
 * every pose is finite. Also: the fixed step, the same bits for the same inputs, a pose read from the state alone.
 */
import { describe, expect, it } from 'vitest';
import { Vector3 } from '../core/math';
import { SIM_DT } from '../core/time';
import { Floater, FLOATER, type FloaterInput } from './floater';

/** Steps `floater` `steps` times with `input`. */
function run(floater: Floater, input: FloaterInput, steps: number): Floater {
  for (let i = 0; i < steps; i++) floater.step(input);
  return floater;
}

/** Flies `floater` round a circle at `speed` m/s, turning at `rate` rad/s (+ to the left), for `seconds`. */
function circle(floater: Floater, speed: number, rate: number, seconds: number): number[] {
  const banks: number[] = [];
  for (let i = 1; i <= Math.round(seconds / SIM_DT); i++) {
    const heading = rate * i * SIM_DT;
    floater.step({ velocity: new Vector3(Math.sin(heading) * speed, 0, Math.cos(heading) * speed) });
    banks.push(floater.state.bank);
  }
  return banks;
}

describe('the hover (my-3d2dge’s wisp)', () => {
  it('gives the source’s vertical speed: 6 × the gap to 20 units over the floor, bobbing ±3 units at 2 rad/s', () => {
    const wisp = new Floater();
    for (let i = 0; i < 100; i++) {
      wisp.step();
      const [z, floor] = [i * 0.37, (i % 7) * 4]; // units
      const source = (floor + 20 + Math.sin(wisp.state.clock * 2) * 3 - z) * 6; // stress-world/20-sim.js:427-428
      expect(wisp.hover(z / 16, floor / 16)).toBeCloseTo(source / 16, 12);
    }
  });

  it('holds a body that follows it at its height over the floor, bobbing about 18 cm either way', () => {
    const wisp = new Floater();
    let y = 0;
    const heights: number[] = [];
    for (let i = 0; i < 360; i++) {
      y += wisp.step().hover(y, 0.5) * SIM_DT;
      if (i >= 180) heights.push(y);
    }
    const [low, high] = [Math.min(...heights), Math.max(...heights)];
    expect((low + high) / 2).toBeCloseTo(0.5 + FLOATER.height, 2);
    expect(high - low).toBeGreaterThan(0.3); // a lag of rate 6 on a bob at 2 rad/s: 2 × 0.1875 × 6/√40 ≈ 0.36
    expect(high - low).toBeLessThan(2 * FLOATER.bob);
  });
});

describe('the heading and the bank', () => {
  it('turns to the direction of travel, or to a given yaw, and keeps it when slow', () => {
    const turning = run(new Floater(), { velocity: new Vector3(-3, 0, 0) }, 1); // one step in: on its way, not there
    expect([turning.state.yaw < -0.01, turning.state.yaw > -Math.PI / 2 + 0.01]).toEqual([true, true]);
    const wisp = run(new Floater(), { velocity: new Vector3(-3, 0, 0) }, 60);
    expect(wisp.state.yaw).toBeCloseTo(-Math.PI / 2, 3);
    run(wisp, { velocity: new Vector3(0.1, 0, 0.1) }, 30);
    expect(wisp.state.yaw).toBeCloseTo(-Math.PI / 2, 3);
    run(wisp, { velocity: new Vector3(-3, 0, 0), yaw: 3 }, 60);
    expect(wisp.state.yaw).toBeCloseTo(3, 3);
  });

  it('banks into a turn as an aircraft does: right side down turning right, by atan(a / 15 m/s²)', () => {
    const right = new Floater();
    const banks = circle(right, 5, -1.25, 3); // 5 m/s round a 4 m circle: 6.25 m/s² toward its right
    const lag = 1.25 / FLOATER.turnRate; // the heading trails the travel by ω / turnRate
    expect(banks.at(-1)!).toBeCloseTo(Math.atan((6.25 * Math.cos(lag)) / FLOATER.bankAccel), 2); // measured 0.392
    const { core } = right.pose();
    const side = (x: number) => new Vector3(x, 0, 0).applyMatrix4(core).y;
    expect(side(-1)).toBeLessThan(side(1)); // its right (−X in its frame) lower than its left
    expect(circle(new Floater(), 5, 1.25, 3).at(-1)).toBeCloseTo(-banks.at(-1)!, 3);
    run(right, { velocity: new Vector3(0, 0, 5) }, 120);
    expect(Math.abs(right.state.bank)).toBeLessThan(1e-3);
  });

  it('banks at most bankMax in a hard turn, and eases in through its spring', () => {
    const banks = circle(new Floater(), 6, -6, 2); // 36 m/s²
    expect(Math.max(...banks.map(Math.abs))).toBeLessThanOrEqual(FLOATER.bankMax + 1e-9);
    expect(banks.at(-1)).toBeCloseTo(FLOATER.bankMax, 3);
    expect(banks[0]).toBeLessThan(FLOATER.bankMax / 2); // not in one step
  });
});

describe('the motes and the pose', () => {
  it('orbits three motes where wispParts put them: 6 units out at 4 rad/s, ±2 units at 1.3 × the angle', () => {
    const wisp = new Floater({ clock: 0.3 });
    const at = new Vector3(1, 2, 3);
    const pose = wisp.step({ position: at }).pose();
    expect(pose.motes).toHaveLength(3);
    pose.motes.forEach((mote, i) => {
      const a = wisp.state.clock * 4 + (i * Math.PI * 2) / 3;
      const source = new Vector3(Math.cos(a) * 6, Math.sin(a * 1.3) * 2, Math.sin(a) * 6).divideScalar(16).add(at);
      expect(mote.distanceTo(source)).toBeLessThan(1e-15);
    });
  });

  it('swells the core and the orbit up to 1.8 times, and turns and banks the orbit with the core', () => {
    const wisp = new Floater({ motes: 5, yaw: 1 });
    const pose = run(wisp, { swell: 4, velocity: new Vector3(-2, 0, 3) }, 30).pose();
    expect(wisp.state.swell).toBe(1);
    expect(pose.core.determinant()).toBeCloseTo(Math.pow(1.8, 3), 12);
    expect(pose.motes).toHaveLength(5);
    const local = new Vector3();
    const inverse = pose.core.clone().invert();
    for (const mote of pose.motes) {
      local.copy(mote).applyMatrix4(inverse).multiplyScalar(1.8); // the core's frame, unscaled
      expect(Math.hypot(local.x, local.z)).toBeCloseTo(FLOATER.orbit * 1.8, 12);
      expect(Math.abs(local.y)).toBeLessThanOrEqual(FLOATER.rise + 1e-12);
    }
  });

  it('steps at SIM_DT by default, and gives the same bits for the same inputs', () => {
    expect(new Floater().dt).toBe(SIM_DT);
    expect(run(new Floater(), {}, 60).state.clock).toBeCloseTo(1, 12);
    const make = () => {
      const wisp = new Floater({ clock: 2 });
      circle(wisp, 4, 0.7, 1);
      return run(wisp, { position: new Vector3(1, 1.3, -2), swell: 0.4 }, 9);
    };
    const [a, b] = [make(), make()];
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
    expect(a.pose().core.elements).toEqual(b.pose().core.elements);
  });

  it('poses from the state alone: a copy of the state and position gives the same pose', () => {
    const wisp = new Floater();
    circle(wisp, 3, -2, 0.5);
    wisp.step({ position: new Vector3(4, 1, 0), velocity: new Vector3(1, 0, 1), swell: 0.5 });
    const copy = new Floater();
    Object.assign(copy.state, structuredClone(wisp.state));
    copy.position.copy(wisp.position);
    expect(copy.pose().core.elements).toEqual(wisp.pose().core.elements);
    expect(copy.pose().motes.map((m) => m.toArray())).toEqual(wisp.pose().motes.map((m) => m.toArray()));
  });

  it('gives a finite pose for any input: at rest, jolts of velocity, a given yaw, no motes', () => {
    const inputs: FloaterInput[] = [
      {},
      { velocity: new Vector3(1e6, -1e6, -1e6) },
      { velocity: new Vector3() },
      { velocity: new Vector3(-1e-9, 0, 1e-9), yaw: -40 },
      { swell: -3, position: new Vector3(-1e4, 0, 1e4) },
    ];
    for (const motes of [0, 3, 8]) {
      const wisp = new Floater({ motes, dt: 1 / 120 });
      for (const input of inputs) {
        const pose = run(wisp, input, 7).pose();
        expect(Object.values(wisp.state).every(Number.isFinite)).toBe(true);
        expect(pose.core.elements.every(Number.isFinite)).toBe(true);
        expect(pose.core.determinant()).toBeGreaterThan(0);
        expect(pose.motes.every((m) => m.toArray().every(Number.isFinite))).toBe(true);
        expect(wisp.state.yaw).toBeGreaterThanOrEqual(-Math.PI);
        expect(wisp.state.yaw).toBeLessThan(Math.PI);
      }
    }
  });
});
