/**
 * @file Camera collision (PLAN.md WP 13.8, docs/PLAYGROUND.md §4; doctrine: Common ground): what keeps every follow
 * camera (the chase, the shoulder, the platformer's) out of the level, as Unreal's spring arm and Cinemachine's
 * deoccluder do. Through the sim's read-only `QueryView` (gfx never imports physics/), a ball of `COLLIDE_RADIUS`,
 * wider than the near plane's corners, is cast against the groups `walls.groups` names (`world`, the level, by
 * default; `walls.exclude` skips a body, the hero's own):
 * - `reach`: how far the ball gets from a point along a direction, `COLLIDE_SKIN` short of the first surface;
 * - `sweep`: where the ball gets from one point toward another, stopped twice the skin short of a surface, so a cast
 *   that starts there starts clear (a pivot's lag never takes it through a wall);
 * - `easeArm`: an arm's length after the walls: in at once to what the cast left clear, back out with a time constant
 *   of `COLLIDE_RETURN` real seconds, never past what it wants (the chase camera's spring arm);
 * - `slide`: where the ball gets from one point toward another, sliding along what it meets, as a character does;
 *   `follow`, a point (an arm's base) that follows another so, never jumping;
 * - `moveCamera`: a camera that moves on, never jumps (the shooter's and the platformer's): carried with its arm (what
 *   the arm's base and the view moved it, `carry`), then toward the arm's end where the ball fits there, else as far
 *   along the arm as a ball swept from the base clears (`sweep`), in at up to `COLLIDE_PULL` m/s and out eased with a
 *   time constant of `COLLIDE_RETURN`, no faster, each leg slid along the walls; so a ledge, a roof or a pole that
 *   crosses the arm is passed over, under or round, never through, and the camera is never inside a wall, while a wall
 *   may stand between it and the player (the view fades it). A camera that has stood more than a metre from where it
 *   wants for `COLLIDE_STUCK` seconds, or is carried further than `COLLIDE_TELEPORT` in a frame (the player put
 *   elsewhere), goes there at once.
 *
 * Invariants: pure (equal walls and inputs give equal answers); a ball that starts clear and stops where `reach` or
 * `sweep` says never overlaps the groups cast against (chase.test.ts walks fixtures/scenes/chase-walls/ to prove it);
 * without `walls.queries` nothing is in the way.
 *
 * Carried from engine/gfx/cameras/chase.ts (WP 3.9's arm), which takes its casts from here since WP 13.8.
 *
 * @example
 * import { startScene } from '../../sim/scene';
 * import { queryViewOf } from '../../sim/queryView';
 * import chaseWalls from '../../../fixtures/scenes/chase-walls';
 * const { world } = startScene(chaseWalls);
 * world.step({}); // queries see the level from the first step
 * const walls = { queries: queryViewOf(world) };
 * reach(walls, [1.5, 1.5, 1.5], [0, 0, -1], 5); // 0.28…: a wall 0.5 m behind, less the ball and its skin
 * easeArm(0.3, 5.5, 5.5, 1 / 60); // 0.581…: easing back out
 * @see engine/gfx/cameras/collide.test.ts
 */
import type { QueryView } from '../../sim/queryView';
import { poseForward, poseRight, poseUp, type Vec3 } from './pose';

/** The radius of the ball cast, m: wider than the near plane's corners (0.09 m at 60° and 21:9). */
export const COLLIDE_RADIUS = 0.2;
/** How far short of a surface the ball stops, m. */
export const COLLIDE_SKIN = 0.02;
/** The time constant of an arm easing back out after a wall, real seconds. */
export const COLLIDE_RETURN = 0.3;
/** The fastest a `moveCamera` camera closes in on its arm's end beyond what carries it, m/s: 1/6 m a frame at 60 Hz. */
export const COLLIDE_PULL = 10;
/** How long a `moveCamera` camera may stand more than a metre from where it wants before it goes there, s. */
export const COLLIDE_STUCK = 1;
/** A carry longer than this in one frame is the player put somewhere else, m: the camera goes with him at once. */
export const COLLIDE_TELEPORT = 2;

/** The collision groups a query hits, as the `QueryView` names them. */
export type QueryGroups = NonNullable<Parameters<QueryView['raycast']>[2]>['groups'];

/** The walls a camera keeps out of: the sim's queries, the groups that stop it and a body it passes through. */
export interface Walls {
  /** The sim's read-only queries (its snapshot's `QueryView`); without them nothing is in the way. */
  readonly queries?: QueryView;
  /** The groups that stop the camera (`world`, the level, by default). */
  readonly groups?: QueryGroups;
  /** A body the camera passes through: the hero's own, when `groups` holds his. */
  readonly exclude?: number;
}

/** How far a ball of `COLLIDE_RADIUS` gets from `from` along the unit `dir`, up to `max`: `COLLIDE_SKIN` short of a hit. */
export function reach(walls: Walls, from: Vec3, dir: Vec3, max: number): number {
  const { queries, groups = 'world', exclude } = walls;
  if (!queries || max < 1e-6) return max;
  const ball = { type: 'ball', radius: COLLIDE_RADIUS } as const;
  const hit = queries.shapeCast(ball, from, dir, { maxDistance: max, margin: COLLIDE_SKIN, groups, exclude });
  return hit ? hit.distance : max;
}

/** Where a ball of `COLLIDE_RADIUS` gets from `from` toward `to`: `to`, or twice the skin short of the first surface. */
export function sweep(walls: Walls, from: Vec3, to: Vec3): Vec3 {
  const d: Vec3 = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
  const gap = Math.hypot(...d);
  if (gap <= 1e-6) return to;
  const room = reach(walls, from, [d[0] / gap, d[1] / gap, d[2] / gap], gap);
  if (room >= gap) return to;
  const t = Math.max(0, room - COLLIDE_SKIN) / gap;
  return [from[0] + d[0] * t, from[1] + d[1] * t, from[2] + d[2] * t];
}

/**
 * Where a ball of `COLLIDE_RADIUS` gets from `from` toward `to`, sliding along up to three surfaces it meets: it stops
 * `COLLIDE_SKIN` short of each and moves on along it; a ball already within the skin of one is first lifted off it.
 */
export function slide(walls: Walls, from: Vec3, to: Vec3): Vec3 {
  const { queries, groups = 'world', exclude } = walls;
  if (!queries) return to;
  const ball = { type: 'ball', radius: COLLIDE_RADIUS } as const;
  let at = from;
  let move: Vec3 = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
  for (let k = 0; k < 4; k++) {
    const length = Math.hypot(...move);
    if (length < 1e-6) break;
    const dir: Vec3 = [move[0] / length, move[1] / length, move[2] / length];
    const hit = queries.shapeCast(ball, at, dir, { maxDistance: length, margin: COLLIDE_SKIN, groups, exclude });
    if (!hit) return [at[0] + move[0], at[1] + move[1], at[2] + move[2]];
    const n = hit.normal;
    const went = Math.max(0, hit.distance - COLLIDE_SKIN);
    at = [at[0] + dir[0] * went, at[1] + dir[1] * went, at[2] + dir[2] * went];
    if (hit.distance < COLLIDE_SKIN) at = [at[0] + n.x * COLLIDE_SKIN, at[1] + n.y * COLLIDE_SKIN, at[2] + n.z * COLLIDE_SKIN]; // prettier-ignore
    const left = 1 - went / length;
    const rest: Vec3 = [move[0] * left, move[1] * left, move[2] * left];
    const into = Math.min(0, rest[0] * n.x + rest[1] * n.y + rest[2] * n.z);
    move = [rest[0] - n.x * into, rest[1] - n.y * into, rest[2] - n.z * into];
  }
  return at;
}

/**
 * A point that follows `to` and never passes through a wall: slid from where it was (`last`), or swept from `from` (the
 * hero's eye, clear of the walls) on the first frame or when `to` is further than `COLLIDE_TELEPORT` from it. An arm's
 * base moves so, so a pole or a lip that comes between it and where it wants to be never makes it jump.
 */
export function follow(walls: Walls, last: Vec3 | null, from: Vec3, to: Vec3): Vec3 {
  if (!last || Math.hypot(to[0] - last[0], to[1] - last[1], to[2] - last[2]) > COLLIDE_TELEPORT) return sweep(walls, from, to); // prettier-ignore
  return slide(walls, last, to);
}

/** Where an arm's base stands and which way its view looks: what carries a `moveCamera` camera. */
export interface ArmFrame {
  readonly base: Vec3;
  readonly yaw: number;
  readonly pitch: number;
}

/** Where `at`, placed relative to the arm `from` (its base and view), stands relative to the arm `to`. */
export function carry(at: Vec3, from: ArmFrame, to: ArmFrame): Vec3 {
  const d: Vec3 = [at[0] - from.base[0], at[1] - from.base[1], at[2] - from.base[2]];
  const axes = (arm: ArmFrame) => [poseRight({ yaw: arm.yaw }), poseUp(arm), poseForward(arm)];
  const rel = axes(from).map((axis) => d[0] * axis[0] + d[1] * axis[1] + d[2] * axis[2]);
  const [r, u, f] = axes(to);
  return [0, 1, 2].map((i) => to.base[i] + r[i] * rel[0] + u[i] * rel[1] + f[i] * rel[2]) as unknown as Vec3;
}

/** A `moveCamera` camera's state: where it stood, and how long it has stood more than a metre from where it wants. */
export interface CameraBall {
  readonly at: Vec3;
  readonly stuck: number;
}

/**
 * Moves a camera on by a frame (see the file comment): from `ball` (null on the first frame), carried to `carried`,
 * then toward `want`, the arm's end, where the ball fits there, else as far along the arm as a sweep from `base`
 * clears. Without queries it stands at `want`.
 */
export function moveCamera(
  walls: Walls,
  ball: CameraBall | null,
  base: Vec3,
  carried: Vec3,
  want: Vec3,
  dt: number,
): CameraBall {
  // prettier-ignore
  const clear = sweep(walls, base, want);
  const { queries, groups = 'world', exclude } = walls;
  if (!queries || !ball) return { at: clear, stuck: 0 };
  const fit = { type: 'ball', radius: COLLIDE_RADIUS - COLLIDE_SKIN } as const;
  const blocked = (at: Vec3) => queries.overlap(fit, at, { groups, exclude }).length > 0;
  const far = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  if (blocked(ball.at) || far(carried, ball.at) > COLLIDE_TELEPORT) return { at: clear, stuck: 0 };
  const target = blocked(want) ? clear : want;
  const moved = slide(walls, ball.at, carried);
  const gap = far(target, moved);
  const eased = far(target, base) > far(moved, base) ? gap * (1 - Math.exp(-dt / COLLIDE_RETURN)) : gap; // out: eased
  const share = gap < 1e-9 ? 0 : Math.min(eased, COLLIDE_PULL * dt) / gap;
  const at = slide(walls, moved, [0, 1, 2].map((i) => moved[i] + (target[i] - moved[i]) * share) as unknown as Vec3);
  const stuck = far(target, at) > 1 ? ball.stuck + dt : 0;
  return stuck > COLLIDE_STUCK ? { at: clear, stuck: 0 } : { at, stuck };
}

/** An arm's length after the walls (see the file comment): `arm` eased toward `want`, never past `clear`. */
export function easeArm(arm: number, want: number, clear: number, dt: number, back = COLLIDE_RETURN): number {
  const eased = arm + (want - arm) * (1 - Math.exp(-dt / back));
  return Math.min(clear, eased, want);
}
