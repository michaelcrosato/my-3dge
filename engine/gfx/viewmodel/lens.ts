/**
 * @file The viewmodel's lens (PLAN.md WP 13.12, docs/PLAYGROUND.md §4): first person draws the player's arms with a
 * field of view and a depth range of their own, so they never clip a wall and keep their shape when the picture's lens
 * changes (the cam.fov slider, a slide's wider lens, the sights). Every point of them is drawn on its ray from the eye
 * at the depth their own lens gives it (`armsDepth`): past their near plane (`VIEWMODEL.near`) squeezed into the few
 * centimetres in front of the picture's near plane, so any wall, at least the capsule's radius off the eye, stands
 * behind them; and moved out across the picture (`armsSpread`) as far as their lens (`VIEWMODEL.fov`, Apex's 70 at 4:3)
 * puts it beyond the picture's. The material does this per vertex (engine/gfx/viewmodel/material.ts); here is the same
 * arithmetic on the CPU: where a point is drawn (`drawnPoint`), whether the arms' frame shows it (`inArmsFrame`), and
 * the frame's edge a hand is kept within (`intoArmsFrame`), which the arms rig (rig.ts) and the feel kit's first-person
 * checks (engine/dev/feel/camera.ts) use. Its view settings (`VIEWMODEL_SETTINGS`): the arms' lens (`cam.armsFov`) and
 * the full body under the camera (`cam.fullBody`).
 *
 * Invariants: pure; a point keeps its ray (only its depth and, with the spread, its distance from the picture's
 * centre change); `armsDepth` rises with the depth, so the arms hide their own far side as they would undrawn.
 *
 * @example
 * import { makePose } from '../cameras/pose';
 * const pose = makePose({ position: [0, 1.5, 0], fov: VIEWMODEL.fov, near: 0.05 }); // facing +Z with the arms' own lens
 * armsDepth(0.6, pose.near); // 0.135: 60 cm away, drawn 13.5 cm off the eye
 * drawnPoint(pose, [0.1, 1.3, 0.6]); // [0.0225, 1.455, 0.135]: on its ray, 4.4 times nearer
 * inArmsFrame(pose, [0.1, 1.3, 0.6], 16 / 9); // true
 * intoArmsFrame(pose, [0, 2.3, 0.2], 16 / 9)[1] < 2.3; // true: a hand on a cable overhead, kept at the frame's top
 * @see engine/gfx/viewmodel/lens.test.ts
 */
import { defineSettings } from '../../core/settings';
import { apexFov } from '../cameras/effects';
import { poseForward, poseRight, poseUp, type CameraPose, type Vec3 } from '../cameras/pose';

const DEG = Math.PI / 180;

/** The arms' lens and depth (see the file comment): degrees, metres, shares. */
export const VIEWMODEL = Object.freeze({
  /** Their lens, vertical degrees (three.js's `fov`): Apex's 70 at 4:3. */
  fov: apexFov(70),
  /** Their near plane, m: a point of them nearer the eye, along the view, is cut. */
  near: 0.1,
  /** M drawn per m of their depth past their near plane. */
  squeeze: 0.15,
  /** Their near plane is drawn this many times the picture's own. */
  lift: 1.2,
  /** How far out on their frame, a share of the half-frame, `intoArmsFrame` keeps a point by default. */
  margin: 0.85,
  /** M: a part of them nearer the eye than this is hidden. */
  cull: 0.12,
});

/** The view settings the viewmodel reads; never in the hash. */
export const VIEWMODEL_SETTING_FIELDS = {
  'cam.armsFov': {
    type: 'number',
    default: 70,
    minimum: 50,
    maximum: 110,
    view: true,
    description: "First person's arms' own field of view, as Apex Legends' slider gives it: horizontal degrees at 4:3. A view setting: never in the hash.", // prettier-ignore
  },
  'cam.fullBody': {
    type: 'boolean',
    default: false,
    view: true,
    description: 'First person shows the whole body under the camera (seen looking down) beside the arms, not the arms alone. A view setting: never in the hash.', // prettier-ignore
  },
} as const;

/** The view settings the viewmodel reads, declared on the shared registry. */
export const VIEWMODEL_SETTINGS = defineSettings(VIEWMODEL_SETTING_FIELDS);

/** The arms' lens of the setting `cam.armsFov` (`h`, Apex's horizontal degrees at 4:3), vertical degrees. */
export function armsLens(h: unknown): number {
  return typeof h === 'number' && Number.isFinite(h) ? apexFov(h) : VIEWMODEL.fov;
}

/** The depth (m, along the view) the arms draw a point of theirs `z` deep at, in a picture whose near plane is `near`. */
export function armsDepth(z: number, near: number): number {
  const base = near * VIEWMODEL.lift;
  return z >= VIEWMODEL.near ? base + (z - VIEWMODEL.near) * VIEWMODEL.squeeze : (z * base) / VIEWMODEL.near;
}

/** How far out across the picture the arms' lens `fov` (vertical degrees) moves a point beyond `pose`'s lens. */
export function armsSpread(pose: Pick<CameraPose, 'fov' | 'zoom'>, fov: number = VIEWMODEL.fov): number {
  return Math.tan((pose.fov / 2) * DEG) / Math.max(pose.zoom, 1e-6) / Math.tan((fov / 2) * DEG);
}

/** `p` in `pose`'s frame: across (right), up and along the view, m. */
function viewOf(pose: CameraPose, p: Vec3): Vec3 {
  const d: Vec3 = [p[0] - pose.position[0], p[1] - pose.position[1], p[2] - pose.position[2]];
  const dot = (a: Vec3) => a[0] * d[0] + a[1] * d[1] + a[2] * d[2];
  return [dot(poseRight(pose)), dot(poseUp(pose)), dot(poseForward(pose))];
}

/** The world point `pose`'s frame puts at across `x`, up `y`, along `z`. */
function worldOf(pose: CameraPose, x: number, y: number, z: number): Vec3 {
  const [r, u, f] = [poseRight(pose), poseUp(pose), poseForward(pose)];
  const at = (i: 0 | 1 | 2) => pose.position[i] + r[i] * x + u[i] * y + f[i] * z;
  return [at(0), at(1), at(2)];
}

/** Where the arms draw their point `p` (world, m) for `pose`, with their lens `fov` (see the file comment). */
export function drawnPoint(pose: CameraPose, p: Vec3, fov: number = VIEWMODEL.fov): Vec3 {
  const [x, y, z] = viewOf(pose, p);
  const f = z >= VIEWMODEL.near ? armsDepth(z, pose.near) / z : (pose.near * VIEWMODEL.lift) / VIEWMODEL.near;
  const s = armsSpread(pose, fov);
  return worldOf(pose, x * s * f, y * s * f, z * f);
}

/** Whether the arms' frame (their lens `fov`, a picture of `aspect`) shows their point `p`, and their depth keeps it. */
export function inArmsFrame(pose: CameraPose, p: Vec3, aspect: number, fov: number = VIEWMODEL.fov): boolean {
  const [x, y, z] = viewOf(pose, p);
  const half = Math.tan((fov / 2) * DEG);
  if (!(armsDepth(z, pose.near) > pose.near)) return false;
  return Math.abs(y) <= z * half && Math.abs(x) <= z * half * aspect;
}

/**
 * `p` kept within `margin` of the arms' half-frame (their lens `fov`, a picture of `aspect`), as far from the eye as
 * it was: a point outside moves to the frame's nearest edge, one behind the eye to the edge it is beyond.
 */
export function intoArmsFrame(
  pose: CameraPose,
  p: Vec3,
  aspect: number,
  margin: number = VIEWMODEL.margin,
  fov: number = VIEWMODEL.fov,
): Vec3 {
  const [x, y, z] = viewOf(pose, p);
  const r = Math.hypot(x, y, z);
  const [tv, th] = [Math.tan((fov / 2) * DEG), Math.tan((fov / 2) * DEG) * aspect];
  const depth = Math.max(z, 0.05 * r, 1e-9); // behind the eye: as far out as a 3° ray
  const [sx, sy] = [x / (depth * th), y / (depth * tv)];
  if (Math.abs(sx) <= margin && Math.abs(sy) <= margin && z > 0) return p;
  const [cx, cy] = [Math.max(-margin, Math.min(margin, sx)) * th, Math.max(-margin, Math.min(margin, sy)) * tv];
  const k = r / Math.hypot(cx, cy, 1);
  return worldOf(pose, cx * k, cy * k, k);
}
