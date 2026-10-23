/**
 * @file Unit tests for joints (engine/physics/joints.ts, PLAN.md WP 10.2): a ball joint to the world swings a bob on
 * its length; a hinge turns about its axis only, within its limits of its rest, back to its rest on a spring, at its
 * speed on a motor; a slider moves along its axis within its limits; a rope holds at most its length and a spring
 * stretches under a weight; a fixed joint carries one body with another; a rest other than now pulls the bodies to
 * it; a capture taken mid-swing restores into a world that steps on exactly; removing a joint frees its body, removing
 * a body its joints; a bad spec is named and adds nothing.
 * @see engine/physics/joints.ts
 */
import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from '../core/math';
import { createRegistry } from '../core/registry';
import { createSettings, defineSettings } from '../core/settings';
import { addJoint, hasJoint, jointBodies, joints, removeJoint, type JointKind } from './joints';
import { PHYSICS_SETTINGS } from './params';
import { createPhysics, type Physics } from './world';

/** A sim stand-in for `step`: 60 Hz under `gravity`. */
function sim(gravity = 9.81) {
  const registry = createRegistry();
  defineSettings(PHYSICS_SETTINGS, registry);
  const settings = createSettings({ registry });
  settings.set('physics.gravity', gravity);
  return { dt: 1 / 60, settings: settings.sim };
}

/** Steps `p` `n` times under `stepper`. */
const run = (p: Physics, n: number, stepper = sim()) => {
  for (let k = 0; k < n; k++) p.step(stepper);
};

/** A 1 kg-ish box `size` at `at`, turned by `rotation`. */
const box = (
  p: Physics,
  at: readonly [number, number, number],
  size: readonly [number, number, number] = [0.1, 1, 0.1],
  extra = {},
) => p.addBody({ position: at, colliders: [{ shape: { type: 'box', size } }], canSleep: false, ...extra });

/** A body's turn about X (rad), for one turned about X only. */
const turnX = (q: Quaternion) => 2 * Math.atan2(q.x, q.w);

describe('joints', () => {
  it('swings a bob on a ball joint to the world, its length kept, the anchor a fixed body at the point', () => {
    const p = createPhysics();
    const bob = p.addBody({ position: [1, 3, 0], colliders: [{ shape: { type: 'ball', radius: 0.1 } }] });
    const id = addJoint(p, { a: bob, b: null, at: [0, 3, 0], kind: { type: 'ball' } });
    const [anchor, held] = jointBodies(p, id);
    expect([held, p.readBody(anchor).type, p.readBody(anchor).position.toArray()]).toEqual([bob, 'fixed', [0, 3, 0]]);
    let lowest = 3;
    for (let k = 0; k < 120; k++) {
      run(p, 1);
      const at = p.readBody(bob).position;
      expect(Math.abs(at.distanceTo(new Vector3(0, 3, 0)) - 1)).toBeLessThan(0.01);
      lowest = Math.min(lowest, at.y);
    }
    expect(lowest).toBeLessThan(2.05); // it swung through the bottom, 1 m under the anchor
    expect(joints(p)).toEqual([id]);
    p.dispose();
  });

  it('turns a hinge about its axis only, within its limits of its rest', () => {
    const free = createPhysics();
    const limited = createPhysics();
    const turns: number[][] = [[], []];
    [free, limited].forEach((p, i) => {
      const rod = box(p, [0, 2.5, 0]); // hanging 1 m from y 3 to 2
      const kind: JointKind = { type: 'hinge', axis: [1, 0, 0], ...(i ? { limits: [-0.3, 0.3] as const } : {}) };
      addJoint(p, { a: rod, b: null, at: [0, 3, 0], kind });
      p.setBody(rod, { angularVelocity: [6, 0, 0], velocity: [0, 0, -3] }); // 6 rad/s about the hinge, its middle 0.5 m down
      for (let k = 0; k < 90; k++) {
        run(p, 1);
        const { rotation, position } = p.readBody(rod);
        turns[i].push(turnX(rotation));
        expect(Math.abs(position.x)).toBeLessThan(1e-3); // in its plane
        expect(Math.abs(rotation.y) + Math.abs(rotation.z)).toBeLessThan(1e-3); // about X only
      }
    });
    expect(Math.max(...turns[0])).toBeGreaterThan(1); // free, it swings far
    for (const turn of turns[1]) expect(Math.abs(turn)).toBeLessThan(0.3 + 0.03); // limited
    expect(Math.max(...turns[1])).toBeGreaterThan(0.29);
    free.dispose();
    limited.dispose();
  });

  it('brings a hinge back to its rest on a spring, and turns one at its speed on a motor', () => {
    const p = createPhysics();
    const still = sim(0);
    const plate = (x: number) => box(p, [x, 1, 0], [1, 0.05, 1] as const); // a plate turning about Y, no gravity
    const [sprung, driven] = [plate(0), plate(3)];
    addJoint(p, {
      a: sprung,
      b: null,
      at: [0, 1, 0],
      kind: { type: 'hinge', axis: [0, 1, 0], spring: 40, damping: 8 },
    });
    addJoint(p, { a: driven, b: null, at: [3, 1, 0], kind: { type: 'hinge', axis: [0, 1, 0], motorSpeed: 1, motorForce: 1e3 } }); // prettier-ignore
    p.setBody(sprung, { angularVelocity: [0, 4, 0] });
    run(p, 180, still); // 3 s
    const yaw = (id: number) => 2 * Math.atan2(p.readBody(id).rotation.y, p.readBody(id).rotation.w);
    expect(Math.abs(yaw(sprung))).toBeLessThan(0.01); // back at rest
    expect(yaw(driven)).toBeCloseTo(3, 1); // 3 rad turned at 1 rad/s
    p.dispose();
  });

  it('moves a slider along its axis within its limits, and a rope or a spring holds a weight', () => {
    const p = createPhysics();
    const slid = box(p, [0, 3, 0], [0.5, 0.5, 0.5] as const);
    addJoint(p, { a: slid, b: null, at: [0, 3, 0], kind: { type: 'slider', axis: [0, 1, 0], limits: [-1, 0] } });
    const hung = box(p, [2, 3, 0], [0.2, 0.2, 0.2] as const);
    addJoint(p, { a: hung, b: null, at: [2, 3, 0], atB: [2, 4, 0], kind: { type: 'rope', length: 2 } }); // 1 m slack
    const sprung = box(p, [4, 3, 0], [0.2, 0.2, 0.2] as const);
    addJoint(p, { a: sprung, b: null, at: [4, 3, 0], atB: [4, 4, 0], kind: { type: 'spring', length: 1, stiffness: 400, damping: 20 } }); // prettier-ignore
    run(p, 180);
    const [s, h, k] = [slid, hung, sprung].map((id) => p.readBody(id).position);
    expect([s.x, s.z, s.y].map((v) => Math.round(v * 1e4) / 1e4 || 0)).toEqual([0, 0, 2]); // to its limit 1 m down, along Y only
    expect(h.y).toBeCloseTo(2, 1); // the rope taut, 2 m under its anchor
    expect(4 - k.y).toBeGreaterThan(1.001); // the spring stretched past its 1 m under the weight
    expect(4 - k.y).toBeLessThan(1.2);
    p.dispose();
  });

  it('carries one body with another on a fixed joint, and pulls two bodies to a rest other than now', () => {
    const p = createPhysics();
    const [a, b] = [box(p, [0, 5, 0]), box(p, [1, 5, 0])];
    addJoint(p, { a, b, at: [0.5, 5, 0], kind: { type: 'fixed' } });
    p.setBody(a, { velocity: [0, 0, 3] }); // a push off the pair's middle: they turn as one
    run(p, 30);
    const [ra, rb] = [p.readBody(a), p.readBody(b)];
    const seen = rb.position.clone().sub(ra.position).applyQuaternion(ra.rotation.clone().invert());
    expect(seen.distanceTo(new Vector3(1, 0, 0))).toBeLessThan(0.01); // b where it was, seen from a
    expect(ra.rotation.angleTo(rb.rotation)).toBeLessThan(0.01);
    expect(ra.position.z).toBeGreaterThan(0.5); // carried along
    const q = createPhysics();
    const [upper, lower] = [box(q, [0, 3.5, 0]), box(q, [0, 2.5, 0], [0.1, 1, 0.1] as const, { rotation: new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.4) })]; // prettier-ignore
    q.setBody(upper, { velocity: [0, 0, 0] });
    addJoint(q, { a: upper, b: null, at: [0, 4, 0], kind: { type: 'fixed' } });
    addJoint(q, { a: upper, b: lower, at: [0, 3, 0], rest: [0, 0, 0, 1], kind: { type: 'hinge', axis: [1, 0, 0], limits: [-0.05, 0.05] } }); // prettier-ignore
    run(q, 60);
    expect(Math.abs(turnX(q.readBody(lower).rotation))).toBeLessThan(0.06); // pulled within its limits of the rest
    p.dispose();
    q.dispose();
  });

  it('captures a chain mid-swing and restores a world that steps on exactly', () => {
    const p = createPhysics();
    let last = p.addBody({ type: 'fixed', position: [0, 5, 0] });
    for (let k = 1; k <= 5; k++) {
      const link = p.addBody({ position: [0.4 * k, 5, 0], colliders: [{ shape: { type: 'ball', radius: 0.1 } }] });
      addJoint(p, { a: last, b: link, at: [0.4 * k - 0.2, 5, 0], kind: { type: 'ball', damping: 0.5 } });
      last = link;
    }
    run(p, 30);
    const capture = p.capture();
    run(p, 60);
    const straight = Array.from(p.state());
    p.restore(capture);
    expect(joints(p)).toHaveLength(5);
    run(p, 60);
    expect(Array.from(p.state())).toEqual(straight);
    p.dispose();
  });

  it('frees a body whose joint is removed, removes a body’s joints with it, and names a bad spec', () => {
    const p = createPhysics();
    const bob = box(p, [1, 3, 0]);
    const id = addJoint(p, { a: bob, b: null, at: [0, 3, 0], kind: { type: 'ball' } });
    removeJoint(p, id);
    expect(hasJoint(p, id)).toBe(false);
    run(p, 60);
    expect(p.readBody(bob).position.y).toBeLessThan(-1); // it fell
    const other = box(p, [5, 3, 0]);
    const held = addJoint(p, { a: other, b: null, at: [5, 4, 0], kind: { type: 'hinge' } });
    p.removeBody(other);
    expect(hasJoint(p, held)).toBe(false);
    expect(() => removeJoint(p, held)).toThrow(/PHYSICS_NO_JOINT/);
    const count = p.count;
    const bad = (spec: object) => () => addJoint(p, { a: bob, b: null, at: [0, 0, 0], ...spec } as never);
    expect(bad({ kind: { type: 'weld' } })).toThrow(/PHYSICS_BAD_ARGUMENT.*kind/);
    expect(bad({ kind: { type: 'hinge', limits: [1, 0] } })).toThrow(/PHYSICS_BAD_ARGUMENT.*limits/);
    expect(bad({ kind: { type: 'rope' } })).toThrow(/PHYSICS_BAD_ARGUMENT.*length/);
    expect(bad({ kind: { type: 'ball' }, a: 99 })).toThrow(/PHYSICS_NO_BODY/);
    expect(p.count).toBe(count); // no anchor left behind
    p.dispose();
  });
});
