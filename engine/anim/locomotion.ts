/**
 * @file Procedural locomotion for the humanoid (PLAN.md WP 3.6, §5.2): my-3d2dge's gait, idle, lean and arm-swing
 * formulas as effector targets in the character's own terms (`B(f, r, u)`, authoring.ts): where the pelvis rides,
 * where each foot and hand swings, which way the spine and the head lean, where the shoulders sit. `GAIT` holds every
 * constant, in metres and radians, each with its line; poses.ts lays the held poses and stances over these targets,
 * and humanoid.ts solves them onto the skeleton.
 *
 * Invariants:
 * - Targets are rig-local and unscaled: metres before the build's `size`, the origin on the ground under the
 *   character, in the model frame (+Z forward, +Y up). The humanoid scales and places them.
 * - Each formula is the source's, with its numbers ÷ 16 where they are lengths: the reference vectors
 *   (tests/baselines/port/humanoid-*.json) hold the port to them (humanoid.test.ts).
 * - Pure functions of the `EffectorContext`: no clock, no random stream, no state of their own.
 *
 * Carried from `my-3d2dge:engine/my-3d2dge.js:1919-1954` (`_pose`: bob, breathing, sway, the pelvis, the stride, the
 * lean, the shoulders, the head and the arm swing).
 *
 * @example
 * import { Vector3 } from '../core/math';
 * import { getBuild } from './builds';
 * const ctx = restContext(getBuild('build:chibi'));
 * pelvisTarget(ctx, new Vector3()).y; // 0.725: the stance height (no breath at clock 0, no bob standing still)
 * gaitFoot(ctx, 'R', new Vector3()); // (-0.11875, 0, 0.05): the right foot, a little ahead, footSpread to the right
 * spineDirection(ctx, new Vector3()); // (0, 1, 0): upright
 * @see engine/anim/poses.test.ts
 */
import { MathUtils, Quaternion, Vector3 } from '../core/math';
import { B, sideSign, turnRight, type LimbSide, type Sided } from './authoring';
import type { Build } from './builds';
import type { ArmState } from './strike';

/** Every constant of the gait, idle, lean and arm swing; lengths in metres (the source's units ÷ 16). */
export const GAIT = {
  /** Breathing: radians of its cycle per second. */
  breatheRate: 2.3,
  /** How far each breath lifts the pelvis, metres (fades out with speed). */
  breatheLift: 0.01875,
  /** The bob's offset at rest, metres: the pelvis sits this much higher at a standstill… */
  bobRest: 0.03125,
  /** …and drops by up to this much at each footfall while moving, metres (× |cos phase|). */
  bobDrop: 0.08125,
  /** Idle weight shift from foot to foot: radians of its cycle per second. */
  swayRate: 1.15,
  /** How far the idle sway moves the pelvis sideways, metres. */
  swayReach: 0.01875,
  /** How far the pelvis leads forward along the movement at full speed, metres. */
  pelvisLead: 0.025,
  /** How far the pelvis leads sideways along the movement at full speed, metres. */
  pelvisSide: 0.01875,
  /** How far a flinch pushes the pelvis back, metres. */
  hurtBack: 0.025,
  /** How far a flinch drops the pelvis, metres. */
  hurtDrop: 0.0375,
  /** How far a dash drops the pelvis, metres. */
  dashDrop: 0.1375,
  /** Share of a lunge the pelvis follows forward. */
  lungePelvis: 0.55,
  /** Share of the stance height (`hipHeight`) the pelvis drops in a full kneel. */
  kneelDrop: 0.42,
  /** How far the guard pose drops the pelvis, metres. */
  guardDrop: 0.05625,
  /** Share of the stance height the pelvis drops in a full crouch. */
  crouchDrop: 0.32,
  /** How far the knees buckle midway through a fall or a get-up, crouch share (× sin(down · π)). */
  fallCrouch: 0.85,
  /** The share of the hips' turn in the shoulders' (body) twist. */
  hipTwist: 0.4,
  /** A standing foot sits this far ahead of the pelvis on the right, metres. */
  standAheadR: 0.05,
  /** A standing foot sits this far ahead of the pelvis on the left (negative: behind), metres. */
  standAheadL: -0.0375,
  /** Forward lean per unit of forward speed share, radians. */
  leanSpeed: 0.16,
  /** Forward lean of a dash, radians. */
  leanDash: 0.45,
  /** Backward lean of a flinch, radians (subtracted). */
  leanHurt: 0.35,
  /** Forward lean of a full crouch, radians. */
  leanCrouch: 0.22,
  /** Sideways lean per unit of sideways speed share, radians. */
  leanSide: 0.1,
  /** Share of the build's `hunch` that tips the head forward. */
  headHunch: 0.9,
  /** A hanging hand rests this far ahead of its shoulder when still, metres. */
  handRest: 0.03125,
  /** A hanging hand moves this far forward per unit of `hunch`, metres. */
  handHunch: 0.1875,
  /** A hanging hand rests this far out from its shoulder, metres. */
  handOut: 0.05625,
  /** A hanging hand drops this share of the arm's length below its shoulder. */
  handDrop: 0.86,
  /** How far a swinging hand lifts at the ends of its swing, metres (× |sin phase|). */
  handLift: 0.075,
} as const;

/** The weights the effector stage reads: each 0 (off) to 1 (full), eased toward its input by the humanoid. */
export interface HumanoidWeights {
  /** Speed share: speed ÷ the build's `speedRef`, up to 1.25. */
  speed: number;
  /** A dash. */
  dash: number;
  /** A flinch. */
  hurt: number;
  /** A move playing (its body motion damps the idle sway). */
  attack: number;
  /** Airborne: the legs tuck. */
  air: number;
  /** The weapon hand held out, aimed. */
  point: number;
  /** Climbing a ladder. */
  climb: number;
  /** Knocked flat (0 standing, 1 lying). */
  down: number;
  /** The guard stance: fists up while moving. */
  stanceGuard: number;
  /** The ready stance: the weapon held forward in both hands. */
  stanceReady: number;
  /** Held pose: arms raised in triumph. */
  cheer: number;
  /** Held pose: both hands forward. */
  cast: number;
  /** Held pose: a boxer's guard. */
  guard: number;
  /** Held pose: on one knee. */
  kneel: number;
  /** Held pose: crouched low. */
  crouch: number;
  /** Held pose: the free hand waves. */
  wave: number;
  /** Held pose: hands on the hips. */
  hips: number;
  /** Held pose: the weapon upright across the body. */
  block: number;
}

/** A move's body motion now, eased toward its targets (a move's arm path asks for them, strike.ts `stepArm`). */
export interface BodyMotion {
  /** Forward step of the pelvis and the lead foot, metres. */
  lunge: number;
  /** Lift of the whole body, metres. */
  hop: number;
  /** Crouch share (0–1). */
  crouch: number;
  /** Extra forward lean, radians. */
  lean: number;
  /** Turn of the shoulders toward the right hand, radians (the hips take `GAIT.hipTwist` of it). */
  twist: number;
}

/** What the effector stage reads: the build, the humanoid's state now and the anchors placed so far. */
export interface EffectorContext {
  /** The build, in metres before `size`. */
  readonly build: Build;
  /** Whether the right hand holds a weapon (the free hand waves, the ready stance holds it). */
  readonly armed: boolean;
  /** Seconds since the breathing phase's origin (the humanoid's clock). */
  readonly clock: number;
  /** The gait's phase, radians: a step every π. */
  readonly phase: number;
  /** The movement direction relative to the facing: forward share. */
  readonly moveF: number;
  /** The movement direction relative to the facing: rightward share. */
  readonly moveR: number;
  /** The hand-over-hand phase on a ladder, radians. */
  readonly climbPhase: number;
  /** The aim, radians above level (+) or below (−). */
  readonly aim: number;
  /** The weights. */
  readonly w: Readonly<HumanoidWeights>;
  /** A move's body motion. */
  readonly body: Readonly<BodyMotion>;
  /** The foot that steps into a lunge. */
  readonly lead: LimbSide;
  /** The speed share, capped at 1 (my-3d2dge's `sp`). */
  readonly sp: number;
  /** The crouch now: the held pose, a move's, or the knees buckling as the body falls. */
  readonly crouch: number;
  /** The arm's length, shoulder to wrist, metres. */
  readonly armLength: number;
  /** The pelvis (my-3d2dge's `hipC`), placed by `pelvisTarget`. */
  readonly pelvis: Vector3;
  /** The shoulder centre, the neck joint (my-3d2dge's `shC`), placed by `spineDirection`. */
  readonly chest: Vector3;
  /** The shoulder joints, placed by `shoulderTarget`. */
  readonly shoulders: Sided<Vector3>;
  /** The hip joints, placed by `hipTarget`. */
  readonly hips: Sided<Vector3>;
  /** A move's arm path (strike.ts), laid over the hands, the kicking foot and the blade; none at rest. */
  readonly arm?: Readonly<ArmState>;
}

/** The share of a full crouch now: the held pose, a move's, or the knees buckling while the body falls or rises. */
export function crouchShare(w: Readonly<HumanoidWeights>, body: Readonly<BodyMotion>): number {
  const fall = Math.sin(MathUtils.clamp(w.down, 0, 1) * Math.PI) * GAIT.fallCrouch;
  return Math.max(w.crouch, body.crouch, fall);
}

/** The pelvis: stance height, bob, breathing and sway, a flinch, a dash, the held poses' drops, a lunge and a hop. */
export function pelvisTarget(ctx: EffectorContext, out: Vector3): Vector3 {
  const { build: b, w, sp, body } = ctx;
  const G = GAIT;
  const breathe = Math.sin(ctx.clock * G.breatheRate) * (1 - sp);
  const bob = (G.bobRest - Math.abs(Math.cos(ctx.phase)) * G.bobDrop) * sp;
  const sway = Math.sin(ctx.clock * G.swayRate) * G.swayReach * (1 - sp) * (1 - w.attack);
  const f = ctx.moveF * G.pelvisLead * sp - G.hurtBack * w.hurt + body.lunge * G.lungePelvis;
  const r = ctx.moveR * G.pelvisSide * sp + sway;
  let u = b.hipHeight + bob + breathe * G.breatheLift - w.dash * G.dashDrop - w.hurt * G.hurtDrop;
  u = u - w.kneel * b.hipHeight * G.kneelDrop - w.guard * G.guardDrop - ctx.crouch * b.hipHeight * G.crouchDrop;
  return B(f, r, u + body.hop, out);
}

/** The hip joint of `side`: the pelvis plus `hipHalf` sideways, turned with the hips' share of the twist. */
export function hipTarget(ctx: EffectorContext, side: LimbSide, out: Vector3): Vector3 {
  const turn = turnRight(ctx.body.twist * GAIT.hipTwist, q);
  return B(0, sideSign(side) * ctx.build.hipHalf, 0, out)
    .applyQuaternion(turn)
    .add(ctx.pelvis);
}

/** The sole of the foot on `side` in the gait: a stride along the movement and a lift, or the standing spread. */
export function gaitFoot(ctx: EffectorContext, side: LimbSide, out: Vector3): Vector3 {
  const { build: b, sp } = ctx;
  const s = sideSign(side);
  const p = ctx.phase + (s > 0 ? Math.PI : 0);
  const along = Math.sin(p) * b.stride * sp;
  const stand = (s > 0 ? GAIT.standAheadR : GAIT.standAheadL) * (1 - sp);
  return B(
    ctx.moveF * along + stand,
    s * b.footSpread + ctx.moveR * along,
    Math.max(0, Math.cos(p)) * b.lift * sp,
    out,
  );
}

/** The spine's direction, pelvis to shoulder centre: the build's lean, speed, a dash, a move, a flinch, a crouch. */
export function spineDirection(ctx: EffectorContext, out: Vector3): Vector3 {
  const { build: b, w, sp } = ctx;
  const G = GAIT;
  const forward =
    b.lean +
    G.leanSpeed * sp * ctx.moveF +
    G.leanDash * w.dash +
    ctx.body.lean -
    G.leanHurt * w.hurt +
    ctx.crouch * G.leanCrouch;
  const side = G.leanSide * sp * ctx.moveR;
  return B(Math.sin(forward), Math.sin(side), Math.cos(forward), out).normalize();
}

/** The head's direction from the shoulder centre: the spine's, tipped forward by the build's `hunch`. */
export function headDirection(ctx: EffectorContext, spine: Vector3, out: Vector3): Vector3 {
  return out
    .copy(spine)
    .add(B(ctx.build.hunch * GAIT.headHunch, 0, 0, v))
    .normalize();
}

/** The shoulder joint of `side`: `shoulderHalf` out from the shoulder centre, turned by the twist, level. */
export function shoulderTarget(ctx: EffectorContext, side: LimbSide, out: Vector3): Vector3 {
  const turn = turnRight(ctx.body.twist, q);
  return B(0, sideSign(side) * ctx.build.shoulderHalf, 0, out)
    .applyQuaternion(turn)
    .add(ctx.chest);
}

/** The hand on `side` in the gait: hanging by the shoulder, swinging against its foot, lifting at each end. */
export function gaitHand(ctx: EffectorContext, side: LimbSide, out: Vector3): Vector3 {
  const { build: b, sp } = ctx;
  const G = GAIT;
  const s = sideSign(side);
  const p = ctx.phase + (s > 0 ? 0 : Math.PI);
  const along = -Math.sin(p) * b.swing * sp;
  const f = ctx.moveF * along + G.handRest * (1 - sp) + b.hunch * G.handHunch;
  const u = -ctx.armLength * G.handDrop + Math.abs(Math.sin(p)) * G.handLift * sp;
  return B(f, s * G.handOut + ctx.moveR * along, u, out).add(ctx.shoulders[side]);
}

/** A context for `build` at rest: every weight 0, the clock and phase at 0, the anchors placed. For tests and docs. */
export function restContext(build: Build): EffectorContext {
  const zero = { speed: 0, dash: 0, hurt: 0, attack: 0, air: 0, point: 0, climb: 0, down: 0 };
  const w = { ...zero, stanceGuard: 0, stanceReady: 0, cheer: 0, cast: 0, guard: 0, kneel: 0 };
  const ctx = {
    build,
    armed: false,
    clock: 0,
    phase: 0,
    moveF: 1,
    moveR: 0,
    climbPhase: 0,
    aim: 0,
    w: { ...w, crouch: 0, wave: 0, hips: 0, block: 0 },
    body: { lunge: 0, hop: 0, crouch: 0, lean: 0, twist: 0 },
    lead: 'L' as LimbSide,
    sp: 0,
    crouch: 0,
    armLength: build.armUpper + build.armLower,
    pelvis: new Vector3(),
    chest: new Vector3(),
    shoulders: { L: new Vector3(), R: new Vector3() },
    hips: { L: new Vector3(), R: new Vector3() },
  };
  pelvisTarget(ctx, ctx.pelvis);
  ctx.chest.copy(spineDirection(ctx, v)).multiplyScalar(build.torso).add(ctx.pelvis);
  for (const side of ['L', 'R'] as const) {
    shoulderTarget(ctx, side, ctx.shoulders[side]);
    hipTarget(ctx, side, ctx.hips[side]);
  }
  return ctx;
}

/** Scratch objects. */
const q = new Quaternion();
const v = new Vector3();
