/**
 * @file The math every layer shares (PLAN.md §6.1; doctrine: Common ground): three.js's math classes, re-exported
 * from `three/webgpu` so there is one set of math types and one entry point, plus what three.js lacks: my-3d2dge's
 * angle helpers (`angDiff`, `lerpAng`, `approach`, `approachAng`), `smoothDamp`, the easing curves (`ease`) and the
 * swing-twist decomposition. `MathUtils` already covers `clamp`, `lerp`, `damp`, `smoothstep` and degree
 * conversions: use it rather than writing them again.
 *
 * Invariants: angles are radians; `angDiff` and `lerpAng` take the short way round. Each port is the source's
 * formula, so it gives the source's bits: the reference vectors check that exactly, though PLAN.md WP 1.1 allows the
 * angle helpers 1e-12. This is the only engine file that imports three.js outside gfx/, and it takes nothing but the
 * math classes (ESLint's layer rules, `THREE_MATH`). Sim-side code may call all of it: inside `withSimMath` the
 * `Math.sin`, `cos` and `pow` that three.js and `ease` call are the fdlibm ports (engine/core/simMath.ts).
 *
 * Carried from `my-3d2dge:engine/my-3d2dge.js:74` (`approach`, `ease`, `angDiff`, `lerpAng`, `approachAng`,
 * `smoothDamp`).
 *
 * @example
 * angDiff(3, -3); // 0.28318530717958623: the short way round
 * const yaw = approachAng(0, Math.PI, 0.1); // 0.1
 * const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.5);
 * const twist = swingTwist(q, new Vector3(0, 1, 0), new Quaternion(), new Quaternion()); // 0.5
 * MathUtils.clamp(ease.outBack(0.5), 0, 1); // 1
 * @see engine/core/math.test.ts
 */
import { Quaternion, Vector3 } from 'three/webgpu';

/** three.js's 3D vector: positions, directions, velocities (metres, +Y up). */
export { Vector3 } from 'three/webgpu';
/** three.js's quaternion: every rotation in the engine. */
export { Quaternion } from 'three/webgpu';
/** three.js's 4×4 matrix: transforms. */
export { Matrix4 } from 'three/webgpu';
/** three.js's Euler angles (radians, an axis order). */
export { Euler } from 'three/webgpu';
/** three.js's axis-aligned box. */
export { Box3 } from 'three/webgpu';
/** three.js's sphere. */
export { Sphere } from 'three/webgpu';
/** three.js's ray: an origin and a unit direction. */
export { Ray } from 'three/webgpu';
/** three.js's plane: a unit normal and a constant. */
export { Plane } from 'three/webgpu';
/** three.js's colour (linear RGB floats inside; a hex given to it is sRGB). engine/core/color.ts builds on it. */
export { Color } from 'three/webgpu';
/** three.js's scalar helpers: `clamp`, `lerp`, `damp`, `smoothstep`, `degToRad`, `euclideanModulo` and more. */
export { MathUtils } from 'three/webgpu';

/** A full turn, 2π. */
const TAU = Math.PI * 2;

/** `a` moved toward `b` by at most `step` (≥ 0), never past it. */
export function approach(a: number, b: number, step: number): number {
  return a < b ? Math.min(b, a + step) : Math.max(b, a - step);
}

/** The signed angle from `a` to `b` the short way round, in [−π, π). */
export function angDiff(a: number, b: number): number {
  return ((((b - a + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
}

/** The angle `t` of the way from `a` to `b`, the short way round (`t` = 1 lands on `b` plus whole turns). */
export function lerpAng(a: number, b: number, t: number): number {
  return a + angDiff(a, b) * t;
}

/** The angle `a` turned toward `b` by at most `step` (≥ 0) the short way round; exactly `b` once within reach. */
export function approachAng(a: number, b: number, step: number): number {
  const d = angDiff(a, b);
  return Math.abs(d) <= step ? b : a + Math.sign(d) * step;
}

/**
 * A critically damped spring toward `target` (Game Programming Gems 4's, as Unity's `SmoothDamp`): reaches it in
 * about `smoothTime` seconds without overshoot. Returns `[value, velocity]`; pass the velocity back in next step.
 */
export function smoothDamp(
  current: number,
  target: number,
  velocity: number,
  smoothTime: number,
  dt: number,
): [number, number] {
  const omega = 2 / smoothTime;
  const x = omega * dt;
  const decay = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = current - target;
  const temp = (velocity + omega * change) * dt;
  return [target + (change + temp) * decay, (velocity - omega * temp) * decay];
}

/**
 * Easing curves over u in [0, 1], each 0 at 0 and 1 at 1: `outCubic`, `outQuad`, `inQuad`, `inOut` (quadratic in and
 * out) and `outBack`, which overshoots to about 1.12 at u ≈ 0.55 (c1 = 1.9; easings.net's easeOutBack uses 1.70158).
 */
export const ease = {
  outCubic: (u: number): number => 1 - Math.pow(1 - u, 3),
  outQuad: (u: number): number => 1 - (1 - u) * (1 - u),
  inQuad: (u: number): number => u * u,
  inOut: (u: number): number => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2),
  outBack: (u: number): number => {
    const c1 = 1.9;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2);
  },
};

const projected = new Vector3();
const inverseTwist = new Quaternion();

/**
 * Splits the rotation `q` into a twist about the unit vector `axis` and a swing about an axis perpendicular to it,
 * with `q = swing · twist` (twist applied first): a joint's roll and its bend. Writes both into the targets and
 * returns the twist angle in (−π, π]. When `q` turns `axis` half a turn the twist is undefined; it is then identity.
 */
export function swingTwist(q: Quaternion, axis: Vector3, swing: Quaternion, twist: Quaternion): number {
  const dot = q.x * axis.x + q.y * axis.y + q.z * axis.z;
  projected.copy(axis).multiplyScalar(dot);
  twist.set(projected.x, projected.y, projected.z, q.w);
  if (twist.lengthSq() < 1e-24) twist.identity();
  else twist.normalize();
  swing.copy(q).multiply(inverseTwist.copy(twist).invert());
  const angle = 2 * Math.atan2(twist.x * axis.x + twist.y * axis.y + twist.z * axis.z, twist.w);
  return angle > Math.PI ? angle - TAU : angle <= -Math.PI ? angle + TAU : angle;
}
