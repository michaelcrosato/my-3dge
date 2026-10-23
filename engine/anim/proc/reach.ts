/**
 * @file Animation-measured reach (PLAN.md WP 10.1, §5.6's animation-measured reach): how far an attack reaches, read
 * off the animation rather than written by hand, so whatever keeps its distance (an AI, a camera, a test) goes by what
 * the body really does. `measureReach(sample, options)` asks for the move's pose at `steps + 1` moments of its window
 * (its progress from 0 to 1, both ends included), each in the body's frame (its root at the origin, facing +Z):
 * `sample(u)` gives the strike point (a blade's tip, a fist, a claw) and the head. It returns how far ahead the strike
 * point reaches at most (`reach`, m along +Z) and at which moment (`at`), the head's farthest ahead (`head`), and where
 * to stand (`stand`): the reach and a `margin`, never nearer than the head and a body's `room`.
 *
 * Invariants: pure; `sample` is asked in order from u = 0 to 1, each moment exactly `i / steps`, so the last is 1
 * (the source's sum of tenths fell short of it).
 *
 * Carried from `my-3d2dge:src/emberdeep/30-monsters-core.js:23-41` (each attack measured once on a spare rig over its
 * active phase, its reach the farthest the strike point went, its stand the reach and 3 units, or the head and 8.5
 * units a size), as a mechanism, in metres.
 *
 * @example
 * import { Vector3 } from '../../core/math';
 * const swing = (u: number) => ({ strike: new Vector3(0, 1.2, 0.4 + 0.6 * Math.sin(Math.PI * u)), head: new Vector3(0, 1.6, 0.1) });
 * measureReach(swing).reach; // 1: at the middle of the swing
 * measureReach(swing).at; // 0.5
 * @see engine/anim/proc/reach.test.ts
 */
import type { Vector3 } from '../../core/math';

/** A moment of a move, in the body's frame: where its strike point and its head are. */
export interface ReachPose {
  readonly strike: Vector3;
  readonly head?: Vector3;
}

/** How a reach is measured: how many steps across the window, and what the stand adds (m). */
export interface ReachOptions {
  /** Steps across the window (10: eleven moments). */
  readonly steps?: number;
  /** What the stand adds to the reach, m (0.19: the source's 3 units). */
  readonly margin?: number;
  /** The room a body leaves past its head, m (0.53: the source's 8.5 units). */
  readonly room?: number;
}

/** A move's measured reach (see the file comment). */
export interface Reach {
  readonly reach: number;
  readonly at: number;
  readonly head: number;
  readonly stand: number;
}

/** Measures the reach of the move `sample` poses (see the file comment). */
export function measureReach(sample: (u: number) => ReachPose, options: ReachOptions = {}): Reach {
  const { steps = 10, margin = 0.19, room = 0.53 } = options;
  let [reach, at, head] = [-Infinity, 0, -Infinity];
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const pose = sample(u);
    if (pose.strike.z > reach) [reach, at] = [pose.strike.z, u];
    if (pose.head) head = Math.max(head, pose.head.z);
  }
  const stand = Math.max(reach + margin, head === -Infinity ? -Infinity : head + room);
  return { reach, at, head: head === -Infinity ? 0 : head, stand };
}
