/**
 * @file Unit tests for screen shake (engine/gfx/fx/shake.ts), in Node: hits add up to the cap and nothing with
 * reduced motion; the amplitude dies away by exp(−9 t); the offset is the 2D engine's sums of sines, nothing when
 * still; applying moves the camera along its own right and up by it, and restoring puts it back exactly.
 * @see engine/gfx/fx/shake.ts
 */
import { PerspectiveCamera, Vector3 } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { ScreenShake, SHAKE } from './shake';

describe('ScreenShake', () => {
  it('adds up to its cap, and nothing with reduced motion', () => {
    const shake = new ScreenShake();
    for (let i = 0; i < 10; i++) shake.add(0.03);
    expect(shake.amount).toBe(SHAKE.max);
    const calm = new ScreenShake();
    calm.reduced = true;
    calm.add(0.03);
    expect(calm.amount).toBe(0);
  });

  it('dies away by exp(−9 t), with the sines of the 2D engine', () => {
    const shake = new ScreenShake();
    shake.add(0.1);
    shake.update(0.3);
    expect(shake.amount).toBeCloseTo(0.1 * Math.exp(-2.7), 15);
    const t = shake.time;
    const [across, down] = shake.offset();
    expect(across).toBeCloseTo((Math.sin(t * 83) + Math.sin(t * 57.3)) * 0.5 * shake.amount, 15);
    expect(down).toBeCloseTo((Math.sin(t * 71) + Math.sin(t * 49.7)) * 0.5 * shake.amount, 15);
    shake.update(1);
    expect(shake.offset()).toEqual([0, 0]); // still
  });

  it('moves the camera along its own right and up, and puts it back', () => {
    const camera = new PerspectiveCamera();
    camera.position.set(6, 7, 12);
    camera.lookAt(6, 0, 4);
    camera.updateMatrixWorld();
    const start = camera.position.clone();
    const shake = new ScreenShake();
    shake.add(0.1);
    shake.update(0.01);
    const [across, down] = shake.offset();
    shake.apply(camera);
    const moved = camera.position.clone().sub(start);
    const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const up = new Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    expect(moved.dot(right)).toBeCloseTo(across, 12);
    expect(moved.dot(up)).toBeCloseTo(-down, 12);
    expect(moved.length()).toBeGreaterThan(0.01);
    shake.restore(camera);
    expect(camera.position.distanceTo(start)).toBeLessThan(1e-12);
  });
});
