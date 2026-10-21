/**
 * @file The shooter model's rides (PLAN.md WP 13.7, docs/PLAYGROUND.md §3.2): ziplines, the redeploy balloon's
 * skydive and ladders, and launchers for every character. The world gives them as plain data (`Rides`:
 * engine/sim/rides.ts makes it from the scene's entities, whose specs are engine/world/traverse.ts's). The zipline's
 * numbers are the Apex Movement Wiki's; Apex has no ladders, so theirs are ours, from GTA V and Red Dead Redemption 2.
 *
 * - Ziplines (`tryZipline`, `stepZipline`): a cable between two anchors, vertical within `zipline.steep` of straight
 *   up. Use catches one whose nearest point (on the ride's span, `zipline.end` short of each anchor) is within
 *   `zipline.reach` of the hands (`zipline.hang` over the feet) with the view within `zipline.look` of it (`lookAir`
 *   in the air); in the air a cable within `zipline.grab` of the hands catches it unasked; `zipline.catches` catches
 *   between two touches of the ground. It rides the way the view looks along the cable (else its velocity's, else
 *   down, a vertical one up), keeping the velocity's part along it, reaching `zipline.speed` (`vertical`) at
 *   `zipline.accel` (`jumpOn` when caught in the air), the feet hanging from the cable and moved straight along it:
 *   the hull's way is swept as it catches, and the ride ends where the hull would meet something. A jump leaves it, a
 *   full jump up with `zipline.jump` added along the view across the ground, no faster across than `jumpMax` unless
 *   the ride was (it keeps its speed); crouch drops it, keeping the ride's velocity. At an end it lets go keeping
 *   `zipline.exit` of its speed; a vertical cable's top hops it `topHop` up and on along the view at `topPush`, and a
 *   balloon's launches the skydive. No catch or ladder for `zipline.cooldown` after letting go of either.
 * - The skydive (`stepSkydive`, through the controller): it falls under gravity to `skydive.glide` with the view
 *   level or up, to `skydive.dive` with it straight down, braking at `skydive.brake` when faster, and the push moves
 *   it across at up to `skydive.across` (`skydive.accel`). From the tick whose move ends with the ground within
 *   `skydive.land` below, the landing pose takes over (`landing`) and slows the fall to `skydive.touch`; it lands
 *   with no stun.
 * - Ladders: engine/physics/movement/ladder.ts.
 * - Launchers (`launch`, for a character on a model or not): its feet inside a launcher's volume, not rising, set it
 *   off at the launcher's velocity (its part across added to the character's when it `keep`s it), leaving the
 *   launcher's top at its speed up, or at `bounce` times the speed it falls onto the top at if faster, whatever
 *   height over the top the volume caught it at: a trampoline's volume stands a tick's fall above its mat.
 *
 * Invariants: rides are entity ids in the motion state, never references, so a restored world rides on alike; a
 * ride's tick moves the feet along a path (no controller) but the skydive's; they change only the states given.
 *
 * @example
 * const cable = { id: 1, from: [0, 8, 0], to: [0, 2, 40], balloon: false } as const;
 * cablePoint(cable, 0); // [0, 8, 0]: its first anchor
 * nearestOnCable(cable, [0, 6, 20.5], 0.6)?.distance; // ≈ 1.04: the hands below the cable's middle
 * @see engine/physics/movement/ride.test.ts
 */
import { Vector3 } from '../../core/math';
import type { Character, CharacterInput, CharacterState } from '../character';
import { endSlide } from './crouch';
import { crouchPressed, type MantleTick } from './mantle';
import type { MotionState } from './model';
import type { Room } from './steer';

/** A point, world metres. */
type Point = readonly [number, number, number];

/** A zipline as the model rides it: its cable from `from` to `to` (m); a balloon's top launches a skydive. */
export interface RideCable {
  readonly id: number;
  readonly from: Point;
  readonly to: Point;
  readonly balloon: boolean;
}

/** A ladder: the foot of its face (m), its top's height, its normal across the ground (out of the wall), its width. */
export interface RideLadder {
  readonly id: number;
  readonly foot: Point;
  readonly top: number;
  readonly normal: readonly [number, number];
  readonly width: number;
}

/** A launcher: the volume the feet set it off in, its top, the velocity it gives, its bounce and whether it keeps the speed across. */ // prettier-ignore
export interface RideLauncher {
  readonly id: number;
  /** The height of its top (m): the velocity is the one leaving it there. */
  readonly top: number;
  readonly min: Point;
  readonly max: Point;
  readonly velocity: Point;
  readonly bounce: number;
  readonly keep: boolean;
}

/** The world's rides, as the sim gives them to a tick (engine/sim/rides.ts). */
export interface Rides {
  readonly cables: readonly RideCable[];
  readonly ladders: readonly RideLadder[];
  readonly launchers: readonly RideLauncher[];
}

/** A world without rides. */
export const NO_RIDES: Rides = Object.freeze({ cables: [], ladders: [], launchers: [] });

/** A tick's numbers beside the states: the mantle's (the move, the view across the ground, dt, g). */
export type RideTick = MantleTick;

/** The ticks `seconds` take, at least one. */
const ticksOf = (seconds: number, dt: number) => Math.max(1, Math.round(seconds / dt));

/** A coyote time already spent: no coyote jump off a ride. */
export const spent = (character: Character, dt: number) => Math.round(character.feel.coyote / dt) + 1;

/** `cable`'s length (m) and its unit axis from its first anchor to its second. */
export function cableAxis(cable: RideCable): { length: number; axis: [number, number, number] } {
  const d = [cable.to[0] - cable.from[0], cable.to[1] - cable.from[1], cable.to[2] - cable.from[2]] as const;
  const length = Math.hypot(d[0], d[1], d[2]);
  return { length, axis: length > 0 ? [d[0] / length, d[1] / length, d[2] / length] : [0, 1, 0] };
}

/** The point `at` metres along `cable` from its first anchor. */
export function cablePoint(cable: RideCable, at: number): [number, number, number] {
  const { axis } = cableAxis(cable);
  return [cable.from[0] + axis[0] * at, cable.from[1] + axis[1] * at, cable.from[2] + axis[2] * at];
}

/** The point of `cable`'s ride span (`end` short of each anchor) nearest `p`, how far along and how far off; null for a span too short to ride. */ // prettier-ignore
export function nearestOnCable(cable: RideCable, p: readonly number[], end: number) {
  const { length, axis } = cableAxis(cable);
  if (length <= 2 * end) return null;
  const t = (p[0] - cable.from[0]) * axis[0] + (p[1] - cable.from[1]) * axis[1] + (p[2] - cable.from[2]) * axis[2];
  const at = Math.min(Math.max(t, end), length - end);
  const point = cablePoint(cable, at);
  return { at, point, distance: Math.hypot(p[0] - point[0], p[1] - point[1], p[2] - point[2]) };
}

/** Whether `cable` is vertical: within `steep` of straight up. */
const verticalOf = (cable: RideCable, steep: number) => Math.abs(cableAxis(cable).axis[1]) >= Math.cos(steep) - 1e-12;

/** Where the feet hang `at` metres along `cable`: `hang` below it. */
const hangAt = (cable: RideCable, at: number, hang: number): Point => {
  const p = cablePoint(cable, at);
  return [p[0], p[1] - hang, p[2]];
};

/** Whether `view` (a unit direction across the ground, or none) is within `angle` of the way from `a` to `b`; a point overhead is faced. */ // prettier-ignore
function faces(view: readonly [number, number] | null, a: Point, b: Point, angle: number): boolean {
  const [dx, dz] = [b[0] - a[0], b[2] - a[2]];
  const d = Math.hypot(dx, dz);
  return !view || d < 0.05 || (view[0] * dx + view[1] * dz) / d >= Math.cos(angle) - 1e-9;
}

/** Which way along `cable` it rides: the view's (with its pitch), else its velocity's, else down a sloped one and up a vertical one. */ // prettier-ignore
function directionOf(cable: RideCable, input: CharacterInput, state: CharacterState, steep: number): 1 | -1 {
  const { axis } = cableAxis(cable);
  if (input.view !== undefined) {
    const pitch = input.pitch ?? 0;
    const look = [Math.sin(input.view) * Math.cos(pitch), Math.sin(pitch), Math.cos(input.view) * Math.cos(pitch)];
    const d = look[0] * axis[0] + look[1] * axis[1] + look[2] * axis[2];
    if (Math.abs(d) > 1e-6) return d > 0 ? 1 : -1;
  }
  const along = state.vx * axis[0] + state.vy * axis[1] + state.vz * axis[2];
  if (Math.abs(along) > 0.1) return along > 0 ? 1 : -1;
  return verticalOf(cable, steep) === axis[1] > 0 ? 1 : -1;
}

/** Leaves a zipline or a ladder into the air at `v`, `zipline.cooldown` before the next; a jump arms the lurch. */
export function letGo(
  character: Character,
  state: CharacterState,
  motion: MotionState,
  v: Point,
  jump: boolean,
  dt: number,
): void {
  // prettier-ignore
  const cool = ticksOf(character.movement!.zipline.cooldown, dt);
  Object.assign(motion, { mode: 'air', ride: -1, rideSpeed: 0, rideDir: 0, rideCool: cool });
  if (jump) Object.assign(motion, { jumped: true, fatigued: false, flight: 0 });
  Object.assign(state, { vx: v[0], vy: v[1], vz: v[2], jumping: jump, jumpAge: -1 });
}

/** What a ride takes from the motion it starts in: no slide, sprint, duck, mantle or climb. */
export const RIDING = { sprinting: false, sticky: false, mantle: 'none', climbAge: -1, glideAge: -1, jumped: false, fatigued: false, flight: -1 } as const; // prettier-ignore

/** Catches a zipline in reach if one takes (see the file comment); true when it did. */
export function tryZipline(
  character: Character,
  state: CharacterState,
  motion: MotionState,
  input: CharacterInput,
  rides: Rides,
  room: Room,
  tick: RideTick,
  grounded: boolean,
): boolean {
  const z = character.movement!.zipline;
  const use = input.usePressed === true;
  if (rides.cables.length === 0 || motion.rideCool > 0 || motion.catches >= z.catches || (grounded && !use)) return false; // prettier-ignore
  const feet = room.feet();
  const hands: Point = [feet[0], feet[1] + z.hang, feet[2]];
  const [reach, look] = [use ? z.reach : z.grab, grounded ? z.look : z.lookAir];
  let best: { cable: RideCable; at: number; distance: number } | null = null;
  for (const cable of rides.cables) {
    const near = nearestOnCable(cable, hands, z.end);
    if (!near || near.distance > reach + 1e-9 || !faces(tick.view, hands, near.point, look)) continue;
    if (!best || near.distance < best.distance) best = { cable, at: near.at, distance: near.distance };
  }
  if (!best) return false;
  const { cable, at } = best;
  const { length, axis } = cableAxis(cable);
  const dir = directionOf(cable, input, state, z.steep);
  const end = dir > 0 ? length - z.end : z.end;
  const span = Math.abs(end - at);
  const clear = span < 0.1 ? 0 : room.sweep(hangAt(cable, at, z.hang), hangAt(cable, end, z.hang));
  if (clear < 0.1) return false;
  const along = (state.vx * axis[0] + state.vy * axis[1] + state.vz * axis[2]) * dir;
  endSlide(motion);
  Object.assign(motion, {
    ...RIDING, mode: 'zipline', ride: cable.id, rideAt: at, rideDir: dir, rideSpeed: Math.max(along, 0),
    rideAccel: grounded ? z.accel : z.jumpOn, rideEnd: clear >= span ? end : at + dir * Math.max(clear - character.offset, 0),
    catches: motion.catches + 1, duck: 'standing', duckLeft: 0, stance: 'stand', airDuck: false, crouchToggle: false,
  }); // prettier-ignore
  Object.assign(state, { jumping: false, jumpAge: -1, air: spent(character, tick.dt) });
  return true;
}

/**
 * One tick on a zipline (see the file comment): the feet's next point along the cable, or null once it let go
 * (jumped, dropped, reached an end or lost the cable: the tick goes on in the air, or skydiving). `starting`: the
 * tick it caught, whose presses started it.
 */
export function stepZipline(
  character: Character,
  state: CharacterState,
  motion: MotionState,
  input: CharacterInput,
  rides: Rides,
  tick: RideTick,
  starting = false,
): Point | null {
  const m = character.movement!;
  const z = m.zipline;
  const cable = rides.cables.find((c) => c.id === motion.ride);
  if (!cable) {
    letGo(character, state, motion, [state.vx, state.vy, state.vz], false, tick.dt);
    return null;
  }
  const { axis } = cableAxis(cable);
  const dir = motion.rideDir;
  const velocity = (speed: number): Point => [axis[0] * dir * speed, axis[1] * dir * speed, axis[2] * dir * speed];
  if (!starting && input.jumpPressed === true) {
    const ride = velocity(motion.rideSpeed);
    const across = Math.hypot(ride[0], ride[2]);
    let [hx, hz] = tick.view ? [ride[0] + tick.view[0] * z.jump, ride[2] + tick.view[1] * z.jump] : [ride[0], ride[2]];
    const [speed, cap] = [Math.hypot(hx, hz), Math.max(z.jumpMax, across)];
    if (speed > cap) [hx, hz] = [(hx * cap) / speed, (hz * cap) / speed];
    letGo(character, state, motion, [hx, character.jumpSpeed, hz], true, tick.dt);
    return null;
  }
  if (!starting && crouchPressed(input, motion)) {
    letGo(character, state, motion, velocity(motion.rideSpeed), false, tick.dt);
    return null;
  }
  const top = verticalOf(cable, z.steep) ? z.vertical : z.speed;
  const step = motion.rideAccel * tick.dt;
  motion.rideSpeed = motion.rideSpeed < top ? Math.min(motion.rideSpeed + step, top) : Math.max(motion.rideSpeed - step, top); // prettier-ignore
  const next = motion.rideAt + dir * motion.rideSpeed * tick.dt;
  if (dir > 0 ? next >= motion.rideEnd : next <= motion.rideEnd) {
    arrive(character, state, motion, cable, velocity(motion.rideSpeed), tick);
    return null;
  }
  motion.rideAt = next;
  [state.vx, state.vy, state.vz] = velocity(motion.rideSpeed);
  return hangAt(cable, next, z.hang);
}

/** At a ride's end (see the file comment): let go keeping a share of `v`, hop off a vertical top, or skydive off a balloon's. */ // prettier-ignore
function arrive(character: Character, state: CharacterState, motion: MotionState, cable: RideCable, v: Point, tick: RideTick): void { // prettier-ignore
  const { zipline: z, skydive } = character.movement!;
  const up = v[1] > 0 && verticalOf(cable, z.steep);
  if (up && cable.balloon) {
    letGo(character, state, motion, [0, skydive.launch, 0], false, tick.dt);
    Object.assign(motion, { mode: 'skydive', landing: false });
  } else if (up) {
    const [vx, vz] = tick.view ? [tick.view[0] * z.topPush, tick.view[1] * z.topPush] : [0, 0];
    letGo(character, state, motion, [vx, Math.sqrt(2 * tick.g * z.topHop), vz], false, tick.dt);
  } else {
    letGo(character, state, motion, [v[0] * z.exit, v[1] * z.exit, v[2] * z.exit], false, tick.dt);
  }
}

/** One tick of a skydive (see the file comment): sets the velocity and returns the move to make, through the controller. */ // prettier-ignore
export function stepSkydive(
  character: Character,
  state: CharacterState,
  motion: MotionState,
  input: CharacterInput,
  room: Room,
  tick: RideTick,
): Vector3 {
  const s = character.movement!.skydive;
  const { dt, g, wish } = tick;
  const share = Math.min(Math.max(-(input.pitch ?? 0) / (Math.PI / 2), 0), 1);
  const fall = motion.landing ? s.touch : s.glide + (s.dive - s.glide) * share;
  const [dx, dz] = [wish[0] * s.across - state.vx, wish[1] * s.across - state.vz];
  const [d, step] = [Math.hypot(dx, dz), s.accel * dt];
  [state.vx, state.vz] = d <= step ? [state.vx + dx, state.vz + dz] : [state.vx + (dx / d) * step, state.vz + (dz / d) * step]; // prettier-ignore
  const v0 = state.vy;
  state.vy = v0 > -fall ? Math.max(v0 - g * dt, -fall) : Math.min(v0 + s.brake * dt, -fall);
  const desired = new Vector3(state.vx * dt, ((v0 + state.vy) / 2) * dt, state.vz * dt);
  if (!motion.landing && room.below(s.land - Math.min(desired.y, 0)) !== null) motion.landing = true; // within it after this move
  return desired;
}

/**
 * Sets a character off a launcher its feet stand in (see the file comment), on a model or not, under gravity `g`:
 * true when one did. It must not be rising, nor on a ride or in a mantle. Its speed up is the one that leaves the
 * launcher's top at the launcher's own (or `bounce` times the speed it falls onto the top at), from where its feet are.
 */
export function launch(
  rides: Rides,
  feet: readonly number[],
  character: Character,
  state: CharacterState,
  motion: MotionState | undefined,
  dt: number,
  g: number,
): boolean {
  if (state.vy > 0 || (motion && motion.mode !== 'ground' && motion.mode !== 'air')) return false;
  const pad = rides.launchers.find((p) => feet.every((v, k) => v >= p.min[k] - 1e-9 && v <= p.max[k] + 1e-9));
  if (!pad) return false;
  const above = Math.max(feet[1] - pad.top, 0);
  const onto = Math.sqrt(state.vy * state.vy + 2 * g * above);
  const leave = Math.max(pad.velocity[1], onto * pad.bounce);
  const up = Math.sqrt(Math.max(leave * leave - 2 * g * above, 0));
  const [vx, vz] = pad.keep ? [state.vx + pad.velocity[0], state.vz + pad.velocity[2]] : [pad.velocity[0], pad.velocity[2]]; // prettier-ignore
  Object.assign(state, { vx, vy: up, vz, grounded: false, jumping: false, jumpAge: -1, air: spent(character, dt) });
  if (motion) {
    endSlide(motion);
    Object.assign(motion, { mode: 'air', jumped: true, fatigued: false, flight: 0 });
  }
  return true;
}
