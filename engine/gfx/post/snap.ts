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
 * Invariants: presentation only (doctrine: WebGPU only): the camera is put back exactly after the frame, so nothing
 * that reads it between frames, and nothing in the sim, ever sees the snap.
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

/** Moves `camera` to the nearest whole block in its screen plane (see the file comment); returns how to undo it. */
export function snapToBlocks(camera: Camera, block: number, size: { width: number; height: number }): () => void {
  if (!(block > 1) || size.width <= 0 || size.height <= 0) return () => undefined;
  const [across, up] = blockSize(camera, block, size);
  if (!(Number.isFinite(across) && Number.isFinite(up) && across > 0 && up > 0)) return () => undefined;
  const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
  const upward = new Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize();
  const kept = camera.position.clone();
  const a = kept.dot(right);
  const b = kept.dot(upward);
  camera.position
    .addScaledVector(right, Math.round(a / across) * across - a)
    .addScaledVector(upward, Math.round(b / up) * up - b);
  camera.updateMatrixWorld();
  return () => {
    camera.position.copy(kept);
    camera.updateMatrixWorld();
  };
}
