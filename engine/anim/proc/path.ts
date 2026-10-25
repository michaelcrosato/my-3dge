/**
 * @file The path chain (PLAN.md WP 10.1, §5.6's path-history chains): a serpent's body, a worm's rings or a train of
 * followers going the way its head went. `PathChain` records the head's path as points `gap / 2` apart along it
 * (each on the line from the last toward the head, so a fast head leaves as many as it covered), keeps as much of it
 * as the body needs, and stands segment k at arc length k × `gap` behind the head along that path, between its
 * points. `reset(head, back)` lays the body out behind the head along `back` (lying on the ground, or hanging down a
 * hole) as the path it came by, so a head rising from rest lifts its neck and leaves the rest lying; were the path
 * ever to run out, the rest would lie along its oldest stretch. `tangents` point toward the head.
 *
 * Invariants: world space, metres; segment 0 is the head; consecutive segments lie `gap` apart along the path (a
 * chord across a bend is shorter); the history holds at most enough points for the body and eight more; no clock and
 * no random stream.
 *
 * Carried from `my-3d2dge:src/emberdeep/33-beasts.js:591-671` (`BST_Serpent`: the path recorded every half gap, kept
 * to the body's length, the segments sampled at whole gaps along it, the body hanging where the history runs out),
 * as a mechanism; its ground holes, mounds and crumbling are the game's.
 *
 * @example
 * import { Vector3 } from '../../core/math';
 * const snake = new PathChain({ count: 8, gap: 0.2 }).reset(new Vector3(0, 0.1, 0), new Vector3(0, 0, -1));
 * for (let i = 1; i <= 60; i++) snake.step(new Vector3(Math.sin(i / 20), 0.1, i / 30));
 * snake.points[0].z; // 2: the head where it went
 * snake.points[1].distanceTo(snake.points[0]); // ≈ 0.2: a gap behind it along the way it came
 * @see engine/anim/proc/path.test.ts
 */
import { Vector3 } from '../../core/math';

/** A path chain's shape: its segments, and how far apart along the path they stand, m. */
export interface PathOptions {
  readonly count: number;
  readonly gap: number;
}

/** A chain following its head's path (see the file comment). */
export class PathChain {
  readonly count: number;
  readonly gap: number;
  /** Each segment, the head first, world metres. */
  readonly points: Vector3[];
  /** Each segment's direction toward the head, unit. */
  readonly tangents: Vector3[];
  /** The path, oldest first. */
  // Stryker disable next-line ArrayDeclaration: the constructor's reset empties it before anything reads it
  readonly #path: Vector3[] = [];
  /** Which way the body lies where the path runs out, unit. */
  readonly #back = new Vector3(0, 0, -1);

  /** A chain shaped by `options`, its head at the origin, its body along −Z. */
  constructor(options: PathOptions) {
    [this.count, this.gap] = [options.count, options.gap];
    this.points = Array.from({ length: options.count }, () => new Vector3());
    this.tangents = Array.from({ length: options.count }, () => new Vector3(0, 0, 1));
    this.reset(new Vector3(), this.#back);
  }

  /** Forgets the path: the head at `head`, the body laid out behind it along unit `back`. */
  reset(head: Vector3, back: Vector3): this {
    this.#back.copy(back).normalize();
    this.#path.length = 0;
    const step = this.gap / 2;
    const n = Math.ceil(((this.count - 1) * this.gap) / step);
    for (let i = n; i >= 0; i--) this.#path.push(head.clone().addScaledVector(this.#back, i * step)); // oldest first
    return this.#sample(head);
  }

  /** How many points of the path it holds. */
  get history(): number {
    return this.#path.length;
  }

  /** Records the head at `head` and stands the body along the path. */
  step(head: Vector3): this {
    const step = this.gap / 2;
    const path = this.#path;
    let last = path[path.length - 1];
    let left = last.distanceTo(head);
    while (left >= step) {
      last = last.clone().lerp(head, step / left);
      path.push(last);
      left -= step;
    }
    const keep = Math.ceil(((this.count - 1) * this.gap) / step) + 8;
    if (path.length > keep) path.splice(0, path.length - keep);
    if (path.length > 1) this.#back.subVectors(path[0], path[1]).normalize(); // the way its oldest stretch ran
    return this.#sample(head);
  }

  /** Stands each segment at its arc length behind `head` along the path, and its tangent. */
  #sample(head: Vector3): this {
    const path = this.#path;
    let [k, acc] = [1, 0];
    let prev = head;
    this.points[0].copy(head);
    for (let j = path.length - 1; j >= 0 && k < this.count; j--) {
      const d = prev.distanceTo(path[j]);
      while (k < this.count && k * this.gap <= acc + d && d > 1e-12) {
        this.points[k].lerpVectors(prev, path[j], (k * this.gap - acc) / d);
        k++;
      }
      [acc, prev] = [acc + d, path[j]];
    }
    for (; k < this.count; k++) this.points[k].copy(prev).addScaledVector(this.#back, k * this.gap - acc);
    for (let i = 0; i < this.count; i++) {
      const [a, b] = [this.points[Math.max(0, i - 1)], this.points[Math.min(this.count - 1, i + 1)]];
      const t = this.tangents[i].subVectors(a, b);
      if (t.lengthSq() > 1e-18) t.normalize();
      else t.copy(this.#back).negate();
    }
    return this;
  }
}
