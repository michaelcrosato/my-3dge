/**
 * @file The shooter model's ladders (PLAN.md WP 13.7, docs/PLAYGROUND.md §3.2): ours, from GTA V and Red Dead
 * Redemption 2, since Apex has none. A ladder is world data (`RideLadder`, engine/physics/movement/ride.ts's `Rides`):
 * the foot of its face, its top, its normal out of the wall it stands against and its width.
 *
 * `tryLadder`: a push within `ladder.angle` of straight into a ladder's face, or use, with the hull within
 * `ladder.reach` of it takes hold from the front, standing; use takes hold from its top, the feet `ladder.top` below
 * it. `stepLadder`: the push climbs it up or down at `ladder.speed`, the hull `ladder.gap` off its face, moved straight
 * (no controller); at its foot it steps off; with its top within `mantle.low` over the feet it mantles over
 * (engine/physics/movement/mantle.ts, the pull alone); a jump pushes it away at `ladder.away`, rising `ladder.jump`;
 * crouch lets go. No zipline or ladder for `zipline.cooldown` after letting go.
 *
 * Invariants: the ladder is an entity id in the motion state (`ride`), the feet's height over its foot `rideAt`, so a
 * restored world climbs on alike; it changes only the states given.
 *
 * @example
 * // in steerMotion: if (motion.mode === 'ladder') { const next = stepLadder(character, state, motion, input, rides, room, tick); … }
 * @see engine/physics/movement/ride.test.ts
 */
import type { Character, CharacterInput, CharacterState } from '../character';
import { endSlide } from './crouch';
import { crouchPressed, startMantle } from './mantle';
import type { MotionState } from './model';
import { letGo, RIDING, spent, type RideLadder, type Rides, type RideTick } from './ride';
import type { Room } from './steer';

/** A point, world metres. */
type Point = readonly [number, number, number];

/** How the feet stand to `ladder`: in front of its face (along its normal), along it from its middle, over its foot. */
function against(ladder: RideLadder, feet: Point) {
  const [nx, nz] = ladder.normal;
  const [dx, dz] = [feet[0] - ladder.foot[0], feet[2] - ladder.foot[2]];
  return { out: dx * nx + dz * nz, side: dz * nx - dx * nz, up: feet[1] - ladder.foot[1] };
}

/** Takes hold of a ladder in reach if one takes (see the file comment); true when it did. */
export function tryLadder(
  character: Character,
  state: CharacterState,
  motion: MotionState,
  input: CharacterInput,
  rides: Rides,
  room: Room,
  tick: RideTick,
): boolean {
  const m = character.movement!;
  const l = m.ladder;
  if (rides.ladders.length === 0 || motion.rideCool > 0 || motion.stance !== 'stand') return false;
  const feet = room.feet();
  const { radius } = character.capsule;
  const use = input.usePressed === true;
  const push = Math.hypot(tick.wish[0], tick.wish[1]);
  for (const ladder of rides.ladders) {
    const at = against(ladder, feet);
    const height = ladder.top - ladder.foot[1];
    if (Math.abs(at.side) > ladder.width / 2 + radius / 2) continue;
    const into = push > 0.3 && -(tick.wish[0] * ladder.normal[0] + tick.wish[1] * ladder.normal[1]) / push >= Math.cos(l.angle) - 1e-9; // prettier-ignore
    const front = at.out >= 0 && at.out <= radius + l.gap + l.reach && at.up >= -0.25 && at.up < height - m.mantle.low;
    const above = use && Math.abs(at.up - height) <= 0.3 && at.out < radius && at.out >= -(radius + l.reach + 0.5);
    if (!(front && (use || into)) && !above) continue;
    endSlide(motion);
    Object.assign(motion, {
      ...RIDING, mode: 'ladder', ride: ladder.id, rideAt: above ? height - l.top : Math.max(at.up, 0), rideDir: 0,
      rideSpeed: 0, rideEnd: height, wallX: ladder.normal[0], wallZ: ladder.normal[1], catches: 0,
    }); // prettier-ignore
    Object.assign(state, { vx: 0, vy: 0, vz: 0, jumping: false, jumpAge: -1, air: spent(character, tick.dt) });
    return true;
  }
  return false;
}

/**
 * One tick on a ladder (see the file comment): the feet's next point on it; `'mantle'` when it starts the mantle over
 * its top (the caller steps the mantle); null once it let go or stepped off at its foot (the tick goes on in the air).
 */
export function stepLadder(
  character: Character,
  state: CharacterState,
  motion: MotionState,
  input: CharacterInput,
  rides: Rides,
  room: Room,
  tick: RideTick,
  starting = false,
): Point | 'mantle' | null {
  const m = character.movement!;
  const l = m.ladder;
  const ladder = rides.ladders.find((each) => each.id === motion.ride);
  if (!ladder) {
    letGo(character, state, motion, [0, 0, 0], false, tick.dt);
    return null;
  }
  const [nx, nz] = ladder.normal;
  if (!starting && input.jumpPressed === true) {
    letGo(character, state, motion, [nx * l.away, Math.sqrt(2 * tick.g * l.jump), nz * l.away], true, tick.dt);
    return null;
  }
  if (!starting && crouchPressed(input, motion)) {
    letGo(character, state, motion, [0, 0, 0], false, tick.dt);
    return null;
  }
  const push = -(tick.wish[0] * nx + tick.wish[1] * nz);
  const speed = Math.abs(push) < 0.3 ? 0 : push * l.speed;
  let at = motion.rideAt + speed * tick.dt;
  if (speed < 0 && at <= 0) {
    letGo(character, state, motion, [0, 0, 0], false, tick.dt);
    return null;
  }
  if (speed > 0 && motion.rideEnd - motion.rideAt <= m.mantle.low - 0.01) {
    const wall = room.wall([-nx, -nz], m.mantle.probe);
    const ledge = wall && room.ledge(wall, m.mantle.reach);
    if (ledge) {
      startMantle(character, state, motion, input, ledge, room.feet(), tick.dt);
      return 'mantle';
    }
  }
  if (speed > 0) at = Math.min(at, motion.rideEnd - m.mantle.low + 0.011); // where the top's mantle takes over
  at = Math.max(at, 0);
  [motion.rideSpeed, state.vy] = [(at - motion.rideAt) / tick.dt, (at - motion.rideAt) / tick.dt];
  [motion.rideAt, state.vx, state.vz] = [at, 0, 0];
  const off = character.capsule.radius + l.gap;
  return [ladder.foot[0] + nx * off, ladder.foot[1] + at, ladder.foot[2] + nz * off];
}
