/**
 * @file The Animation Lab's bone overlay (PLAN.md WP 10.8; the animlab's skeleton key, `my-3d2dge:src/starter/
 * 60-animlab.js`): every figure's skeleton drawn over the picture, a line from each joint to its parent, as
 * `__engine.anim(id).joints` places them (the animator's FK, world metres), projected through the camera's pose of the
 * frame (`EngineFrame.camera`) onto a 2D canvas laid over the engine's.
 *
 * Invariants: presentation only, from the page: it reads the inspector, never the sim's state, and writes only its own
 * canvas; the projection is the camera's (perspective with its vertical field of view and zoom, or orthographic with
 * its frustum), its roll left out.
 *
 * @example
 * project({ position: [0, 1, -5], yaw: 0, pitch: 0, projection: 'perspective', fov: 60, zoom: 1, frustumSize: 10 }, [0, 1, 0], 640, 360); // [320, 180]
 * @see tests/e2e/labs.spec.ts
 */
import type { CameraPose } from '../../engine';

/** Each joint and its parent in the humanoid skeleton (engine/anim/skeleton.ts): the bones the overlay draws. */
export const BONES: readonly [joint: string, parent: string][] = [
  ...(['spine0', 'spine1', 'spine2', 'chest', 'neck', 'head'] as const).map((joint, i, all): [string, string] => [
    joint,
    i ? all[i - 1] : 'pelvis',
  ]),
  ...(['L', 'R'] as const).flatMap((s): [string, string][] => [
    [`clavicle${s}`, 'chest'],
    [`upperArm${s}`, `clavicle${s}`],
    [`forearm${s}`, `upperArm${s}`],
    [`hand${s}`, `forearm${s}`],
    [`thigh${s}`, 'pelvis'],
    [`shin${s}`, `thigh${s}`],
    [`foot${s}`, `shin${s}`],
    [`toe${s}`, `foot${s}`],
  ]),
];

/** The parts of a camera's pose the projection reads. */
type Lens = Pick<CameraPose, 'yaw' | 'pitch' | 'projection' | 'fov' | 'zoom' | 'frustumSize'> & {
  position: readonly number[] | { x: number; y: number; z: number };
};

/** Where world point `p` (m) falls on a `width` × `height` picture seen through `camera`; null behind it. */
export function project(camera: Lens, p: readonly number[], width: number, height: number): [number, number] | null {
  const at = Array.isArray(camera.position)
    ? camera.position
    : [(camera.position as { x: number }).x, (camera.position as { y: number }).y, (camera.position as { z: number }).z]; // prettier-ignore
  const [cy, sy, cp, sp] = [Math.cos(camera.yaw), Math.sin(camera.yaw), Math.cos(camera.pitch), Math.sin(camera.pitch)];
  const forward = [sy * cp, sp, cy * cp];
  const right = [-cy, 0, sy]; // forward × up, level: +X is the character's left
  const up = [-sy * sp, cp, -cy * sp];
  const v = [p[0] - at[0], p[1] - at[1], p[2] - at[2]];
  const dot = (a: number[]) => a[0] * v[0] + a[1] * v[1] + a[2] * v[2];
  const [x, y, z] = [dot(right), dot(up), dot(forward)];
  const aspect = width / height;
  let nx: number;
  let ny: number;
  if (camera.projection === 'orthographic') {
    const half = camera.frustumSize / 2 / (camera.zoom || 1);
    [nx, ny] = [x / (half * aspect), y / half];
  } else {
    if (z < 0.05) return null;
    const f = (camera.zoom || 1) / Math.tan((camera.fov * Math.PI) / 360);
    [nx, ny] = [((x / z) * f) / aspect, (y / z) * f];
  }
  return [((nx + 1) / 2) * width, ((1 - ny) / 2) * height];
}

/** Draws each skeleton of `skeletons` (joint name → world position) on `canvas` through `camera`; clears it first. */
export function drawBones(canvas: HTMLCanvasElement, camera: Lens, skeletons: readonly Record<string, number[]>[]) {
  const ratio = globalThis.devicePixelRatio || 1;
  const [width, height] = [canvas.clientWidth * ratio, canvas.clientHeight * ratio];
  if (canvas.width !== width || canvas.height !== height) [canvas.width, canvas.height] = [width, height];
  const g = canvas.getContext('2d');
  if (!g) return;
  g.clearRect(0, 0, width, height);
  g.lineWidth = 2 * ratio;
  g.strokeStyle = '#ffd27a';
  g.fillStyle = '#ff7a5a';
  for (const joints of skeletons) {
    for (const [joint, parent] of BONES) {
      const [a, b] = [joints[joint] && project(camera, joints[joint], width, height), joints[parent] && project(camera, joints[parent], width, height)]; // prettier-ignore
      if (!a || !b) continue;
      g.beginPath();
      g.moveTo(a[0], a[1]);
      g.lineTo(b[0], b[1]);
      g.stroke();
      g.fillRect(a[0] - 2 * ratio, a[1] - 2 * ratio, 4 * ratio, 4 * ratio);
    }
  }
}
