/**
 * @file Camera blends (PLAN.md WP 13.8, docs/PLAYGROUND.md §4; doctrine: Common ground): a switch from one camera to
 * another moves the picture there over `BLEND_TIME` seconds instead of cutting, as Cinemachine's blends do.
 * `blendCameras(a, b, w)` is the pose `w` of the way from `a` to `b`, `blendWeight(t, time)` the eased share of a blend
 * `t` seconds in (a smoothstep), `blendGap(a, b, from, to)` how far and how much a blend's own progress moves the
 * picture between two weights, which the camera metrics allow it (engine/dev/feel/camera.ts).
 *
 * A pose blends about what it looks at: its target (`poseTarget`) moves on a straight line, its heading the short way
 * round, its pitch, roll, distance, lens, zoom, boost and planes in step, and the camera stands `distance` back from
 * the target along the blended view, so a view turned about its target swings round it. Orthographic and perspective
 * meet at a matched frustum: an orthographic pose blends as the perspective one on its line of sight with a
 * `BLEND_LENS` lens that frames the same height at its target (`perspectiveFrom`), so the first and last frames of a
 * blend are its ends and the projection changes where the pictures agree.
 *
 * Invariants: pure; `blendCameras(a, b, 0)` is `a` and `blendCameras(a, b, 1)` is `b`, the very poses; two orthographic
 * poses blend orthographic, any other pair perspective.
 *
 * @example
 * import { makePose } from './pose';
 * const a = makePose({ position: [0, 0, -10], yaw: 0, distance: 10 }); // looking at the origin from the south
 * const b = makePose({ position: [10, 0, 0], yaw: -Math.PI / 2, distance: 10 }); // and from the east
 * blendCameras(a, b, 0.5).position; // [7.07…, 0, -7.07…]: halfway round the origin, still 10 m from it
 * blendWeight(0.175, BLEND_TIME); // 0.5
 * @see engine/gfx/cameras/blend.test.ts
 */
import { MathUtils } from '../../core/math';
import { makePose, perspectiveFrom, poseForward, poseTarget, wrapAngle, type CameraPose, type Vec3 } from './pose';

/** How long a switch blends, real seconds. */
export const BLEND_TIME = 0.35;
/** The lens an orthographic pose blends with, degrees: narrow, so the swap of projections barely shows. */
export const BLEND_LENS = 20;

/** The eased share of a blend `t` seconds into `time` (a smoothstep; 1 when `time` is 0). */
export function blendWeight(t: number, time: number): number {
  return time > 0 ? MathUtils.smoothstep(t / time, 0, 1) : 1;
}

/** `pose` as perspective: an orthographic one on its line of sight, with a `BLEND_LENS` lens framing its picture. */
function asPerspective(pose: CameraPose): CameraPose {
  if (pose.projection === 'perspective') return pose;
  const { position, yaw, pitch } = perspectiveFrom(pose, BLEND_LENS);
  const distance = Math.hypot(...position.map((p, i) => poseTarget(pose)[i] - p));
  return makePose({ ...pose, position, yaw, pitch, projection: 'perspective', fov: BLEND_LENS, zoom: 1, distance, far: Math.max(pose.far, distance * 4) }); // prettier-ignore
}

const mix = (a: number, b: number, w: number) => a + (b - a) * w;

/** The pose `w` (0 to 1) of the way from `a` to `b` (see the file comment). */
export function blendCameras(a: CameraPose, b: CameraPose, w: number): CameraPose {
  if (w <= 0) return a;
  if (w >= 1) return b;
  const ortho = a.projection === 'orthographic' && b.projection === 'orthographic';
  const [p, q] = ortho ? [a, b] : [asPerspective(a), asPerspective(b)];
  const [ta, tb] = [poseTarget(p), poseTarget(q)];
  const target: Vec3 = [mix(ta[0], tb[0], w), mix(ta[1], tb[1], w), mix(ta[2], tb[2], w)];
  const yaw = wrapAngle(p.yaw + wrapAngle(q.yaw - p.yaw) * w);
  const pitch = mix(p.pitch, q.pitch, w);
  const distance = mix(p.distance, q.distance, w);
  const [fx, fy, fz] = poseForward({ yaw, pitch });
  return makePose({
    position: [target[0] - fx * distance, target[1] - fy * distance, target[2] - fz * distance],
    yaw,
    pitch,
    roll: mix(p.roll, q.roll, w),
    projection: ortho ? 'orthographic' : 'perspective',
    fov: mix(p.fov, q.fov, w),
    frustumSize: mix(p.frustumSize, q.frustumSize, w),
    zoom: mix(p.zoom, q.zoom, w),
    near: mix(p.near, q.near, w),
    far: mix(p.far, q.far, w),
    boost: mix(p.boost, q.boost, w),
    distance,
  });
}

/** The angle between two poses' view directions, rad. */
export function turnBetween(a: CameraPose, b: CameraPose): number {
  const [u, v] = [poseForward(a), poseForward(b)];
  const cross = Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]);
  return Math.atan2(cross, u[0] * v[0] + u[1] * v[1] + u[2] * v[2]);
}

/** How far (m) and how much (rad) the blend from `a` to `b` moves the picture from weight `from` to weight `to`. */
export function blendGap(a: CameraPose, b: CameraPose, from: number, to: number): { move: number; turn: number } {
  const [p, q] = [blendCameras(a, b, from), blendCameras(a, b, to)];
  const move = Math.hypot(...q.position.map((x, i) => x - p.position[i]));
  return { move, turn: turnBetween(p, q) };
}
