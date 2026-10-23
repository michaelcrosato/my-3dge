/**
 * @file The quadruped rig (PLAN.md WP 13.21, on WP 10.1's blocks; docs/PLAYGROUND.md §7.4): a four-legged body (a
 * dog, a fox, a wolf) for a crowd body (engine/sim/crowdBodies.ts), its state plain data as the blob's and the
 * floater's. `step(input)` is the sim's part: its feet on the planted gait (`LegGait`, a trot: the diagonals step
 * together), its heading toward the one it is told (else its travel), its head turning toward what it looks at
 * within bounds (looking about when it stands and has
 * nothing to look at), its tail's wag easing toward the share it is told, its sitting easing in and out. `pose()` is
 * the view's: from the state alone it writes the joints its body is drawn on (engine/gfx/puppets/bodies/quadruped.ts):
 * the torso, the neck, the head and its ears, each leg's bones, the paws, the tail's links, and `mouth`, where it
 * carries something.
 *
 * - **The legs**: the front two of two bones, the elbows bent back; the hind three (`digitigrade`): the stifle
 *   forward, the hock behind the paw, its long foot lying back as it sits.
 * - **The body** rides over its feet: the shoulders over the front feet's ground, the hips over the hind's (a foot
 *   mid-step counted where its step runs, not where it lifts), so a curb tips it.
 * - **Sitting** drops the hips `QUADRUPED.sit.drop` and draws them back, the chest rising a little, the head higher on
 *   the pitched torso but level, the tail lying behind; the paws stay planted.
 * - The state (`QuadrupedState`) is all of it: the gait's (`GaitState`), the heading, the clock, the sitting share,
 *   the head's turn and tilt, the wag's share, the walk's and the run's shares (its ears flop as it walks, its body
 *   lowers as it runs, and bobs `QUADRUPED.bob` with its feet in the air: Σ sin πt, as `LegGait.lifting`).
 *
 * Invariants: metres, seconds, +Y up, facing +Z (x left in its frame); a fixed step `dt`; no random stream (a crowd
 * spreads its clocks); the head eases and the heading turns by `1 − e^(−rate·dt)`, so any step rate eases alike; the
 * pose reads the state and `position` alone, so a view that loads them poses what the sim stepped.
 *
 * Carried from shardfall@fa2dab6 `crates/pav_core/src/rig.rs:173-183` (the legs straight under a raised body),
 * `:237-238` (a hound carries its tail up), `:250-256` (`quad_head`: the head forward of the chest on a raised neck),
 * `:560-571` (mammal legs, the joints bent back) and `:651-677` (a deep chest, a tucked waist, the neck, the snout and
 * nose, the ears flopping as it walks, the eyes, looking about when standing), and `crates/pav_core/src/arpg/
 * scene.rs:974-981` (Biscuit, the town dog: the quadruped preset, `puppet.rs:318-333`, at 0.72), as numbers and
 * mechanisms. The hind legs' third bone, sitting, the wag and the look are new.
 *
 * @example
 * import { Vector3 } from '../core/math';
 * const dog = new Quadruped();
 * const [at, velocity] = [new Vector3(), new Vector3(0, 0, 1.5)];
 * for (let i = 0; i < 60; i++) dog.step({ position: at.addScaledVector(velocity, 1 / 60), velocity });
 * dog.pose().paws.length; // 4, each on the planted gait's foot
 * @see engine/anim/quadruped.test.ts
 */
import { angDiff, lerpAng, MathUtils, Matrix4, Quaternion, smoothDamp, Vector3 } from '../core/math';
import { SIM_DT } from '../core/time';
import { twoBone } from './ik';
import { digitigrade, type DigitigradeSolve } from './proc/digitigrade';
import { GAIT_FOOT, LegGait, type GaitLeg, type GaitProbe, type GaitState } from './proc/gait';
import type { ProcRig } from './proc/rig';

/** The quadruped's build, m (shardfall's Biscuit: its quadruped preset at 0.72), and its tuning. */
export const QUADRUPED = {
  body: 0.391, // the body's line over its feet (leg × 0.95 + torso radius × 0.4)
  torso: 0.122, // the torso's radius
  legs: { z: 0.227, x: 0.067, paw: 0.076, drop: 0.049 }, // the legs' roots ±z, ±x and drop; the paws' ±x
  front: { upper: 0.19, lower: 0.19 }, // the front legs' bones (leg × 0.53 each)
  hind: { thigh: 0.15, shin: 0.15, foot: 0.11 }, // the hind legs' bones: the thigh, the shin, the long foot
  hock: { stand: 0.35, sit: 1.3 }, // rad: the hind long foot back from upright, standing and sitting
  head: { at: [0, 0.181, 0.399], radius: 0.094 }, // the head from the body's middle (`quad_head`) and its radius
  neck: { at: [0, 0.055, 0.173] }, // the neck's base, over the chest
  tail: { at: [0, 0.043, -0.343], length: 0.36, links: 3, lift: 0.675, sit: -0.25, droop: 0.12 }, // `lift`: atan(0.8)
  wag: { swing: 0.55, rate: 15, lag: 0.7, ease: 2.5 }, // rad, rad/s, rad a link, per s the share eases
  sit: { drop: 0.22, back: 0.05, rise: 0.03, time: 0.15, stifle: 1.2 }, // the hips' drop, draw back, the chest's rise;
  // s; and how much higher the stifles bend as it sits (over the pole's 0.3 up), so they stay off the ground
  look: { yaw: 1.1, pitch: 0.6, rate: 7, about: 0.35, aboutRate: 0.7 }, // its bounds and turn; looking about
  turn: { rate: 9, min: 0.25 }, // per s toward its travel, faster than `min` m/s
  bob: 0.025, // m: the body's rise from two feet planted to two mid-step, as it walks
  ears: { flop: 0.25, walk: 0.2, rate: 3 }, // the ears' flop, more as it walks, and how fast
  walk: 1.5, // m/s: a full walk's share (the ears flop, the looking about stops)
  run: { speed: 3.5, crouch: 0.07, ease: 10 }, // m/s: a full run, which lowers its body (its feet stay in reach)
  mouth: [0, -0.03, 0.13], // where it carries something, in the head's frame
} as const;

/**
 * The gait's tuning for the quadruped's size (`LegGait`'s options): short strides and a short lead, so a planted paw
 * stays within its leg's reach up to 6 m/s, the body lowering as it runs (measured, speeding up at 15 m/s²: on its
 * foot at a steady pace, within 6 mm in the first half second; one diagonal up at a time).
 */
const GAIT = {
  threshold: { base: 0.09, perSpeed: 0.015, maxSpeed: 6, still: 0.015, stand: 0.05 },
  stepTime: { min: 0.045, max: 0.14, speed: 0.9 },
  lift: { base: 0.05, perSpeed: 0.008 },
  lead: 0.03,
} as const;

/** Its legs on the gait: the front left and right, the hind left and right; the diagonals step together. */
export const QUADRUPED_LEGS: readonly GaitLeg[] = [
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
].map(([side, end]) => ({
  hip: [side * QUADRUPED.legs.x, QUADRUPED.body - QUADRUPED.legs.drop, end * QUADRUPED.legs.z],
  rest: [side * QUADRUPED.legs.paw, 0, end * QUADRUPED.legs.z],
  group: side === end ? 0 : 1,
}));

/** What a quadruped is made from: its heading and clock at first, and the fixed step. */
export interface QuadrupedOptions {
  /** Its heading at first, rad: forward is (sin yaw, 0, cos yaw); 0 by default. */
  yaw?: number;
  /** Its clock at first, s (the wag's and the look about's): spread a crowd's with the entity's stream; 0. */
  clock?: number;
  /** The fixed step, s; `SIM_DT` by default. */
  dt?: number;
}

/** What a quadruped is told each step; every field is optional. */
export interface QuadrupedInput {
  /** Where its feet's origin is (the ground under its middle), world m; kept from the last step when absent. */
  position?: Vector3;
  /** Its velocity, m/s; at rest when absent. */
  velocity?: Vector3;
  /** Its heading, rad (an actor's); else it turns toward its travel. */
  yaw?: number;
  /** Off its feet: they tuck under it (`LegGait.fly`). */
  air?: boolean;
  /** Sitting. */
  sit?: boolean;
  /** A world point it looks at (within its bounds); it looks about when absent and standing. */
  look?: Vector3 | null;
  /** 0 to 1: how hard its tail wags. */
  wag?: number;
  /** The world's ground for its feet (`GaitProbe`); its own ground plane when absent. */
  probe?: GaitProbe;
}

/** A quadruped's state: what `step` writes and `pose` reads, plain data (see the file comment). */
export interface QuadrupedState {
  gait: GaitState;
  /** Its heading, rad in [−π, π). */
  yaw: number;
  /** Seconds on its clock. */
  clock: number;
  /** 0 standing to 1 sitting, and its rate (per s). */
  sit: number;
  sitRate: number;
  /** The head's turn from the body's heading and its tilt (nose up +), rad. */
  headYaw: number;
  headPitch: number;
  /** 0 to 1: the wag's share. */
  wag: number;
  /** 0 to 1: the walk's share and the run's. */
  walk: number;
  run: number;
}

/** A quadruped's bones: the front legs' two (`fl0`, `fl1`, `fr0`, `fr1`), the hind legs' three, the tail's links. */
export type QuadrupedBone = `${'fl' | 'fr'}${0 | 1}` | `${'hl' | 'hr'}${0 | 1 | 2}` | `tail${0 | 1 | 2}` | 'neck';

/**
 * A quadruped's pose: each joint a world matrix or a list of points, the rig body's joints. A bone's matrix is at its
 * middle, its +Y along the bone and scaled by its length; the ears' at their bases, +Y toward their tips.
 */
export type QuadrupedPose = { readonly [bone in QuadrupedBone]: Matrix4 } & {
  /** At the torso's middle, turned to its heading and pitched by its shoulders and hips. */
  readonly torso: Matrix4;
  /** The head, level unless it looks up or down. */
  readonly head: Matrix4;
  readonly earL: Matrix4;
  readonly earR: Matrix4;
  /** Its paws, world m: the front left, front right, hind left, hind right. */
  readonly paws: readonly Vector3[];
  /** Where it carries something, world m. */
  readonly mouth: Vector3;
};

const UP = new Vector3(0, 1, 0);
const X_AXIS = new Vector3(1, 0, 0);
const ONE = new Vector3(1, 1, 1);
/** Scratch objects: the pose's, and `bone`'s own. */
const [ahead, front, hind, centre, root, paw, pole, a, b] = Array.from({ length: 9 }, () => new Vector3());
const [head, headAhead, headUp, headLeft, earUp, earLeft, earAhead, earBase] = Array.from({ length: 8 }, () => new Vector3()); // prettier-ignore
const [boneX, boneY, boneZ, boneScale, boneMiddle] = Array.from({ length: 5 }, () => new Vector3());
const [turn, pitch, torsoTurn, headTurn] = Array.from({ length: 4 }, () => new Quaternion());
const velocity = new Vector3();
const knee: [Vector3, Vector3] = [new Vector3(), new Vector3()];
const hindLeg: DigitigradeSolve = { knee: new Vector3(), hock: new Vector3(), toe: new Vector3() };
const eased = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);

/** Writes into `out` the bone from `from` to `to`: at its middle, its +Y along it, scaled by its length along Y. */
function bone(out: Matrix4, from: Vector3, to: Vector3): Matrix4 {
  const length = Math.max(1e-6, from.distanceTo(to));
  const y = boneY.subVectors(to, from).multiplyScalar(1 / length);
  const x = boneX.crossVectors(y, Math.abs(y.y) < 0.99 ? UP : X_AXIS).normalize();
  out.makeBasis(x, y, boneZ.crossVectors(x, y)).scale(boneScale.set(1, length, 1));
  return out.setPosition(boneMiddle.addVectors(from, to).multiplyScalar(0.5));
}

/** A quadruped: its state, its pose. See the file comment. */
export class Quadruped {
  /** The fixed step, s. */
  readonly dt: number;
  /** What `step` writes and `pose` reads: a component's own may stand in it, `step` writing it in place. */
  state: QuadrupedState;
  /** Where its feet's origin is, world m. */
  readonly position = new Vector3();
  /** The pose the last `pose()` wrote. */
  readonly joints: QuadrupedPose;
  readonly #gait = new LegGait({ legs: QUADRUPED_LEGS, ...GAIT });

  /** A quadruped at the origin, standing. */
  constructor(options: QuadrupedOptions = {}) {
    this.dt = options.dt ?? SIM_DT;
    const yaw = angDiff(0, options.yaw ?? 0);
    const gait = this.#gait.save();
    this.state = { gait, yaw, clock: options.clock ?? 0, sit: 0, sitRate: 0, headYaw: 0, headPitch: 0, wag: 0, walk: 0, run: 0 }; // prettier-ignore
    const bones = ['fl0', 'fl1', 'fr0', 'fr1', 'hl0', 'hl1', 'hl2', 'hr0', 'hr1', 'hr2', 'tail0', 'tail1', 'tail2'];
    const matrices = Object.fromEntries(['torso', 'head', 'neck', 'earL', 'earR', ...bones].map((name) => [name, new Matrix4()])); // prettier-ignore
    const paws = Array.from({ length: 4 }, () => new Vector3());
    this.joints = { ...matrices, paws, mouth: new Vector3() } as unknown as QuadrupedPose;
  }

  /** Steps the state one fixed step toward `input`: the sim's part. */
  step(input: QuadrupedInput = {}): this {
    const { dt, state: s } = this;
    s.clock += dt;
    if (input.position) this.position.copy(input.position);
    velocity.set(input.velocity?.x ?? 0, input.velocity?.y ?? 0, input.velocity?.z ?? 0);
    const speed = Math.hypot(velocity.x, velocity.z);
    const travel = speed > QUADRUPED.turn.min ? Math.atan2(velocity.x, velocity.z) : s.yaw;
    s.yaw = angDiff(0, input.yaw ?? lerpAng(s.yaw, travel, eased(QUADRUPED.turn.rate, dt)));
    const gait = this.#gait.load(s.gait);
    const body = { position: this.position, yaw: s.yaw, velocity };
    if (input.air) gait.fly(dt, body);
    else gait.step(dt, body, input.probe);
    gait.save(s.gait);
    [s.sit, s.sitRate] = smoothDamp(s.sit, input.sit ? 1 : 0, s.sitRate, QUADRUPED.sit.time, dt);
    s.walk += (Math.min(1, speed / QUADRUPED.walk) - s.walk) * eased(6, dt);
    s.run += (Math.min(1, speed / QUADRUPED.run.speed) - s.run) * eased(QUADRUPED.run.ease, dt);
    const L = QUADRUPED.look;
    let [yaw, tilt] = [Math.sin(s.clock * L.aboutRate) * L.about * (1 - s.walk) * (1 - s.sit), 0];
    if (input.look) {
      const [hx, hy, hz] = QUADRUPED.head.at;
      a.set(hx, QUADRUPED.body + hy, hz)
        .applyAxisAngle(UP, s.yaw)
        .add(this.position); // where its head is
      b.subVectors(input.look, a);
      yaw = MathUtils.clamp(angDiff(s.yaw, Math.atan2(b.x, b.z)), -L.yaw, L.yaw);
      tilt = MathUtils.clamp(Math.atan2(b.y, Math.hypot(b.x, b.z)), -L.pitch, L.pitch);
    }
    const k = eased(L.rate, dt);
    s.headYaw += (yaw - s.headYaw) * k;
    s.headPitch += (tilt - s.headPitch) * k;
    s.wag += (MathUtils.clamp(input.wag ?? 0, 0, 1) - s.wag) * eased(QUADRUPED.wag.ease, dt);
    return this;
  }

  /** Writes and returns its joints from the state and `position`: the view's part. */
  pose(): QuadrupedPose {
    const { state: s, joints: J, position: at } = this;
    const Q = QUADRUPED;
    const feet = s.gait.feet;
    /** Where foot `i`'s ground is, over the body's: its step's line mid-step, the body's own in the air. */
    const ground = (i: number) => {
      const [k, t] = [i * GAIT_FOOT, feet[i * GAIT_FOOT + 12]];
      const y = t < 0 ? feet[k + 1] : t <= 1 ? feet[k + 4] + (feet[k + 7] - feet[k + 4]) * t : at.y;
      return MathUtils.clamp(y - at.y, -0.25, 0.25);
    };
    turn.setFromAxisAngle(UP, s.yaw);
    ahead.set(Math.sin(s.yaw), 0, Math.cos(s.yaw));
    let lifting = 0; // Σ sin πt over the feet mid-step, 0 to 2: the body rises with its feet in the air
    for (let i = 0; i < 4; i++) lifting += feet[i * GAIT_FOOT + 12] >= 0 && feet[i * GAIT_FOOT + 12] <= 1 ? Math.sin(Math.PI * feet[i * GAIT_FOOT + 12]) : 0; // prettier-ignore
    const lift = Q.body + Q.bob * (lifting / 2 - 0.5) * s.walk - Q.run.crouch * s.run;
    front.copy(at).addScaledVector(ahead, Q.legs.z).y += (ground(0) + ground(1)) / 2 + lift + Q.sit.rise * s.sit;
    hind.copy(at).addScaledVector(ahead, -Q.legs.z - Q.sit.back * s.sit).y += (ground(2) + ground(3)) / 2 + lift - Q.sit.drop * s.sit; // prettier-ignore
    const along = Math.hypot(front.x - hind.x, front.z - hind.z);
    torsoTurn.multiplyQuaternions(turn, pitch.setFromAxisAngle(X_AXIS, -Math.atan2(front.y - hind.y, along)));
    centre.addVectors(front, hind).multiplyScalar(0.5);
    J.torso.compose(centre, torsoTurn, ONE);
    const T = (p: readonly number[], out: Vector3) => out.set(p[0], p[1], p[2]).applyQuaternion(torsoTurn).add(centre);
    const half = front.distanceTo(hind) / 2; // the roots over the shoulders and hips, drawn back as it sits
    QUADRUPED_LEGS.forEach((leg, i) => {
      T([leg.hip[0], -Q.legs.drop, Math.sign(leg.hip[2]) * half], root);
      paw.fromArray(feet, i * GAIT_FOOT);
      const name = (['fl', 'fr', 'hl', 'hr'] as const)[i];
      if (i < 2) {
        twoBone(root, paw, Q.front.upper, Q.front.lower, pole.copy(ahead).negate().addScaledVector(UP, 0.1), knee);
        bone(J[`${name}0`], root, knee[0]);
        bone(J[`${name}1`], knee[0], knee[1]);
        J.paws[i].copy(knee[1]);
      } else {
        const angle = Q.hock.stand + (Q.hock.sit - Q.hock.stand) * s.sit;
        pole.copy(ahead).addScaledVector(UP, 0.3 + Q.sit.stifle * s.sit);
        digitigrade(root, paw, Q.hind, { forward: ahead, pole }, angle, hindLeg);
        bone(J[`${name}0`], root, hindLeg.knee);
        bone(J[`${name}1`], hindLeg.knee, hindLeg.hock);
        bone(J[`${name}2` as QuadrupedBone], hindLeg.hock, hindLeg.toe);
        J.paws[i].copy(hindLeg.toe);
      }
    });
    headTurn.setFromAxisAngle(UP, s.yaw + s.headYaw).multiply(pitch.setFromAxisAngle(X_AXIS, -s.headPitch));
    T(Q.head.at, head);
    J.head.compose(head, headTurn, ONE);
    headAhead.set(0, 0, 1).applyQuaternion(headTurn);
    headUp.set(0, 1, 0).applyQuaternion(headTurn);
    headLeft.set(1, 0, 0).applyQuaternion(headTurn);
    bone(J.neck, T(Q.neck.at, a), b.copy(head).addScaledVector(headAhead, -0.3 * Q.head.radius));
    const flop = Q.ears.flop + Q.ears.walk * Math.abs(Math.sin(s.clock * Q.ears.rate)) * s.walk;
    for (const side of [1, -1]) {
      earBase.copy(head).addScaledVector(headUp, 0.7 * Q.head.radius).addScaledVector(headLeft, side * 0.55 * Q.head.radius); // prettier-ignore
      const y = earUp.copy(headUp).multiplyScalar(1 - flop).addScaledVector(headLeft, side * 0.35).addScaledVector(headAhead, -0.25).normalize(); // prettier-ignore
      const x = earLeft.crossVectors(y, headAhead).normalize();
      (side > 0 ? J.earL : J.earR).makeBasis(x, y, earAhead.crossVectors(x, y)).setPosition(earBase);
    }
    J.mouth.fromArray(Q.mouth).applyQuaternion(headTurn).add(head);
    const W = Q.wag;
    T(Q.tail.at, a);
    for (let i = 0; i < Q.tail.links; i++) {
      const yaw = s.yaw + Math.PI + s.wag * W.swing * Math.sin(s.clock * W.rate - i * W.lag);
      const up = Q.tail.lift + (Q.tail.sit - Q.tail.lift) * s.sit - Q.tail.droop * i;
      const length = Q.tail.length / Q.tail.links;
      b.set(Math.sin(yaw) * Math.cos(up), Math.sin(up), Math.cos(yaw) * Math.cos(up))
        .multiplyScalar(length)
        .add(a);
      bone(J[`tail${i}` as QuadrupedBone], a, b);
      a.copy(b);
    }
    return J;
  }
}

const SIDES = ['L', 'R'] as const;
/** The quadruped's points for its rig contract: its frame, its legs (front, then hind), then its head and tail. */
const NAMES = ['root', 'chest', 'hips', 'neck', ...SIDES.flatMap((s) => [`shoulder${s}`, `elbow${s}`, `pawF${s}`]), ...SIDES.flatMap((s) => [`hip${s}`, `stifle${s}`, `hock${s}`, `pawH${s}`]), 'head', 'nose', 'mouth', 'tail0', 'tail1', 'tail2', 'tail3'] as const; // prettier-ignore
const [START, END] = [new Vector3(0, -0.5, 0), new Vector3(0, 0.5, 0)];
const ends = (m: Matrix4) => [START.clone().applyMatrix4(m), END.clone().applyMatrix4(m)];

/** The quadruped's rig (engine/anim/proc/rig.ts): its points, its bones' lengths, its paws, and its states. */
export const QUADRUPED_RIG: ProcRig = {
  id: 'rig:quadruped',
  names: NAMES,
  bones: [
    ...SIDES.flatMap((s) => [[`shoulder${s}`, `elbow${s}`, QUADRUPED.front.upper], [`elbow${s}`, `pawF${s}`, QUADRUPED.front.lower]] as const), // prettier-ignore
    ...SIDES.flatMap((s) => [[`hip${s}`, `stifle${s}`, QUADRUPED.hind.thigh], [`stifle${s}`, `hock${s}`, QUADRUPED.hind.shin], [`hock${s}`, `pawH${s}`, QUADRUPED.hind.foot]] as const), // prettier-ignore
    ['chest', 'hips'],
    ['head', 'nose'],
    ...[0, 1, 2].map((i) => [`tail${i}`, `tail${i + 1}`, QUADRUPED.tail.length / QUADRUPED.tail.links] as const),
  ],
  feet: ['pawFL', 'pawFR', 'pawHL', 'pawHR'],
  closed: NAMES.indexOf('head'), // all but its head, which looks about on its clock, and its tail
  states: { rest: 1, walk: 2, trot: 2, run: 2, turn: 1.5, sit: 1.5, look: 1 },
  make(state, facing, dt) {
    const dog = new Quadruped({ yaw: facing, dt });
    const [look, velocity] = [new Vector3(), new Vector3()];
    const hold = QUADRUPED_RIG.states[state];
    return {
      step(time) {
        const on = time !== undefined;
        // the speed eased in and out over 0.3 s, as an actor's body speeds up and brakes; a turn is one in place
        const ramp = on ? Math.min(1, time / 0.3, (hold - time) / 0.3) : 0;
        const top = ({ walk: 1.2, trot: 3, run: 5 } as Record<string, number>)[state] ?? 0;
        velocity.set(Math.sin(facing), 0, Math.cos(facing)).multiplyScalar(top * Math.max(0, ramp));
        const yaw = on && state === 'turn' ? facing + 2 * Math.PI * MathUtils.smoothstep(time, 0, hold) : undefined;
        const seen = on && state === 'look' ? look.set(1.5 * Math.cos(facing), 1.2, -1.5 * Math.sin(facing)).add(dog.position) : null; // prettier-ignore
        dog.step({ position: dog.position.clone().addScaledVector(velocity, dt), velocity, yaw, sit: on && state === 'sit', look: seen }); // prettier-ignore
        return dog.position;
      },
      points() {
        const J = dog.pose();
        const at = (p: readonly number[], m: Matrix4) => new Vector3(p[0], p[1], p[2]).applyMatrix4(m);
        const legs = (['fl', 'fr'] as const).flatMap((leg, i) => [...ends(J[`${leg}0`]), J.paws[i].clone()]);
        const hind = (['hl', 'hr'] as const).flatMap((leg, i) => [ends(J[`${leg}0`])[0], ends(J[`${leg}1`])[0], ends(J[`${leg}2`])[0], J.paws[2 + i].clone()]); // prettier-ignore
        const tail = [ends(J.tail0)[0], ...[J.tail0, J.tail1, J.tail2].map((m) => ends(m)[1])];
        return [dog.position.clone(), at([0, 0.012, 0.173], J.torso), at([0, 0, -0.205], J.torso), ends(J.neck)[0], ...legs, ...hind, at([0, 0, 0], J.head), at([0, -0.019, 0.145], J.head), J.mouth.clone(), ...tail]; // prettier-ignore
      },
    };
  },
};
