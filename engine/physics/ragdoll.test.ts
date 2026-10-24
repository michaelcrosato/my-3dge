/**
 * @file Unit tests for ragdolls (engine/physics/ragdoll.ts, PLAN.md WP 10.2): a doll of a trunk, a head and two legs
 * falls onto a floor and comes to rest on it, its head held at its neck and its parts kept above the floor; thrown, it
 * flies on as one body, each part at the whole body's velocity; its parts read back 7 numbers each; a capture taken
 * mid-fall restores into a world that steps on exactly; removing it removes its bodies and joints; a bad spec is named
 * and adds nothing.
 * @see engine/physics/ragdoll.ts
 */
import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from '../core/math';
import { createRegistry } from '../core/registry';
import { createSettings, defineSettings } from '../core/settings';
import { joints } from './joints';
import { PHYSICS_SETTINGS } from './params';
import {
  addRagdoll,
  PART_STRIDE,
  ragdollSpeed,
  readRagdoll,
  removeRagdoll,
  type RagdollPart,
  type RagdollSpec,
} from './ragdoll';
import { createPhysics, type Physics } from './world';

/** A sim stand-in for `step`: 60 Hz under 9.81 m/s². */
function sim() {
  const registry = createRegistry();
  defineSettings(PHYSICS_SETTINGS, registry);
  return { dt: 1 / 60, settings: createSettings({ registry }).sim };
}
const stepper = sim();
const run = (p: Physics, n: number) => {
  for (let k = 0; k < n; k++) p.step(stepper);
};

/** A floor whose top is y 0. */
const floored = () => {
  const p = createPhysics();
  p.addBody({ type: 'fixed', colliders: [{ shape: { type: 'box', size: [20, 1, 20] }, position: [0, -0.5, 0] }] });
  return p;
};

/** A doll standing at `x`, `up` metres up: a trunk, a head and two legs (each a hinge at the hip, the knee's way). */
const doll = (x = 0, up = 0, extra: Partial<RagdollSpec> = {}): RagdollSpec => ({
  parts: [
    { position: [x, 1 + up, 0], shapes: [{ from: [x, 1 + up, 0], to: [x, 1.5 + up, 0], radius: 0.15 }] },
    { position: [x, 1.65 + up, 0], shapes: [{ from: [x, 1.8 + up, 0], radius: 0.12 }] },
    { position: [x + 0.1, 0.95 + up, 0], shapes: [{ from: [x + 0.1, 0.95 + up, 0], to: [x + 0.1, 0.1 + up, 0], radius: 0.07 }] }, // prettier-ignore
    { position: [x - 0.1, 0.95 + up, 0], shapes: [{ from: [x - 0.1, 0.95 + up, 0], to: [x - 0.1, 0.1 + up, 0], radius: 0.07 }] }, // prettier-ignore
  ],
  joints: [
    { parent: 0, child: 1, at: [x, 1.65 + up, 0], kind: { type: 'ball', spring: 30, damping: 6 } },
    { parent: 0, child: 2, at: [x + 0.1, 0.95 + up, 0], kind: { type: 'hinge', axis: [1, 0, 0], limits: [-1.5, 0.3], damping: 2 } }, // prettier-ignore
    { parent: 0, child: 3, at: [x - 0.1, 0.95 + up, 0], kind: { type: 'hinge', axis: [1, 0, 0], limits: [-1.5, 0.3], damping: 2 } }, // prettier-ignore
  ],
  ...extra,
});

/** Where a part's local point `local` is now. */
const pointOf = (poses: number[], part: number, local: readonly number[]) => {
  const o = part * PART_STRIDE;
  const q = new Quaternion(poses[o + 3], poses[o + 4], poses[o + 5], poses[o + 6]);
  return new Vector3(...local).applyQuaternion(q).add(new Vector3(poses[o], poses[o + 1], poses[o + 2]));
};

describe('ragdolls', () => {
  it('falls onto the floor and comes to rest there, its head held at the neck, every part above the floor', () => {
    const p = floored();
    const ragdoll = addRagdoll(p, doll(0, 0, { velocity: [0, 0, 1.5] })); // a push: it topples forward
    expect([ragdoll.bodies.length, ragdoll.joints.length, joints(p).length]).toEqual([4, 3, 3]);
    let lowest = Infinity;
    for (let k = 0; k < 240; k++) {
      run(p, 1);
      const poses = readRagdoll(p, ragdoll);
      const neck = [pointOf(poses, 0, [0, 0.65, 0]), pointOf(poses, 1, [0, 0, 0])];
      expect(neck[0].distanceTo(neck[1])).toBeLessThan(0.05); // held at the neck: a few cm as it strikes the floor
      for (let i = 0; i < 4; i++) lowest = Math.min(lowest, poses[i * PART_STRIDE + 1]);
    }
    const poses = readRagdoll(p, ragdoll);
    expect(poses).toHaveLength(4 * PART_STRIDE);
    expect(poses[1]).toBeLessThan(0.4); // the trunk lies
    expect(lowest).toBeGreaterThan(0); // nothing sank through
    expect(ragdollSpeed(p, ragdoll)).toBeLessThan(0.05); // at rest after 4 s
    p.dispose();
  });

  it('flies on as one body when thrown, each part at the whole body’s velocity', () => {
    const p = createPhysics();
    const ragdoll = addRagdoll(p, doll(0, 5, { velocity: [3, 4, 0] }));
    for (const id of ragdoll.bodies) expect(p.readBody(id).velocity.toArray()).toEqual([3, 4, 0]);
    const spun = addRagdoll(p, doll(10, 5, { angularVelocity: [0, 0, 2] })); // a spin about the trunk's frame
    expect(p.readBody(spun.bodies[1]).velocity.x).toBeCloseTo(-2 * 0.65, 5); // the head, 0.65 m up, swung back
    run(p, 30);
    expect(readRagdoll(p, ragdoll)[0]).toBeCloseTo(1.5, 1); // 0.5 s at 3 m/s
    p.dispose();
  });

  it('captures a fall mid-way and restores a world that steps on exactly; removed, it leaves nothing', () => {
    const p = floored();
    const ragdoll = addRagdoll(p, doll(0, 0.5, { velocity: [1, 0, 0] }));
    run(p, 20);
    const capture = p.capture();
    run(p, 60);
    const straight = Array.from(p.state());
    p.restore(capture);
    run(p, 60);
    expect(Array.from(p.state())).toEqual(straight);
    removeRagdoll(p, ragdoll);
    expect([p.count, joints(p)]).toEqual([1, []]); // the floor alone
    p.dispose();
  });

  it('names a bad spec', () => {
    const p = createPhysics();
    expect(() => addRagdoll(p, { parts: [], joints: [] })).toThrow(/PHYSICS_BAD_ARGUMENT.*addRagdoll\(spec\)/);
    const bad = doll();
    expect(() => addRagdoll(p, { ...bad, joints: [{ ...bad.joints[0], child: 9 }] })).toThrow(/joints\[0\]/);
    const broken: RagdollPart[] = [
      ...bad.parts.slice(0, 3),
      { ...bad.parts[3], shapes: [{ from: [0, 0, 0], radius: 0 }] },
    ];
    expect(() => addRagdoll(p, { ...bad, parts: broken })).toThrow(/parts\[3\] \}\)\.shapes\[0\]/);
    const kinked = [...bad.joints.slice(0, 2), { ...bad.joints[2], kind: { type: 'hinge', limits: [1, 0] } as const }];
    expect(() => addRagdoll(p, { ...bad, joints: kinked })).toThrow(/limits/);
    expect([p.count, joints(p)]).toEqual([0, []]); // all or nothing
    p.dispose();
  });
});
