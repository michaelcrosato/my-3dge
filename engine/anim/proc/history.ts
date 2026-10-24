/**
 * @file Pose history (PLAN.md WP 10.1, §5.6's delayed pose replay): a rig's recent poses, played again a little later:
 * a second pair of arms echoing the first, a follower doing what its leader did, an afterimage. `PoseHistory` records
 * `count` points at each `push(time, points)` (in whatever frame the rig gives them: its own, so the echo moves with
 * it), keeps `keep` seconds of them and one record older, and `at(lag, out)` gives the pose `lag` seconds before the
 * newest, between the two records around that moment. Older than it holds, the oldest; with nothing recorded, `out`
 * as it is.
 *
 * Invariants: records keep their order and times (a time not after the newest is dropped, as a step taken twice); a
 * lag of 0 is the newest pose exactly; no clock but the times it is given, no random stream.
 *
 * Carried from `my-3d2dge:src/emberdeep/36-bosses.js:644-681` (the Six-Armed Reaver: the hands' offsets from the
 * shoulders recorded each frame, 0.4 s kept, the lower arms replaying them 0.07 and 0.15 s late), as a mechanism:
 * the source took the record at or before the lag, here the pose between the records around it.
 *
 * @example
 * import { Vector3 } from '../../core/math';
 * const echo = new PoseHistory({ count: 1, keep: 0.4 });
 * for (let i = 0; i <= 30; i++) echo.push(i / 60, [new Vector3(i / 60, 0, 0)]);
 * echo.at(0.1, [new Vector3()])[0].x; // ≈ 0.4: where the hand was 0.1 s before the newest (0.5)
 * @see engine/anim/proc/history.test.ts
 */
import type { Vector3 } from '../../core/math';

/** A history's shape: how many points a pose has, and how long it keeps them, s. */
export interface HistoryOptions {
  readonly count: number;
  readonly keep: number;
}

/** Recent poses, played again later (see the file comment). */
export class PoseHistory {
  readonly count: number;
  readonly keep: number;
  readonly #times: number[] = [];
  readonly #poses: Float64Array[] = [];

  /** A history shaped by `options`. */
  constructor(options: HistoryOptions) {
    [this.count, this.keep] = [options.count, options.keep];
  }

  /** How many poses it holds. */
  get length(): number {
    return this.#times.length;
  }

  /** Records `points` (its first `count`) at `time`, s; drops what is older than it keeps. */
  push(time: number, points: readonly Vector3[]): this {
    const times = this.#times;
    if (times.length && time <= times[times.length - 1]) return this;
    let spare: Float64Array | undefined;
    while (times.length >= 2 && time - times[1] >= this.keep) {
      times.shift(); // the oldest goes once the next is old enough to cover the window
      spare = this.#poses.shift();
    }
    const pose = spare ?? new Float64Array(this.count * 3);
    points.slice(0, this.count).forEach((p, i) => pose.set([p.x, p.y, p.z], i * 3));
    times.push(time);
    this.#poses.push(pose);
    return this;
  }

  /** The pose `lag` seconds before the newest, into `out` (see the file comment). */
  at(lag: number, out: Vector3[]): Vector3[] {
    const times = this.#times;
    if (!times.length) return out;
    const when = times[times.length - 1] - Math.max(0, lag);
    let b = times.length - 1;
    while (b > 0 && times[b - 1] >= when) b--;
    const a = Math.max(0, b - 1);
    const span = times[b] - times[a];
    const k = span > 0 ? Math.max(0, Math.min(1, (when - times[a]) / span)) : 1;
    const [p, q] = [this.#poses[a], this.#poses[b]];
    for (let i = 0; i < this.count && i < out.length; i++) {
      out[i].set(p[i * 3] + (q[i * 3] - p[i * 3]) * k, p[i * 3 + 1] + (q[i * 3 + 1] - p[i * 3 + 1]) * k, p[i * 3 + 2] + (q[i * 3 + 2] - p[i * 3 + 2]) * k); // prettier-ignore
    }
    return out;
  }
}
