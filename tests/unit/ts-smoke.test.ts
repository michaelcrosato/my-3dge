/**
 * @file The type smoke test (PLAN.md WP 0.1, §4.7). It proves that the pinned three.js entry points (`three/webgpu`,
 * `three/tsl`) and Rapier's SIMD build import, type-check and run in Node under the pinned versions and
 * `moduleResolution: bundler`.
 *
 * Invariant: `tsc --noEmit` fails if Rapier's types ever degrade to `any` (Rapier 0.19.3's did under `nodenext`): the
 * `@ts-expect-error` below `createRigidBody(123)` then has no error to expect, and an unused directive is an error.
 *
 * Run: `npx vitest run tests/unit/ts-smoke.test.ts`, and `npx tsc --noEmit` for the type half.
 */
import RAPIER from '@dimforge/rapier3d-simd-compat';
import { float, vec3 } from 'three/tsl';
import { Quaternion, Vector3, WebGPURenderer } from 'three/webgpu';
import { describe, expect, it } from 'vitest';

describe('the pinned three.js and Rapier', () => {
  it('imports three/webgpu and three/tsl in Node', () => {
    const quarterTurn = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
    const turned = new Vector3(0, 0, 1).applyQuaternion(quarterTurn);
    expect(turned.x).toBeCloseTo(1, 12);
    expect(turned.z).toBeCloseTo(0, 12);
    expect(typeof WebGPURenderer).toBe('function');
    expect(vec3(1, 2, 3).mul(float(2)).isNode).toBe(true);
  });

  it('constructs and steps a Rapier World', async () => {
    await RAPIER.init();
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    world.timestep = 1 / 60;
    world.createCollider(RAPIER.ColliderDesc.cuboid(10, 0.1, 10));
    const ball = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 2, 0));
    world.createCollider(RAPIER.ColliderDesc.ball(0.5), ball);
    for (let step = 0; step < 120; step++) world.step();
    const y: number = ball.translation().y;
    expect(y).toBeLessThan(2);
    expect(y).toBeGreaterThan(0.5);

    // Never called: it exists only for the type check described in the file comment.
    const typesStayReal = () =>
      // @ts-expect-error createRigidBody takes a RigidBodyDesc, not a number.
      world.createRigidBody(123);
    expect(typeof typesStayReal).toBe('function');
    world.free();
  });
});
