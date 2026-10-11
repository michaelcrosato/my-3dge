/**
 * @file A training dummy (PLAN.md WP 6.1, §6.2 fixtures): a neutral target that takes hits, so tests can show moves
 * connecting. A post standing at a point, with an upright hurt capsule, that logs every hit it takes (which move, on
 * which tick, how hard it was pushed) and wobbles away from each push on a damped spring, settling back upright. No
 * game content: no health, no damage, no reaction beyond the wobble.
 *
 * Invariants: lengths in metres, +Y up; plain numbers and vectors, stepped at a fixed step. The geometry here
 * (`segmentDistance`, `sweepTouches`) is test geometry, enough to show a sweep crossing the capsule; the engine's hit
 * queries arrive in WP 6.3.
 *
 * @example
 * import { Vector3, type Sweep } from '../../../engine/sim-api';
 * const dummy = createDummy(new Vector3(0, 0, 1));
 * hitDummy(dummy, { move: 'move:jab', tick: 3, push: new Vector3(0, 0, 2) });
 * stepDummy(dummy, 1 / 60);
 * dummy.hits.length; // 1
 * dummy.lean.z > 0; // true: it rocks away from the hit, then settles
 * @see fixtures/rigs/dummy/index.test.ts
 */
import { Vector3, type Sweep } from '../../../engine/sim-api';

/** A hit the dummy took. */
export interface DummyHit {
  /** The move that hit it. */
  readonly move: string;
  /** The tick it landed on. */
  readonly tick: number;
  /** The push it gave, m/s (engine/anim/moves.ts `knockbackVelocity`). */
  readonly push: Vector3;
}

/** A training dummy: where it stands, its hurt capsule, the hits it took and its wobble. */
export interface Dummy {
  /** The foot of its post, world metres. */
  readonly position: Vector3;
  /** The capsule's radius, metres. */
  readonly radius: number;
  /** The capsule's height, ground to top, metres. */
  readonly height: number;
  /** Every hit, in order. */
  readonly hits: DummyHit[];
  /** How far its top leans from upright, metres (horizontal). */
  readonly lean: Vector3;
  /** How fast its top moves, m/s. */
  readonly velocity: Vector3;
}

/** The wobble: a stiff, well-damped spring (per second squared, per second), and the share of a push it takes. */
export const WOBBLE = { stiffness: 120, damping: 14, give: 0.05 } as const;

/** A dummy standing at `at`: a person-sized capsule unless `options` say otherwise. */
export function createDummy(at: Vector3, options: { radius?: number; height?: number } = {}): Dummy {
  const { radius = 0.25, height = 1.7 } = options;
  return { position: at.clone(), radius, height, hits: [], lean: new Vector3(), velocity: new Vector3() };
}

/** Logs `hit` and rocks the dummy away by its push. */
export function hitDummy(dummy: Dummy, hit: DummyHit): void {
  dummy.hits.push({ ...hit, push: hit.push.clone() });
  dummy.velocity.x += hit.push.x * WOBBLE.give * 10;
  dummy.velocity.z += hit.push.z * WOBBLE.give * 10;
}

/** One fixed step of the wobble. */
export function stepDummy(dummy: Dummy, dt: number): void {
  const { lean, velocity } = dummy;
  velocity.addScaledVector(lean, -WOBBLE.stiffness * dt).multiplyScalar(Math.max(0, 1 - WOBBLE.damping * dt));
  velocity.y = 0;
  lean.addScaledVector(velocity, dt);
}

/** The capsule's axis: its bottom and top centres. */
export function dummyAxis(dummy: Dummy, bottom = new Vector3(), top = new Vector3()): [Vector3, Vector3] {
  bottom.copy(dummy.position).add(new Vector3(0, dummy.radius, 0));
  top
    .copy(dummy.position)
    .add(new Vector3(0, dummy.height - dummy.radius, 0))
    .add(dummy.lean);
  return [bottom, top];
}

/** The closest distance between segments p1q1 and p2q2 (Ericson, Real-Time Collision Detection, 5.1.9). */
export function segmentDistance(p1: Vector3, q1: Vector3, p2: Vector3, q2: Vector3): number {
  const d1 = new Vector3().subVectors(q1, p1);
  const d2 = new Vector3().subVectors(q2, p2);
  const r = new Vector3().subVectors(p1, p2);
  const [a, e, f] = [d1.dot(d1), d2.dot(d2), d2.dot(r)];
  let [s, t] = [0, 0];
  if (a <= 1e-12 && e <= 1e-12) return p1.distanceTo(p2);
  if (a <= 1e-12) t = Math.min(1, Math.max(0, f / e));
  else {
    const c = d1.dot(r);
    if (e <= 1e-12) s = Math.min(1, Math.max(0, -c / a));
    else {
      const b = d1.dot(d2);
      const denom = a * e - b * b;
      s = denom > 1e-12 ? Math.min(1, Math.max(0, (b * f - c * e) / denom)) : 0;
      t = (b * s + f) / e;
      if (t < 0) [t, s] = [0, Math.min(1, Math.max(0, -c / a))];
      else if (t > 1) [t, s] = [1, Math.min(1, Math.max(0, (b - c) / a))];
    }
  }
  return p1.clone().addScaledVector(d1, s).distanceTo(p2.clone().addScaledVector(d2, t));
}

/** Whether `sweep` crosses the dummy's capsule: the quad it swept, as `slices` segments across it, within reach. */
export function sweepTouches(dummy: Dummy, sweep: Sweep, slices = 8): boolean {
  const [bottom, top] = dummyAxis(dummy);
  const [base, tip] = [new Vector3(), new Vector3()];
  for (let i = 0; i <= slices; i++) {
    base.lerpVectors(sweep.base0, sweep.base1, i / slices);
    tip.lerpVectors(sweep.tip0, sweep.tip1, i / slices);
    if (segmentDistance(base, tip, bottom, top) <= dummy.radius) return true;
  }
  return segmentDistance(sweep.tip0, sweep.tip1, bottom, top) <= dummy.radius;
}
