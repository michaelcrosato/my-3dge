/**
 * @file The shooter model's wall-climb and wall-bounce (PLAN.md WP 13.6, docs/PLAYGROUND.md §3.2), as the Apex
 * Movement Wiki's climb fundamentals measure them, through the controller's own move up the wall.
 *
 * - The climb space: its foot (`spaceY`) is the feet's height on the ground; off it, a fall below drags it down; each
 *   letting go lowers it by `climb.drop`, a jump off above the mini zone by `climb.dropJump`; a climb into a mantle
 *   leaves it be. The zones over it: mini to `climb.mini`, green to `climb.green`, neutral to `climb.cutoff`.
 * - `tryClimb`: in the air, pushing into a wall touching it, steeper than `climb.angle`, the push and the view within
 *   `climb.angle` of facing it, the feet within the space; after a climb since it stood, only below the last catch,
 *   unless the wall turned `climb.turn` from that one's.
 * - `stepClimb`: a ledge within the mantle's reach tops it out (the grab, no detach); the feet past the catch plus
 *   `climb.attach` or the space's foot plus `climb.cutoff` end it, the end boost throwing it `climb.end` higher; back,
 *   no forward, crouch, the view off the wall, the wall gone or `climb.timer` after the catch rising slower than
 *   `climb.rising` let go; else it climbs: up at `climb.up`, across at `climb.acrossUp` by the push's part along the
 *   wall, what it carried in along the wall kept up to `climb.across`, each reached at `climb.accel`, gravity off.
 * - `wallBounce`, a jump off it: from the mini zone `climb.miniLift` up and `climb.miniAway` away; from the green
 *   zone a lift from a full jump at the zone's foot to none at its top (ours: the measures say only that it falls)
 *   and `climb.away` away; higher, `climb.away` away, keeping its rise (a wall push). It lands fatigued.
 *
 * Invariants: heights are the feet's, world metres; the wall's normal is kept in `wallX`, `wallZ`; they change only
 * the states they are given.
 *
 * @example
 * // in steerMotion: if (motion.mode === 'climb') { const next = stepClimb(character, state, motion, input, room, tick); … }
 * @see engine/physics/movement/climb.test.ts
 */
import type { Character, CharacterInput, CharacterState } from '../character';
import { startMantle, type MantleTick } from './mantle';
import type { MotionState } from './model';
import type { Room } from './steer';

/** How near the hull a wall counts as touched, in skins. */
const TOUCH = 4;

/** `value` moved toward `target` by at most `step`. */
const approach = (value: number, target: number, step: number) =>
  value < target ? Math.min(value + step, target) : Math.max(value - step, target);

/** The push's parts into the wall and along it (its tangent, the normal turned a quarter left), and the view's into it. */ // prettier-ignore
function frameOf(motion: MotionState, tick: MantleTick) {
  const [nx, nz] = [motion.wallX, motion.wallZ];
  const into = -(tick.wish[0] * nx + tick.wish[1] * nz);
  const along = tick.wish[0] * -nz + tick.wish[1] * nx;
  const view = tick.view ? -(tick.view[0] * nx + tick.view[1] * nz) : 1;
  return { nx, nz, into, along, view };
}

/** Keeps the climb space's foot: the feet's height on the ground, dragged down by a fall below it off the ground. */
export function keepSpace(motion: MotionState, feet: number, grounded: boolean): void {
  if (grounded) Object.assign(motion, { spaceY: feet, reattach: false });
  else motion.spaceY = Math.min(motion.spaceY, feet);
}

/** Starts a climb if one takes (see the file comment); true when it did. */
export function tryClimb(
  character: Character,
  state: CharacterState,
  motion: MotionState,
  input: CharacterInput,
  room: Room,
  tick: MantleTick,
): boolean {
  // prettier-ignore
  const c = character.movement!.climb;
  const push = Math.hypot(tick.wish[0], tick.wish[1]);
  if (push < 0.3 || input.crouch === true || motion.crouchToggle) return false;
  const dir: [number, number] = [tick.wish[0] / push, tick.wish[1] / push];
  const wall = room.wall(dir, character.offset * TOUCH);
  const cos = Math.cos(c.angle);
  if (!wall || wall.up >= cos) return false;
  const facing = (d: readonly [number, number]) => -(d[0] * wall.normal[0] + d[1] * wall.normal[1]) >= cos - 1e-9;
  if (!facing(dir) || (tick.view && !facing(tick.view))) return false;
  const feet = room.feet()[1];
  if (feet - motion.spaceY > c.cutoff) return false;
  const turned = Math.acos(Math.min(1, wall.normal[0] * motion.wallX + wall.normal[1] * motion.wallZ)) >= c.turn;
  if (motion.reattach && feet >= motion.attachY && !turned) return false;
  const [nx, nz] = wall.normal;
  const into = state.vx * -nx + state.vz * -nz;
  Object.assign(motion, { mode: 'climb', climbAge: 0, attachY: feet, wallX: nx, wallZ: nz, reattach: true });
  [state.vx, state.vz] = [state.vx + into * nx, state.vz + into * nz];
  state.jumping = false;
  return true;
}

/** Lets go of the wall into the air, the climb space lowered by `drop` (m). */
function letGo(motion: MotionState, drop: number): void {
  Object.assign(motion, { mode: 'air', climbAge: -1 });
  motion.spaceY -= drop;
}

/**
 * One tick of a climb (see the file comment): `'climb'` when it climbs on (its velocity set), `'mantle'` when it
 * topped out (the grab started), `'air'` when it let go, bounced off or ended in the end boost.
 */
export function stepClimb(
  character: Character,
  state: CharacterState,
  motion: MotionState,
  input: CharacterInput,
  room: Room,
  tick: MantleTick,
): 'climb' | 'mantle' | 'air' {
  // prettier-ignore
  const m = character.movement!;
  const c = m.climb;
  const { nx, nz, into, along, view } = frameOf(motion, tick);
  const feet = room.feet();
  motion.climbAge = Math.min(motion.climbAge + 1, 1e6);
  const top = room.wall([-nx, -nz], m.mantle.probe);
  const ledge = top && room.ledge(top, m.mantle.reach);
  if (ledge) {
    startMantle(character, state, motion, input, ledge, feet, tick.dt);
    return 'mantle';
  }
  if (input.jumpPressed === true) {
    wallBounce(character, state, motion, feet[1], tick);
    return 'air';
  }
  const cos = Math.cos(c.angle);
  const touching = room.wall([-nx, -nz], character.offset * TOUCH);
  const slow = motion.climbAge >= Math.round(c.timer / tick.dt) && state.vy < c.rising;
  if (into < 0.3 || input.crouch === true || motion.crouchToggle || view < cos - 1e-9 || !touching || slow) {
    letGo(motion, c.drop);
    return 'air';
  }
  if (feet[1] >= motion.attachY + c.attach || feet[1] >= motion.spaceY + c.cutoff) {
    state.vy = Math.sqrt(2 * tick.g * c.end);
    letGo(motion, c.drop);
    return 'air';
  }
  const step = c.accel * tick.dt;
  const sideways = Math.max(-c.across, Math.min(c.across, state.vx * -nz + state.vz * nx));
  const across = approach(sideways, along * c.acrossUp, step);
  state.vy = approach(state.vy, c.up, step);
  [state.vx, state.vz] = [-nz * across - nx, nx * across - nz]; // and 1 m/s into the wall, keeping it touched
  return 'climb';
}

/** A jump off the wall (see the file comment): by the zone the feet at `feet` stand in over the climb space's foot. */
export function wallBounce(
  character: Character,
  state: CharacterState,
  motion: MotionState,
  feet: number,
  tick: MantleTick,
): void {
  // prettier-ignore
  const c = character.movement!.climb;
  const z = feet - motion.spaceY;
  const { nx, nz } = frameOf(motion, tick);
  const along = state.vx * -nz + state.vz * nx;
  let away = c.away;
  if (z < c.mini) [state.vy, away] = [Math.sqrt(2 * tick.g * c.miniLift), c.miniAway];
  else if (z <= c.green) state.vy = character.jumpSpeed * Math.sqrt((c.green - z) / (c.green - c.mini));
  [state.vx, state.vz] = [nx * away - nz * along, nz * away + nx * along];
  Object.assign(state, { jumping: state.vy > 0, jumpAge: -1 });
  Object.assign(motion, { jumped: true, fatigued: true, flight: 0 });
  letGo(motion, z < c.mini ? c.drop : c.dropJump);
}
