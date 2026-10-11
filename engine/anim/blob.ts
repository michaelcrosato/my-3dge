/**
 * @file The blob rig (PLAN.md WP 5.3): my-3d2dge's `Blob`, the squash-and-stretch ball of slimes, jellies and bats,
 * on a minimal skeleton. `step(input)` is the sim's part: it eases `state`, plain data, one fixed step. A spring
 * takes the squash toward its target (`kick` jolts it), the look turns smoothly toward a direction, the wings ease
 * their beat, and a move (`input.move`) sets the squash target and the body's offset. `pose()` is the view's: from
 * the state alone it writes the skeleton's world matrices (`BLOB_JOINTS`), which a body (WP 5.4) hangs its shapes on.
 *
 * A blob's attacks are data: `BLOB_MOVES` (bite, leap, pounce, spit), each a timing and shares of the creature's own
 * leap (`BlobLeap`: how far it gathers back and reaches, how high it jumps, a dive when negative, its squash in the
 * air and on landing, and when in the strike it hits). `blobMove` evaluates one at a moment; `blobMoveTimes` says
 * when it hits and ends.
 *
 * Invariants:
 * - The squash preserves volume: the body is R(1 + squash) tall and R / √(1 + squash) wide, so a unit sphere through
 *   the body's matrix keeps 4/3 πR³ (the source's width, R(1 − 0.55 squash), lost up to 18 %). Its bottom stays on
 *   `position`, the ground point under it, moved by the move's offset along the look. Hanging turns the rig half a
 *   turn about its forward axis through the rest centre, so the body hangs from 2R above `position`.
 * - Where the joints land (blob.test.ts checks it against the reference vectors, Appendix C): the spring, the look and
 *   the beat are the source's update to rounding, so the centre and the top are the source's; the width, and with it
 *   the eyes and the wing roots, differs by the volume fix only (4 cm at most, at the squash's limits).
 * - A fixed step `dt` (`SIM_DT` by default) and no clock or random stream: the same inputs give the same bits.
 *
 * Carried from `my-3d2dge:engine/my-3d2dge.js:2595-2602` (`Blob.update`: the spring 320/14 within ±0.45, the look's
 * lerp at 8 per second, the beat at 14 rad/s eased at 6), `src/starter/60-animlab.js:15-29` (the leap's parameters;
 * the slime's are `BLOB_LEAP`), `:205-216` (`leap`: a move on the blob's clock; its timings are those of the moves
 * the lab played as each, jab, slash, overhead and cast) and `:198` (the mouth), and the eye and wing placement of
 * `src/stress-world/30-crowd.js:145-160` (`slimeParts`). The source's `walk` and its 2D drawing are dropped.
 *
 * @example
 * import { Vector3 } from '../core/math';
 * const slime = new Blob();
 * slime.kick(5).step({ look: new Vector3(1, 0, 0) }).state.squash; // ≈ 0.064: the jolt stretches it
 * blobMove('pounce', 0.04).squash; // -0.15: halfway into its crouch
 * slime.step({ move: { name: 'leap', time: 0.13 } }).pose().body; // the body's matrix, lifted and moved along the look
 * @see engine/anim/blob.test.ts
 */
import { approach, ease, MathUtils, Matrix4, Vector3 } from '../core/math';
import { SIM_DT } from '../core/time';

/** The blob's tuning: the source's numbers, lengths ÷ 16 in metres. */
export const BLOB = {
  radius: 6.5 / 16, // metres: the body at rest, R
  stiffness: 320, // the squash spring's pull, per second squared
  damping: 14, // its damping, per second
  limit: 0.45, // the squash's bound, either way
  lookRate: 8, // the share of the way the look turns toward its target each second (all of it at most, per step)
  lookMin: 0.01 / 16, // metres: a shorter look keeps the last direction
  flapRate: 6, // per second: how fast the beat's speed eases toward the input's
  beat: 14, // radians per second of the wings' beat at full speed
  touchdown: 0.85, // the share of a leap's flight after which the body braces to land
  eye: { turn: 0.42, out: 0.86, up: 0.2 }, // radians off the look; shares of the width and the height
  mouth: 0.9, // its height, a share of the body's
  wing: { out: 0.6, span: 0.8, spread: 0.9, spreadBeat: 0.5, rise: 1.2, riseBeat: 1.3, lift: 0.6 },
} as const;

/** The blob's skeleton, parents first, and what each joint's world matrix places. */
export const BLOB_JOINTS = {
  root: 'The ground point under the body, turned to the look (upside down while hanging); unscaled.',
  body: 'The body: a unit sphere through this matrix is the squashed ball.',
  eyeL: 'The left eye’s centre on the body, its +Z out along the look turned 0.42 rad left; unscaled.',
  eyeR: 'The right eye’s centre on the body, its +Z out along the look turned 0.42 rad right; unscaled.',
  mouth: 'Where a spit leaves: the front of the body, at 0.9 of its height; unscaled.',
  wingL: 'The left wing: a part from y = 0 to y = 1 through this matrix spans its root to its tip, x along the look.',
  wingR: 'The right wing: a part from y = 0 to y = 1 through this matrix spans its root to its tip, x along the look.',
} as const;

/** A joint of the blob's skeleton. */
export type BlobJoint = keyof typeof BLOB_JOINTS;

/** The blob's pose: each joint's world matrix (`BLOB_JOINTS` says what it places). */
export type BlobPose = Readonly<Record<BlobJoint, Matrix4>>;

/** A creature's leap, which its moves take shares of. Lengths in metres. */
export interface BlobLeap {
  /** How far it gathers back before it launches. */
  back: number;
  /** How far forward it lands. */
  reach: number;
  /** How high the leap's top is; negative dives. */
  height: number;
  /** Its squash in the air. */
  air: number;
  /** Its squash landing, easing to 0 as it backs off. */
  land: number;
  /** When in the strike it hits: 0 at its start, 1 at its end. */
  hit: number;
}

/** The slime's leap: back 3, reach 15, height 9 units. A bat's dives: back 0.25, reach 0.875, height −0.5625 m, air −0.15, land 0.25, hit 0.5. */
export const BLOB_LEAP: Readonly<BlobLeap> = {
  back: 0.1875,
  reach: 0.9375,
  height: 0.5625,
  air: 0.25,
  land: -0.45,
  hit: 0.9,
};

/** A blob move as data: its timing, and the shares of the creature's leap it strikes with. */
export interface BlobMove {
  /** Seconds it gathers, strikes and recovers; its clock runs 0–1, 1–2 and 2–3 through them. */
  readonly time: Readonly<{ wind: number; active: number; recover: number }>;
  /** Where on its clock the body launches from its gather. */
  readonly launch: number;
  /** The squash it gathers to by the launch. */
  readonly gather: number;
  /** The share of the leap's reach it lands at. */
  readonly reach: number;
  /** The share of the leap's height it jumps. */
  readonly height: number;
  /** Its own leap, in place of the creature's (the spit's short rear and stretch). */
  readonly leap?: Readonly<Partial<BlobLeap>>;
}

/** The blob's moves: a short low bite, its leap, a high pounce, and a spit that rears back and stretches forward. */
export const BLOB_MOVES = {
  bite: { time: { wind: 0.035, active: 0.06, recover: 0.13 }, launch: 0.5, gather: -0.3, reach: 0.6, height: 0.3 },
  leap: { time: { wind: 0.08, active: 0.1, recover: 0.22 }, launch: 0.5, gather: -0.3, reach: 1, height: 1 },
  pounce: { time: { wind: 0.16, active: 0.09, recover: 0.26 }, launch: 0.5, gather: -0.3, reach: 1, height: 1.5 },
  spit: {
    time: { wind: 0.22, active: 0.12, recover: 0.32 },
    launch: 1,
    gather: -0.5,
    reach: 1,
    height: 0,
    leap: { back: 0.125, reach: 0.125, air: 0.3, land: 0.3, hit: 1 },
  },
} as const satisfies Readonly<Record<string, BlobMove>>;

/** A blob move's name. */
export type BlobMoveName = keyof typeof BLOB_MOVES;

/** A move at a moment: the body's offset (metres forward along the look, and up) and the squash it aims for. */
export interface BlobMoveFrame {
  forward: number;
  lift: number;
  squash: number;
}

/** The leap field `key` of `move` on a creature's `leap`: the move's own, else the creature's. */
const leapOf = (move: BlobMove, leap: Readonly<BlobLeap>, key: keyof BlobLeap) => move.leap?.[key] ?? leap[key];

/** `a` to `b` by `t`, as the source writes it (`a + (b − a) t`, not three.js's `(1 − t) a + t b`): the same bits. */
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Move `name` at `seconds` in (clamped to its length), on the creature's `leap`: the body's offset and squash. */
export function blobMove(
  name: BlobMoveName,
  seconds: number,
  leap: Readonly<BlobLeap> = BLOB_LEAP,
  out: BlobMoveFrame = { forward: 0, lift: 0, squash: 0 },
): BlobMoveFrame {
  const move: BlobMove = BLOB_MOVES[name];
  const { wind, active, recover } = move.time;
  const t = Math.max(0, seconds);
  let k = 2 + Math.min(1, (t - wind - active) / recover); // the move's clock: wind 0–1, active 1–2, recover 2–3
  if (t < wind + active) k = t < wind ? t / wind : 1 + (t - wind) / active;
  const back = leapOf(move, leap, 'back');
  const reach = leapOf(move, leap, 'reach') * move.reach;
  out.lift = 0;
  if (k < move.launch) {
    const s = k / move.launch; // gather: back off and crouch
    out.forward = -back * s;
    out.squash = move.gather * s;
  } else if (k < 2) {
    const u = (k - move.launch) / (2 - move.launch); // the strike: out to the reach over an arc
    out.forward = lerp(-back, reach, ease.outQuad(u));
    out.lift = leapOf(move, leap, 'height') * move.height * Math.sin(u * Math.PI);
    out.squash = leapOf(move, leap, u < BLOB.touchdown ? 'air' : 'land');
  } else {
    const u = k - 2; // land on the target and back off
    out.forward = reach * (1 - ease.inOut(u));
    out.squash = leapOf(move, leap, 'land') * (1 - u);
  }
  return out;
}

/** When move `name` hits and when it ends, seconds from its start, on the creature's `leap`. */
export function blobMoveTimes(name: BlobMoveName, leap: Readonly<BlobLeap> = BLOB_LEAP): { hit: number; end: number } {
  const move: BlobMove = BLOB_MOVES[name];
  const { wind, active, recover } = move.time;
  return { hit: wind + leapOf(move, leap, 'hit') * active, end: wind + active + recover };
}

/** What a blob is made from. */
export interface BlobOptions {
  /** The body's radius at rest, metres; `BLOB.radius` by default. */
  radius?: number;
  /** The creature's leap, which its moves take shares of; `BLOB_LEAP` by default. */
  leap?: Readonly<BlobLeap>;
  /** The heading it looks along at first, radians: forward is (sin yaw, 0, cos yaw); 0 by default. */
  yaw?: number;
  /** The fixed step, seconds; `SIM_DT` by default. */
  dt?: number;
}

/** What a blob is told each step; every field is optional. */
export interface BlobInput {
  /** The ground point under it, world metres; kept from the last step when absent. */
  position?: Vector3;
  /** The squash it eases toward, −0.45 (flat) to 0.45 (tall); 0 when absent. A move overrides it. */
  squash?: number;
  /** A direction to look along, world (its vertical part ignored); the look is kept when absent or under 0.6 mm. */
  look?: Vector3;
  /** Its eyes squeezed shut (hurt, flattened). */
  squint?: boolean;
  /** The wings' beat, 0 (folded) to 1 (full speed); 1 when absent. */
  flap?: number;
  /** Roosting upside down. */
  hang?: boolean;
  /** A move playing: its name and the seconds since it started. */
  move?: { name: BlobMoveName; time: number };
}

/** The blob's state: what `step` eases and `pose` reads, plain data. */
export interface BlobState {
  /** −0.45 (flat) to 0.45 (tall). */
  squash: number;
  /** The squash's rate, per second. */
  squashSpeed: number;
  /** The look's world x: with `lookZ`, the source's lerped vector, not always of unit length. */
  lookX: number;
  /** The look's world z. */
  lookZ: number;
  /** The beat's speed, 0–1. */
  flap: number;
  /** The beat's phase, radians in [0, 2π). */
  beat: number;
  /** Its eyes squeezed shut. */
  squint: boolean;
  /** Roosting upside down. */
  hang: boolean;
  /** The move's offset, metres forward along the look. */
  forward: number;
  /** The move's offset, metres up. */
  lift: number;
}

const TAU = Math.PI * 2;
/** Scratch objects. */
const frame: BlobMoveFrame = { forward: 0, lift: 0, squash: 0 };
const local = new Matrix4();
/** The paired joints and their sides: +1 left (+X at yaw 0), −1 right. */
const EYES = [['eyeL', 1], ['eyeR', -1]] as const; // prettier-ignore
const WINGS = [['wingL', 1], ['wingR', -1]] as const; // prettier-ignore

/** A blob: its state, its skeleton's pose. See the file comment. */
export class Blob {
  /** The body's radius at rest, metres. */
  readonly radius: number;
  /** The creature's leap. */
  readonly leap: Readonly<BlobLeap>;
  /** The fixed step, seconds. */
  readonly dt: number;
  /** What `step` eases. */
  readonly state: BlobState;
  /** The ground point under it, world metres. */
  readonly position = new Vector3();
  /** The pose the last `pose()` wrote. */
  readonly joints: BlobPose = Object.fromEntries(Object.keys(BLOB_JOINTS).map((j) => [j, new Matrix4()])) as BlobPose;

  /** A blob at rest at the origin, looking along `yaw`. */
  constructor(options: BlobOptions = {}) {
    this.radius = options.radius ?? BLOB.radius;
    this.leap = options.leap ?? BLOB_LEAP;
    this.dt = options.dt ?? SIM_DT;
    const yaw = options.yaw ?? 0;
    const [lookX, lookZ] = [Math.sin(yaw), Math.cos(yaw)];
    this.state = {
      squash: 0,
      squashSpeed: 0,
      lookX,
      lookZ,
      flap: 1,
      beat: 0,
      squint: false,
      hang: false,
      forward: 0,
      lift: 0,
    };
    this.pose();
  }

  /** Jolts the squash: adds `speed` (per second) to its rate, + to stretch, − to flatten. */
  kick(speed: number): this {
    this.state.squashSpeed += speed;
    return this;
  }

  /** Eases the state one fixed step toward `input`: the sim's part. */
  step(input: BlobInput = {}): this {
    const { dt, state: s } = this;
    if (input.position) this.position.copy(input.position);
    let target = input.squash ?? 0;
    s.forward = s.lift = 0;
    if (input.move) {
      target = blobMove(input.move.name, input.move.time, this.leap, frame).squash;
      s.forward = frame.forward;
      s.lift = frame.lift;
    }
    s.squashSpeed += (-(s.squash - target) * BLOB.stiffness - BLOB.damping * s.squashSpeed) * dt;
    s.squash = MathUtils.clamp(s.squash + s.squashSpeed * dt, -BLOB.limit, BLOB.limit);
    const look = input.look;
    const length = look ? Math.hypot(look.x, look.z) : 0;
    if (look && length > BLOB.lookMin) {
      const k = Math.min(1, dt * BLOB.lookRate);
      s.lookX = lerp(s.lookX, look.x / length, k);
      s.lookZ = lerp(s.lookZ, look.z / length, k);
    }
    s.squint = input.squint ?? false;
    s.hang = input.hang ?? false;
    s.flap = approach(s.flap, input.flap ?? 1, dt * BLOB.flapRate);
    s.beat = (s.beat + dt * BLOB.beat * s.flap) % TAU;
    return this;
  }

  /** Writes and returns the skeleton's world matrices from the state: the view's part. */
  pose(): BlobPose {
    const { radius: R, state: s, joints: J, position: p } = this;
    const h = 1 + s.squash;
    const w = 1 / Math.sqrt(h);
    const yaw = Math.atan2(s.lookX, s.lookZ);
    J.root.makeRotationY(yaw);
    J.root.setPosition(p.x + Math.sin(yaw) * s.forward, p.y + s.lift, p.z + Math.cos(yaw) * s.forward);
    if (s.hang) J.root.multiply(local.makeScale(-1, -1, 1).setPosition(0, 2 * R, 0)); // half a turn about +Z
    J.body.multiplyMatrices(J.root, local.makeScale(R * w, R * h, R * w).setPosition(0, R * h, 0));
    const { turn, out, up } = BLOB.eye;
    for (const [joint, side] of EYES) {
      local.makeRotationY(side * turn);
      local.setPosition(side * Math.sin(turn) * out * R * w, R * h * (1 + up), Math.cos(turn) * out * R * w);
      J[joint].multiplyMatrices(J.root, local);
    }
    J.mouth.multiplyMatrices(J.root, local.makeTranslation(0, R * h * BLOB.mouth, R * w));
    const W = BLOB.wing;
    const f = Math.sin(s.beat) * 0.5 + 0.5; // the beat: 0 with the tips raised, 1 lowered
    const fold = Math.min(1, s.flap * 2);
    const span = R * (W.span + (W.spread + f * W.spreadBeat) * fold);
    const rise = (W.rise - f * W.riseBeat) * fold * R * W.lift;
    const length = Math.hypot(span, rise);
    for (const [joint, side] of WINGS) {
      // columns: x along the look, y from the root to the tip, z = x × y / |y|; the root beside the body's centre
      // prettier-ignore
      local.set(
        0, side * span, -rise / length, side * R * w * W.out,
        0, rise, (side * span) / length, R * h,
        1, 0, 0, 0,
        0, 0, 0, 1,
      );
      J[joint].multiplyMatrices(J.root, local);
    }
    return J;
  }
}
