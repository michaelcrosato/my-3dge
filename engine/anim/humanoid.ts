/**
 * @file The procedural humanoid (PLAN.md WP 3.6, §5.2; I-09): my-3d2dge's `Humanoid` on the rotation skeleton.
 * `step(input)` eases the state toward the input at a fixed step (humanoidRates.ts): the weights, the gait's phase,
 * the clocks. `solve()` runs the effector stage (poses.ts `effectorStage`: locomotion.ts's gait, then the pose layers
 * in order) and the solve stage (authoring.ts: the spine from lean and twist, the arms and legs through `twoBoneRot`
 * with the old hints as poles, the feet, the weapon hand), writing `pose` and its FK, `world`; `update` does both.
 *
 * Invariants:
 * - `step` is the sim's part: `state` is plain numbers (WP 3.7 hashes and captures it). `solve` reads only `state`,
 *   `position` and `yaw`, and starts from a cleared pose, so it may run in the presentation, as often as wanted, with
 *   the same result.
 * - A fixed step, `dt` (`SIM_DT` by default). The breathing phase and the blinks come from the entity's stream
 *   (`rng`); `clock` sets the phase instead (the differential tests inject the reference rig's).
 * - `effectors` are rig-local metres before `size`, in the model frame (+Z forward, +Y up), placed by the root:
 *   `rootRot` is the yaw (times the knockdown's turn), `rootPos` carries the pelvis's offset (`rootOffset`).
 * - Where the joints land (humanoid.test.ts checks it against the reference vectors): on the old rig's points (`hipC`,
 *   `shC`, `head`, the shoulders, elbows, wrists, hips, the blade, the sole under each ankle); the old leg had no
 *   ankle, so where a planted foot lies flat or its heel lifts (authoring.ts `solveLeg`) the knee and the sole move,
 *   3 mm on average and 2 cm at worst; elsewhere the joints match to float32 rounding.
 * - The removed view hacks (`_cheat`, `_pitch`, `_camSide`) have no counterpart: the camera never feeds animation.
 *   What the view shows of the movement (`shown`, WP 13.10) is presentation, never stepped or saved; `stance()` and
 *   `treadmill()` tell the foot plant's locks when the feet stand and how the ground moves under them.
 * - A move plays through `input.body` (WP 6.1): `step` steps its arm path (strike.ts, `state.arm`), the effector
 *   stage lays it, a spin turns the root. A swing's start comes from the effector stage of the state before the step,
 *   never from a pose, so posing or not leaves the state as it is. A body motion given instead is taken as it is.
 *
 * Carried from `my-3d2dge:engine/my-3d2dge.js:1803-1871` (`update`, the state) and `:1917-1994` (`_pose`; the
 * knockdown's rigid turn at `:1989-1993`, as a root rotation). Squash, hair and cape are secondary motion (WP 6.2).
 *
 * @example
 * import { Vector3 } from '../core/math';
 * import { Rng } from '../core/rng';
 * import { jointPosition } from './fk';
 * const hero = new Humanoid({ build: 'build:heroic', weapon: 'sword', rng: new Rng(7) });
 * for (let i = 0; i < 60; i++) hero.update({ velocity: new Vector3(0, 0, 5), position: new Vector3(0, 0, i / 12) });
 * hero.state.weights.speed; // 1: walking at its reference speed
 * jointPosition(hero.world, 'head').y; // ≈ 1.6: the base of the skull
 * hero.update({ body: { move: 'move:slash', phase: 'active', u: 0.5 } }).state.arm.weight; // 0.5: a strike begins
 * @see engine/anim/humanoid.test.ts
 */
import { log as engineLog, type Log } from '../core/log';
import { approach, MathUtils, Quaternion, Vector3 } from '../core/math';
import { Rng } from '../core/rng';
import { SIM_DT } from '../core/time';
import { B, holdAlong, relaxHand, SIDES, sideSign, solveArm, solveLeg, solveSpine, type Rig, type LimbSide } from './authoring'; // prettier-ignore
import { getBuild, type Build } from './builds';
import { createWorldPose, forwardKinematics, type WorldPose } from './fk';
import { crouchShare, gaitKnee, gaitStance, strideShare, type BodyMotion, type EffectorContext, type HumanoidWeights } from './locomotion'; // prettier-ignore
import { GAIT } from './locomotion/gait';
import { onFeet } from './locomotion/locks';
import { plantedEase, plantedMove } from './locomotion/planted';
import { createShown, type ShownMovement } from './locomotion/shown';
import { Pose } from './pose';
import type { MoveInput } from './moves-data';
import { poseName, stanceName, weaponName, type PoseName, type StanceName, type Weapon } from './poseNames';
import { createEffectors, effectorStage, type Effectors } from './poses';
import { createSkeleton, jointIndex, type Skeleton } from './skeleton';
import { KNOCKDOWN, STEP } from './humanoidRates';
import { createArmState, stepArm, type ArmState } from './strike';

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
  /**
   * A move playing (WP 6.1): the move at its phase and share (`moveAt`, `Attack.body`), whose arm path and body
   * motion the humanoid plays; or a body motion's targets alone, and the foot that leads a lunge.
   */
  body?: MoveInput | (Partial<BodyMotion> & { lead?: LimbSide });
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
  /** A move's arm path now (strike.ts). */
  arm: ArmState;
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
  /**
   * What the view shows beyond the sim's state (WP 13.10, engine/anim/locomotion/shown.ts): the movement's crouch,
   * slide, air, landing and lean, which the view eases (locomotion/motion.ts) and sets before each pose. Presentation
   * only: never stepped or saved, so no hash sees it.
   */
  readonly shown: ShownMovement = createShown();
  readonly #rng: Rng;
  /** The last step's `run`: running in place. */
  #run = 0;
  readonly #log: Log;
  /** The effectors of the state before a step, for a swing's start. */
  readonly #before: Effectors = createEffectors();

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
      arm: createArmState(),
    };
    this.solve();
  }

  /** Eases the state one fixed step toward `input`: the sim's part. Warns once for a misspelt pose or stance. */
  step(input: HumanoidInput = {}): this {
    const { dt, build: b, state: st } = this;
    const S = STEP;
    const w = st.weights;
    const move = input.body && 'move' in input.body ? input.body : undefined;
    const arm = { armed: this.weapon !== 'none', armLength: b.armUpper + b.armLower };
    const before = () => effectorStage(this.#context(this.#before), this.weapon, this.#before);
    const motion = stepArm(st.arm, move, arm, before, dt, this.#log);
    st.clock += dt;
    if (input.position) this.position.copy(input.position);
    if (input.yaw !== undefined) this.yaw = input.yaw;
    const vel = input.velocity ?? ZERO;
    this.#run = input.run ?? 0;
    const speed = input.run ? input.run * b.speedRef : Math.hypot(vel.x, vel.z);
    w.speed = approach(w.speed, MathUtils.clamp(speed / b.speedRef, 0, S.speedShareMax), dt * S.speed);
    if (speed > S.turnSpeed && !input.run) {
      const k = Math.min(1, dt * S.turnRate);
      const [sin, cos] = [Math.sin(this.yaw), Math.cos(this.yaw)];
      st.moveF = MathUtils.lerp(st.moveF, (vel.x * sin + vel.z * cos) / speed, k);
      st.moveR = MathUtils.lerp(st.moveR, (vel.z * sin - vel.x * cos) / speed, k);
    }
    st.phase += (dt * speed) / (b.stride * b.size * strideShare(w.speed, b.plantedStride, w.crouch, plantedMove(st.moveF, st.moveR)[1])); // prettier-ignore
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
    const direct = move ? undefined : (input.body as Partial<BodyMotion> & { lead?: LimbSide });
    const body = (move ? motion : direct) ?? {};
    if (body.lead) st.lead = sideSign(body.lead);
    for (const channel of ['lunge', 'hop', 'crouch', 'lean', 'twist'] as const) {
      st.body[channel] = MathUtils.lerp(st.body[channel], body[channel] ?? 0, Math.min(1, dt * S.body[channel]));
    }
    return this;
  }

  /** The effector stage, then the solve stage: writes `effectors`, `pose` and `world`. */
  solve(): this {
    const [E, ctx] = [this.effectors, this.#context()];
    effectorStage(ctx, this.weapon, E);
    this.#placeRoot();
    solveSpine(this, E, this.state.body.twist * GAIT.hipTwist, this.state.body.twist);
    for (const side of SIDES) solveArm(this, side, E.hands[side]);
    const roll = this.build.plantedStride && onFeet(this.state.weights); // a planted foot rolls on its ball and heel
    for (const side of SIDES) solveLeg(this, side, E.feet[side], roll, roll ? plantedEase(ctx.sp) : 0, roll ? gaitKnee(ctx, side) : 0); // prettier-ignore
    for (const side of SIDES) if (side === 'L' || this.weapon === 'none') relaxHand(this, side);
    if (this.weapon !== 'none') holdAlong(this, E.blade);
    forwardKinematics(this.skeleton, this.pose, this.world);
    return this;
  }

  /**
   * Whether each foot (left, right) stands now, for the foot plant's stance locks (footPlant.ts): a `plantedStride`
   * build on its feet (locomotion/locks.ts `onFeet`), walking or standing (locomotion.ts `gaitStance`). Null for another
   * build: its feet lock nowhere.
   */
  stance(): [boolean, boolean] | null {
    const ctx = this.#context();
    const left = gaitStance(ctx, 'L');
    if (left === null) return null;
    return onFeet(this.state.weights) ? [left, gaitStance(ctx, 'R') === true] : [false, false];
  }

  /** The ground's own velocity under a body told to `run` in place (a treadmill), m/s, world; zero otherwise. */
  treadmill(out = new Vector3()): Vector3 {
    const speed = this.#run * this.build.speedRef;
    return out.set(-Math.sin(this.yaw) * speed, 0, -Math.cos(this.yaw) * speed);
  }

  /** `step(input)`, then `solve()`. */
  update(input: HumanoidInput = {}): this {
    return this.step(input).solve();
  }

  /** What the effector stage reads now, its anchors placed in `E` (the humanoid's effectors by default). */
  #context(E: Effectors = this.effectors): EffectorContext {
    const { state: st, build: b } = this;
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
      sp: Math.min(1, st.weights.speed) * (1 - this.shown.slide), // a slide glides: no stride
      crouch: Math.max(crouchShare(st.weights, st.body), this.shown.crouch),
      slide: this.shown.slide,
      shown: this.shown,
      armLength: b.armUpper + b.armLower,
      pelvis: E.pelvis,
      chest: E.chest,
      shoulders: E.shoulders,
      hips: E.hips,
      arm: st.arm,
    };
  }

  /** Clears the pose and places the root: the yaw, the knockdown's turn and slide, the pelvis's offset. */
  #placeRoot(): void {
    const { pose: P, build: b, effectors: E } = this;
    const s = b.size;
    const down = this.state.weights.down;
    yaw.setFromAxisAngle(UP, this.yaw + this.state.arm.turn);
    knock.setFromAxisAngle(X_AXIS, -down * KNOCKDOWN.turn);
    P.reset();
    P.rootRot.copy(yaw).multiply(knock);
    const rest = v.fromArray(this.skeleton.offsets, jointIndex('pelvis') * 3);
    this.rootOffset.copy(E.pelvis).multiplyScalar(s).sub(rest);
    const slide = B(down * KNOCKDOWN.shift * (b.hipHeight + b.torso), 0, down * KNOCKDOWN.lift, v).multiplyScalar(s);
    P.rootPos.copy(this.rootOffset).applyQuaternion(knock).add(slide).applyQuaternion(yaw).add(this.position);
  }
}
