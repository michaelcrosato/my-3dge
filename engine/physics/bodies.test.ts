/**
 * @file Tests for bodies and props (engine/physics/bodies.ts): the four prop shapes weigh their volume of
 * `PROP_MATERIAL` and rest on the floor; a stack stands, sleeps and wakes; `knock` gives every mass the same push and
 * tips it toward the push; torque impulses turn a ball as I = 2/5·m·r² says; movers follow `moverPose` to float32
 * precision, waiting and easing as shardfall's `amount`; sensors block nothing, list the dynamic and kinematic bodies
 * inside and never the level, and triggers report each entry and exit once. The scene-level proofs (the hero carried,
 * the replay) are in fixtures/scenes/physics-props/index.test.ts; the rescue's are engine/physics/rescue.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from '../core/math';
import {
  addBall,
  addBox,
  addCapsule,
  addCylinder,
  addSensor,
  applyTorqueImpulse,
  driveBody,
  driveMover,
  knock,
  MOVER,
  moverPose,
  PROP_MATERIAL,
  sensorHits,
  updateTrigger,
  type Mover,
} from './bodies';
import { handleOf } from './capture';
import { createPhysics, rapierOf, type Physics } from './world';

const DT = 1 / 60;
/** The sim stand-in `step` reads: the world's gravity. */
const SIM = { dt: DT, settings: { get: (path: string) => (path === 'physics.gravity' ? 9.81 : undefined) } };
const steps = (p: Physics, n: number) => Array.from({ length: n }, () => p.step(SIM));

/** A physics world with a 40 × 40 m floor whose top is y 0 (x and z from −20 to 20). */
function withFloor(): Physics {
  const p = createPhysics();
  p.addBody({ type: 'fixed', colliders: [{ shape: { type: 'box', size: [40, 1, 40] }, position: [0, -0.5, 0] }] });
  return p;
}

describe('props', () => {
  it('weigh their volume of PROP_MATERIAL, take its friction, bounce and damping, and rest on the floor', () => {
    const p = withFloor();
    const r = 0.3;
    const props = [
      { id: addBox(p, [0.75, 0.75, 0.75], { position: [0, 1, 0] }), volume: 0.75 ** 3, rest: 0.375 },
      { id: addBall(p, r, { position: [2, 1, 0] }), volume: (4 / 3) * Math.PI * r ** 3, rest: r },
      { id: addCapsule(p, r, 0.5, { position: [4, 1, 0] }), volume: Math.PI * r * r * (0.5 + (4 / 3) * r), rest: 0.55 },
      { id: addCylinder(p, 0.375, 0.875, { position: [6, 1, 0] }), volume: Math.PI * 0.375 ** 2 * 0.875, rest: 0.4375 },
    ];
    expect(p.readBody(props[0].id).mass).toBeCloseTo(24.05, 2); // a hollow crate: 0.75 m at 57 kg/m³
    steps(p, 180);
    for (const { id, volume, rest } of props) {
      const body = p.readBody(id);
      expect(body.mass / volume).toBeCloseTo(PROP_MATERIAL.density, 2);
      expect(body.position.y).toBeCloseTo(rest, 2);
      const rigid = rapierOf(p).bodies.get(handleOf(id))!;
      const collider = rigid.collider(0);
      expect([collider.friction(), collider.restitution()]).toEqual([0.7, 0.05].map(Math.fround));
      expect([rigid.linearDamping(), rigid.angularDamping()]).toEqual([0.3, 0.8].map(Math.fround));
    }
    const heavy = addBox(p, [1, 1, 1], { position: [8, 0.5, 0], density: 1000, linearDamping: 0 });
    expect(p.readBody(heavy).mass).toBeCloseTo(1000, 3);
    expect(() => addBox(p, [1, 1, 1], null as never)).toThrow(/PHYSICS_BAD_ARGUMENT.*addProp\(spec\)/);
    p.dispose();
  });

  it('stack: five crates stand within 1 cm, fall asleep within a second, and wake when one is knocked', () => {
    const p = withFloor();
    const crates = Array.from({ length: 5 }, (_, level) =>
      addBox(p, [0.75, 0.75, 0.75], { position: [0, 0.375 + 0.75 * level, 0] }),
    );
    let asleep = -1;
    for (let k = 1; k <= 120 && asleep < 0; k++) {
      p.step(SIM);
      if (crates.every((id) => p.readBody(id).sleeping)) asleep = k;
    }
    expect(asleep).toBeGreaterThan(0);
    expect(asleep).toBeLessThanOrEqual(60);
    crates.forEach((id, level) => {
      expect(p.readBody(id).position.distanceTo(new Vector3(0, 0.375 + 0.75 * level, 0))).toBeLessThan(0.01);
    });
    knock(p, crates[4], [-1, 0, 0]);
    steps(p, 1);
    expect(crates.map((id) => p.readBody(id).sleeping)).toContain(false);
    p.dispose();
  });
});

describe('impulses', () => {
  it('knock: the same push for every mass, away from the striker and up; a tip toward the push, a twist with spin', () => {
    const p = createPhysics();
    const light = addBox(p, [0.75, 0.75, 0.75], {
      position: [0, 0, 0],
      gravityScale: 0,
      linearDamping: 0,
      angularDamping: 0,
    });
    const heavy = addBox(p, [0.75, 0.75, 0.75], {
      position: [5, 0, 0],
      density: 600,
      gravityScale: 0,
      linearDamping: 0,
      angularDamping: 0,
    });
    knock(p, light, [-3, 7, -4]); // from the south-west, 5 m away: the push points (0.6, 0, 0.8)
    knock(p, heavy, [2, 0, -4], { speed: 2, up: 1, spin: 0.5 });
    const [a, b] = [p.readBody(light), p.readBody(heavy)];
    expect(a.velocity.toArray().map((v) => +v.toFixed(4))).toEqual([2.8125, 2.5, 3.75]); // 4.6875 m/s across, 2.5 up
    expect(b.velocity.toArray().map((v) => +v.toFixed(4))).toEqual([1.2, 1, 1.6]);
    const tipAxis = new Vector3(0.8, 0, -0.6); // up × push: its top tips toward the push
    expect(a.angularVelocity.dot(tipAxis)).toBeGreaterThan(1);
    expect(a.angularVelocity.y).toBeCloseTo(0, 6);
    expect(b.angularVelocity.y).toBeGreaterThan(0.5);
    const above = addBall(p, 0.2, { position: [0, 0, 9], gravityScale: 0, linearDamping: 0 });
    knock(p, above, [0, 3, 9]); // straight above: no direction across, just up
    expect(
      p
        .readBody(above)
        .velocity.toArray()
        .map((v) => +v.toFixed(4)),
    ).toEqual([0, 2.5, 0]);
    expect(() => knock(p, light, [0, 0, 0], { speed: Number.NaN })).toThrow(
      /PHYSICS_BAD_ARGUMENT.*knock\(\{ speed \}\)/,
    );
    expect(() => knock(p, 99, [0, 0, 0])).toThrow(/PHYSICS_NO_BODY.*99: it was removed/);
    p.dispose();
  });

  it('applyTorqueImpulse turns a ball by τ / (2/5·m·r²)', () => {
    const p = createPhysics();
    const ball = addBall(p, 0.5, { position: [0, 0, 0], gravityScale: 0, angularDamping: 0 });
    const { mass } = p.readBody(ball);
    applyTorqueImpulse(p, ball, [0, 3, 0]);
    expect(p.readBody(ball).angularVelocity.y).toBeCloseTo(3 / (0.4 * mass * 0.25), 4);
    expect(() => applyTorqueImpulse(p, ball, [0, 1] as never)).toThrow(/applyTorqueImpulse\(torque\)/);
    p.dispose();
  });
});

describe('movers', () => {
  const path: Mover = { ...MOVER, origin: [1, 2, 3], offset: [4, 0, -2], period: 4 };

  it('moverPose: back and forth along the offset, waiting `hold` at the ends, eased or steady, phased, spinning', () => {
    const x = (mover: Mover, t: number) => moverPose(mover, t).position.x;
    expect(moverPose(path, 0).position.toArray()).toEqual([1, 2, 3]);
    expect(moverPose(path, 2).position.toArray()).toEqual([5, 2, 1]); // the far end at half the period
    expect(x(path, 1)).toBeCloseTo(3, 12); // eased: halfway at a quarter
    expect(x({ ...path, smooth: false }, 0.5)).toBeCloseTo(2, 12); // steady: a quarter of the way at an eighth
    expect(x(path, 0.5)).toBeLessThan(2); // eased: slower at first
    const held = { ...path, hold: 0.5 }; // waits 1 s at each end
    expect([x(held, 0.4), x(held, 1.6), x(held, 2.4), x(held, 4.4)]).toEqual([1, 5, 5, 1]);
    expect(x({ ...path, phase: 0.5 }, 0)).toBe(5);
    expect(x(path, -2)).toBe(5); // time before 0 wraps
    const turn = moverPose({ ...path, yaw: 0.25, spin: 0.5 }, 2).rotation;
    expect(turn.angleTo(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 1.25))).toBeLessThan(1e-12);
  });

  it('driveMover brings its kinematic body to moverPose(k·dt) after step k, to float32 precision, turning too', () => {
    const p = createPhysics();
    const mover = { ...path, hold: 0.2, spin: 1.5, yaw: 3 };
    const start = moverPose(mover, 0);
    mover.body = p.addBody({ type: 'kinematic', position: start.position, rotation: start.rotation });
    let [far, turned] = [0, 0];
    for (let k = 1; k <= 480; k++) {
      driveMover(p, mover, { time: k * DT, dt: DT });
      p.step(SIM);
      const [want, got] = [moverPose(mover, k * DT), p.readBody(mover.body)];
      far = Math.max(far, got.position.distanceTo(want.position));
      const off = got.rotation.clone().multiply(want.rotation.clone().invert()); // angleTo's acos is coarse here
      turned = Math.max(turned, 2 * Math.asin(Math.min(1, Math.hypot(off.x, off.y, off.z))));
    }
    expect(far).toBeLessThan(1e-5);
    expect(turned).toBeLessThan(1e-5);
    const crate = addBox(p, [1, 1, 1]);
    expect(() => driveBody(p, crate, [0, 0, 0], [0, 0, 0, 1], DT)).toThrow(/PHYSICS_BAD_ARGUMENT.*a kinematic body/);
    expect(() => driveBody(p, mover.body, [0, 0, 0], [0, 0, 0, 1], 0)).toThrow(/driveBody\(dt\)/);
    p.dispose();
  });
});

describe('sensors and triggers', () => {
  it('a sensor blocks nothing and lists the dynamic and kinematic bodies inside, never the fixed', () => {
    const p = withFloor();
    const sensor = addSensor(p, { type: 'box', size: [2, 2, 2] }, { position: [0, 1, 0] });
    const ball = addBall(p, 0.25, { position: [0, 4, 0] });
    const lift = p.addBody({
      type: 'kinematic',
      position: [6, 1, 0],
      colliders: [{ shape: { type: 'ball', radius: 0.3 } }],
    });
    const trigger = { body: sensor, inside: [] as number[] };
    const log: string[] = [];
    for (let k = 1; k <= 120; k++) {
      p.setBody(lift, { velocity: [k <= 60 ? -6 : 6, 0, 0] }); // in to x 0 by step 60, back out by 120
      p.step(SIM);
      const { entered, left } = updateTrigger(p, trigger);
      for (const id of entered) log.push(`${k} enter ${id}`);
      for (const id of left) log.push(`${k} leave ${id}`);
      if (k === 60) expect(sensorHits(p, sensor)).toEqual([ball, lift]);
    }
    expect(p.readBody(ball).position.y).toBeCloseTo(0.25, 2); // fell through it to the floor
    expect(log.map((line) => line.split(' ').slice(1).join(' '))).toEqual([
      `enter ${ball}`,
      `enter ${lift}`,
      `leave ${lift}`,
    ]);
    expect(trigger.inside).toEqual([ball]);
    expect(addSensor(p, { type: 'ball', radius: 1 }, { type: 'kinematic' })).toBeGreaterThan(sensor);
    expect(() => addSensor(p, { type: 'ball', radius: 1 }, { type: 'dynamic' as 'fixed' })).toThrow(
      /addSensor\(\{ type \}\)/,
    );
    p.dispose();
  });
});
