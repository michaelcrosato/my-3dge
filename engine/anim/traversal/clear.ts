/**
 * @file Keeping a traversing body's legs out of the wall it traverses (PLAN.md WP 13.11, docs/PLAYGROUND.md §5.1), for
 * the traversal plant (engine/anim/traversal/plant.ts) after each leg's solve:
 * - the wall (`faceOf`): a mantle's face under its lip, a low ledge's too (a point on it, its normal out toward the
 *   body, the lip's height as its top), or a climb's wall, a skin off the hull's front where it last climbed
 *   (`TraversalPose.wallAt`, kept while the body is near it and takes no other way, `walled`); a wall reaches
 *   `CLEAR.deep` past its face, so a fence's far side, open ground, is never in it;
 * - a solved leg kept off it (`clearLeg`): its toes' tip moved out with the foot, then its knee kept `CLEAR.knee` off
 *   it until the kneecap clears the top, swung out to its side (and up over the lip once the hip is over it), each no
 *   further than that takes (so the swing grows smoothly as a foot steps up the face), and a leg that clears it is
 *   left exactly as it was;
 * - a solved arm kept off it (`clearArm`): its elbow `CLEAR.elbow` off it, swung down, out and back; and a hand on its
 *   way to a contact kept in front of the face until it rises over the top (`keepOff`), so a reach for a lip goes up
 *   the face, never through it.
 *
 * Invariants: presentation only: it writes the pose through the caller's solve and reads world joints; pure but for
 * that, and the scratch vectors here.
 *
 * @example
 * import { Vector3 } from '../../core/math';
 * import { getBuild } from '../builds';
 * import { TraversalPose } from './pose';
 * const traversal = new TraversalPose();
 * const grab = { mode: 'mantle', mantle: 'grab', mantleLeft: 20, mantleTotal: 27, lipX: 0, lipY: 2, lipZ: 0.87, wallX: 0, wallZ: -1, fromY: 0 };
 * const feet = new Vector3(0, 0.5, 0.43);
 * traversal.update(grab, null, { radius: 0.41, skin: 0.01, hang: 2.032, rung: 0.3 }, getBuild('build:adult'), feet, null, 1 / 60);
 * const face = faceOf(traversal, { point: new Vector3(), nx: 0, nz: 1, top: 0 })!; // its face at z 0.85, 2 m high
 * inside(face, new Vector3(0, 1, 0.9), CLEAR.knee); // 0.11: 5 cm past the face, short of 6 cm off it
 * // after a leg's solve: clearLeg(animator, 'L', target, pole, (towards) => twoBoneRot(…, { pole: towards }), face)
 * @see engine/anim/traversal/plant.test.ts
 */
import { MathUtils, Vector3 } from '../../core/math';
import { B, sideSign, type LimbSide } from '../authoring';
import type { Animator } from '../character';
import { jointPosition, tipPosition } from '../fk';
import type { TraversalPose } from './pose';

/** The clearances: metres off the wall, a share of the leg, and how far a fix may go. */
export const CLEAR = {
  toes: 0.01, // m: a toe's tip is kept this far off the wall
  knee: 0.06, // m: a knee this far (its joint: the kneecap stands in front of it, and over the top this far)
  elbow: 0.03, // m: an elbow this far, under the top and over it
  swing: 4, // the most a knee's or an elbow's pole turns away: this times the pole's length
  deep: 0.45, // m: how far past its face a wall reaches (the playground's thinnest, a fence, is 0.5 m)
} as const;

/** A wall the legs keep out of: a point on its face, its normal across the ground out toward the body, its top. */
export interface Face {
  readonly point: Vector3;
  nx: number;
  nz: number;
  top: number;
}

const v = Array.from({ length: 3 }, () => new Vector3());

/** The wall a traversal's legs keep out of now, written into `out`: a mantle's face under its lip, a climb's; else null. */ // prettier-ignore
export function faceOf(t: TraversalPose, out: Face): Face | null {
  const mantle = t.lastView('mantle');
  if (mantle && mantle.mantle !== 'none') {
    [out.nx, out.nz, out.top] = [mantle.wallX ?? 0, mantle.wallZ ?? 0, mantle.lipY ?? 0];
    out.point.set((mantle.lipX ?? 0) + out.nx * 2 * t.hull.skin, 0, (mantle.lipZ ?? 0) + out.nz * 2 * t.hull.skin);
    return out;
  }
  if (!(t.weights.climb > 0) && !t.walled) return null;
  [out.nx, out.nz, out.top] = [t.wall[0], t.wall[1], Infinity];
  out.point.copy(t.wallAt);
  return out;
}

/** How far `p` stands inside `face`, short of `margin` off it, under its top and `rise` over it: 0 when clear. */
export function inside(face: Face, p: Vector3, margin: number, rise = -0.01): number {
  const out = (p.x - face.point.x) * face.nx + (p.z - face.point.z) * face.nz;
  if (!(p.y < face.top + rise) || out < -CLEAR.deep) return 0;
  return Math.max(0, margin - out);
}

/** Moves `p` out to `margin` off `face` where it stands inside that under the top; returns it. */
export function keepOff(face: Face, p: Vector3, margin: number): Vector3 {
  const depth = inside(face, p, margin, 0);
  return depth > 0 ? p.set(p.x + face.nx * depth, p.y, p.z + face.nz * depth) : p;
}

/** The least `x` in 0 to `most` for which `clear(x)` holds (bisected), applied last; false when even `most` fails. */
function least(most: number, clear: (x: number) => boolean): boolean {
  if (!clear(most)) return false;
  let [lo, hi] = [0, most];
  for (let i = 0; i < 8; i++) {
    const mid = (lo + hi) / 2;
    if (clear(mid)) hi = mid;
    else lo = mid;
  }
  clear(hi);
  return true;
}

/**
 * Keeps leg `side`, solved to `target` with its knee toward `pole`, out of `face` under its top (see the file
 * comment): moves `target` and re-solves with `solve` as it needs, leaving a leg that clears it alone.
 */
export function clearLeg(
  animator: Animator,
  side: LimbSide,
  target: Vector3,
  pole: Vector3,
  solve: (pole: Vector3) => unknown,
  face: Face,
): void {
  const { skeleton, pose, world } = animator.body;
  const toes = inside(face, tipPosition(skeleton, world, `toe${side}`, v[0]), CLEAR.toes);
  if (toes > 0) {
    target.set(target.x + face.nx * toes, target.y, target.z + face.nz * toes);
    solve(pole);
  }
  const knee = () => inside(face, jointPosition(world, `shin${side}`, v[0]), CLEAR.knee, CLEAR.knee);
  if (!(knee() > 0)) return;
  const over = MathUtils.smoothstep(jointPosition(world, `thigh${side}`, v[0]).y - face.top, 0, 0.3); // the hip over the lip
  const out = B(0, sideSign(side) * MathUtils.lerp(1, 0.6, over), MathUtils.lerp(0.3, 1, over), v[1]).applyQuaternion(pose.rootRot); // prettier-ignore
  least(CLEAR.swing, (k) => {
    solve(v[2].copy(pole).addScaledVector(out, k).normalize());
    return !(knee() > 0);
  });
}

/**
 * Keeps arm `side`, solved with its elbow toward `pole`, out of `face` (see the file comment): swings the elbow down,
 * out and back and re-solves with `solve` as it needs, leaving an arm that clears it alone.
 */
export function clearArm(
  animator: Animator,
  side: LimbSide,
  pole: Vector3,
  solve: (pole: Vector3) => unknown,
  face: Face,
): void {
  // prettier-ignore
  const { pose, world } = animator.body;
  const elbow = () => inside(face, jointPosition(world, `forearm${side}`, v[0]), CLEAR.elbow, CLEAR.elbow);
  if (!(elbow() > 0)) return;
  const away = B(-0.4, sideSign(side) * 0.6, -1, v[1])
    .applyQuaternion(pose.rootRot)
    .normalize();
  least(CLEAR.swing, (k) => {
    solve(v[2].copy(pole).addScaledVector(away, k).normalize());
    return !(elbow() > 0);
  });
}
