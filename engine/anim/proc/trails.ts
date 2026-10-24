/**
 * @file Tip trails (PLAN.md WP 10.1, §5.6's tip trails): the streak a fast tip leaves, a blade's swing, a tail's lash,
 * a wingtip. `TipTrail` samples a tip, and the base it rides with (a blade's hilt, so the view draws a ribbon from
 * base to tip), each step while it is `active`; keeps samples younger than `life` seconds, `capacity` at most, the
 * newest first; and lets them age out when the tip goes still rather than vanish at once (the source cleared them).
 * A tip that jumps farther than `jump` m in a step (a teleport, a reset) starts the trail afresh, so it never streaks
 * across the world. Each sample's `age` over the life is its fade, for the view.
 *
 * Invariants: world space, metres and seconds; samples are copies, newest first, none older than `life`; no clock
 * but the steps' and no random stream.
 *
 * Carried from `my-3d2dge:src/emberdeep/22-char-dan.js:246-257` (the scythes' trails: the tips pushed while a move is
 * active, six kept, a segment over 40 units skipped) and `src/emberdeep/21-codex.js:406-433` (cleared when the tip
 * jumps), as mechanisms: there sampled per draw and by count, here per step and by time, with a base for a ribbon.
 *
 * @example
 * import { Vector3 } from '../../core/math';
 * const swing = new TipTrail({ life: 0.1 });
 * for (let i = 0; i < 12; i++) swing.step(1 / 60, new Vector3(Math.sin(i / 3), 1.2, Math.cos(i / 3)));
 * swing.samples.length; // 6: a tenth of a second of steps
 * swing.samples[0].age; // 0: the newest first
 * @see engine/anim/proc/trails.test.ts
 */
import { Vector3 } from '../../core/math';

/** A trail's shape (see the file comment). */
export interface TrailOptions {
  /** How long a sample lasts, s (0.1). */
  readonly life?: number;
  /** The most samples kept (32). */
  readonly capacity?: number;
  /** A step's move past which the trail starts afresh, m (2.5). */
  readonly jump?: number;
}

/** A sample of a trail: its tip, its base and its age, s. */
export interface TipSample {
  readonly tip: Vector3;
  readonly base: Vector3;
  age: number;
}

/** The streak a tip leaves (see the file comment). */
export class TipTrail {
  readonly life: number;
  readonly capacity: number;
  readonly jump: number;
  /** Its samples, the newest first. */
  readonly samples: TipSample[] = [];

  /** A trail shaped by `options`. */
  constructor(options: TrailOptions = {}) {
    [this.life, this.capacity, this.jump] = [options.life ?? 0.1, options.capacity ?? 32, options.jump ?? 2.5];
  }

  /** Steps `dt` seconds: the samples age, and while `active` the tip (on `base`, the tip itself) is sampled. */
  step(dt: number, tip: Vector3, base: Vector3 = tip, active = true): this {
    for (const sample of this.samples) sample.age += dt;
    while (this.samples.length && this.samples[this.samples.length - 1].age > this.life + 1e-9) this.samples.pop();
    if (!active) return this;
    if (this.samples.length && this.samples[0].tip.distanceTo(tip) > this.jump) this.clear();
    const spare = this.samples.length >= this.capacity ? this.samples.pop()! : undefined;
    const sample = spare ?? { tip: new Vector3(), base: new Vector3(), age: 0 };
    sample.tip.copy(tip);
    sample.base.copy(base);
    sample.age = 0;
    this.samples.unshift(sample);
    return this;
  }

  /** Forgets every sample. */
  clear(): this {
    this.samples.length = 0;
    return this;
  }
}
