/**
 * @file Animation metrics on a feel course (PLAN.md WP 13.4, docs/PLAYGROUND.md §5.1 and §9.1): `createAnimTrack()`
 * poses an actor's animator as the page poses it (engine/gfx/puppets/actors.ts: its sim data loaded into an animator of
 * the track's own, its plants attached and laid as the page's are, engine/anim/bodyPlants.ts, the foot plant last in
 * the post slot, at the actor's feet and yaw, its movement shown, on the sim's ground through the query view) once a
 * step, and keeps its joints and sockets (engine/anim/stateMatrix.ts `RUN_POINTS`) with heights from the actor's feet
 * (for the pops), and its soles with heights from the ground the plant stood them on (`FootPlant.floorAt`, for the
 * slide), so a sole on a deck or a ramp stands on its floor as one on the ground does; off the ground (traversing,
 * flying) from the physics ground under them (WP 13.11). Over a range of frames it reads the anim QA's rules
 * (engine/anim/motionMetrics.ts): `footSlide`, the most a sole slides on the floor in one contact, and `pop`, the
 * largest one-step jump of a point against its neighbours (m; 0 when nothing qualifies); `handGap(point)`, the closest
 * either hand comes to a point (m); and `muzzle`, the farthest the gun hand's barrel line points from the aim while the
 * sights are fully up (rad, WP 13.20). §5.1's bounds: 5 cm of slide, no pop past the QA's 9/16 m, 3 cm from a contact,
 * the muzzle within 2° of the aim. Each frame keeps the eyes too (`eye(k)`), where the first-person camera stands, and
 * the last frame's body gives first person's arms their input (`armsInput`, engine/gfx/viewmodel/rig.ts `armsInputOf`:
 * the hands it holds on contacts, a carried gun, a kick).
 *
 * Invariants: posing never writes what the sim saves (engine/anim/character.ts), so measuring leaves a run's hash as it
 * is; the track keeps animators of its own, never the world's.
 *
 * @example
 * // const track = createAnimTrack(); after each step: track.frame(id, entity.animator, [x, y, z], yaw, dt);
 * // track.footSlide(1, 300); // the most a sole slid in one contact over frames 1–300, m
 * @see engine/dev/feel/anim.test.ts
 */
import { attachPlants, layPlants, type BodyPlants } from '../../anim/bodyPlants';
import { AnimatorPool, type Animator, type AnimatorData } from '../../anim/character';
import { getBuild } from '../../anim/builds';
import { jointPosition, jointRotation, socketPosition } from '../../anim/fk';
import { FOOT_PLANT, queryGround, type GroundQueries } from '../../anim/footPlant';
import { MovementPose, type BodyView, type MotionView } from '../../anim/locomotion/motion';
import type { HullView, RideView, TraversalView } from '../../anim/traversal/contacts';
import { HOLD, LookPose, type HeldLook, type HoldPlant, type Look } from '../../anim/traversal/hold';
import type { TraversalPlant } from '../../anim/traversal/plant';
import { TraversalPose } from '../../anim/traversal/pose';
import { motionTrack, worstPop, worstSlide } from '../../anim/motionMetrics';
import { JOINTS, SOCKETS } from '../../anim/skeleton';
import { RUN_POINTS } from '../../anim/stateMatrix';
import { MathUtils, Vector3 } from '../../core/math';
import { eyePoint } from '../../gfx/cameras/first';
import type { Vec3 } from '../../gfx/cameras/pose';
import { armsInputOf, type ArmsInput } from '../../gfx/viewmodel/rig';

/** The hands, as sockets: what `handGap` measures from. */
export const HAND_SOCKETS = ['weaponR', 'weaponL'] as const;

/** The soles, as sockets: what `footSlide` measures. */
const SOLES = ['contactL', 'contactR'] as const;

/** One posed frame: the points (heights from the feet), the soles (heights from the ground under them), the feet, and the hands and the eye in the world. */ // prettier-ignore
interface AnimFrame {
  points: Vector3[];
  soles: Vector3[];
  position: Vector3;
  hands: Vector3[];
  /** How far each hand held on its contact was from it (m); NaN for a hand holding none. */
  held: number[];
  eye: Vec3;
  /** How far the gun hand's barrel line pointed from the aim (rad), its sights fully up; NaN otherwise. */
  muzzle: number;
}

/**
 * How far the right hand's +Z, which the hold puts on the gun's barrel (engine/anim/traversal/hold.ts), points from
 * `look`'s aim (rad): its heading as far round as the hold turns the gun from the body's (`HOLD.yaw`), its pitch.
 */
function muzzleOff(animator: Animator, look: HeldLook): number {
  const heading = animator.body.yaw;
  const yaw = heading + MathUtils.clamp(Math.atan2(Math.sin(look.yaw - heading), Math.cos(look.yaw - heading)), -HOLD.yaw, HOLD.yaw); // prettier-ignore
  const aim = new Vector3(Math.sin(yaw) * Math.cos(look.pitch), Math.sin(look.pitch), Math.cos(yaw) * Math.cos(look.pitch)); // prettier-ignore
  return new Vector3(0, 0, 1).applyQuaternion(jointRotation(animator.body.world, 'handR')).angleTo(aim);
}

/** What a traversing body is on (the ride, its component: engine/anim/traversal/contacts.ts `rideOf`), its hull and its look. */ // prettier-ignore
export interface TrackTraverse {
  ride: RideView | null;
  hull: HullView | null;
  look?: Look | null;
}

/**
 * An animator posed once a step as the page poses it, and the anim QA's numbers over its frames; with the sim's
 * read-only `queries`, its feet stand on their ground as the page's do, and a sole's height is from the ground under it.
 */
export function createAnimTrack(where = 'feel', queries?: GroundQueries) {
  const pool = new AnimatorPool();
  const planted = new WeakMap<object, BodyPlants>();
  /** Each actor's last hold: a new one, made with its animator when the weapon changes, follows its draw. */
  const holds = new Map<number, HoldPlant>();
  const moving = new Map<number, MovementPose>();
  const traversing = new Map<number, TraversalPose>();
  const looking = new Map<number, LookPose>();
  const ground = queries ? queryGround(queries) : null;
  const frames: AnimFrame[] = [];
  let size = 1;
  /** The last frame's animator and its traversal plant: what first person's arms are posed from. */
  let last: { animator: Animator; traversal: TraversalPlant } | null = null;
  const hit = { point: new Vector3(), normal: new Vector3() };
  /** The ground under a sole, as the plant looks for it (`FOOT_PLANT.up` over it to `FOOT_PLANT.down` under); none: far below. */ // prettier-ignore
  const floorUnder = (p: Vector3) => {
    if (!ground) return -Infinity;
    const from = new Vector3(p.x, p.y + FOOT_PLANT.up, p.z);
    return ground(from, FOOT_PLANT.up + FOOT_PLANT.down, hit) ? hit.point.y : -Infinity;
  };
  /** Frames `from` to `to` (inclusive) as a track: every point, or `soles` only. */
  const track = (from: number, to: number, soles = false) => {
    const span = frames.slice(from, to + 1);
    const world = span.map((f) => (soles ? f.soles : f.points));
    const positions = span.map((f) => f.position);
    const names = soles ? SOLES : RUN_POINTS;
    return motionTrack({ where, size, names, world, positions, feet: soles ? [0, 1] : [] });
  };
  return {
    /** How many frames it holds. */
    get length() {
      return frames.length;
    },
    /**
     * Poses actor `id`'s animator `data` at `feet`, facing `yaw`, after a step of `dt` seconds, and keeps the frame;
     * `motion`, its movement model's state, and `body`, its velocity, gate the foot plant's locks and show the body's
     * movement as the page's puppets do (WP 13.10); with `traverse`, the ride it is on and its hull, its hands and
     * feet go on their contacts as the page's do (WP 13.11).
     */
    frame(
      id: number,
      data: Readonly<AnimatorData>,
      feet: readonly [number, number, number],
      yaw: number,
      dt: number,
      motion?: MotionView | null,
      body?: BodyView | null,
      traverse?: TrackTraverse,
    ): void {
      const animator = pool.get(id, data, { dt });
      let own = planted.get(animator);
      if (!own) {
        planted.set(animator, (own = attachPlants(animator, 'feel', holds.get(id))));
        holds.set(id, own.hold);
      }
      const { plant, traversal, hold } = own;
      const at = new Vector3(feet[0], feet[1], feet[2]);
      const travels = (traversing.get(id) ?? new TraversalPose()).update((motion as TraversalView | null) ?? null, traverse?.ride ?? null, traverse?.hull ?? null, animator.body.build, at, body ?? null, dt); // prettier-ignore
      traversing.set(id, travels);
      const look = (looking.get(id) ?? new LookPose()).update(traverse?.look ?? null, dt);
      looking.set(id, look);
      const shown = (moving.get(id) ?? new MovementPose()).update(motion, dt, body);
      moving.set(id, shown);
      layPlants(animator, own, { motion, shown, traversal: travels, look }, ground); // as the page lays them
      animator.pose({ at, yaw });
      last = { animator, traversal };
      const { skeleton, world } = animator.body;
      const joints = JOINTS.map((_, j) => jointPosition(world, j));
      const sockets = SOCKETS.map((name) => socketPosition(skeleton, world, name));
      const hands = HAND_SOCKETS.map((name) => socketPosition(skeleton, world, name));
      const held = [0, 1].map((h) => (traversal.limbs[h].held ? hands[1 - h].distanceTo(traversal.limbs[h].point) : NaN)); // prettier-ignore
      const grounded = !motion || (motion.mode ?? 'ground') === 'ground';
      const floor = (p: Vector3) => (grounded && plant.weight > 0 ? plant.floorAt(p.x, p.z) : floorUnder(p)); // off the ground, or the plant skipped: the real one
      const soles = SOLES.map((name) => socketPosition(skeleton, world, name)).map((p) => p.setY(p.y - floor(p)));
      const points = [...joints, ...sockets].map((p) => p.setY(p.y - feet[1]));
      const aimed = hold.holding && look.look !== null && look.look.raised >= 1 && look.look.weight >= 1 && hold.busy === 0; // prettier-ignore
      const muzzle = aimed ? muzzleOff(animator, look.look!) : Number.NaN;
      frames.push({ points, soles, position: new Vector3(feet[0], 0, feet[2]), hands, held, eye: eyePoint(skeleton, world), muzzle }); // prettier-ignore
      size = getBuild(data.build).size;
    },
    /** First person's arms' input off the last frame's body, for a frame with `frame`'s camera inputs; null before one. */
    armsInput(frame: Pick<ArmsInput, 'player' | 'effects' | 'aspect' | 'fov'>): ArmsInput | null {
      return last ? armsInputOf(last.animator, last.traversal, frame) : null;
    },
    /** Where frame `k`'s eyes are (world, m): where the first-person camera stands. */
    eye(k: number): Vec3 {
      return frames[k].eye;
    },
    /** The most a sole slid on the floor in one contact over frames `from` to `to` (m). */
    footSlide(from: number, to: number): number {
      return worstSlide(track(from, to, true))?.value ?? 0;
    },
    /** The largest one-step jump of a point against its neighbours over frames `from` to `to` (m). */
    pop(from: number, to: number): number {
      return worstPop(track(from, to))?.value ?? 0;
    },
    /**
     * The farthest a hand held on its contact (a lip, a rung, a hold on a wall, a cable, the floor under a hard
     * landing's hand) was from it over frames `from` to `to` (m; 0 when none held one), and how many hands' frames held.
     */
    handContact(from: number, to: number): { gap: number; held: number } {
      let [gap, held] = [0, 0];
      for (const f of frames.slice(from, to + 1)) for (const d of f.held) if (!Number.isNaN(d)) [gap, held] = [Math.max(gap, d), held + 1]; // prettier-ignore
      return { gap, held };
    },
    /**
     * The farthest the gun hand's barrel line pointed from the aim over frames `from` to `to` while its sights were fully
     * up and nothing held its hands (rad; 0 when it never aimed), and how many frames aimed.
     */
    muzzle(from: number, to: number): { angle: number; aimed: number } {
      let [angle, aimed] = [0, 0];
      for (const f of frames.slice(from, to + 1)) if (!Number.isNaN(f.muzzle)) [angle, aimed] = [Math.max(angle, f.muzzle), aimed + 1]; // prettier-ignore
      return { angle, aimed };
    },
    /** The closest either hand came to `point` (world, m) over frames `from` to `to` (m). */
    handGap(point: readonly [number, number, number], from: number, to: number): number {
      const at = new Vector3(point[0], point[1], point[2]);
      let gap = Infinity;
      for (const f of frames.slice(from, to + 1)) for (const hand of f.hands) gap = Math.min(gap, hand.distanceTo(at));
      return gap;
    },
  };
}

/** An animation track: what `createAnimTrack` returns. */
export type AnimTrack = ReturnType<typeof createAnimTrack>;
