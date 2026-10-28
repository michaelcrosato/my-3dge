/**
 * @file What the clip layer plays and keeps (PLAN.md §10.4, WP 8.4; engine/anim/clip/layer.ts plays it): a play's
 * options (`ClipPlay`: my-3d2dge's moment fields), a slot (a clip playing, its time and weight), the layer's plain
 * state (`ClipLayerState`, which the sim saves, hashes and captures), its events, what a step is told
 * (`ClipStepInput`), its timings (`CLIP_LAYER`) and what it is made with (`ClipLayerOptions`). Split from layer.ts at
 * its line cap.
 *
 * Invariants: data only, plain numbers, strings and arrays; times in seconds, speeds in m/s.
 *
 * @example
 * CLIP_LAYER.fade; // 0.12: a clip fades in over 0.12 s unless its play says otherwise
 * @see engine/anim/clip/layer.test.ts
 */
import type { Build } from '../builds';
import type { JointName, MaskName } from '../skeleton';
import type { ClipLibrary } from './library';

/** How a clip plays (see the file comment). */
export interface ClipPlay {
  /** Playback rate, 1 as captured. */
  speed?: number;
  /** Seconds it fades in over what plays now (0.12; 0 at once). */
  fade?: number;
  /** Seconds it fades out when stopped or ended (0.2). */
  out?: number;
  /** Clip seconds it starts from (0). */
  at?: number;
  /** The joints it plays: a preset, or joints and presets (`boneMask`). */
  mask?: MaskName | readonly (JointName | MaskName | 'root')[];
  /** Loops, or not, whatever the clip says. */
  loop?: boolean;
  /** Added to the pose under it (its change from its first frame), not laid over it. */
  additive?: boolean;
  /** Left and right swapped. */
  mirror?: boolean;
  /** Moving or a flinch does not cancel it. */
  walk?: boolean;
  /** A one-shot keeps its last pose until stopped. */
  hold?: boolean;
  /** The clip that follows when this one ends. */
  next?: string;
  /** Clip seconds by which a fall is down: a `landed` event, and `down()` from then. */
  landed?: number;
  /** Played as an attack: a `hit` event at its `hit` event, else at its strike time. */
  attack?: boolean;
}

/** A slot: a playing clip and where it is. Plain data. */
export interface ClipSlot {
  /** `SET/Clip`. */
  clip: string;
  /** Clip seconds (a loop's run on; sampling wraps them). */
  t: number;
  /** Its fade, 0–1. */
  w: number;
  /** The last tick's rate. */
  rate: number;
  /** Seconds of the fade out under way; 0 while it plays on. */
  stopping: number;
  /** Picked by `locomote`. */
  loco: boolean;
  play: ClipPlay;
}

/** The layer's state, plain data: what `step` changes and `save` copies. */
export interface ClipLayerState {
  /** The clips playing, bottom first: the last is the current one. */
  slots: ClipSlot[];
  /** The loops `locomote` picks from, by ground speed. */
  moving: { idle?: string; walk: string; run?: string } | null;
  /** Whether the run plays (the walk–run switch's side). */
  running: boolean;
  /** The last tick's ground speed, m/s. */
  ground: number;
  /** The last tick's root motion `[x, z]`, metres in the character's frame. */
  root: [number, number];
}

/** An event of the tick `step` took. */
export type ClipLayerEvent =
  { type: 'event'; clip: string; name: string; side?: 'L' | 'R' } | { type: 'hit' | 'landed' | 'end'; clip: string };

/** What `step` reads. */
export interface ClipStepInput {
  /** The character's speed over the ground, m/s. */
  groundSpeed?: number;
  /** A flinch: fades a clip without `walk`. */
  hurt?: boolean;
  /** An action or a roll: takes the body back at once. */
  action?: boolean;
}

/** The layer's defaults: fades (s), the cancel speed (m/s), the locomotion crossfade (shardfall's `FADE`). */
export const CLIP_LAYER = { fade: 0.12, out: 0.2, quick: 0.07, move: 1.25, loco: 0.25 } as const;

/** What a `ClipLayer` is made with. */
export interface ClipLayerOptions {
  /** The libraries its clips come from. */
  library: ClipLibrary | readonly ClipLibrary[];
  /** Its name in the animator ('clips'). */
  name?: string;
  /** The build its paces and root motion are measured on: the animator's (`build:chibi`, as its default). */
  build?: Build | string;
  /** The fixed step (`SIM_DT`). */
  dt?: number;
  /** Contact IK and the lift (retarget.ts; true); off, the pose is the rotation copy alone, as a mixer plays it. */
  ik?: boolean;
  /** A blade held in the right hand: its length, metres, along the weaponR socket's +Z, kept above the floor. */
  blade?: number;
}

/** Scratch. */
