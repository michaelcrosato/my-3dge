/**
 * @file The procedural humanoid (PLAN.md WP 3.6, §5.2; I-09): my-3d2dge's `Humanoid` on the rotation skeleton.
 * `step(input)` eases the state toward the input at a fixed step: the weights, the gait's phase, the clocks.
 * `solve()` runs the effector stage (poses.ts `effectorStage`: locomotion.ts's gait, then the pose layers in order)
 * and the solve stage (authoring.ts: the spine from lean and twist, the arms and legs through `twoBoneRot` with the
 * old hints as poles, the feet, the weapon hand), writing `pose` and its FK, `world`. `update(input)` does both.
 *
 * Invariants:
 * - `step` is the sim's part: `state` is plain numbers (WP 3.7 hashes and captures it). `solve` reads only `state`,
 *   `position` and `yaw`, and starts from a cleared pose, so it may run in the presentation, as often as wanted, with
 *   the same result.
 * - A fixed step, `dt` (`SIM_DT` by default). The breathing phase and the blinks come from the entity's stream
 *   (`rng`); `clock` sets the phase instead (the differential tests inject the reference rig's).
 * - `effectors` are rig-local metres before `size`, in the model frame (+Z forward, +Y up). The root places them:
 *   `rootRot` is the yaw (times the knockdown's turn), `rootPos` carries the pelvis's offset from its rest
 *   (`rootOffset`).
 * - Where the joints land (humanoid.test.ts checks it against the reference vectors): the pelvis on the old `hipC`,
 *   the neck joint on `shC`, the head's centre on `head`, the upper arms on `shL`/`shR`, the elbows, wrists and hips
 *   on theirs, the blade from the right wrist along the weapon socket's +Z, and the sole under each ankle on the old
 *   foot point. The old leg had no ankle: where a planted foot lies flat or its heel lifts (authoring.ts
 *   `solveLeg`), the knee and the sole move, about 3 mm on average and 2 cm at worst; elsewhere the joints match to
 *   float32 rounding.
 * - The removed view hacks (`_cheat`, `_pitch`, `_camSide`) have no counterpart: the camera never feeds animation.
 *
 * Carried from `my-3d2dge:engine/my-3d2dge.js:1803-1871` (`update`, the state) and `:1917-1994` (`_pose`; the
 * knockdown's rigid turn at `:1989-1993`, as a root rotation). The attack's arm path, the squash, hair and cape
 * belong to moves (WP 6.1) and secondary motion (WP 6.2); `input.body` is a move's slot.
 *
 * @example
 * import { Vector3 } from '../core/math';
 * import { Rng } from '../core/rng';
 * import { jointPosition } from './fk';
 * const hero = new Humanoid({ build: 'build:heroic', weapon: 'sword', rng: new Rng(7) });
 * for (let i = 0; i < 60; i++) hero.update({ velocity: new Vector3(0, 0, 5), position: new Vector3(0, 0, i / 12) });
 * hero.state.weights.speed; // 1: walking at its reference speed
 * jointPosition(hero.world, 'head').y; // ≈ 1.6: the base of the skull
 * for (let i = 0; i < 30; i++) hero.update({ pose: 'cheer' });
 * hero.state.weights.cheer; // 1: both fists up
 * @see engine/anim/humanoid.test.ts
 */
import { log as engineLog, type Log } from '../core/log';
import { approach, MathUtils, Quaternion, Vector3 } from '../core/math';
import { Rng } from '../core/rng';
import { SIM_DT } from '../core/time';
import { B, holdAlong, SIDES, sideSign, solveArm, solveLeg, solveSpine, type Rig, type Side } from './authoring';
import { getBuild, type Build } from './builds';
import { createWorldPose, forwardKinematics, type WorldPose } from './fk';
import { crouchShare, GAIT, type BodyMotion, type EffectorContext, type HumanoidWeights } from './locomotion';
import { Pose } from './pose';
import { createEffectors, effectorStage, poseName, stanceName, weaponName, type Effectors } from './poses';
import type { PoseName, StanceName, Weapon } from './poses';
import { createSkeleton, jointIndex, type Skeleton } from './skeleton';

/** Every constant of the state update: rates are per second, times in seconds; pairs are [in, out]. */
export const STEP = {
  /** Rate the speed weight eases toward the speed share. */
  speed: 7,
  /** Top of the speed share (speed ÷ the build's `speedRef`): a sprint stretches the stride. */
  speedShareMax: 1.25,
  /** Slowest speed that turns the movement direction, m/s (3 source units/s). */
  turnSpeed: 0.1875,
  /** Share of the way the movement direction follows the velocity, per second (at most all of it per step). */
  turnRate: 10,
  /** Floor of the speed weight in the stride's length: slow steps are short, not slow. */
  strideFloor: 0.4,
  /** Rates a dash eases in and out. */
  dash: [24, 8],
  /** Rate a flinch eases in and out. */
  hurt: 14,
  /** Rates a move's weight eases in and out. */
  attack: [30, 7],
  /** Rates the airborne tuck eases in and out (a landing is quick). */
  air: [10, 18],
  /** Rate a held pose eases in and out. */
  pose: 9,
  /** Rate a stance eases in and out. */
  stance: 10,
  /** Rate the climb eases in and out. */
  climb: 12,
  /** Share of the arm's length a hand climbs per half cycle, so the hands keep pace with the climb. */
  climbReach: 0.4,
  /** Rates pointing eases in and out. */
  point: [30, 8],
  /** Rate the aim turns, radians per second. */
  aim: 14,
  /** The die pose: a flinch until `hurt`, the knees giving over `kneel` at `kneelRate`, the topple from `down`. */
  die: { hurt: 0.25, kneel: [0.2, 0.6], kneelRate: 10, down: 0.45 },
  /** A fall's rate starts at `rate` and gains `gain` per unit fallen (faster and faster); it gets up at `rise`. */
  fall: { rate: 2.5, gain: 10, rise: 3.2 },
  /** Blinks: shut for `shut`, then open `gap` plus up to `spread` more, from the entity's stream. */
  blink: { shut: 0.12, gap: 2, spread: 3 },
  /** The breathing clock starts up to this far in, from the entity's stream. */
  clockSpread: 10,
  /** Share of the way each channel of a move's body motion eases, per second (at most all of it per step). */
  body: { lunge: 22, hop: 25, crouch: 20, lean: 25, twist: 25 },
} as const;

/** Every constant of the knockdown (a rigid turn of the whole body, until reactions take it over, WP 6.2). */
export const KNOCKDOWN = {
  /** The body's turn back at full weight, radians: 0.96 of a quarter turn. */
  turn: 0.96 * (Math.PI / 2),
  /** How far the body lifts, metres. */
  lift: 0.0875,
  /** Share of `hipHeight + torso` the body slides forward, to lie centred on its position. */
  shift: 0.5,
} as const;

/** The poses with a weight of their own (`die` and `down` drive the down weight instead). */
const HELD = ['cheer', 'cast', 'guard', 'kneel', 'crouch', 'wave', 'hips', 'block'] as const;

/** What a humanoid is made from. */
export interface HumanoidOptions {
  /** Its build, or the build's id; `build:chibi` by default. */
  build?: Build | string;
  /** What its right hand holds; `'none'` by default. */
  weapon?: Weapon;
  /** The entity's own stream (in a scene, `w.rng.entity(id, 'anim')`): the breathing phase and the blinks. Seed 0 by default. */
  rng?: Rng;
  /** The breathing clock's start, seconds; drawn from `rng` (0–10 s) by default. */
  clock?: number;
  /** The fixed step, seconds; `SIM_DT` by default. */
  dt?: number;
  /** Where it reports a misspelt pose, stance or weapon; the engine's log by default. */
  log?: Log;
}

/** What a humanoid is told each step; every field is optional. */
export interface HumanoidInput {
  /** The ground point under it, world metres; kept from the last step when absent. */
  position?: Vector3;
  /** Its velocity, m/s: the horizontal part drives the gait, the vertical the climb. */
  velocity?: Vector3;
  /** Its heading, radians: forward is (sin yaw, 0, cos yaw). Kept from the last step when absent. */
  yaw?: number;
  /** 0–1: run in place at this share of the build's `speedRef` (a treadmill). */
  run?: number;
  /** Dashing. */
  dash?: boolean;
  /** Hurt: a flinch. */
  hurt?: boolean;
  /** Airborne: the legs tuck. */
  air?: boolean;
  /** Climbing a ladder, hand over hand, at the vertical velocity. */
  climb?: boolean;
  /** The weapon hand held out along the aim. */
  point?: boolean;
  /** Radians above level (+) or below (−) while pointing. */
  aim?: number;
  /** A held pose (`POSES`). */
  pose?: PoseName;
  /** A stance held while moving (`STANCES`). */
  stance?: StanceName;
  /** 0–1: knocked flat, overriding the `die` and `down` poses. */
  down?: number;
  /** A move's body motion while it plays (moves fill it, WP 6.1): its targets, and the foot that leads a lunge. */
  body?: Partial<BodyMotion> & { lead?: Side };
}

/** The humanoid's state: plain numbers, what the sim keeps of it. */
export interface HumanoidState {
  /** Seconds on the breathing clock. */
  clock: number;
  /** The gait's phase, radians: a step every π. */
  phase: number;
  /** The movement direction relative to the facing: forward share. */
  moveF: number;
  /** The movement direction relative to the facing: rightward share. */
  moveR: number;
  /** The hand-over-hand phase on a ladder, radians. */
  climbPhase: number;
  /** Seconds into the die pose; 0 when not dying. */
  dieTime: number;
  /** The aim now, radians. */
  aim: number;
  /** Seconds to the next blink; the eyes are shut while it is below 0. */
  blink: number;
  /** The foot that steps into a lunge: −1 left, 1 right. */
  lead: number;
  /** The weights, 0–1 each. */
  weights: HumanoidWeights;
  /** A move's body motion now. */
  body: BodyMotion;
}

const ZERO = new Vector3();
const [UP, X_AXIS] = [new Vector3(0, 1, 0), new Vector3(1, 0, 0)];
/** Scratch objects. */
const [v, yaw, knock] = [new Vector3(), new Quaternion(), new Quaternion()];

/** A procedural humanoid: state, effectors, pose. See the file comment. */
export class Humanoid implements Rig {
  /** Its build. */
  readonly build: Build;
  /** Its skeleton, made from the build. */
  readonly skeleton: Skeleton;
  /** What its right hand holds. */
  readonly weapon: Weapon;
  /** The fixed step, seconds. */
  readonly dt: number;
  /** The state `step` eases. */
  readonly state: HumanoidState;
  /** The ground point under it, world metres. */
  readonly position = new Vector3();
  /** Its heading, radians. */
  yaw = 0;
  /** The pose the last `solve` wrote. */
  readonly pose = new Pose();
  /** The pose's FK. */
  readonly world: WorldPose = createWorldPose();
  /** The last effector stage's targets. */
  readonly effectors: Effectors = createEffectors();
  /** Where the root sits in the rig frame, metres after `size`: the pelvis's target less its rest offset. */
  readonly rootOffset = new Vector3();
  readonly #rng: Rng;
  readonly #log: Log;

  /** A humanoid standing at the origin, facing +Z. Warns `ANIM_UNKNOWN_POSE` for an unknown weapon. */
  constructor(options: HumanoidOptions = {}) {
    this.build = typeof options.build === 'object' ? options.build : getBuild(options.build ?? 'build:chibi');
    this.skeleton = createSkeleton(this.build);
    this.#log = options.log ?? engineLog;
    this.weapon = weaponName(options.weapon, this.#log) ?? 'none';
    this.dt = options.dt ?? SIM_DT;
    this.#rng = options.rng ?? new Rng(0);
    const zero = { speed: 0, dash: 0, hurt: 0, attack: 0, air: 0, point: 0, climb: 0, down: 0 };
    const held = Object.fromEntries(HELD.map((name) => [name, 0])) as Record<(typeof HELD)[number], number>;
    this.state = {
      clock: options.clock ?? this.#rng.next() * STEP.clockSpread,
      phase: 0,
      moveF: 1,
      moveR: 0,
      climbPhase: 0,
      dieTime: 0,
      aim: 0,
      blink: 2,
      lead: -1,
      weights: { ...zero, stanceGuard: 0, stanceReady: 0, ...held },
      body: { lunge: 0, hop: 0, crouch: 0, lean: 0, twist: 0 },
    };
    this.solve();
  }

  /** Eases the state one fixed step toward `input`: the sim's part. Warns once for a misspelt pose or stance. */
  step(input: HumanoidInput = {}): this {
    const { dt, build: b, state: st } = this;
    const S = STEP;
    const w = st.weights;
    st.clock += dt;
    if (input.position) this.position.copy(input.position);
    if (input.yaw !== undefined) this.yaw = input.yaw;
    const vel = input.velocity ?? ZERO;
    const speed = input.run ? input.run * b.speedRef : Math.hypot(vel.x, vel.z);
    w.speed = approach(w.speed, MathUtils.clamp(speed / b.speedRef, 0, S.speedShareMax), dt * S.speed);
    if (speed > S.turnSpeed && !input.run) {
      const k = Math.min(1, dt * S.turnRate);
      const [sin, cos] = [Math.sin(this.yaw), Math.cos(this.yaw)];
      st.moveF = MathUtils.lerp(st.moveF, (vel.x * sin + vel.z * cos) / speed, k);
      st.moveR = MathUtils.lerp(st.moveR, (vel.z * sin - vel.x * cos) / speed, k);
    }
    st.phase += (dt * speed) / (b.stride * b.size * Math.max(S.strideFloor, Math.min(1, w.speed)));
    const ease = (now: number, on: boolean | undefined, [up, down]: readonly [number, number]) =>
      approach(now, on ? 1 : 0, dt * (on ? up : down));
    w.dash = ease(w.dash, input.dash, S.dash);
    w.hurt = approach(w.hurt, input.hurt ? 1 : 0, dt * S.hurt);
    w.attack = ease(w.attack, input.body !== undefined, S.attack);
    w.air = ease(w.air, input.air, S.air);
    const pose = poseName(input.pose, this.#log);
    for (const name of HELD) w[name] = approach(w[name], pose === name ? 1 : 0, dt * S.pose);
    const stance = stanceName(input.stance, this.#log);
    w.stanceGuard = approach(w.stanceGuard, stance === 'guard' ? 1 : 0, dt * S.stance);
    w.stanceReady = approach(w.stanceReady, stance === 'ready' ? 1 : 0, dt * S.stance);
    w.climb = approach(w.climb, input.climb ? 1 : 0, dt * S.climb);
    const rung = S.climbReach * (b.armUpper + b.armLower) * b.size;
    if (input.climb) st.climbPhase += ((dt * Math.abs(vel.y)) / rung) * Math.PI;
    st.dieTime = pose === 'die' ? st.dieTime + dt : 0;
    const dying = st.dieTime > S.die.down;
    const down = input.down !== undefined ? MathUtils.clamp(input.down, 0, 1) : pose === 'down' || dying ? 1 : 0;
    w.down = approach(w.down, down, dt * (down > w.down ? S.fall.rate + S.fall.gain * w.down : S.fall.rise));
    if (st.dieTime > 0) {
      w.hurt = approach(w.hurt, st.dieTime < S.die.hurt ? 1 : 0, dt * S.hurt);
      const kneel = st.dieTime > S.die.kneel[0] && st.dieTime < S.die.kneel[1] ? 1 : 0;
      w.kneel = approach(w.kneel, kneel, dt * S.die.kneelRate);
    }
    w.point = ease(w.point, input.point, S.point);
    st.aim = approach(st.aim, input.aim ?? 0, dt * S.aim);
    st.blink -= dt;
    if (st.blink < -S.blink.shut) st.blink = S.blink.gap + this.#rng.next() * S.blink.spread;
    const body = input.body ?? {};
    if (body.lead) st.lead = sideSign(body.lead);
    for (const channel of ['lunge', 'hop', 'crouch', 'lean', 'twist'] as const) {
      st.body[channel] = MathUtils.lerp(st.body[channel], body[channel] ?? 0, Math.min(1, dt * S.body[channel]));
    }
    return this;
  }

  /** The effector stage, then the solve stage: writes `effectors`, `pose` and `world`. */
  solve(): this {
    const E = this.effectors;
    effectorStage(this.#context(), this.weapon, E);
    this.#placeRoot();
    solveSpine(this, E, this.state.body.twist * GAIT.hipTwist, this.state.body.twist);
    for (const side of SIDES) solveArm(this, side, E.hands[side]);
    for (const side of SIDES) solveLeg(this, side, E.feet[side]);
    if (this.weapon !== 'none') holdAlong(this, E.blade);
    forwardKinematics(this.skeleton, this.pose, this.world);
    return this;
  }

  /** `step(input)`, then `solve()`. */
  update(input: HumanoidInput = {}): this {
    return this.step(input).solve();
  }

  /** What the effector stage reads now. */
  #context(): EffectorContext {
    const { state: st, effectors: E, build: b } = this;
    return {
      build: b,
      armed: this.weapon !== 'none',
      clock: st.clock,
      phase: st.phase,
      moveF: st.moveF,
      moveR: st.moveR,
      climbPhase: st.climbPhase,
      aim: st.aim,
      w: st.weights,
      body: st.body,
      lead: st.lead > 0 ? 'R' : 'L',
      sp: Math.min(1, st.weights.speed),
      crouch: crouchShare(st.weights, st.body),
      armLength: b.armUpper + b.armLower,
      pelvis: E.pelvis,
      chest: E.chest,
      shoulders: E.shoulders,
      hips: E.hips,
    };
  }

  /** Clears the pose and places the root: the yaw, the knockdown's turn and slide, the pelvis's offset. */
  #placeRoot(): void {
    const { pose: P, build: b, effectors: E } = this;
    const s = b.size;
    const down = this.state.weights.down;
    yaw.setFromAxisAngle(UP, this.yaw);
    knock.setFromAxisAngle(X_AXIS, -down * KNOCKDOWN.turn);
    P.reset();
    P.rootRot.copy(yaw).multiply(knock);
    const rest = v.fromArray(this.skeleton.offsets, jointIndex('pelvis') * 3);
    this.rootOffset.copy(E.pelvis).multiplyScalar(s).sub(rest);
    const slide = B(down * KNOCKDOWN.shift * (b.hipHeight + b.torso), 0, down * KNOCKDOWN.lift, v).multiplyScalar(s);
    P.rootPos.copy(this.rootOffset).applyQuaternion(knock).add(slide).applyQuaternion(yaw).add(this.position);
  }
}
