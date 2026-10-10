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
 * Named streams: a stream's name is the canonical text of its keys (`["entity",7,"anim"]`), JSON's own text for
 * strings and finite numbers other than -0 (the same text, made fast), the canonical walk for the rest. A stream still
 * at its derived seed is the same as no stream, so `state()` leaves it out: making a handle without drawing changes
 * no hash. `setState` sets the streams it lists and puts every other one back at its derived seed, so a handle,
 * whenever it was made, keeps reaching its stream across restores and reseeds. Entity streams
 * (`entity(id, …)`, the keys `'entity', id, …`) are indexed by id, so `dropEntity(id)` removes one entity's streams
 * without a walk over the rest; a dropped stream's old handle reaches nothing any more.
 *
 * Carried from `my-3d2dge:engine/my-3d2dge.js:84` (`rng`, seeds normalised by `| 0` as there), with the stream
 * helpers of `my-3d2dge:src/emberdeep/00-core.js:104` rebuilt generically.
 *
 * @example
 * const streams = new RngStreams(1234);
 * const roll = streams.stream('loot').int(1, 6); // 1..6, the same every run
 * const saved = streams.state(); // { '["loot"]': … }
 * streams.entity(7, 'anim').next(); // the stream ["entity",7,"anim"]; streams.dropEntity(7) removes it
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

/** The name of a stream: JSON's text when it equals the canonical text (strings, finite numbers but -0), else that. */
function keyText(keys: readonly (string | number)[]): string {
  for (const key of keys) {
    if (typeof key === 'string' || (Number.isFinite(key) && !Object.is(key, -0))) continue;
    return serialize(keys); // -0, NaN, ±Infinity and other values: the canonical walk (which refuses what it cannot hold)
  }
  return JSON.stringify(keys);
}

/** The prefix of every entity stream's name. */
const ENTITY = '["entity",';

/** One named stream and the int32 it starts from (worked out when first needed for a restored stream). */
interface Slot {
  readonly rng: Rng;
  start?: number;
}

/**
 * Named streams from one seed (the scene's): `stream('ai')`, `entity(7, 'anim')`. Each is created on first use from
 * `derive(seed, …keys)`, so the streams never depend on each other or on the order they were first used in.
 */
export class RngStreams {
  /** The seed every stream derives from. */
  #seed: number;
  /** Streams by name. */
  readonly #slots = new Map<string, Slot>();
  /** Every name, sorted (code-unit order), kept up to date as streams come and go. */
  #sorted: string[] = [];
  /** The names of each entity's streams, by entity id. */
  readonly #byEntity = new Map<number, string[]>();
  /** Each entity's streams named by one string (`entity(7, 'anim')`), by id then that string: the fast path. */
  readonly #named = new Map<number, Map<string, Rng>>();

  /** Streams derived from `seed`. */
  constructor(seed: number) {
    this.#seed = seed;
  }

  /** The seed every stream derives from. */
  get seed(): number {
    return this.#seed;
  }

  /** The stream named by `keys`, created from `derive(seed, …keys)` on first use. */
  stream(...keys: readonly (string | number)[]): Rng {
    const name = keyText(keys);
    return (this.#slots.get(name) ?? this.#add(name, keys)).rng;
  }

  /** The entity's stream named by `keys` (the stream `'entity', id, …keys`). */
  entity(id: number, ...keys: readonly (string | number)[]): Rng {
    if (!(id > 0) || keys.length !== 1 || typeof keys[0] !== 'string') return this.stream('entity', id, ...keys);
    let own = this.#named.get(id);
    let rng = own?.get(keys[0]);
    if (rng) return rng;
    rng = this.stream('entity', id, keys[0]);
    if (!own) this.#named.set(id, (own = new Map()));
    own.set(keys[0], rng);
    return rng;
  }

  /** Removes every stream of entity `id`; their old handles reach nothing any more. */
  dropEntity(id: number): void {
    const names = this.#byEntity.get(id);
    this.#named.delete(id);
    if (!names) return;
    this.#byEntity.delete(id);
    for (const name of names) {
      this.#slots.delete(name);
      this.#sorted.splice(this.#place(name), 1);
    }
  }

  /** Removes the streams of every entity for which `alive(id)` is false. */
  keepEntities(alive: (id: number) => boolean): void {
    for (const id of [...this.#byEntity.keys()]) if (!alive(id)) this.dropEntity(id);
  }

  /** Every stream away from its derived seed, by name, with its state; names sorted, so the record is canonical. */
  state(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const name of this.#sorted) {
      const slot = this.#slots.get(name) as Slot;
      if (slot.rng.state !== slot.start) out[name] = slot.rng.state;
    }
    return out;
  }

  /**
   * Sets the streams `states` lists (a `state()` record) and puts every other stream back at its derived seed, so
   * each continues exactly as in the run the record came from; with `seed`, the streams derive from it from now on.
   * Handles stay valid.
   */
  setState(states: Readonly<Record<string, number>>, seed = this.#seed): void {
    if (!Object.is(seed, this.#seed)) {
      this.#seed = seed;
      for (const slot of this.#slots.values()) slot.start = undefined;
    }
    for (const [name, slot] of this.#slots) {
      if (Object.hasOwn(states, name)) continue;
      slot.start ??= startOf(this.#seed, JSON.parse(name) as (string | number)[]);
      slot.rng.state = slot.start;
    }
    let added = false;
    for (const [name, value] of Object.entries(states)) {
      const slot = this.#slots.get(name);
      if (slot) slot.rng.state = value;
      else {
        this.#index(name, () => JSON.parse(name) as (string | number)[]);
        const rng = new Rng(value);
        this.#slots.set(name, { rng });
        added = true;
      }
    }
    if (added) this.#sorted = [...this.#slots.keys()].sort();
  }

  /** Makes the stream `name` (from `keys`) and files it. */
  #add(name: string, keys: readonly (string | number)[]): Slot {
    const start = startOf(this.#seed, keys);
    const slot: Slot = { rng: new Rng(start), start };
    this.#slots.set(name, slot);
    this.#sorted.splice(this.#place(name), 0, name);
    this.#index(name, () => keys);
    return slot;
  }

  /** Files an entity stream's name under its id. */
  #index(name: string, keys: () => readonly (string | number)[]): void {
    if (!name.startsWith(ENTITY)) return;
    const id = keys()[1];
    if (typeof id !== 'number') return;
    const names = this.#byEntity.get(id);
    if (names) names.push(name);
    else this.#byEntity.set(id, [name]);
  }

  /** Where `name` sits, or would sit, in the sorted names (binary search, code-unit order). */
  #place(name: string): number {
    const sorted = this.#sorted;
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid] < name) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
}

/** The int32 state a stream of `keys` starts from. */
function startOf(seed: number, keys: readonly (string | number)[]): number {
  return derive(seed, ...keys) | 0;
}
