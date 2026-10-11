/**
 * @file The arm path (PLAN.md WP 6.1, §6.4; I-10): how a move plays on a humanoid's arms, my-3d2dge's strike ported
 * onto the rotation skeleton. A move at a phase and a share of it (`MoveInput`, moves-data.ts) gives the arm's path
 * now (the swing angle, the height, the reach) and the body's motion (lean, lunge, hop, crouch, twist, a spin's
 * turn): `stepArm` takes one fixed step of it, easing the arm's weight and keeping where a swing started; `layArm` and
 * `armBlade` lay the striking hand (or foot), the other hand and the blade over the effectors. The humanoid
 * (engine/anim/humanoid.ts) steps it in its `step` and lays it in its effector stage (poses.ts `effectorStage`).
 *
 * Invariants:
 * - The arm state (`ArmState`) is plain numbers, part of the humanoid's state: stepped at a fixed step from the move
 *   and, as a swing begins, the body's effectors before the step (computed from the state, never from a pose), so
 *   the sim's hash never depends on whether the body was posed. Laying it reads only the state and the effectors.
 * - A new swing starts its wind from where the arm was: the hands and blade of those effectors, and the last path
 *   while the arm is still raised (weight above 0.3), as my-3d2dge chained hits. It starts as a wind begins, and
 *   when the move changes during a wind (a feint, a cancel into another move): `ArmState.move` keys the move by its
 *   fields, so two moves made from specs (both `move:custom`) differ, and a spec made anew each step does not. A
 *   chain from a kick into a hand move (or back) starts its height at rest: the old rig mixed a share of the hip
 *   height with a height in units there.
 * - A move told with a phase outside `MOVE_PHASES` or a share that is not finite (data, the console) plays as no
 *   move: `stepArm` warns once (`ANIM_BAD_STATE`, naming the closest phase), so the state stays plain numbers.
 * - moves.test.ts holds all 24 moves to my-3d2dge's reference vectors (tests/baselines/port/moves.json): the hands,
 *   the blade's tip and the right foot within 1 cm on average and 3 cm at worst.
 *
 * Carried from `my-3d2dge:engine/my-3d2dge.js:1842-1867` (the attack's path and body motion, `armW`),
 * `:1950-1951` (the striking hand's target and the blade's direction), `:1969-1986` (the hands, the kick's arms, the
 * blade) and `:1937` (the kicking foot).
 *
 * @example
 * import { getBuild } from './builds';
 * import { restContext } from './locomotion';
 * import { createEffectors } from './poses';
 * const arm = createArmState();
 * const thrust = { move: 'move:thrust', phase: 'active', u: 0.5 } as const;
 * const motion = stepArm(arm, thrust, { armed: true, armLength: 0.575 }, createEffectors, 1);
 * arm.weight; // 1: the arm follows the strike
 * motion?.lunge; // ≈ 0.164: 0.875 of the thrust's 0.1875 m lunge
 * const E = createEffectors();
 * layArm(arm, restContext(getBuild('build:chibi')), E).hands.R.length() > 0; // true: the right hand reaches out
 * @see engine/anim/strike.test.ts
 */
import { hashValue } from '../core/hash';
import { didYouMean, log as engineLog, type Log } from '../core/log';
import { approach, ease, MathUtils, Vector3 } from '../core/math';
import { show } from '../core/schema';
import { B, fromFRU, SIDES, sideSign, type FRU, type Sided } from './authoring';
import type { BodyMotion, EffectorContext } from './locomotion';
import { MOVE_PHASES, resolveMove, REFERENCE_ARM, type Move, type MoveInput, type MovePhase } from './moves-data';
import type { Effectors } from './poses';
import './states'; // registers ANIM_BAD_STATE, which a move told with a bad phase or share raises

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

/** What a move is told with, as `ANIM_BAD_STATE` says it. */
const MOVE_EXPECTED = `a move at phase ${MOVE_PHASES.slice(0, -1).join(', ')} or ${MOVE_PHASES.at(-1)}, with a finite u`;

/**
 * `input` when its phase is one of `MOVE_PHASES` and its share `u` a finite number; otherwise undefined, after
 * warning once through `to` (`ANIM_BAD_STATE`, naming the closest phase).
 */
function checkMove(input: MoveInput | undefined, to: Log): MoveInput | undefined {
  if (!input) return undefined;
  const { phase, u } = input as { readonly phase: unknown; readonly u: unknown };
  const known = typeof phase === 'string' && Object.hasOwn(PHASE_NUMBER, phase);
  if (known && typeof u === 'number' && Number.isFinite(u)) return input;
  const suggestion = typeof phase === 'string' && !known ? didYouMean(phase, MOVE_PHASES) : '';
  const value = `a move at phase ${show(phase)}, with u ${show(u)}`;
  to.warnOnce('ANIM_BAD_STATE', { name: 'body', value, expected: MOVE_EXPECTED, suggestion }, 'state:body.move');
  return undefined;
}

/** The arm's state: plain numbers, stepped by `stepArm`, read by `layArm` and `armBlade`. */
export interface ArmState {
  /** How much the arm follows the path, 0 to 1 (my-3d2dge's `armW`). */
  weight: number;
  /** The phase of the last step: 0 none, 1 wind, 2 active, 3 recover. */
  phase: number;
  /** The move of the last step, keyed by a hash of its fields (0 before any): another move restarts a wind. */
  move: number;
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
  const shape = { windK: 1, turn: 0, hand: 1, kick: 0, vertical: 0, from: Array<number>(9).fill(0) };
  return { weight: 0, phase: 0, move: 0, ...path, ...shape };
}

/** Each move's key, made once: its fields hashed (core/hash.ts `hashValue`), 52 bits, the same in Node and Chromium. */
const keys = new WeakMap<Move, number>();

/** `m`'s key: equal for moves with equal fields, and (to 52 bits) different for any other (`ArmState.move`). */
function moveKey(m: Move): number {
  let key = keys.get(m);
  if (key === undefined) keys.set(m, (key = Number.parseInt(hashValue(m).slice(3), 16) || 1));
  return key;
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
 * toward it, and, as a swing begins its wind (or the move changes during one), where it starts (`last`: the body's
 * effectors before this step, asked for only then). Returns the body motion the move asks for, or undefined when no
 * move plays. A phase outside `MOVE_PHASES` or a share that is not finite warns once through `to`
 * (`ANIM_BAD_STATE`) and plays no move.
 */
export function stepArm(
  arm: ArmState,
  told: MoveInput | undefined,
  body: ArmBody,
  last: () => Effectors,
  dt: number,
  to: Log = engineLog,
): ArmMotion | undefined {
  let target = 0;
  let motion: ArmMotion | undefined;
  const input = checkMove(told, to);
  const m = input ? resolveMove(input.move) : undefined;
  const phase = input ? PHASE_NUMBER[input.phase] : 0;
  const key = m ? moveKey(m) : arm.move;
  if (m && phase === 1 && (arm.phase !== 1 || arm.move !== key)) startSwing(arm, m, body, last());
  [arm.windK, arm.turn] = [1, 0];
  if (input && m) {
    const u = MathUtils.clamp(input.u, 0, 1);
    const kick = m.limb === 'footR';
    const vertical = !kick && m.plane === 'vertical';
    const left = m.hand === 'L';
    const scale = m.reachScale === 'arm' ? body.armLength / REFERENCE_ARM : 1;
    const [a0, a1] = m.arc;
    const [z0, z1] = kick ? m.kickHeight : m.height;
    const [r0, r1] = [m.reach[0] * scale, m.reach[1] * scale];
    const { lean, hop, crouch } = m.body;
    const lunge = m.rootMotion === 'apply' ? 0 : m.body.lunge;
    [arm.phase, arm.move, arm.kick, arm.vertical] = [phase, key, kick ? 1 : 0, vertical ? 1 : 0];
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
function startSwing(arm: ArmState, m: Move, body: ArmBody, last: Effectors): void {
  const kick = m.limb === 'footR';
  const chain = arm.weight > ARM.chain;
  const fists = !body.armed || m.hand === 'L' || !m.trail;
  const [rest, z0] = kick ? [ARM.restHeight.kick, m.kickHeight[0]] : [ARM.restHeight.hand, m.height[0]];
  const scale = m.reachScale === 'arm' ? body.armLength / REFERENCE_ARM : 1;
  arm.theta0 = chain ? arm.theta : !kick && m.plane === 'vertical' ? ARM.rest.vertical : ARM.rest.ground;
  arm.height0 = chain && arm.kick === (kick ? 1 : 0) ? arm.height : fists ? z0 : rest;
  arm.reach0 = chain ? arm.reach : (m.windReach ?? 0.75 * m.reach[0]) * scale;
  last.hands.L.toArray(arm.from, 0);
  last.hands.R.toArray(arm.from, 3);
  last.blade.toArray(arm.from, 6);
}

/**
 * What `layArm` reads of the body beside its effectors: its build, whether it is armed, the guard stance's weight
 * (over 0.5 the free fist guards the chin), the attack weight (the kicking foot follows only above 0) and the hop.
 */
export type ArmLayContext = Pick<EffectorContext, 'build' | 'armed' | 'w' | 'body'>;

/** Scratch objects. */
const [aim, dir, at, start] = Array.from({ length: 4 }, () => new Vector3());

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
export function layArm(arm: ArmState, ctx: ArmLayContext, E: Effectors): Effectors {
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
      const guards = !ctx.armed || ctx.w.stanceGuard > 0.5;
      const target = (guards ? fromFRU(GUARD_HANDS[side], at) : B(f, s * r, u, at)).add(E.chest);
      hand.lerp(blend ? start.lerp(target, arm.windK) : target, blend ? w : w * ARM.pullShare);
    }
  }
  if (arm.kick && ctx.w.attack > 0) {
    const [c, s, reach] = [Math.cos(arm.theta), Math.sin(arm.theta), arm.reach + ARM.kickReach];
    E.feet.R.lerp(B(c * reach, s * reach, arm.height * ctx.build.hipHeight + ctx.body.hop, at), w);
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
