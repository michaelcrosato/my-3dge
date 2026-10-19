/**
 * @file Animation metrics on a feel course (PLAN.md WP 13.4, docs/PLAYGROUND.md §5.1 and §9.1): `createAnimTrack()`
 * poses an actor's animator as the page poses it (engine/gfx/puppets/actors.ts: its sim data loaded into an animator of
 * the track's own, the foot plant last in the post slot, at the actor's feet and yaw, its movement shown, on the sim's
 * ground through the query view) once a step, and keeps its joints and sockets (engine/anim/stateMatrix.ts
 * `RUN_POINTS`) with heights from the actor's feet (for the pops), and its soles with heights from the ground the plant
 * stood them on (`FootPlant.floorAt`, for the slide), so a sole on a deck or a ramp stands on its floor as one on the
 * ground does. Over a range of frames it reads the anim QA's rules (engine/anim/motionMetrics.ts): `footSlide`, the
 * most a sole slides on the floor in one contact, and `pop`, the largest one-step jump of a point against its
 * neighbours (m; 0 when nothing qualifies); and `handGap(point)`, the closest either hand comes to a point (m). §5.1's
 * bounds: 5 cm of slide, no pop past the QA's 9/16 m, 3 cm from a contact. Each frame keeps the eyes too (`eye(k)`),
 * where the first-person camera stands.
 *
 * Invariants: posing never writes what the sim saves (engine/anim/character.ts), so measuring leaves a run's hash as it
 * is; the track keeps animators of its own, never the world's.
 *
 * @example
 * // const track = createAnimTrack(); after each step: track.frame(id, entity.animator, [x, y, z], yaw, dt);
 * // track.footSlide(1, 300); // the most a sole slid in one contact over frames 1–300, m
 * @see engine/dev/feel/anim.test.ts
 */
import { AnimatorPool, type AnimatorData } from '../../anim/character';
import { getBuild } from '../../anim/builds';
import { jointPosition, socketPosition } from '../../anim/fk';
import { FootPlant, queryGround, type GroundQueries } from '../../anim/footPlant';
import { MovementPose, plantsFeet, type BodyView, type MotionView } from '../../anim/locomotion/motion';
import { motionTrack, worstPop, worstSlide } from '../../anim/motionMetrics';
import { JOINTS, SOCKETS } from '../../anim/skeleton';
import { RUN_POINTS } from '../../anim/stateMatrix';
import { Vector3 } from '../../core/math';
import { eyePoint } from '../../gfx/cameras/first';
import type { Vec3 } from '../../gfx/cameras/pose';

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
  eye: Vec3;
}

/**
 * An animator posed once a step as the page poses it, and the anim QA's numbers over its frames; with the sim's
 * read-only `queries`, its feet stand on their ground as the page's do, and a sole's height is from the ground under it.
 */
export function createAnimTrack(where = 'feel', queries?: GroundQueries) {
  const pool = new AnimatorPool();
  const planted = new WeakMap<object, FootPlant>();
  const moving = new Map<number, MovementPose>();
  const ground = queries ? queryGround(queries) : null;
  const frames: AnimFrame[] = [];
  let size = 1;
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
     * movement as the page's puppets do (WP 13.10).
     */
    frame(
      id: number,
      data: Readonly<AnimatorData>,
      feet: readonly [number, number, number],
      yaw: number,
      dt: number,
      motion?: MotionView | null,
      body?: BodyView | null,
    ): void {
      const animator = pool.get(id, data, { dt });
      const plant = planted.get(animator) ?? new FootPlant({ name: 'feel:footPlant' }).attach(animator);
      planted.set(animator, plant);
      plant.locks = plantsFeet(motion);
      plant.ground = ground;
      const pose = moving.get(id) ?? new MovementPose();
      moving.set(id, pose.update(motion, dt, body));
      pose.apply(animator);
      animator.pose({ at: new Vector3(feet[0], feet[1], feet[2]), yaw });
      const { skeleton, world } = animator.body;
      const joints = JOINTS.map((_, j) => jointPosition(world, j));
      const sockets = SOCKETS.map((name) => socketPosition(skeleton, world, name));
      const hands = HAND_SOCKETS.map((name) => socketPosition(skeleton, world, name));
      const soles = SOLES.map((name) => socketPosition(skeleton, world, name)).map((p) => p.setY(p.y - plant.floorAt(p.x, p.z))); // prettier-ignore
      const points = [...joints, ...sockets].map((p) => p.setY(p.y - feet[1]));
      frames.push({ points, soles, position: new Vector3(feet[0], 0, feet[2]), hands, eye: eyePoint(skeleton, world) }); // prettier-ignore
      size = getBuild(data.build).size;
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
