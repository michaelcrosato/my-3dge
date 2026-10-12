/**
 * @file Held poses, stances and the humanoid's effector layers (PLAN.md WP 3.6, §5.2; I-09): the names a humanoid
 * takes (`POSES`, `STANCES`, `WEAPONS`), with a warning that suggests the closest name for a misspelt one, and the
 * ordered tables that lay each pose, stance and state over the gait's targets: `FOOT_LAYERS` for the soles,
 * `HAND_LAYERS` for the wrists, `BLADE_LAYERS` for the weapon's direction.
 *
 * Invariants:
 * - A table's order is the priority: each layer moves the target toward its own by its weight (my-3d2dge's
 *   `V3.lerp`), or adds its offset, in turn, so a later layer wins. `layerWeights` lists every layer's weight now.
 * - Targets are rig-local metres before `size`, in the model frame, written `[forward, right, up]` (authoring.ts);
 *   blade directions are unit-free. Each row is the source's numbers ÷ 16 where they are lengths.
 * - The poses `die` and `down` have no layer here: they drive the down weight and the die timeline (humanoid.ts).
 * - Pure functions of the `EffectorContext`; the warnings go through the engine's log, once per name.
 *
 * Carried from `my-3d2dge:engine/my-3d2dge.js:1924-1937` (the feet's pose targets) and `:1955-1968` (the hands'),
 * and `:1979-1988` (the weapon's direction). The camera-side wave (`_camSide`) is gone: the free hand waves.
 *
 * @example
 * import { createLog } from '../core/log';
 * import { getBuild } from './builds';
 * import { restContext } from './locomotion';
 * const quiet = createLog({ console: { warn: () => {}, error: () => {} } });
 * poseName('cheer'); // 'cheer'
 * poseName('cheeer', quiet); // undefined, and quiet.advice[0].message ends '(did you mean "cheer"?); it is ignored'
 * const ctx = restContext(getBuild('build:heroic'));
 * layerWeights(HAND_LAYERS, ctx).every((w) => w.weight === 0); // true: nothing held at rest
 * @see engine/anim/poses.test.ts
 */
import { defineCodes, didYouMean, log, type Log } from '../core/log';
import { Vector3 } from '../core/math';
import { B, fromFRU, SIDES, sideSign, type FRU, type LimbSide, type Sided } from './authoring';
import {
  gaitFoot,
  gaitHand,
  headDirection,
  hipTarget,
  pelvisTarget,
  shoulderTarget,
  spineDirection,
} from './locomotion';
import type { EffectorContext } from './locomotion';
import { armBlade, layArm } from './strike';

/** The codes this module raises, with their fixes. */
export const POSE_CODES = defineCodes('anim', {
  ANIM_UNKNOWN_POSE: {
    template: '{name} is not a humanoid {what}{suggestion}; it is ignored',
    fix: 'use one of: {names}',
    doc: 'Raised once per name by the humanoid (engine/anim/humanoid.ts) for a `pose`, `stance` or `weapon` it does not know. The message names the closest names; `POSES`, `STANCES` and `WEAPONS` (engine/anim/poses.ts) list them all. An unknown weapon holds nothing.',
  },
});

/** The held poses, each with what it shows. `die` and `down` are reactions: they knock the body flat. */
export const POSES = {
  cheer: 'Both fists pumping above the head (an item found, a victory).',
  cast: 'Both hands thrust forward.',
  guard: "A boxer's guard: fists up by the chin, knees bent, feet apart.",
  kneel: 'Down on the right knee.',
  crouch: 'Crouched low, feet wide.',
  wave: 'The free hand waves: the left when the right holds a weapon.',
  hips: 'Hands on the hips.',
  block: 'The weapon upright across the body, both hands on it.',
  die: 'A stagger, the knees give, then the body topples onto its back and stays down.',
  down: 'Knocked flat onto the back; it gets up when the pose ends.',
} as const;

/** A pose's name. */
export type PoseName = keyof typeof POSES;

/** The stances, held while moving. */
export const STANCES = {
  guard: 'Fists up while moving.',
  ready: 'The weapon held forward in both hands (with a weapon).',
} as const;

/** A stance's name. */
export type StanceName = keyof typeof STANCES;

/** What the right hand holds, by the direction its blade rests in: `[forward, right, up]`, normalised when used. */
export const WEAPONS = {
  /** Nothing: the hands are fists (the knuckle line rests as a sword's would). */
  none: [0.55, 0.35, -0.75],
  /** A blade held low, pointing forward, out and down. */
  sword: [0.55, 0.35, -0.75],
  /** A gun held low, muzzle forward and down. */
  gun: [0.8, 0, -0.6],
  /** A staff held upright, leaning forward. */
  staff: [0.3, 0.15, 1],
} as const satisfies Record<string, FRU>;

/** A weapon's name. */
export type Weapon = keyof typeof WEAPONS;

/** Returns `name` when `table` has it; otherwise warns `ANIM_UNKNOWN_POSE` once for it and returns undefined. */
function known<T extends string>(table: object, name: string | undefined, what: string, to: Log): T | undefined {
  if (name === undefined || Object.hasOwn(table, name)) return name as T | undefined;
  const names = Object.keys(table);
  const values = { name: JSON.stringify(name), what, suggestion: didYouMean(String(name), names) };
  to.warnOnce('ANIM_UNKNOWN_POSE', { ...values, names: names.join(', ') }, `${what}:${name}`);
  return undefined;
}

/** `name` if it is a pose; otherwise warns once, suggesting the closest, and returns undefined. */
export function poseName(name: string | undefined, to: Log = log): PoseName | undefined {
  return known<PoseName>(POSES, name, 'pose', to);
}

/** `name` if it is a stance; otherwise warns once, suggesting the closest, and returns undefined. */
export function stanceName(name: string | undefined, to: Log = log): StanceName | undefined {
  return known<StanceName>(STANCES, name, 'stance', to);
}

/** `name` if it is a weapon; otherwise warns once, suggesting the closest, and returns undefined. */
export function weaponName(name: string | undefined, to: Log = log): Weapon | undefined {
  return known<Weapon>(WEAPONS, name, 'weapon', to);
}

/** Places a layer's target for `side` (rig-local, model frame), given the target so far; an `add` layer's offset. */
export type Placement = (ctx: EffectorContext, side: LimbSide, current: Vector3, out: Vector3) => Vector3;

/** One layer of an effector table. */
export interface EffectorLayer {
  /** The pose, stance or state it shows. */
  readonly name: string;
  /** Its weight now on `side`, 0 to 1. */
  readonly weight: (ctx: EffectorContext, side: LimbSide) => number;
  /** Where it puts the target. */
  readonly at: Placement;
  /** `blend` (the default) moves the target toward `at` by the weight; `add` adds `at` times the weight. */
  readonly mode?: 'blend' | 'add';
}

/** A fixed rig-local target per side. */
const fixed =
  (t: Sided<FRU>): Placement =>
  (_ctx, side, _cur, out) =>
    fromFRU(t[side], out);
/** A target per side, from that side's shoulder joint. */
const fromShoulder =
  (t: Sided<FRU>): Placement =>
  (ctx, side, _cur, out) =>
    fromFRU(t[side], out).add(ctx.shoulders[side]);
/** A target per side, from the shoulder centre (the neck joint). */
const fromChest =
  (t: Sided<FRU>): Placement =>
  (ctx, side, _cur, out) =>
    fromFRU(t[side], out).add(ctx.chest);
/** A target per side, from that side's hip joint. */
const fromHip =
  (t: Sided<FRU>): Placement =>
  (ctx, side, _cur, out) =>
    fromFRU(t[side], out).add(ctx.hips[side]);

/** The boxer's guard by the chin: the lead (left) fist out, the right by the face, which stays visible. */
const GUARD_HANDS: Sided<FRU> = { L: [0.2375, -0.0625, 0.025], R: [0.14375, 0.09375, -0.0375] };

/** The soles, after the gait (locomotion.ts `gaitFoot`), in priority order. */
export const FOOT_LAYERS: readonly EffectorLayer[] = [
  /** Dash: the right foot kicked forward and up, the left trailing far behind. */
  { name: 'dash', weight: (c) => c.w.dash, at: fixed({ L: [-0.3125, -0.1375, 0.01875], R: [0.25, 0.1375, 0.09375] }) },
  /** Air: both legs tucked, the right higher and ahead. */
  { name: 'air', weight: (c) => c.w.air, at: fixed({ L: [-0.1625, -0.11875, 0.225], R: [0.2, 0.11875, 0.375] }) },
  /** Kneel: the right foot planted ahead, the left behind on its knee. */
  { name: 'kneel', weight: (c) => c.w.kneel, at: fixed({ L: [-0.2625, -0.125, 0], R: [0.2125, 0.125, 0] }) },
  /** Guard pose: a wide boxer's stance, fading as the body moves. */
  {
    name: 'guard',
    weight: (c) => c.w.guard * (1 - c.sp),
    at: fixed({ L: [-0.175, -0.1625, 0], R: [0.1625, 0.1625, 0] }),
  },
  /** Crouch: feet 0.04375 m wider, right 0.1 m ahead, left 0.0875 m behind, lifted feet lowered; half at full speed. */
  {
    name: 'crouch',
    weight: (c) => c.crouch * (1 - c.sp * 0.5),
    at: (c, side, cur, out) =>
      B(side === 'R' ? 0.1 : -0.0875, sideSign(side) * (c.build.footSpread + 0.04375), cur.y * (1 - c.crouch), out),
  },
  /** Lunge: the lead foot steps 1.3 × the lunge into it, the other slides back 0.15 ×, standing still only. */
  {
    name: 'lunge',
    mode: 'add',
    weight: (c) => (c.body.lunge > 0 ? 1 - c.sp : 0),
    at: (c, side, _cur, out) => B(side === c.lead ? c.body.lunge * 1.3 : -c.body.lunge * 0.15, 0, 0, out),
  },
  /** Hop: both feet lift with the body. */
  { name: 'hop', mode: 'add', weight: (c) => (c.body.hop ? 1 : 0), at: (c, _s, _cur, out) => B(0, 0, c.body.hop, out) },
  /** Climb: feet on the rungs, 0.0375 m ahead and 0.09375 m out, stepping up to 0.2125 m in turn with the hands. */
  {
    name: 'climb',
    weight: (c) => c.w.climb,
    at: (c, side, _cur, out) => {
      const step = Math.max(0, Math.sin(c.climbPhase + (side === 'R' ? Math.PI : 0))) * 0.2125;
      return B(0.0375, sideSign(side) * 0.09375, step, out);
    },
  },
];

/** The wrists, after the gait's arm swing (locomotion.ts `gaitHand`), in priority order. */
export const HAND_LAYERS: readonly EffectorLayer[] = [
  /** Dash: both arms swept back and down. */
  {
    name: 'dash',
    weight: (c) => c.w.dash,
    at: fromShoulder({ L: [-0.28125, -0.1, -0.3125], R: [-0.28125, 0.1, -0.3125] }),
  },
  /** Hurt: a flinch, the right arm up to shield the face, the left flung back. */
  {
    name: 'hurt',
    weight: (c) => c.w.hurt,
    at: fromShoulder({ L: [-0.1, -0.1375, -0.2], R: [0.0875, -0.0375, 0.0375] }),
  },
  /** Air: arms out for balance, at 0.7 of the air weight. */
  {
    name: 'air',
    weight: (c) => c.w.air * 0.7,
    at: fromShoulder({ L: [0.075, -0.1625, -0.075], R: [0.075, 0.1625, -0.075] }),
  },
  /** Point: the weapon hand held out at 0.92 of the arm's length along the aim, 0.0375 m in and 0.025 m low. */
  {
    name: 'point',
    weight: (c, side) => (side === 'R' ? c.w.point : 0),
    at: (c, side, _cur, out) => {
      const reach = c.armLength * 0.92;
      return B(reach * Math.cos(c.aim), -0.0375, reach * Math.sin(c.aim) - 0.025, out).add(c.shoulders[side]);
    },
  },
  /** Cheer: fists 0.0375 m ahead, 0.0875 m out, pumping at 9 rad/s 0.62–0.86 arm lengths up, the left 0.7 rad later. */
  {
    name: 'cheer',
    weight: (c) => c.w.cheer,
    at: (c, side, _cur, out) => {
      const pump = 0.74 + 0.12 * Math.sin(c.clock * 9 + (side === 'R' ? 0 : 0.7));
      return B(0.0375, sideSign(side) * 0.0875, c.armLength * pump, out).add(c.shoulders[side]);
    },
  },
  /** Cast: both hands thrust 0.82 arm lengths ahead of the shoulder centre, 0.08125 m out each and 0.075 m low. */
  {
    name: 'cast',
    weight: (c) => c.w.cast,
    at: (c, side, _cur, out) => B(c.armLength * 0.82, sideSign(side) * 0.08125, -0.075, out).add(c.chest),
  },
  /** Guard pose: fists up by the chin. */
  { name: 'guard', weight: (c) => c.w.guard, at: fromChest(GUARD_HANDS) },
  /** Guard stance: the same fists while moving, dropped while dashing. */
  { name: 'stanceGuard', weight: (c) => c.w.stanceGuard * (1 - c.w.dash), at: fromChest(GUARD_HANDS) },
  /** Ready stance: the weapon held forward in both hands, dropped while dashing; armed only. */
  {
    name: 'stanceReady',
    weight: (c) => (c.armed ? c.w.stanceReady * (1 - c.w.dash) : 0),
    at: fromChest({ L: [0.1375, 0.0125, -0.225], R: [0.175, 0.05625, -0.1875] }),
  },
  /** Wave: the free hand 0.8 arm lengths up, swinging at 11 rad/s 0.05 ± 0.10625 m forward, wider on the outswing. */
  {
    name: 'wave',
    weight: (c, side) => (side === (c.armed ? 'L' : 'R') ? c.w.wave : 0),
    at: (c, side, _cur, out) => {
      const swing = Math.sin(c.clock * 11);
      const outward = sideSign(side) * (0.125 + Math.max(0, swing) * 0.0875);
      return B(0.05 + swing * 0.10625, outward, c.armLength * 0.8, out).add(c.shoulders[side]);
    },
  },
  /** Hips: hands on the hips, a little behind, out and up from each hip joint. */
  {
    name: 'hips',
    weight: (c) => c.w.hips,
    at: fromHip({ L: [-0.0125, -0.09375, 0.09375], R: [-0.0125, 0.09375, 0.09375] }),
  },
  /** Block: the weapon upright across the body, both hands on its grip. */
  {
    name: 'block',
    weight: (c) => c.w.block,
    at: fromChest({ L: [0.15, -0.0125, -0.2125], R: [0.1625, 0.0375, -0.15] }),
  },
  /** Climb: hands on the rails, one reaching up to 0.88 of the arm's length while the other pulls down to 0.08. */
  {
    name: 'climb',
    weight: (c) => c.w.climb,
    at: (c, side, _cur, out) => {
      const reach = 0.08 + 0.8 * (0.5 + 0.5 * Math.sin(c.climbPhase + (side === 'R' ? 0 : Math.PI)));
      return B(0.10625, sideSign(side) * 0.03125, c.armLength * reach, out).add(c.shoulders[side]);
    },
  },
];

/** A fixed blade direction, the same on both sides (only the right hand holds the weapon). */
const toward =
  (t: FRU): Placement =>
  (_ctx, _side, _cur, out) =>
    fromFRU(t, out);

/** The weapon's direction, after its rest (`WEAPONS`), in priority order; normalised after the last. */
export const BLADE_LAYERS: readonly EffectorLayer[] = [
  /** Cheer: raised in triumph, point up. */
  { name: 'cheer', weight: (c) => c.w.cheer, at: toward([0.15, 0.05, 1]) },
  /** Block: held upright across the body. */
  { name: 'block', weight: (c) => c.w.block, at: toward([0.35, -0.3, 0.9]) },
  /** Ready stance: forward and up, in both hands; a strike's arm fades it out. */
  { name: 'stanceReady', weight: (c) => c.w.stanceReady * (1 - (c.arm?.weight ?? 0)), at: toward([0.62, 0.08, 0.78]) },
  /** Point: along the aim. */
  { name: 'point', weight: (c) => c.w.point, at: (c, _s, _cur, out) => B(Math.cos(c.aim), 0, Math.sin(c.aim), out) },
];

/** Where a weapon dropped by a knocked-down body lies, before the body's turn: flat and to the right. */
export const DROPPED_BLADE: FRU = [0, 0.9, -0.4];

const target = new Vector3();

/** Runs `layers` over `current` for `side`, in order, and returns it. */
export function applyLayers(
  layers: readonly EffectorLayer[],
  ctx: EffectorContext,
  side: LimbSide,
  current: Vector3,
): Vector3 {
  for (const layer of layers) {
    const weight = layer.weight(ctx, side);
    if (weight === 0) continue;
    layer.at(ctx, side, current, target);
    if (layer.mode === 'add') current.addScaledVector(target, weight);
    else current.lerp(target, weight);
  }
  return current;
}

/** Every layer of `layers` with its weight on each side now: what an inspector shows. */
export function layerWeights(
  layers: readonly EffectorLayer[],
  ctx: EffectorContext,
): { name: string; weight: number; L: number; R: number }[] {
  return layers.map((layer) => {
    const [L, R] = [layer.weight(ctx, 'L'), layer.weight(ctx, 'R')];
    return { name: layer.name, weight: Math.max(L, R), L, R };
  });
}

/** The effector stage's targets: rig-local metres before `size`, in the model frame (+Z forward, +Y up). */
export interface Effectors {
  /** The pelvis (the old `hipC`). */
  readonly pelvis: Vector3;
  /** The spine's direction, pelvis to shoulder centre. */
  readonly spine: Vector3;
  /** The head's direction from the shoulder centre. */
  readonly head: Vector3;
  /** The shoulder centre, the neck joint (the old `shC`). */
  readonly chest: Vector3;
  /** The shoulder joints. */
  readonly shoulders: Sided<Vector3>;
  /** The hip joints. */
  readonly hips: Sided<Vector3>;
  /** The soles under the ankles (the old `footL`, `footR`). */
  readonly feet: Sided<Vector3>;
  /** The wrists. */
  readonly hands: Sided<Vector3>;
  /** The weapon's direction, from the right hand. */
  readonly blade: Vector3;
}

/** A set of effectors for `effectorStage` to fill. */
export function createEffectors(): Effectors {
  const sided = () => ({ L: new Vector3(), R: new Vector3() });
  const [pelvis, spine, head, chest, blade] = Array.from({ length: 5 }, () => new Vector3());
  return { pelvis, spine, head, chest, shoulders: sided(), hips: sided(), feet: sided(), hands: sided(), blade };
}

/**
 * The effector stage: the gait's targets (locomotion.ts), then the layers over them in order, then a move's arm path
 * (strike.ts `layArm`), into `out`, whose pelvis, chest, shoulders and hips must be `ctx`'s anchors. `weapon` sets
 * the blade's rest; the arm turns it toward the strike before the blade layers.
 */
export function effectorStage(ctx: EffectorContext, weapon: Weapon, out: Effectors): Effectors {
  pelvisTarget(ctx, out.pelvis);
  spineDirection(ctx, out.spine);
  out.chest.copy(out.spine).multiplyScalar(ctx.build.torso).add(out.pelvis);
  headDirection(ctx, out.spine, out.head);
  for (const side of SIDES) {
    hipTarget(ctx, side, out.hips[side]);
    shoulderTarget(ctx, side, out.shoulders[side]);
  }
  for (const side of SIDES) {
    applyLayers(FOOT_LAYERS, ctx, side, gaitFoot(ctx, side, out.feet[side]));
    applyLayers(HAND_LAYERS, ctx, side, gaitHand(ctx, side, out.hands[side]));
  }
  const blade = fromFRU(WEAPONS[weapon], out.blade).normalize();
  if (ctx.arm) armBlade(ctx.arm, blade, layArm(ctx.arm, ctx, out), blade);
  applyLayers(BLADE_LAYERS, ctx, 'R', blade).normalize();
  if (ctx.w.down > 0) out.blade.lerp(fromFRU(DROPPED_BLADE, target), ctx.w.down).normalize();
  return out;
}
