/**
 * @file The view's traversal poses (PLAN.md WP 13.11, docs/PLAYGROUND.md §5.1): `TraversalPose` follows what the
 * shooter model's state says the body does (`TraversalView`, engine/anim/traversal/contacts.ts) once a sim step and
 * eases a weight for each way it traverses (`TRAVERSALS`): a mantle (the grab, the hang, the pull, a low ledge
 * vaulted at a run with one hand), a wall-climb, a ladder, a zipline, a skydive (its spread glide, its dive, its
 * landing pose) and a slide-jump. `targets(feet, …)` says, at pose time and with the body's drawn feet, where each
 * hand and foot goes for the ways that hold it on something (contacts.ts), how much (0 to 1) and whether it is on its
 * contact; engine/anim/traversal/plant.ts poses the rest of the body and solves the limbs to them.
 *
 * - A mantle's hands hold the lip as `mantleHold` says; a low ledge is vaulted when the body came at it faster than
 *   `TRAVERSAL.vaultSpeed` across the ground.
 * - A wall-climb's holds are taken where the body is as each limb's move ends (`climbCycle`) and kept there.
 * - A ladder's limbs are on its rungs by the drawn feet's height (`ladderLimb`), so the cycle follows the body.
 * - A zipline's hands are on the cable over the drawn feet; the legs swing back as the ride speeds up (`swing`).
 * - A skydive dives as it falls faster (`dive`, from the glide's 20 m/s to the dive's 35 m/s) and stands up into
 *   its landing pose (`landing`).
 *
 * Invariants: presentation only: nothing here is stepped by the sim or saved; a body that never traverses has every
 * weight 0 and changes nothing. The weights ease at `TRAVERSAL_POSE.ease`, so a change of mode never pops.
 *
 * @example
 * import { Vector3 } from '../../core/math';
 * import { getBuild } from '../builds';
 * const pose = new TraversalPose();
 * const hull = { radius: 0.41, skin: 0.01, hang: 2.032, rung: 0.3 };
 * const view = { mode: 'zipline', rideDir: 1 };
 * const ride = { zipline: { from: [0, 6, 0], to: [0, 4, 20] } };
 * for (let i = 0; i < 30; i++) pose.update(view, ride, hull, getBuild('build:adult'), new Vector3(0, 3, 5), null, 1 / 60);
 * pose.weights.zipline; // 1
 * @see engine/anim/traversal/pose.test.ts
 */
import { approach, MathUtils, Vector3 } from '../../core/math';
import type { Build } from '../builds';
import { PROPORTIONS } from '../skeleton';
import type { BodyView } from '../locomotion/motion';
import {
  cableGrips,
  climbCycle,
  climbHoldHeight,
  ladderLimb,
  lowPull,
  mantleGrips,
  mantleHold,
  TRAVERSAL,
  wallPoint,
  type HullView,
  type Limb,
  type RideView,
  type TraversalView,
} from './contacts';
import { layTarget, type LimbTarget } from './limbTargets';

/** The ways a body traverses, each with its own eased weight. */
export const TRAVERSALS = ['mantle', 'climb', 'ladder', 'zipline', 'skydive', 'slideJump'] as const;

/** One of `TRAVERSALS`. */
export type Traversal = (typeof TRAVERSALS)[number];

/** The poses' rates (per second) and speeds (m/s). */
export const TRAVERSAL_POSE = {
  ease: 12, // a way's weight eases in and out at this: about 0.08 s; a zipline's at `cable`, the hands reaching higher
  cable: 7.5,
  glide: 20, // a skydive's fall at its glide and at its dive (the model's `skydive`)
  dive: 35,
  dives: 4, // the dive's and the landing pose's rate
  swing: 5, // a zipline's legs: the rate they follow the ride's acceleration, and the most they swing (rad)
  swingMax: 0.5,
  teleport: 1, // m: a body moved this far in a step was placed there: it lets go of everything at once
  settle: 150, // m/s²: the most the body's reach toward a ledge's lip changes its speed as it eases back
  hang: 5, // a mantle hang's rate: the body eases under its hands, and back as it goes on
  walled: 0.35, // m: a climb's wall stays the body's while its front is within this of it, after it lets go
} as const;

/** A climb's hold for one limb: the cycle it was taken in, and where. */
interface Hold {
  n: number;
  point: Vector3;
}

const LIMBS = [0, 1, 2, 3] as const;

/** What a mode is, for `TRAVERSALS`; null on the ground and in the air. */
function traversalOf(view: TraversalView | null): Traversal | null {
  const mode = view?.mode;
  return mode === 'mantle' || mode === 'climb' || mode === 'ladder' || mode === 'zipline' || mode === 'skydive' ? mode : null; // prettier-ignore
}

/** The view's eased traversal of one body (see the file comment). */
export class TraversalPose {
  /** Each way's weight now, 0 to 1. */
  // Stryker disable next-line ObjectLiteral: its feet start out of reach (#feet at infinity), so the first update sets every weight
  readonly weights: Record<Traversal, number> = { mantle: 0, climb: 0, ladder: 0, zipline: 0, skydive: 0, slideJump: 0 }; // prettier-ignore
  /** The last state, ride and hull it followed. */
  view: TraversalView | null = null;
  ride: RideView = {};
  hull: HullView = { radius: 0.41, skin: 0.01, hang: 2.032, rung: 0.3 };
  /** The shoulders' height over the feet and their width, and its toes' reach ahead of a sole's contact (m), from the body's build. */ // prettier-ignore
  shoulder = 1.48;
  width = 0.4;
  toes = 0.18;
  /** The mantle playing is a low ledge vaulted, one hand on its top. */
  // Stryker disable next-line BooleanLiteral: each mantle sets it as it begins, and only a mantle reads it
  vault = false;
  /** A skydive's dive (0 its glide, 1 its dive) and its landing pose, 0 to 1. */
  dive = 0;
  landing = 0;
  /** A zipline's legs, swung back as the ride speeds up (rad). */
  swing = 0;
  /** The wall a climb is on, across the ground, out toward the body, and a point on its face where it last climbed. */
  // Stryker disable next-line ArrayDeclaration: a climb sets it before its own reads, and the walled check needs a climb first
  readonly wall: [number, number] = [0, 1];
  readonly wallAt = new Vector3();
  #walled = false;
  /**
   * How far the body is drawn toward a ledge's lip so its hands reach it (world m): it follows what they need at once
   * and back as they let go, its speed changing smoothly (`TRAVERSAL_POSE.settle`), so a hop never snaps the body up.
   */
  readonly reach = new Vector3();
  readonly #reachSpeed = new Vector3();
  readonly #holds: Hold[] = Array.from({ length: 4 }, () => ({ n: NaN, point: new Vector3() }));
  /** Each way's last points for each limb, its own weights and whether each was on its contact. */
  readonly #kept = Object.fromEntries(TRAVERSALS.map((t) => [t, { points: LIMBS.map(() => new Vector3()), weights: [0, 0, 0, 0], held: [false, false, false, false] }])) as Record<Traversal, { points: Vector3[]; weights: number[]; held: boolean[] }>; // prettier-ignore
  #speed = 0;
  #sliding = false;
  /** A climb rising (else it slides down the wall, slowing a fall it caught). */
  // Stryker disable next-line BooleanLiteral: the slide check reads it only after a climb's step, which set it
  #rising = true;
  #rideSpeed = 0;
  /** How far the body hangs under its hands (a mantle hang), 0 to 1. */
  #hanging = 0;
  readonly #feet = new Vector3(Infinity, 0, 0);
  /** The last state each way saw while it was the body's mode. */
  readonly #views: Partial<Record<Traversal, TraversalView>> = {};

  /** Whether a climb's wall stands beside the body: climbing, or let go and still within `TRAVERSAL_POSE.walled` of it. */ // prettier-ignore
  get walled(): boolean {
    return this.#walled;
  }

  /** The way it traverses now, or null. */
  get traversal(): Traversal | null {
    return traversalOf(this.view);
  }

  /** The last state `way` saw while it was the body's mode (what a way easing out still shows), or null. */
  lastView(way: Traversal): TraversalView | null {
    return this.weights[way] > 0 ? (this.#views[way] ?? null) : null;
  }

  /** How much of the foot plant stays: all of it on the ground, else what the ways leave of the legs. */
  get plantShare(): number {
    return (this.view?.mode ?? 'ground') === 'ground' ? 1 : 1 - this.weight;
  }

  /** How much the ways hold the body now: their weights together, at most 1 (two cross-fading make one). */
  get weight(): number {
    return Math.min(
      1,
      TRAVERSALS.reduce((sum, t) => sum + this.weights[t], 0),
    );
  }

  /**
   * Follows `view` (null: no movement model) over `dt` seconds, one sim step: the body on `ride` with `hull`, its build
   * `build`, its feet at `feet` and its velocity `body`; returns itself.
   */
  update(
    view: TraversalView | null,
    ride: RideView | null,
    hull: HullView | null,
    build: Build,
    feet: Vector3,
    body: BodyView | null,
    dt: number,
  ): this {
    // prettier-ignore
    const P = TRAVERSAL_POSE;
    const now = traversalOf(view);
    const was = this.view?.mode;
    if (this.#feet.distanceTo(feet) > P.teleport) {
      for (const t of TRAVERSALS) this.weights[t] = 0; // placed, respawned
      this.reach.set(0, 0, 0);
      this.#walled = false;
    }
    this.#feet.copy(feet);
    if (now === 'mantle' && was !== 'mantle') this.vault = lowPull(view!) && (was === 'ground' || was === 'air') && this.#speed > TRAVERSAL.vaultSpeed; // prettier-ignore
    const jumped = this.#sliding && view?.mode === 'air' && (body?.vy ?? 0) > 0;
    const flying = view?.mode === 'air' && (jumped || this.weights.slideJump > 0);
    for (const t of TRAVERSALS) this.weights[t] = approach(this.weights[t], (t === 'slideJump' ? flying : t === now) ? 1 : 0, dt * (t === 'zipline' ? P.cable : P.ease)); // prettier-ignore
    this.view = view && { ...view }; // its own copy: the sim changes its state in place
    if (now && this.view) this.#views[now] = this.view;
    this.ride = ride ?? {};
    if (hull) this.hull = hull;
    this.shoulder = (build.hipHeight + build.torso) * build.size;
    this.width = 2 * build.shoulderHalf * build.size;
    this.toes = (1 - PROPORTIONS.contact) * build.footLength * build.size;
    this.#sliding = view?.sliding === true;
    if (body && now !== 'mantle') this.#speed = Math.hypot(body.vx, body.vz);
    const share = MathUtils.clamp((-(body?.vy ?? 0) - P.glide) / (P.dive - P.glide), 0, 1);
    if (now === 'skydive') {
      this.dive = approach(this.dive, share, dt * P.dives);
      this.landing = approach(this.landing, view?.landing === true ? 1 : 0, dt * P.dives);
    } else if (this.weights.skydive === 0) [this.dive, this.landing] = [0, 0]; // as it lands they hold
    const speed = view?.rideSpeed ?? 0;
    const accel = now === 'zipline' && dt > 0 ? (speed - this.#rideSpeed) / dt : 0;
    this.swing = approach(this.swing, MathUtils.clamp(-Math.atan(accel / 9.81), -P.swingMax, P.swingMax), dt * P.swing);
    this.#rideSpeed = now === 'zipline' ? speed : 0;
    const slid = was === 'climb' && !this.#rising; // the last step slid down this climb's wall
    this.#rising = (body?.vy ?? 0) > TRAVERSAL.rising;
    const off = this.hull.radius + this.hull.skin;
    if (now === 'climb') {
      this.#climb(view!, feet, slid);
      this.wallAt.set(feet.x - this.wall[0] * off, 0, feet.z - this.wall[1] * off);
      this.#walled = true;
    } else {
      for (const hold of this.#holds) hold.n = NaN;
      const front = (feet.x - this.wallAt.x) * this.wall[0] + (feet.z - this.wallAt.z) * this.wall[1] - off;
      if (front > P.walled || now !== null) this.#walled = false; // gone from its wall, or over it onto another way
    }
    this.#hanging = approach(this.#hanging, now === 'mantle' && view!.mantle === 'hang' ? 1 : 0, dt * P.hang);
    const need = now === 'mantle' ? this.#need(view!, feet, build).multiplyScalar(MathUtils.smoothstep(this.weights.mantle, 0, 1)) : NEED.set(0, 0, 0); // prettier-ignore
    this.#ease(need, dt);
    return this;
  }

  /**
   * How far the body must move toward the lip for the hands to reach it, as far as they hold it (see `reach`); a hang
   * moves it under them as far as it hangs: the shoulders `TRAVERSAL.hang` out from the lip, the arms near straight.
   */
  #need(view: TraversalView, feet: Vector3, build: Build): Vector3 {
    const grips = mantleGrips(view, this.width * TRAVERSAL.apart, GRIPS);
    const hold = mantleHold(view, this.vault, this.shoulder);
    const reach = (build.armUpper + build.armLower) * build.size * 0.97;
    const [rx, rz] = [(view.wallZ ?? 0) * (this.width / 2), -(view.wallX ?? 0) * (this.width / 2)]; // its right
    NEED.set(0, 0, 0);
    if (lowPull(view)) return NEED; // a low ledge's hands hold only while they reach
    for (const h of [0, 1] as const) {
      const shoulder = POINT.set(feet.x + (h ? rx : -rx), feet.y + this.shoulder, feet.z + (h ? rz : -rz));
      const to = shoulder.subVectors(grips[h], shoulder);
      const short = (to.length() - reach) * hold[h];
      if (short > NEED.length()) NEED.copy(to.normalize()).multiplyScalar(short);
    }
    if (this.#hanging > 0) {
      const [out, share] = TRAVERSAL.hang;
      const across = ((TRAVERSAL.apart - 1) * this.width) / 2; // each grip out past its shoulder along the lip
      const arm = share * Math.hypot(reach, PROPORTIONS.grip * build.handLength * build.size); // to the grip of a hand hooked over the lip
      const under = Math.sqrt(Math.max(0, arm * arm - out * out - across * across));
      const hung = POINT.addVectors(grips[0], grips[1]).multiplyScalar(0.5);
      hung.set(hung.x + (view.wallX ?? 0) * out - feet.x, hung.y - under - this.shoulder - feet.y, hung.z + (view.wallZ ?? 0) * out - feet.z); // prettier-ignore
      NEED.lerp(hung, MathUtils.smoothstep(this.#hanging, 0, 1));
    }
    return NEED;
  }

  /**
   * Moves `reach` toward `need`: at once when it needs more; else no faster than it can stop at `need` and with its
   * speed changing by at most `TRAVERSAL_POSE.settle` m/s² (a smooth release follows exactly, a sudden one eases).
   */
  #ease(need: Vector3, dt: number): void {
    if (need.length() >= this.reach.length() || !(dt > 0)) {
      this.reach.copy(need);
      this.#reachSpeed.set(0, 0, 0);
      return;
    }
    const a = TRAVERSAL_POSE.settle;
    const want = POINT.subVectors(need, this.reach);
    const gap = want.length();
    if (gap < 1e-9) return;
    const speed = Math.min(gap / dt, a * (Math.sqrt((dt * dt) / 4 + (2 * gap) / a) - dt / 2)); // and still stop there, step by step
    const change = want.multiplyScalar(speed / gap).sub(this.#reachSpeed);
    if (change.length() > a * dt) change.multiplyScalar((a * dt) / change.length());
    this.#reachSpeed.add(change);
    this.reach.addScaledVector(this.#reachSpeed, dt);
  }

  /**
   * Where each limb goes now (left hand, right hand, left foot, right foot) for the ways that hold it on something,
   * with the drawn feet at `feet` (world m), written into `out`; a limb no way holds weighs 0.
   */
  targets(feet: Vector3, out: readonly [LimbTarget, LimbTarget, LimbTarget, LimbTarget]): typeof out {
    const w = this.weights;
    for (const limb of out) [limb.weight, limb.held] = [0, false];
    const view = this.view;
    /**
     * Way `t`'s points: `fill` sets them while it is the body's mode (`set(limb, point, weight, held)`), and a way
     * easing out keeps the last it set, so letting go of a ledge or a ladder never drops a hand at once.
     */
    const way = (
      t: Traversal,
      now: boolean,
      fill: (set: (limb: Limb, point: Vector3, weight: number, held: boolean) => void) => void,
    ) => {
      // prettier-ignore
      if (!(w[t] > 0)) return;
      const kept = this.#kept[t];
      if (now) {
        kept.weights.fill(0);
        fill((limb, point, weight, held) => {
          kept.points[limb].copy(point);
          [kept.weights[limb], kept.held[limb]] = [weight, held];
        });
      }
      for (const limb of LIMBS) layTarget(out[limb], kept.points[limb], w[t] * kept.weights[limb], now && kept.held[limb]); // prettier-ignore
    };
    const mode = view?.mode;
    way('mantle', mode === 'mantle', (set) => {
      const grips = mantleGrips(view!, this.width * TRAVERSAL.apart, GRIPS);
      const hold = mantleHold(view!, this.vault, this.shoulder);
      set(0, grips[0], hold[0], true);
      set(1, grips[1], hold[1], true);
    });
    const cable = this.#views.zipline; // a zipline's hands stay over the head as it lets go: the grips follow the feet
    if (w.zipline > 0 && cable && mode !== 'zipline') this.#kept.zipline.points.forEach((p, k) => k < 2 && p.copy(cableGrips(cable, this.ride, this.hull, feet, GRIPS)[k])); // prettier-ignore
    way('zipline', mode === 'zipline', (set) => {
      const grips = cableGrips(view!, this.ride, this.hull, feet, GRIPS);
      set(0, grips[0], 1, true);
      set(1, grips[1], 1, true);
    });
    const ladder = this.ride.ladder;
    way('ladder', mode === 'ladder' && ladder !== undefined, (set) => {
      for (const limb of LIMBS) set(limb, POINT, 1, ladderLimb(ladder!, this.hull.rung, limb, feet, this.shoulder, POINT)); // prettier-ignore
    });
    way('climb', mode === 'climb', (set) => {
      const attach = view!.attachY ?? feet.y;
      if (!this.#rising) {
        for (const limb of LIMBS) set(limb, wallPoint(feet, this.wall, this.hull, limb, feet.y + (limb < 2 ? this.shoulder + TRAVERSAL.slide : TRAVERSAL.climbFoot), POINT, this.toes), 1, false); // prettier-ignore
        return;
      }
      for (const limb of LIMBS) {
        const hold = this.#holds[limb];
        if (Number.isNaN(hold.n)) continue;
        const { held, s } = climbCycle(limb, feet.y - attach);
        if (held) set(limb, hold.point, 1, true);
        else {
          const next = wallPoint(feet, this.wall, this.hull, limb, attach + climbHoldHeight(limb, hold.n + 1, this.shoulder), POINT, this.toes); // prettier-ignore
          next.sub(hold.point).multiplyScalar(s).add(hold.point);
          const arc = Math.sin(Math.PI * s) * TRAVERSAL.ladderArc[limb < 2 ? 0 : 1];
          [next.x, next.z] = [next.x + this.wall[0] * arc, next.z + this.wall[1] * arc];
          set(limb, next, 1, false);
        }
      }
    });
    return out;
  }

  /** Takes each limb's climb hold as its move ends, where the body is then, or where it slid to (see the file comment). */
  #climb(view: TraversalView, feet: Vector3, slid: boolean): void {
    const [nx, nz] = [view.wallX ?? 0, view.wallZ ?? 0];
    const length = Math.hypot(nx, nz);
    if (length > 1e-6) [this.wall[0], this.wall[1]] = [nx / length, nz / length];
    const attach = view.attachY ?? feet.y;
    for (const limb of LIMBS) {
      const hold = this.#holds[limb];
      if (!this.#rising) {
        hold.n = NaN;
        continue;
      }
      const { n, held } = climbCycle(limb, feet.y - attach);
      const taken = held ? n : n - 1; // moving: it still has the last cycle's hold
      if (hold.n === taken) continue;
      const first = Number.isNaN(hold.n); // caught moving: it reaches straight for the hold it is moving to
      if (first && slid) hold.point.copy(this.#kept.climb.points[limb]); // sliding, it takes its holds where it is
      else wallPoint(feet, this.wall, this.hull, limb, attach + climbHoldHeight(limb, first ? n : taken, this.shoulder), hold.point, this.toes); // prettier-ignore
      hold.n = taken;
    }
  }
}

const GRIPS: [Vector3, Vector3] = [new Vector3(), new Vector3()];
const POINT = new Vector3();
const NEED = new Vector3();
