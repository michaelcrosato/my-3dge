/**
 * @file Snapping the camera to pixel art's block grid (PLAN.md WP 7.4; shardfall's lesson, `shardfall:docs/
 * HISTORY.md:478-479`): the composite cuts the picture into blocks fixed to the screen, so a camera sliding by less
 * than a block changes what every block shows, and the pixel art shimmers. `snapToBlocks` moves the camera, in its
 * own screen plane, to the nearest whole number of blocks for the frame being drawn and returns how to put it back:
 * the picture then only ever moves by whole blocks. With an orthographic camera that is exact everywhere; with a
 * perspective one it is exact at the depth where the camera's line of sight meets the ground (y = 0), or 10 m ahead
 * when it never does.
 *
 * The block's size in world units comes from the projection matrix (`2 / (m00 · width)` per pixel across, `2 /
 * (m11 · height)` up), so a zoomed or boosted camera snaps by its own scale.
 *
 * `snapGrid` (WP 13.24) snaps at any whole block, one of the drawing buffer's pixels too (the pixel look's low
 * resolution), and says where: the whole blocks the camera stands at (`cells`, across and down the screen, which a
 * dither adds to its screen cells so its pattern stays on the world) and the remainder the snap took off as the
 * picture's offset in pixels (`shift`, right and down), which the page may carry as a smooth offset of the whole
 * picture (engine/gfx/resolution.ts `shift`), so the snapped picture still glides as the camera does.
 *
 * Invariants: presentation only (doctrine: WebGPU only): the camera is put back exactly after the frame, so nothing
 * that reads it between frames, and nothing in the sim, ever sees the snap; `shift` is within half a block.
 *
 * @example
 * import { OrthographicCamera } from 'three/webgpu';
 * const camera = new OrthographicCamera(-4.8, 4.8, 2.7, -2.7, 0.1, 100);
 * camera.position.set(0.013, 0, 10);
 * camera.updateMatrixWorld();
 * const restore = snapToBlocks(camera, 4, { width: 960, height: 540 }); // blocks of 0.04 m
 * camera.position.x; // 0.0 (rounded to 4 px)
 * restore();
 * camera.position.x; // 0.013
 * @see engine/gfx/post/snap.test.ts
 * @see tests/e2e/post.spec.ts
 */
import { Vector3, type Camera } from 'three/webgpu';

/** How far ahead a perspective camera snaps when its line of sight never meets the ground, in metres. */
export const SNAP_FALLBACK_DEPTH = 10;

/** The size of one block in world units, across and up, for `camera` drawing `size` pixels. */
export function blockSize(camera: Camera, block: number, size: { width: number; height: number }): [number, number] {
  camera.updateMatrixWorld();
  const e = camera.projectionMatrix.elements;
  const perspective = e[11] !== 0;
  let depth = 1;
  if (perspective) {
    const forward = new Vector3().setFromMatrixColumn(camera.matrixWorld, 2).negate();
    const origin = new Vector3().setFromMatrixPosition(camera.matrixWorld);
    depth = forward.y < -1e-3 ? -origin.y / forward.y : SNAP_FALLBACK_DEPTH;
    if (!(depth > 0)) depth = SNAP_FALLBACK_DEPTH;
  }
  return [(block * 2 * depth) / (e[0] * size.width), (block * 2 * depth) / (e[5] * size.height)];
}

/** Where `snapGrid` put the camera: its whole blocks, the remainder as the picture's offset, and how to undo it. */
export interface SnapGrid {
  /** The whole blocks the camera stands at, across (right) and down the screen. */
  cells: [number, number];
  /** The remainder the snap took off, as the picture's offset in pixels, right and down. */
  shift: [number, number];
  /** Puts the camera back where it was. */
  restore(): void;
}

/** Moves `camera` to the nearest whole block (1 px or more) in its screen plane; see the file comment. */
export function snapGrid(camera: Camera, block: number, size: { width: number; height: number }): SnapGrid {
  const none: SnapGrid = { cells: [0, 0], shift: [0, 0], restore: () => undefined };
  if (!(block >= 1) || size.width <= 0 || size.height <= 0) return none;
  const [across, up] = blockSize(camera, block, size);
  if (!(Number.isFinite(across) && Number.isFinite(up) && across > 0 && up > 0)) return none;
  const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
  const upward = new Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize();
  const kept = camera.position.clone();
  const [a, b] = [kept.dot(right) / across, kept.dot(upward) / up];
  const [x, y] = [Math.round(a), Math.round(b)];
  camera.position.addScaledVector(right, (x - a) * across).addScaledVector(upward, (y - b) * up);
  camera.updateMatrixWorld();
  return {
    cells: [x, 0 - y],
    shift: [(x - a) * block, (b - y) * block],
    restore() {
      camera.position.copy(kept);
      camera.updateMatrixWorld();
    },
  };
}

/** Moves `camera` to the nearest whole block of 2 px or more in its screen plane; returns how to undo it. */
export function snapToBlocks(camera: Camera, block: number, size: { width: number; height: number }): () => void {
  return block > 1 ? snapGrid(camera, block, size).restore : () => undefined;
}
