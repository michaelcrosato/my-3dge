/**
 * @file Seeded randomness for the sim (PLAN.md §6.3, §6.5; doctrine: Reproducible): Mulberry32 streams, bit-exact
 * with my-3d2dge's `E.rng`, seeds derived from a seed and keys, and named streams whose states are plain numbers that
 * captures store and the hash covers. Sim-side code never calls `Math.random` (ESLint bans it); it draws from a
 * stream.
 *
 * Invariants: a stream's whole state is one int32 (`state`), so get → set resumes the exact sequence. `next()` is in
 * [0, 1) with 32 bits of randomness. A stream depends only on its seed: `derive(seed, …keys)` hashes the seed and
 * keys (canonically, with engine/core/hash.ts), so adding a stream never shifts another, and `RngStreams` creates
 * each stream on first use. Pure int32 arithmetic: the same in Node and Chromium.
 *
 * Carried from `my-3d2dge:engine/my-3d2dge.js:84` (`rng`, seeds normalised by `| 0` as there), with the stream
 * helpers of `my-3d2dge:src/emberdeep/00-core.js:104` rebuilt generically.
 *
 * @example
 * const streams = new RngStreams(1234);
 * const roll = streams.stream('loot').int(1, 6); // 1..6, the same every run
 * const saved = streams.state(); // { '["loot"]': … }
 * new Rng(42).next(); // 0.6011037519201636
 * @see engine/core/rng.test.ts
 */
import { Fnv64, mix32, serialize } from './hash';

const TWO_32 = 4294967296;

/** One Mulberry32 stream: `next()` and the usual helpers, all drawn from `next()` in order. */
export class Rng {
  /** The whole state, an int32. */
  #state: number;

  /** A stream from `seed` (any number; normalised with `| 0`, as my-3d2dge's `E.rng` does). */
  constructor(seed: number) {
    this.#state = seed | 0;
  }

  /** The next number in [0, 1). */
  next(): number {
    const s = (this.#state + 0x6d2b79f5) | 0;
    this.#state = s;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / TWO_32;
  }

  /** A number in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** An integer from `min` to `max`, both included. */
  int(min: number, max: number): number {
    return Math.floor(min + this.next() * (max - min + 1));
  }

  /** True with probability `p`. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** One element of `list`, uniformly; undefined when it is empty. */
  pick<T>(list: readonly T[]): T {
    return list[Math.floor(this.next() * list.length)];
  }

  /** Shuffles `list` in place (Fisher–Yates) and returns it. */
  shuffle<T>(list: T[]): T[] {
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
  }

  /** The stream's state: an int32 that `state = …` restores exactly, in this stream or a new one. */
  get state(): number {
    return this.#state;
  }

  set state(value: number) {
    this.#state = value | 0;
  }
}

/**
 * A seed derived from `seed` and `keys` (strings or numbers), as an unsigned 32-bit integer: the 64-bit FNV-1a hash
 * of `[seed, …keys]` in canonical form, folded and mixed. Different keys give unrelated seeds, and the order matters.
 */
export function derive(seed: number, ...keys: readonly (string | number)[]): number {
  const hash = new Fnv64().value([seed, ...keys]);
  return mix32(hash.hi ^ hash.lo);
}

/**
 * Named streams from one seed (the scene's): `stream('ai')`, `stream('entity', 7, 'anim')`. Each is created on first
 * use from `derive(seed, …keys)`, so the streams never depend on each other or on the order they were first used.
 */
export class RngStreams {
  /** The seed every stream derives from. */
  readonly seed: number;
  /** Streams by their canonical key text (`["entity",7,"anim"]`). */
  readonly #streams = new Map<string, Rng>();

  /** Streams derived from `seed`. */
  constructor(seed: number) {
    this.seed = seed;
  }

  /** The stream named by `keys`, created from `derive(seed, …keys)` on first use. */
  stream(...keys: readonly (string | number)[]): Rng {
    const key = serialize(keys);
    let stream = this.#streams.get(key);
    if (!stream) {
      stream = new Rng(derive(this.seed, ...keys));
      this.#streams.set(key, stream);
    }
    return stream;
  }

  /** Every stream used so far, by its canonical key text, with its state; keys sorted, so the record is canonical. */
  state(): Record<string, number> {
    const keys = [...this.#streams.keys()].sort();
    return Object.fromEntries(keys.map((key) => [key, (this.#streams.get(key) as Rng).state]));
  }

  /**
   * Restores streams from a `state()` record. A stream the record lacks is dropped, so its next use starts it from
   * its derived seed, exactly as in the run the record came from.
   */
  setState(states: Readonly<Record<string, number>>): void {
    for (const key of [...this.#streams.keys()]) if (!(key in states)) this.#streams.delete(key);
    for (const [key, value] of Object.entries(states)) {
      const stream = this.#streams.get(key) ?? new Rng(0);
      stream.state = value;
      this.#streams.set(key, stream);
    }
  }
}
