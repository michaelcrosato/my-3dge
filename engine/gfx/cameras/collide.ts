/**
 * @file Camera collision (PLAN.md WP 13.8, docs/PLAYGROUND.md §4; doctrine: Common ground): what keeps every follow
 * camera (the chase, the shoulder, the platformer's) out of the level, as Unreal's spring arm and Cinemachine's
 * deoccluder do. Through the sim's read-only `QueryView` (gfx never imports physics/), a ball of `COLLIDE_RADIUS`,
 * wider than the near plane's corners, is cast against the groups `walls.groups` names (`world`, the level, by
 * default; `walls.exclude` skips a body, the hero's own), their fixed bodies only (`walls.fixed`): a door that swings,
 * a lift, a prop that moves pass through the camera, faded when they stand between it and the player, as a game's
 * camera channel ignores its doors, never pushing it nor cutting it:
 * - `reach`: how far the ball gets from a point along a direction, `COLLIDE_SKIN` short of the first surface;
 * - `sweep`: where the ball gets from one point toward another, stopped twice the skin short of a surface, so a cast
 *   that starts there starts clear (a pivot's lag never takes it through a wall);
 * - `easeArm`: an arm's length after the walls, in at once, out with a time constant of `COLLIDE_RETURN` s (chase's);
 * - `slide`: where the ball gets from one point toward another, sliding along what it meets, as a character does;
 *   `follow`, an arm's base that follows a point so, at a pace (held at a lip, it catches up at `COLLIDE_PULL`);
 * - `moveCamera`: a camera that moves on at a pace (the shooter's, the platformer's): carried with its arm (`carry`),
 *   then toward the arm's end where the ball fits there, else as far along the arm as a ball swept from the base
 *   clears, in at up to `COLLIDE_PULL` m/s and out eased over `COLLIDE_RETURN`, each leg slid along the walls: what
 *   crosses the arm is passed over, under or round, never through (one may stand between it and him: the view fades).
 *   A camera the base sees (a ball swept from it gets there) keeps it in sight (`CameraKeep.room` to spare); one that
 *   lost it goes down only to where it sees the base again (never behind a wall's top it rose over), and along the
 *   base's trail (`CameraBall.trail`: round a corner, through a door) to the newest point of it it sees, no nearer the
 *   base than `CameraKeep.trail`. One more than a metre from where it wants for `COLLIDE_STUCK` seconds homes to the
 *   clear point, level until over it. Two cuts are left: carried further than `COLLIDE_TELEPORT` in a frame (the
 *   player put elsewhere), or found inside a wall (moved into it), it goes to the clear point.
 *
 * Invariants: pure (equal walls and inputs give equal answers); a ball that starts clear and stops where `reach` or
 * `sweep` says never overlaps the groups cast against (chase.test.ts walks fixtures/scenes/chase-walls/ to prove it);
 * without `walls.queries` nothing is in the way. Carried from engine/gfx/cameras/chase.ts (WP 3.9's arm).
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
  /** Whether only fixed bodies stop it (true by default): what moves, a door swinging, a lift, passes through it. */
  readonly fixed?: boolean;
}

/** How far a ball of `COLLIDE_RADIUS` gets from `from` along the unit `dir`, up to `max`: `COLLIDE_SKIN` short of a hit. */
export function reach(walls: Walls, from: Vec3, dir: Vec3, max: number): number {
  const { queries, groups = 'world', exclude, fixed = true } = walls;
  if (!queries || max < 1e-6) return max;
  const ball = { type: 'ball', radius: COLLIDE_RADIUS } as const;
  const hit = queries.shapeCast(ball, from, dir, { maxDistance: max, margin: COLLIDE_SKIN, groups, exclude, fixed });
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

/** The least share of a move, turned along a surface, that `slide`'s `keep` brings back to its full length. */
const KEEP_SHARE = 0.25;

/**
 * Where a ball of `COLLIDE_RADIUS` gets from `from` toward `to`, sliding along up to three surfaces it meets: it stops
 * `COLLIDE_SKIN` short of each and moves on along it; a ball already within the skin of one is first lifted off it.
 * With `keep`, what is left after each surface goes on at its full length along it, not shortened by the turn, where at
 * least `KEEP_SHARE` of it runs along the surface (a camera working its way round a wall, not one pressed into it).
 */
export function slide(walls: Walls, from: Vec3, to: Vec3, keep = false): Vec3 {
  const { queries, groups = 'world', exclude, fixed = true } = walls;
  if (!queries) return to;
  const ball = { type: 'ball', radius: COLLIDE_RADIUS } as const;
  let at = from;
  let move: Vec3 = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
  for (let k = 0; k < 4; k++) {
    const length = Math.hypot(...move);
    if (length < 1e-6) break;
    const dir: Vec3 = [move[0] / length, move[1] / length, move[2] / length];
    const hit = queries.shapeCast(ball, at, dir, { maxDistance: length, margin: COLLIDE_SKIN, groups, exclude, fixed });
    if (!hit) return [at[0] + move[0], at[1] + move[1], at[2] + move[2]];
    const n = hit.normal;
    const went = Math.max(0, hit.distance - COLLIDE_SKIN);
    at = [at[0] + dir[0] * went, at[1] + dir[1] * went, at[2] + dir[2] * went];
    if (hit.distance < COLLIDE_SKIN) at = [at[0] + n.x * COLLIDE_SKIN, at[1] + n.y * COLLIDE_SKIN, at[2] + n.z * COLLIDE_SKIN]; // prettier-ignore
    const left = 1 - went / length;
    const rest: Vec3 = [move[0] * left, move[1] * left, move[2] * left];
    const into = Math.min(0, rest[0] * n.x + rest[1] * n.y + rest[2] * n.z);
    move = [rest[0] - n.x * into, rest[1] - n.y * into, rest[2] - n.z * into];
    const along = Math.hypot(...move);
    if (keep && along >= KEEP_SHARE * length * left) move = move.map((v) => (v * length * left) / along) as unknown as Vec3; // prettier-ignore
  }
  return at;
}

/** The distance between two points, m. */
const far = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** The point `share` of the way from `a` to `b`. */
const lerp = (a: Vec3, b: Vec3, share: number): Vec3 => [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * share) as unknown as Vec3; // prettier-ignore

/**
 * A point that follows `to` and never passes through a wall: slid from where it was (`last`), at most `step` m this
 * frame (what `to` itself moved plus `COLLIDE_PULL`·dt, so one held at a lip catches up, never jumps), or swept from
 * `from` (the hero's eye, clear of the walls) on the first frame or when `to` is further than `COLLIDE_TELEPORT` from it
 * and the step allows that (the hero put elsewhere). An arm's base moves so, so a pole or a lip that comes between it
 * and where it wants to be never makes it jump.
 */
export function follow(walls: Walls, last: Vec3 | null, from: Vec3, to: Vec3, step = Infinity): Vec3 {
  const gap = last ? far(to, last) : Infinity;
  if (!last || (gap > COLLIDE_TELEPORT && step > COLLIDE_TELEPORT)) return sweep(walls, from, to);
  return slide(walls, last, gap > step ? lerp(last, to, step / gap) : to);
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
  /** Where the arm's base has been, oldest first, `TRAIL_STEP` apart, its last `TRAIL_LENGTH` m: a way known clear. */
  readonly trail?: readonly Vec3[];
}

/** How far apart the points of a camera's trail of its base stand, m. */
export const TRAIL_STEP = 0.25;
/** How much of its base's way a camera's trail keeps, m. */
export const TRAIL_LENGTH = 12;
/** The nearest to the base a trail's point a camera heads for stands by default, m: it never closes in on him so. */
export const TRAIL_KEEP = 1.5;

/** `trail` with `base` added once `TRAIL_STEP` from the last point, its oldest dropped past `TRAIL_LENGTH`. */
function remember(trail: readonly Vec3[], base: Vec3): readonly Vec3[] {
  const last = trail[trail.length - 1];
  if (last && far(last, base) < TRAIL_STEP) return trail;
  return [...trail, base].slice(-Math.round(TRAIL_LENGTH / TRAIL_STEP));
}

/** How many halvings find where a leg would leave the base's sight: to 1/256 of the leg. */
const SIGHT_STEPS = 8;
/** How much wider than the camera's ball the sight it keeps is, m: room for the player to move before it is lost. */
const SIGHT_ROOM = 0.2;
/** A face whose normal is this near vertical (its y) is a floor or a ceiling: an arm meeting it keeps to its clear point. */
const LEVEL_NORMAL = 0.7;

/** How a `moveCamera` camera keeps the base: the sight it keeps, and the trail's points it heads for. */
export interface CameraKeep {
  /** How much wider than its ball the sight it keeps is, m (`SIGHT_ROOM` by default). */
  readonly room?: number;
  /** The nearest to the base a trail's point it heads for stands, m (`TRAIL_KEEP` by default). */
  readonly trail?: number;
}

/**
 * Moves a camera on by a frame (see the file comment): from `ball` (null on the first frame), carried to `carried`,
 * then toward `want`, the arm's end, where the ball fits there, else as far along the arm as a sweep from `base`
 * clears, keeping in the base's sight (`keep.room` to spare); out of it, along the base's trail no nearer the base than
 * `keep.trail`. Without queries it stands at `want`.
 */
export function moveCamera(
  walls: Walls,
  ball: CameraBall | null,
  base: Vec3,
  carried: Vec3,
  want: Vec3,
  dt: number,
  keep: CameraKeep = {},
): CameraBall {
  const { room = SIGHT_ROOM, trail: near = TRAIL_KEEP } = keep;
  const clear = sweep(walls, base, want);
  const { queries, groups = 'world', exclude, fixed = true } = walls;
  if (!queries || !ball) return { at: clear, stuck: 0, trail: [base] };
  const fit = { type: 'ball', radius: COLLIDE_RADIUS - COLLIDE_SKIN } as const;
  if (
    queries.overlap(fit, ball.at, { groups, exclude, fixed }).length > 0 ||
    far(carried, ball.at) > COLLIDE_TELEPORT
  ) {
    return { at: clear, stuck: 0, trail: [base] };
  }
  const trail = remember(ball.trail ?? [], base);
  /** Whether a ball swept from the base gets to `at` (within the 2 skins a sweep stops short of a face `at` touches). */
  const sees = (at: Vec3) => far(sweep(walls, base, at), at) < 3 * COLLIDE_SKIN;
  /** Where a frame's leg from `from` toward `to` aims: in at up to `COLLIDE_PULL` m/s, out eased. */
  const aim = (from: Vec3, to: Vec3) => {
    const gap = far(to, from);
    const eased = far(to, base) > far(from, base) ? gap * (1 - Math.exp(-dt / COLLIDE_RETURN)) : gap; // out: eased, as paced
    return lerp(from, to, gap < 1e-9 ? 0 : Math.min(eased, COLLIDE_PULL * dt) / gap);
  };
  /**
   * Whether a ball `SIGHT_ROOM` wider than the camera's gets from the base to within that room of `at`, or meets only a
   * floor or a ceiling on the way while the camera's own ball still `sees` it (the look tipped up over open floor).
   */
  const wide = (at: Vec3) => {
    const d: Vec3 = [at[0] - base[0], at[1] - base[1], at[2] - base[2]];
    const gap = Math.hypot(...d);
    if (gap <= room) return true;
    const ball = { type: 'ball', radius: COLLIDE_RADIUS + room } as const;
    const dir: Vec3 = [d[0] / gap, d[1] / gap, d[2] / gap];
    const hit = queries.shapeCast(ball, base, dir, { maxDistance: gap, margin: COLLIDE_SKIN, groups, exclude, fixed });
    if (!hit || hit.distance >= gap - room - 2 * COLLIDE_SKIN) return true;
    return Math.abs(hit.normal.y) > LEVEL_NORMAL && sees(at);
  };
  /**
   * Slid from `from` toward `to`: a camera in the base's sight keeps it, with `SIGHT_ROOM` to spare when it had that
   * (stopped short), and one out of it goes down only to where it sees the base again, so it never sinks behind a
   * wall's top it rose over.
   */
  const leg = (from: Vec3, to: Vec3, keep = false): Vec3 => {
    const at = slide(walls, from, to, keep);
    if (!sees(from)) {
      return at[1] >= from[1] || sees(at) ? at : slide(walls, from, [to[0], Math.max(to[1], from[1]), to[2]], keep);
    }
    if (wide(at)) return at;
    const held = wide(from) ? wide : sees;
    if (held(at)) return at;
    let [inside, outside] = [0, 1];
    for (let k = 0; k < SIGHT_STEPS; k++) {
      const half = (inside + outside) / 2;
      if (held(slide(walls, from, lerp(from, to, half), keep))) inside = half;
      else outside = half;
    }
    return slide(walls, from, lerp(from, to, inside), keep);
  };
  /** Whether the arm to `to` first meets a floor or a ceiling: slid along that, a camera would leave the arm behind. */
  const level = (to: Vec3) => {
    const d: Vec3 = [to[0] - base[0], to[1] - base[1], to[2] - base[2]];
    const gap = Math.hypot(...d);
    if (gap < 1e-6) return false;
    const ball = { type: 'ball', radius: COLLIDE_RADIUS } as const;
    const dir: Vec3 = [d[0] / gap, d[1] / gap, d[2] / gap];
    const hit = queries.shapeCast(ball, base, dir, { maxDistance: gap, margin: COLLIDE_SKIN, groups, exclude, fixed });
    return hit !== null && Math.abs(hit.normal.y) > LEVEL_NORMAL;
  };
  const moved = leg(ball.at, carried);
  if (!sees(moved)) {
    // out of the base's sight (the player went round a corner, through a door): along his trail, toward the newest of
    // it the camera sees, at its pace, as he went
    for (let k = trail.length - 1; k >= 0; k--) {
      if (far(trail[k], base) < near || far(sweep(walls, moved, trail[k]), trail[k]) >= 3 * COLLIDE_SKIN) continue;
      return { at: leg(moved, aim(moved, trail[k])), stuck: 0, trail };
    }
  }
  if (ball.stuck > COLLIDE_STUCK) {
    // it stood a while short of where it wants: home to the clear point instead, level until over it, then down
    const over = Math.hypot(clear[0] - moved[0], clear[2] - moved[2]) > COLLIDE_RADIUS;
    const home: Vec3 = over ? [clear[0], Math.max(clear[1], moved[1]), clear[2]] : clear;
    const at = leg(moved, aim(moved, home), true);
    return { at, stuck: far(clear, at) > 1 ? ball.stuck + dt : 0, trail };
  }
  const target = queries.overlap(fit, want, { groups, exclude, fixed }).length > 0 || level(want) ? clear : want;
  const at = leg(moved, aim(moved, target), far(target, moved) > 1); // far behind: round what it meets at its pace
  return { at, stuck: far(target, at) > 1 ? ball.stuck + dt : 0, trail };
}

/** An arm's length after the walls (see the file comment): `arm` eased toward `want`, never past `clear`. */
export function easeArm(arm: number, want: number, clear: number, dt: number, back = COLLIDE_RETURN): number {
  const eased = arm + (want - arm) * (1 - Math.exp(-dt / back));
  return Math.min(clear, eased, want);
}
