/**
 * @file Unit tests for snapping the camera to pixel art's block grid (engine/gfx/post/snap.ts): an orthographic
 * camera lands on whole blocks in its screen plane, a perspective one at its ground depth, and both are put back
 * exactly.
 */
import { OrthographicCamera, PerspectiveCamera, Vector3 } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { blockSize, snapToBlocks } from './snap';

const SIZE = { width: 960, height: 540 };

describe('snapToBlocks', () => {
  it('moves an orthographic camera to whole blocks along its own axes, whatever its turn', () => {
    const camera = new OrthographicCamera(-4.8, 4.8, 2.7, -2.7, 0.1, 100);
    camera.position.set(3.217, 9.4, 7.731);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const [across, up] = blockSize(camera, 4, SIZE);
    expect(across).toBeCloseTo(0.04, 10);
    expect(up).toBeCloseTo(0.04, 10);
    const kept = camera.position.clone();
    const restore = snapToBlocks(camera, 4, SIZE);
    const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const upward = new Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    const forward = new Vector3().setFromMatrixColumn(camera.matrixWorld, 2);
    for (const [axis, block] of [
      [right, across],
      [upward, up],
    ] as const) {
      const blocks = camera.position.dot(axis) / block;
      expect(Math.abs(blocks - Math.round(blocks))).toBeLessThan(1e-6);
    }
    expect(camera.position.dot(forward)).toBeCloseTo(kept.dot(forward), 10);
    expect(camera.position.distanceTo(kept)).toBeLessThanOrEqual(Math.hypot(across, up) / 2 + 1e-9);
    restore();
    expect(camera.position.toArray()).toEqual(kept.toArray());
  });

  it("scales a perspective camera's blocks by the depth where its line of sight meets the ground", () => {
    const camera = new PerspectiveCamera(50, SIZE.width / SIZE.height, 0.1, 100);
    camera.position.set(0, 10, 10);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const [, up] = blockSize(camera, 4, SIZE);
    const depth = Math.hypot(10, 10);
    expect(up).toBeCloseTo((4 * 2 * depth * Math.tan((25 * Math.PI) / 180)) / SIZE.height, 10);
    const restore = snapToBlocks(camera, 4, SIZE);
    restore();
    expect(camera.position.toArray()).toEqual([0, 10, 10]);
  });

  it('does nothing for blocks of 1 px or an empty picture', () => {
    const camera = new OrthographicCamera(-1, 1, 1, -1);
    camera.position.set(0.123, 0, 5);
    snapToBlocks(camera, 1, SIZE)();
    snapToBlocks(camera, 4, { width: 0, height: 0 })();
    expect(camera.position.x).toBe(0.123);
  });
});
