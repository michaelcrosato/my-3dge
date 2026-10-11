/**
 * @file Moves on a body (PLAN.md WP 6.1, §6.4; I-10): my-3d2dge's strike, ported onto the rotation skeleton. A move
 * at a phase and a share of it (`MoveInput`, moves-data.ts) gives the arm's path now (the swing angle, the height, the
 * reach) and the body's motion (lean, lunge, hop, crouch, twist, a spin's turn): `stepArm` takes one fixed step of it,
 * easing the arm's weight and keeping where a swing started; `layArm` and `armBlade` lay the striking hand (or foot),
 * the other hand and the blade over a body's effectors. `MoveRig` plays moves on a procedural humanoid with them.
 * `moveAt` names a move at a moment (previews, sheets); `measureMove` measures its hit shape on a spare body;
 * `strikeSegment` is where the striking part is; `inArc`, `inHitShape` and `knockback` are the hit helpers.
 *
 * Invariants:
 * - The arm state (`ArmState`) is plain numbers, stepped at a fixed step from the move and the body's last effectors;
 *   laying it reads nothing else, so a body's solve stays a function of its state.
 * - A new swing starts its wind from where the arm was: the hands and blade of the last effectors, and the last path
 *   when the arm is still raised (weight above 0.3), as my-3d2dge chained hits. A chain from a kick into a hand move
 *   (or back) starts its height at rest: the old rig mixed a share of the hip height with a height in units there.
 * - The humanoid has no arm path of its own yet (engine/anim/humanoid.ts leaves `input.body` for a move's body
 *   motion): `MoveRig` lays the arm after the humanoid's solve and solves the spine and limbs again from the same
 *   effectors, which is the humanoid's own solve with the move laid in. A blade layer (cheer, block, the ready stance,
 *   point) still shows over a strike here; my-3d2dge faded the ready stance out under it.
 * - moves.test.ts holds all 24 moves to my-3d2dge's reference vectors (tests/baselines/port/moves.json): the hands,
 *   the blade's tip and the right foot within 1 cm on average and 3 cm at worst.
 * - `measureMove` runs under the sim's math (engine/core/simMath.ts) and caches by what it measured (the move's fields,
 *   the build's, the weapon), so a changed move or build is measured again and the same bits come back everywhere.
 *
 * Carried from `my-3d2dge:engine/my-3d2dge.js:1842-1867` (the attack's path and body motion, `armW`),
 * `:1950-1951` (the striking hand's target and the blade's direction), `:1969-1986` (the hands, the kick's arms, the
 * blade), `:1937` (the kicking foot), `:2574-2582` (`E.move`, `E.knockback`), `:194` (`inArc`) and
 * `src/emberdeep/30-monsters-core.js:31-41` (`measureAttacks`: the mechanism, measured on a spare rig).
 *
 * @example
 * import { Vector3 } from '../core/math';
 * const hero = new MoveRig({ build: 'build:heroic', weapon: 'sword', clock: 0 });
 * for (let i = 0; i < 10; i++) hero.update({ move: moveAt('slash', i / 10, 'active') });
 * hero.arm.weight; // 1: the arm follows the swing
 * measureMove('thrust', { build: 'build:heroic', weapon: 'sword' }).range; // ≈ 1.69 m: the blade's tip at its farthest
 * inArc(new Vector3(), 0, new Vector3(0, 0, 1), 1.5, 0.5); // true: 1 m straight ahead
 * @see engine/anim/moves.test.ts
 */
import { angDiff, approach, ease, MathUtils, Quaternion, Vector3 } from '../core/math';
import { withSimMath } from '../core/simMath';
import {
  B,
  fromFRU,
  holdAlong,
  SIDES,
  sideSign,
  solveArm,
  solveLeg,
  solveSpine,
  type FRU,
  type Sided,
} from './authoring';
import { getBuild, type Build } from './builds';
import { TRAIL } from './character';
import { jointPosition, jointRotation, socketPosition, forwardKinematics } from './fk';
import { Humanoid, type HumanoidInput, type HumanoidOptions } from './humanoid';
import { crouchShare, GAIT, type BodyMotion, type EffectorContext } from './locomotion';
import { resolveMove, REFERENCE_ARM, type Move, type MoveInput, type MovePhase, type MoveSpec } from './moves-data';
import { applyLayers, BLADE_LAYERS, DROPPED_BLADE, WEAPONS, type Effectors, type Weapon } from './poses';
import type { TrailName } from './states';

const TAU = Math.PI * 2;

/** Every constant of the arm path: my-3d2dge's numbers, lengths ÷ 16 in metres before the build's size. */
export const ARM = {
  /** The swing angle a wind starts from at rest: level (ground plane) or vertical, radians. */
  rest: { ground: 1.1, vertical: -0.9 },
  /** The height a hand strike starts from at rest, metres from the shoulder centre; a kick's, share of hip height. */
  restHeight: { hand: -0.4375, kick: 0.1 },
  /** The arm weight above which a new swing starts from the last one's path (a chain). */
  chain: 0.3,
  /** Rates the arm's weight eases in and out, per second. */
  rates: [30, 12] as const,
  /** On the vertical plane, the striking hand sits this far out to its side, metres. */
  side: 0.05,
  /** The blade's direction leans this far down on the ground plane, and this far out on the vertical. */
  bladeDown: 0.12,
  bladeOut: 0.05,
  /** A two-hand grip: the other hand this far down the blade from the striking hand, metres. */
  grip: 0.10625,
  /** The free hand pulls back here from the shoulder centre (armed, no guard), and follows at 0.85 of the weight. */
  pullBack: [0.1, 0.1, -0.1] as FRU,
  pullShare: 0.85,
  /** During a kick both hands rise for balance, from the shoulder centre; the right drops `kickArmDrop` more. */
  kickArms: [0.1125, 0.1375, 0.0375] as FRU,
  kickArmDrop: 0.09375,
  /** A kick reaches this much past the reach, metres. */
  kickReach: 0.1875,
  /** The shoulders' turn per radian of swing angle (ground, vertical), and its limit, radians. */
  twist: { ground: 0.32, vertical: 0.08, max: 0.7 },
  /** The wind's lean back, as a share of the strike's lean; the lunge drawn back, as a share of the lunge. */
  windLean: 0.45,
  windLunge: 0.3,
  /** In the recover, the swing drifts this share of its span further, over the hold. */
  drift: 0.08,
} as const;

/** The boxer's guard by the chin (poses.ts's guard pose): where the free fist waits when unarmed or guarding. */
const GUARD_HANDS: Sided<FRU> = { L: [0.2375, -0.0625, 0.025], R: [0.14375, 0.09375, -0.0375] };

/** The phases by number, as `ArmState.phase` keeps them: 0 when no move plays. */
const PHASE_NUMBER: Readonly<Record<MovePhase, number>> = { wind: 1, active: 2, recover: 3 };

/** The arm's state: plain numbers, stepped by `stepArm`, read by `layArm` and `armBlade`. */
export interface ArmState {
  /** How much the arm follows the path, 0 to 1 (my-3d2dge's `armW`). */
  weight: number;
  /** The phase of the last step: 0 none, 1 wind, 2 active, 3 recover. */
  phase: number;
  /** The swing angle now, radians (+ toward the right hand; up on the vertical plane). */
  theta: number;
  /** The height now: metres from the shoulder centre, or a kick's share of the hip height. */
  height: number;
  /** The reach now, metres from the shoulder centre (scaled to the body's arm). */
  reach: number;
  /** Where the swing's wind started: angle, height and reach. */
  theta0: number;
  height0: number;
  reach0: number;
  /** Through the wind, the share blended from where the arm was (`from`); 1 after it. */
  windK: number;
  /** The whole body's spin now, radians toward the left. */
  turn: number;
  /** The striking hand: −1 left, 1 right, 2 both. */
  hand: number;
  /** 1 while the last move was a kick. */
  kick: number;
  /** 1 while the move swings on the vertical plane. */
  vertical: number;
  /** Where the arm was as the swing began: the left hand, the right hand and the blade, model-frame xyz each. */
  from: number[];
}

/** An arm at rest. */
export function createArmState(): ArmState {
  const [theta, height, reach] = [ARM.rest.ground, ARM.restHeight.hand, 7 / 16];
  const path = { theta, height, reach, theta0: theta, height0: height, reach0: reach };
  return { weight: 0, phase: 0, ...path, windK: 1, turn: 0, hand: 1, kick: 0, vertical: 0, from: Array(9).fill(0) };
}

/** What `stepArm` reads of the body. */
export interface ArmBody {
  /** Whether the right hand holds a weapon. */
  readonly armed: boolean;
  /** The arm's length, shoulder to wrist, metres before the build's size. */
  readonly armLength: number;
}

/** A move's body motion now, and the foot that leads its lunge: what a humanoid's `input.body` takes. */
export type ArmMotion = BodyMotion & { lead: 'L' | 'R' };

/**
 * One fixed step of the arm: the path at `input`'s phase and share (none: the arm eases down), the weight eased
 * toward it, and, as a swing begins its wind, where it starts (`last`: the body's last effectors). Returns the body
 * motion the move asks for, or undefined when no move plays.
 */
export function stepArm(
  arm: ArmState,
  input: MoveInput | undefined,
  body: ArmBody,
  last: Effectors,
  dt: number,
): ArmMotion | undefined {
  let target = 0;
  let motion: ArmMotion | undefined;
  [arm.windK, arm.turn] = [1, 0];
  if (input) {
    const m = resolveMove(input.move);
    const u = MathUtils.clamp(input.u, 0, 1);
    const phase = PHASE_NUMBER[input.phase];
    const kick = m.limb === 'footR';
    const vertical = !kick && m.plane === 'vertical';
    const left = m.hand === 'L';
    const scale = m.reachScale === 'arm' ? body.armLength / REFERENCE_ARM : 1;
    const [a0, a1] = m.arc;
    const [z0, z1] = kick ? m.kickHeight : m.height;
    const [r0, r1] = [m.reach[0] * scale, m.reach[1] * scale];
    const { lean, hop, crouch } = m.body;
    const lunge = m.rootMotion === 'apply' ? 0 : m.body.lunge;
    if (phase === 1 && arm.phase !== 1) startSwing(arm, m, body, last, { kick, vertical, scale, z0 });
    [arm.phase, arm.kick, arm.vertical] = [phase, kick ? 1 : 0, vertical ? 1 : 0];
    arm.hand = m.hand === 'both' ? 2 : left ? -1 : 1;
    motion = { lean: 0, lunge: 0, hop: 0, crouch: 0, twist: 0, lead: left ? 'R' : 'L' };
    target = 1;
    if (phase === 1) {
      const k = ease.outQuad(u);
      arm.theta = MathUtils.lerp(arm.theta0, a0, k);
      arm.height = MathUtils.lerp(arm.height0, z0, u);
      arm.reach = MathUtils.lerp(arm.reach0, r0, k);
      arm.windK = k;
      [motion.lean, motion.lunge, motion.crouch] = [
        -Math.abs(lean) * ARM.windLean,
        -lunge * ARM.windLunge * k,
        crouch * k,
      ];
    } else if (phase === 2) {
      const k = ease.outCubic(u);
      arm.theta = m.spin ? a0 : MathUtils.lerp(a0, a1, k);
      arm.height = MathUtils.lerp(z0, z1, k);
      arm.reach = MathUtils.lerp(r0, r1, k);
      [motion.lean, motion.lunge, motion.crouch] = [lean, lunge * k, crouch * (1 - k)];
      motion.hop = hop * Math.sin(k * Math.PI);
      if (m.spin && vertical) arm.theta = a0 - TAU * k * m.spin;
      else if (m.spin) arm.turn = TAU * k * m.spin;
    } else {
      const hold = m.time.hold;
      const k = ease.outQuad(hold > 0 ? MathUtils.clamp(u / hold, 0, 1) : 1);
      arm.theta = (m.spin ? a0 : a1) + (m.spin ? 0 : a1 - a0) * ARM.drift * k;
      [arm.height, arm.reach] = [z1, r1];
      target = u < hold || hold >= 1 ? 1 : 1 - ease.inOut((u - hold) / (1 - hold));
      [motion.lean, motion.lunge] = [lean * target, lunge * target];
    }
    const perAngle = vertical ? ARM.twist.vertical : ARM.twist.ground;
    const twist = arm.theta * perAngle * m.body.twist * (left ? -1 : 1);
    motion.twist = m.spin ? 0 : MathUtils.clamp(twist, -ARM.twist.max, ARM.twist.max);
  } else [arm.phase, arm.vertical] = [0, 0];
  const rate = target > arm.weight ? ARM.rates[0] : ARM.rates[1];
  arm.weight = approach(arm.weight, target, dt * rate);
  return motion;
}

/** A swing begins: its wind starts from rest, or from where a chained one left the arm; `from` keeps where it was. */
function startSwing(
  arm: ArmState,
  m: Move,
  body: ArmBody,
  last: Effectors,
  o: { kick: boolean; vertical: boolean; scale: number; z0: number },
): void {
  const chain = arm.weight > ARM.chain;
  const fists = !body.armed || m.hand === 'L' || !m.trail;
  const restHeight = o.kick ? ARM.restHeight.kick : ARM.restHeight.hand;
  arm.theta0 = chain ? arm.theta : o.vertical ? ARM.rest.vertical : ARM.rest.ground;
  arm.height0 = chain && arm.kick === (o.kick ? 1 : 0) ? arm.height : fists ? o.z0 : restHeight;
  arm.reach0 = chain ? arm.reach : (m.windReach ?? 0.75 * m.reach[0]) * o.scale;
  last.hands.L.toArray(arm.from, 0);
  last.hands.R.toArray(arm.from, 3);
  last.blade.toArray(arm.from, 6);
}

/** What `layArm` reads of the body beside its effectors. */
export interface ArmLayBody {
  readonly build: Build;
  readonly armed: boolean;
  /** The guard stance's weight: over 0.5, the free fist guards the chin. */
  readonly guard: number;
  /** The humanoid's attack weight: the kicking foot follows only while it is above 0. */
  readonly attack: number;
  /** The body's hop now, metres. */
  readonly hop: number;
}

/** Scratch objects. */
const [aim, dir, at, start, sweep] = Array.from({ length: 5 }, () => new Vector3());
const turn = new Quaternion();
const UP = new Vector3(0, 1, 0);

/** The striking target and the blade's direction now (rig-local; `dir` unit). */
function strikeTarget(arm: ArmState, E: Effectors): void {
  const [c, s] = [Math.cos(arm.theta), Math.sin(arm.theta)];
  const sA = arm.hand === -1 ? -1 : 1;
  if (arm.vertical) {
    B(c * arm.reach, sA * ARM.side, s * arm.reach, aim).add(E.chest);
    B(c, ARM.bladeOut, s, dir).normalize();
  } else {
    B(c * arm.reach, s * arm.reach, arm.height, aim).add(E.chest);
    B(c, s, -ARM.bladeDown, dir).normalize();
  }
}

/** Lays the arm over effectors `E` (rig-local, before size): the hands, and the right foot of a kick. */
export function layArm(arm: ArmState, body: ArmLayBody, E: Effectors): Effectors {
  const w = arm.weight;
  if (!(w > 0)) return E;
  strikeTarget(arm, E);
  const sA = arm.hand === -1 ? -1 : 1;
  const blend = arm.windK < 1;
  for (const side of SIDES) {
    const hand = E.hands[side];
    const s = sideSign(side);
    if (arm.kick) {
      const [f, r, u] = ARM.kickArms;
      hand.lerp(B(f, s * r, u - (s > 0 ? ARM.kickArmDrop : 0), at).add(E.chest), w * ARM.pullShare);
      continue;
    }
    start.fromArray(arm.from, side === 'L' ? 0 : 3);
    if (s === sA) hand.lerp(blend ? start.lerp(aim, arm.windK) : aim, w);
    else if (arm.hand === 2) hand.lerp(at.copy(aim).addScaledVector(dir, -ARM.grip), w);
    else {
      const [f, r, u] = ARM.pullBack;
      const guards = !body.armed || body.guard > 0.5;
      const target = (guards ? fromFRU(GUARD_HANDS[side], at) : B(f, s * r, u, at)).add(E.chest);
      hand.lerp(blend ? start.lerp(target, arm.windK) : target, blend ? w : w * ARM.pullShare);
    }
  }
  if (arm.kick && body.attack > 0) {
    const [c, s, reach] = [Math.cos(arm.theta), Math.sin(arm.theta), arm.reach + ARM.kickReach];
    E.feet.R.lerp(B(c * reach, s * reach, arm.height * body.build.hipHeight + body.hop, at), w);
  }
  return E;
}

/**
 * The blade's direction under the arm, from `rest` (the weapon's, normalised) into `out`: toward the strike by the
 * arm's weight (not for a kick or the left hand), and through the wind from where it was. Other blade layers follow.
 */
export function armBlade(arm: ArmState, rest: Vector3, E: Effectors, out: Vector3): Vector3 {
  out.copy(rest);
  if (!(arm.weight > 0) || arm.kick || arm.hand === -1) return out;
  strikeTarget(arm, E);
  out.lerp(dir, arm.weight);
  if (arm.windK < 1) out.copy(start.fromArray(arm.from, 6).lerp(out, arm.windK));
  return out;
}

/** What `MoveRig` is told each step: the humanoid's input, and the move playing, if any. */
export interface MoveRigInput extends HumanoidInput {
  /** The move playing and where it is (`moveAt`, `Attack.body`); none when no move plays. */
  move?: MoveInput;
}

/** A procedural humanoid that plays moves: its arm path laid over its effectors. See the file comment. */
export class MoveRig {
  /** The humanoid. */
  readonly body: Humanoid;
  /** The arm's state. */
  readonly arm: ArmState = createArmState();

  /** A humanoid made from `options` (engine/anim/humanoid.ts), its arm at rest. */
  constructor(options: HumanoidOptions = {}) {
    this.body = new Humanoid(options);
  }

  /** Steps the arm, then the humanoid with the move's body motion: the sim's part. */
  step(input: MoveRigInput = {}): this {
    const { move, ...rest } = input;
    const h = this.body;
    const armBody = { armed: h.weapon !== 'none', armLength: h.build.armUpper + h.build.armLower };
    const motion = stepArm(this.arm, move, armBody, h.effectors, h.dt);
    h.step(motion ? { ...rest, body: motion } : rest);
    return this;
  }

  /** The humanoid's solve with the arm laid over its effectors (and a spin's turn on its root). */
  solve(): this {
    const h = this.body;
    h.solve();
    const arm = this.arm;
    if (!(arm.weight > 0) && arm.turn === 0) return this;
    const { effectors: E, pose: P, state: st } = h;
    const ctx = contextOf(h);
    layArm(arm, { build: h.build, armed: ctx.armed, guard: st.weights.stanceGuard, attack: st.weights.attack, hop: st.body.hop }, E); // prettier-ignore
    armBlade(arm, fromFRU(WEAPONS[h.weapon], at).normalize(), E, E.blade);
    applyLayers(BLADE_LAYERS, ctx, 'R', E.blade).normalize();
    if (st.weights.down > 0) E.blade.lerp(fromFRU(DROPPED_BLADE, at), st.weights.down).normalize();
    const [rootRot, rootPos] = [P.rootRot.clone(), P.rootPos.clone()];
    P.reset();
    P.rootRot.copy(rootRot);
    P.rootPos.copy(rootPos);
    if (arm.turn !== 0) {
      turn.setFromAxisAngle(UP, arm.turn);
      P.rootRot.premultiply(turn);
      P.rootPos.sub(h.position).applyQuaternion(turn).add(h.position);
    }
    solveSpine(h, E, st.body.twist * GAIT.hipTwist, st.body.twist);
    for (const side of SIDES) solveArm(h, side, E.hands[side]);
    for (const side of SIDES) solveLeg(h, side, E.feet[side]);
    if (h.weapon !== 'none') holdAlong(h, E.blade);
    forwardKinematics(h.skeleton, P, h.world);
    return this;
  }

  /** `step(input)`, then `solve()`. */
  update(input: MoveRigInput = {}): this {
    return this.step(input).solve();
  }
}

/** The effector context of humanoid `h` now, from its public state (what its own solve read). */
function contextOf(h: Humanoid): EffectorContext {
  const { state: st, effectors: E, build: b } = h;
  return {
    build: b,
    armed: h.weapon !== 'none',
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

/** Move `name` at share `u` of `phase`: what a body is told for a preview, a sheet or a cutscene. */
export function moveAt(name: string | Move | MoveSpec, u = 0.5, phase: MovePhase = 'active'): MoveInput {
  return { move: resolveMove(name), phase, u };
}

/** The part of a body that strikes in `move`: the right foot, the left fist, a held weapon's blade, or the right fist. */
export function strikePart(move: Move, armed: boolean): TrailName {
  if (move.limb === 'footR') return 'kick';
  if (move.hand === 'L') return 'fistL';
  return armed && move.trail ? 'blade' : 'fistR';
}

/** What `strikeSegment` reads of a body. */
export type StrikeBody = Pick<Humanoid, 'skeleton' | 'world' | 'build' | 'weapon'>;

/**
 * Where `part` spans on `body` now, world metres, into `base` and `tip`: a sword from near the grip to its tip
 * (another weapon strikes as the right fist), a forearm from the elbow to the wrist, the right shin from the knee to
 * the sole. The span the animator's trail samples (engine/anim/character.ts).
 */
export function strikeSegment(body: StrikeBody, part: TrailName, base: Vector3, tip: Vector3): void {
  const { skeleton, world, build, weapon } = body;
  if (part === 'blade' && weapon === 'sword') {
    socketPosition(skeleton, world, 'weaponR', base);
    sweep.set(0, 0, build.size).applyQuaternion(jointRotation(world, 'handR', turn));
    tip.copy(base).addScaledVector(sweep, TRAIL.bladeTip);
    base.addScaledVector(sweep, TRAIL.bladeBase);
    return;
  }
  if (part === 'kick') {
    jointPosition(world, 'shinR', base);
    socketPosition(skeleton, world, 'contactR', tip);
    return;
  }
  const side = part === 'fistL' ? 'L' : 'R';
  jointPosition(world, `forearm${side}`, base);
  jointPosition(world, `hand${side}`, tip);
}

/** Where a strike can connect, around its body, which faces +Z standing at the origin: metres and radians. */
export interface HitShape {
  /** The farthest the strike point reaches, horizontally from the body's position. */
  readonly range: number;
  /** The widest angle it reaches either side of the facing. */
  readonly halfAngle: number;
  /** The lowest and highest it reaches, above the ground. */
  readonly yMin: number;
  readonly yMax: number;
}

/** Hit shapes measured so far, by what they were measured from. */
const measured = new Map<string, HitShape>();
/** The most hit shapes kept; past it the cache starts again. */
const MEASURED_MAX = 256;
/** Share of the hit window between measured samples. */
const MEASURE_STEP = 0.05;
/** The cone's angle and heights come from samples at least this share of the range out (not overhead or close in). */
const MEASURE_OUT = 0.5;

/**
 * Measures where `move`'s strike point (the blade's tip, the fist, the foot's sole) goes through its hit window, on a
 * spare body of `options.build` holding `options.weapon` (`build:chibi` with a sword by default): the hit cone and
 * height window to test targets against (`inHitShape`). The range is the farthest it gets; the angle and the heights
 * are where it gets at least half that far, so a blade passing overhead or close by does not widen the cone. Cached
 * by the move's, the build's and the weapon's fields, so changing any of them measures again.
 */
export function measureMove(
  move: string | Move | MoveSpec,
  options: { build?: Build | string; weapon?: Weapon } = {},
): HitShape {
  const m = resolveMove(move);
  const build = typeof options.build === 'object' ? options.build : getBuild(options.build ?? 'build:chibi');
  const weapon = options.weapon ?? 'sword';
  const key = JSON.stringify([m, build, weapon]);
  const known = measured.get(key);
  if (known) return known;
  const shape = withSimMath(() => {
    const rig = new MoveRig({ build, weapon, clock: 0, dt: 1 });
    const part = strikePart(m, weapon !== 'none');
    const samples: [distance: number, angle: number, y: number][] = []; // the angle unwrapped along the swing
    const steps = Math.max(1, Math.ceil((1 - m.hitAt) / MEASURE_STEP));
    for (let i = 0; i <= steps; i++) {
      rig.update({ move: { move: m, phase: 'active', u: m.hitAt + ((1 - m.hitAt) * i) / steps } });
      strikeSegment(rig.body, part, start, at);
      const angle = Math.atan2(at.x, at.z);
      const last = samples.at(-1)?.[1];
      samples.push([Math.hypot(at.x, at.z), last === undefined ? angle : last + angDiff(last, angle), at.y]);
    }
    const range = Math.max(...samples.map(([d]) => d));
    const out = samples.filter(([d]) => d >= range * MEASURE_OUT);
    const ys = out.map(([, , y]) => y);
    const halfAngle = Math.min(Math.PI, Math.max(...out.map(([, a]) => Math.abs(a))));
    return Object.freeze({ range, halfAngle, yMin: Math.min(...ys), yMax: Math.max(...ys) });
  });
  if (measured.size >= MEASURED_MAX) measured.clear();
  measured.set(key, shape);
  return shape;
}

/**
 * Whether `target` (plus `radius`) is within `range` of `from` on the ground plane and within `halfAngle` of the
 * facing `yaw` (forward is (sin yaw, 0, cos yaw)). Heights are ignored; `inHitShape` adds them.
 */
export function inArc(
  from: Vector3,
  yaw: number,
  target: Vector3,
  range: number,
  halfAngle: number,
  radius = 0,
): boolean {
  const [dx, dz] = [target.x - from.x, target.z - from.z];
  return Math.hypot(dx, dz) <= range + radius && Math.abs(angDiff(yaw, Math.atan2(dx, dz))) <= halfAngle;
}

/** `inArc` with `shape`'s range and half angle, scaled by `size`, and its height window (± `radius`) above `from`. */
export function inHitShape(
  from: Vector3,
  yaw: number,
  shape: HitShape,
  target: Vector3,
  radius = 0,
  size = 1,
): boolean {
  const dy = target.y - from.y;
  if (dy < shape.yMin * size - radius || dy > shape.yMax * size + radius) return false;
  return inArc(from, yaw, target, shape.range * size, shape.halfAngle, radius);
}

/**
 * The push a hit gives `target` away from `from`: `speed` m/s along the ground, plus `up` m/s upward, into `out`
 * (nothing along the ground when they stand on the same spot). The receiver adds it to its velocity.
 */
export function knockback(from: Vector3, target: Vector3, speed: number, up = 0, out = new Vector3()): Vector3 {
  const [dx, dz] = [target.x - from.x, target.z - from.z];
  const d = Math.hypot(dx, dz) || 1;
  return out.set((dx / d) * speed, up, (dz / d) * speed);
}
