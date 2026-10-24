/**
 * @file Unit tests for snapping the camera to pixel art's block grid (engine/gfx/post/snap.ts): an orthographic
 * camera lands on whole blocks in its screen plane, a perspective one at its ground depth, and both are put back
 * exactly; `snapGrid` at one pixel says which whole blocks it stands at and the remainder as the picture's offset,
 * a sub-block pan moving the offset and never the blocks.
 */
import { OrthographicCamera, PerspectiveCamera, Vector3 } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { blockSize, snapGrid, snapToBlocks } from './snap';

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

describe('snapGrid', () => {
  /** Iso's camera, 9.6 m across 480 px: blocks of 0.02 m at 1 px. */
  const iso = (x: number) => {
    const camera = new OrthographicCamera(-4.8, 4.8, 2.7, -2.7, 0.1, 100);
    camera.position.set(x, 10, 10);
    camera.lookAt(x, 0, 0);
    camera.updateMatrixWorld();
    return camera;
  };
  const SMALL = { width: 480, height: 270 };

  it("snaps at one of the buffer's pixels, giving the whole blocks and the remainder as the picture's offset", () => {
    const camera = iso(0.513);
    const grid = snapGrid(camera, 1, SMALL);
    expect(camera.position.x).toBeCloseTo(0.52, 10); // 26 blocks of 0.02 m
    expect(grid.cells[0]).toBe(26);
    expect(grid.shift[0]).toBeCloseTo(0.35, 10); // the camera was 0.35 px left of the snap: the picture right
    grid.restore();
    expect(camera.position.x).toBe(0.513);
  });

  it('keeps its blocks under a sub-block pan and moves only the offset, within half a block', () => {
    const grids = [0.511, 0.514, 0.517, 0.5199].map((x) => {
      const grid = snapGrid(iso(x), 1, SMALL);
      grid.restore();
      return grid;
    });
    expect(new Set(grids.map((grid) => grid.cells.join()))).toEqual(new Set(['26,0']));
    const shifts = grids.map((grid) => grid.shift[0]);
    for (let i = 1; i < shifts.length; i++) expect(shifts[i]).toBeLessThan(shifts[i - 1]); // panning right: it slides left
    for (const grid of grids) expect(Math.abs(grid.shift[0]) <= 0.5 && Math.abs(grid.shift[1]) <= 0.5).toBe(true);
  });

  it('counts the blocks down the screen as the camera rises, and does nothing for an empty picture', () => {
    const camera = new OrthographicCamera(-4.8, 4.8, 2.7, -2.7, 0.1, 100);
    camera.position.set(0, 0.3, 10); // looking down -Z: up is +Y
    camera.updateMatrixWorld();
    const grid = snapGrid(camera, 1, SMALL);
    expect(grid.cells).toEqual([0, -15]); // 0.3 m up is 15 blocks: the world's cells move down the screen
    grid.restore();
    expect(snapGrid(camera, 1, { width: 0, height: 0 }).cells).toEqual([0, 0]);
  });
});
