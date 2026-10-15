/**
 * @file The layer stack and its weights (PLAN.md WP 3.7; I-09): what the animator (engine/anim/character.ts) runs, in
 * order, and how much of each part shows, as tables rather than an order of lerps. `SLOTS` are the stack's slots;
 * after the solve, each takes `AnimLayer`s, which the animator fades by their weights; `LOD` says which slots run at
 * each detail level. The first slot is the body's named weights: each eases toward its target as its body state turns
 * on or off, at its own rates. `easeWeight` is one fixed step of that easing; `HUMANOID_WEIGHTS` lists every humanoid
 * weight with the body state that drives it, the slot it feeds and its rates; `activeWeights` reads them by slot.
 *
 * Invariants:
 * - Rates are per second, `[rising, falling]`; a weight with a `gain` rises faster the higher it is (rate + gain ×
 *   weight). The humanoid's rates are its `STEP` table's (engine/anim/humanoid.ts), which its `step` eases with:
 *   this table names them, never copies them, and weights.test.ts drives a humanoid to prove each row.
 * - `speed` eases toward the speed share (speed ÷ the build's `speedRef`), not 0 or 1; `kneel` also follows the die
 *   timeline. A layer's weight is its owner's to ease (`easeWeight`); the animator only fades by it.
 * - Pure functions and data, one fixed step at a time.
 *
 * Carried from `my-3d2dge:engine/my-3d2dge.js:1813-1826` (the rates: dash 24/8, hurt 14, attack 30/7, air 10/18,
 * poses 9, stances 10, climb 12, point 30/8, the fall's 2.5 + 10 × weight and its rise 3.2).
 *
 * @example
 * easeWeight(0, 1, HUMANOID_WEIGHTS.dash.rates, 1 / 60); // 0.4: a dash eases in at 24 per second
 * easeWeight(1, 0, HUMANOID_WEIGHTS.dash.rates, 1 / 60); // ≈ 0.8667: and out at 8
 * HUMANOID_WEIGHTS.cheer; // { word: 'pose', slot: 'override', rates: [9, 9] }
 * Object.keys(SLOTS).indexOf('post'); // 6: after the clips and the additive layers
 * @see engine/anim/weights.test.ts
 */
import { approach } from '../core/math';
import type { Animator } from './character';
import { STEP } from './humanoid';
import type { HumanoidWeights } from './locomotion';
import type { BodyStateName } from './states';

/** The stack's slots, in order, with what fills each. */
export const SLOTS = {
  weights: 'Named eased weights (`HUMANOID_WEIGHTS`): the body.',
  base: 'Locomotion (gait, idle, air, climb) as effector targets: the body.',
  override: 'Stances, held poses, a move’s arm path and body motion, reactions over the base, in order: the body.',
  solve: 'Effectors to local rotations (the spine, two-bone IK, the feet, the weapon hand): the body.',
  clips: 'Clip layers: sampled clips with a weight, a bone mask and a crossfade (WP 8.4).',
  additive: 'Additive layers: breathing, flinches, recoil, look-at (WP 6.2).',
  post: 'Post IK: Actions’ effector solve, grips, aim, and last the feet on the floor (footPlant.ts `FootPlant`).',
  physics: 'The physics blend: a ragdoll’s bodies blended in (WP 10.2).',
  secondary: 'Secondary motion: chains (cape, hair, tail) and the squash spring (WP 6.2).',
} as const;

/** A slot's name. */
export type SlotName = keyof typeof SLOTS;

/** The slots that take layers: those after the solve, each changing the solved pose. */
export const LAYER_SLOTS = ['clips', 'additive', 'post', 'physics', 'secondary'] as const;

/** A slot that takes layers. */
export type LayerSlot = (typeof LAYER_SLOTS)[number];

/** A layer in a slot after the solve. */
export interface AnimLayer {
  /** Its name, unique in its animator. */
  readonly name: string;
  /** 0–1: how much of it shows; at 0 it is skipped. Ease it with `easeWeight`. */
  weight: number;
  /** Writes `animator.body.pose` at full strength, reading `animator.body.world` (the FK so far). View state only. */
  apply(animator: Animator): void;
  /** What `inspect()` shows of it beside its name and weight: plain JSON. */
  inspect?(): Record<string, unknown>;
  /** Whether it stays at the end of its slot when layers are added after it (the foot plant, engine/anim/footPlant.ts). */
  readonly last?: boolean;
}

/** The detail levels `pose({ lod })` takes, by index: how often it re-solves, in ticks, and which slots run. */
export const LOD: readonly Readonly<{ every: number; slots: readonly LayerSlot[]; trail: boolean }>[] = [
  { every: 1, slots: LAYER_SLOTS, trail: true }, // 0: everything, every tick
  { every: 1, slots: ['clips', 'additive', 'physics'], trail: true }, // 1: no post IK, no secondary motion
  { every: 2, slots: ['clips', 'physics'], trail: false }, // 2: every other tick: clips and the physics blend
  { every: 4, slots: ['physics'], trail: false }, // 3: every fourth tick: the body and the physics blend
];

/** A weight's easing rates, per second: `[rising, falling]`. */
export type WeightRates = readonly [number, number];

/** One fixed step of easing: `value` moves toward `target` at `rates[0]` (+ `gain` × value) rising, `rates[1]` falling. */
export function easeWeight(value: number, target: number, rates: WeightRates, dt: number, gain = 0): number {
  return approach(value, target, dt * (target > value ? rates[0] + gain * value : rates[1]));
}

/** What drives a weight and how it eases. */
export interface WeightInfo {
  /** The body state that drives it. */
  readonly word: BodyStateName;
  /** The stack slot it feeds: locomotion (`base`) or what overrides it (`override`). */
  readonly slot: 'base' | 'override';
  /** Its easing rates per second, `[rising, falling]`. */
  readonly rates: WeightRates;
  /** How much faster it rises per unit of weight, per second. */
  readonly gain?: number;
}

/** A weight that eases at one rate both ways. */
const both = (word: BodyStateName, slot: WeightInfo['slot'], rate: number): WeightInfo => ({
  word,
  slot,
  rates: [rate, rate],
});

/** Every weight of the humanoid: its body state, its slot and its rates (from humanoid.ts's `STEP`). */
export const HUMANOID_WEIGHTS = {
  speed: both('velocity', 'base', STEP.speed),
  dash: { word: 'dash', slot: 'base', rates: STEP.dash },
  air: { word: 'air', slot: 'base', rates: STEP.air },
  climb: both('climb', 'base', STEP.climb),
  hurt: both('hurt', 'override', STEP.hurt),
  attack: { word: 'body', slot: 'override', rates: STEP.attack },
  point: { word: 'point', slot: 'override', rates: STEP.point },
  down: { word: 'down', slot: 'override', rates: [STEP.fall.rate, STEP.fall.rise], gain: STEP.fall.gain },
  stanceGuard: both('stance', 'override', STEP.stance),
  stanceReady: both('stance', 'override', STEP.stance),
  cheer: both('pose', 'override', STEP.pose),
  cast: both('pose', 'override', STEP.pose),
  guard: both('pose', 'override', STEP.pose),
  kneel: both('pose', 'override', STEP.pose),
  crouch: both('pose', 'override', STEP.pose),
  wave: both('pose', 'override', STEP.pose),
  hips: both('pose', 'override', STEP.pose),
  block: both('pose', 'override', STEP.pose),
} as const satisfies Readonly<Record<keyof HumanoidWeights, WeightInfo>>;

/** A humanoid weight's name. */
export type WeightName = keyof typeof HUMANOID_WEIGHTS;

/** The weights above zero, in `HUMANOID_WEIGHTS` order, rounded by `round`; only `slot`'s when given. */
export function activeWeights(
  weights: Readonly<HumanoidWeights>,
  slot?: WeightInfo['slot'],
  round: (x: number) => number = (x) => x,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [name, info] of Object.entries(HUMANOID_WEIGHTS) as [WeightName, WeightInfo][]) {
    if (weights[name] > 0 && (slot === undefined || info.slot === slot)) out[name] = round(weights[name]);
  }
  return out;
}
