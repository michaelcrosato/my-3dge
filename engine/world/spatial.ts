/**
 * @file A spatial hash on the ground plane (PLAN.md WP 4.3, §5.4): finds what is near a point fast (a crowd's
 * neighbours, bullets against many enemies). Each step, `clear()`, then `add(id, x, z)` every point (an entity id, an
 * index: any integer), then ask as often as needed: `query(x, z, radius, out)` writes the ids within `radius` metres
 * into `out`, `nearest(x, z, radius, skip)` names the closest. Distances are on the ground (x and z) and exact: a
 * point is reported only when it is within the radius, a point on the circle included.
 *
 * Points go into square cells `cell` metres wide (⌊x / cell⌋, ⌊z / cell⌋), the cells into a power-of-two table of
 * buckets, and the first query after adding sorts the points by bucket (a counting sort), so a query reads only the
 * buckets of the cells its circle's square touches, and skips points of other cells that share a bucket.
 *
 * Invariants: results come in a fixed order, by cell (rows of z, then columns of x, from the smallest), then in the
 * order the points were added; `nearest` breaks ties the same way. Everything lives in typed arrays that grow only
 * when more points are added than ever before, so clearing, adding and querying allocate nothing per step. It holds
 * numbers copied from the sim's state, so it is derived data: rebuild it each step, never save it.
 *
 * Carried from `my-3d2dge:engine/my-3d2dge.js:3626-3646` (`SpatialHash`: `add`, `build`, `near`, `query`), on typed
 * arrays, with exact distances and the results written into the caller's array.
 *
 * @example
 * const hash = new SpatialHash({ cell: 2 });
 * hash.clear().add(7, 1, 1).add(8, 2.5, 1).add(9, 10, 10);
 * const out = new Int32Array(8);
 * [hash.query(1, 1, 2, out), out[0], out[1]]; // [2, 7, 8]
 * [hash.nearest(1, 1, 5, 7), hash.nearest(10, 10, 0.5), hash.count]; // [8, 9, 3]: the closest other than 7, …
 * @see engine/world/spatial.test.ts
 */
import { codeError } from '../core/log';
import { defineSchema, parse, type SpecOf } from '../core/schema';

/** The options of `new SpatialHash(options)`. */
export const SPATIAL_HASH_FIELDS = defineSchema({
  cell: { type: 'number', default: 2, minimum: 0, unit: 'm', description: 'The cells’ width: about the usual radius.' },
  capacity: { type: 'integer', default: 64, minimum: 1, description: 'The points it has room for at first.' },
});

/** What `new SpatialHash` takes: each field of `SPATIAL_HASH_FIELDS`, optional. */
export type SpatialHashOptions = SpecOf<typeof SPATIAL_HASH_FIELDS>;

/** The bucket of cell (cx, cz) in a table of `mask + 1` buckets. */
const bucketOf = (cx: number, cz: number, mask: number) =>
  (Math.imul(cx, 0x8da6b343) ^ Math.imul(cz, 0xd8163841)) & mask;

/** Points on the ground, hashed by cell (see the file comment). */
export class SpatialHash {
  /** The cells' width (m). */
  readonly cell: number;
  #count = 0;
  #sorted = true;
  /** Per point: its id, place and cell. */
  #ids = new Int32Array(0);
  #xs = new Float64Array(0);
  #zs = new Float64Array(0);
  #cx = new Int32Array(0);
  #cz = new Int32Array(0);
  /** The points sorted by bucket, and where each bucket's run starts (`mask + 2` entries). */
  #order = new Int32Array(0);
  #start = new Int32Array(0);
  #mask = 0;
  /** The last scan's points and their squared distances. */
  #hits = new Int32Array(0);
  #d2 = new Float64Array(0);

  /** An empty hash with cells `cell` metres wide. */
  constructor(options: SpatialHashOptions = {}) {
    const where = 'new SpatialHash(options)';
    const { cell, capacity } = parse(SPATIAL_HASH_FIELDS, options, where);
    if (!(cell > 0 && cell < Infinity)) {
      throw codeError('CORE_BAD_SPEC', { where, problems: `cell ${cell} is no width: give metres above 0` });
    }
    this.cell = cell;
    this.#grow(capacity);
  }

  /** How many points it holds. */
  get count(): number {
    return this.#count;
  }

  /** How many points it has room for before its arrays grow. */
  get capacity(): number {
    return this.#ids.length;
  }

  /** Removes every point (keeping the room it made). */
  clear(): this {
    this.#count = 0;
    this.#sorted = true;
    return this;
  }

  /** Adds point `id` at (x, z) metres. */
  add(id: number, x: number, z: number): this {
    if (this.#count === this.#ids.length) this.#grow(2 * this.#ids.length);
    const i = this.#count++;
    this.#ids[i] = id;
    this.#xs[i] = x;
    this.#zs[i] = z;
    this.#cx[i] = Math.floor(x / this.cell);
    this.#cz[i] = Math.floor(z / this.cell);
    this.#sorted = false;
    return this;
  }

  /**
   * Writes the ids within `radius` of (x, z) into `out`, in the fixed order, as many as fit; returns how many are
   * within the radius (more than were written when `out` is too short).
   */
  query(x: number, z: number, radius: number, out: Int32Array): number {
    const found = this.#scan(x, z, radius);
    for (let k = 0; k < found && k < out.length; k++) out[k] = this.#ids[this.#hits[k]];
    return found;
  }

  /** The id of the point nearest (x, z) within `radius`, other than `skip` (ties to the first in order); −1 if none. */
  nearest(x: number, z: number, radius: number, skip = -1): number {
    const found = this.#scan(x, z, radius);
    let best = -1;
    for (let k = 0; k < found; k++) {
      const i = this.#hits[k];
      if (this.#ids[i] !== skip && (best < 0 || this.#d2[k] < this.#d2[best])) best = k;
    }
    return best < 0 ? -1 : this.#ids[this.#hits[best]];
  }

  /** Lists the points within `radius` of (x, z) in `#hits`, in the fixed order, with their squared distances. */
  #scan(x: number, z: number, radius: number): number {
    if (!(radius >= 0)) return 0;
    if (!this.#sorted) this.#sort();
    const x1 = Math.floor((x + radius) / this.cell);
    const z1 = Math.floor((z + radius) / this.cell);
    let found = 0;
    for (let cz = Math.floor((z - radius) / this.cell); cz <= z1; cz++) {
      for (let cx = Math.floor((x - radius) / this.cell); cx <= x1; cx++) {
        const bucket = bucketOf(cx, cz, this.#mask);
        for (let k = this.#start[bucket]; k < this.#start[bucket + 1]; k++) {
          const i = this.#order[k];
          if (this.#cx[i] !== cx || this.#cz[i] !== cz) continue;
          const dx = this.#xs[i] - x;
          const dz = this.#zs[i] - z;
          if (dx * dx + dz * dz > radius * radius) continue;
          this.#hits[found] = i;
          this.#d2[found++] = dx * dx + dz * dz;
        }
      }
    }
    return found;
  }

  /** Sorts the points by bucket, keeping the order they were added within each (a counting sort). */
  #sort(): void {
    const [order, start, mask] = [this.#order, this.#start, this.#mask];
    start.fill(0);
    for (let i = 0; i < this.#count; i++) start[bucketOf(this.#cx[i], this.#cz[i], mask) + 2]++;
    for (let b = 2; b < start.length; b++) start[b] += start[b - 1];
    // start[b + 1] is now where bucket b begins; placing each point moves it on to where b + 1 begins.
    for (let i = 0; i < this.#count; i++) order[start[bucketOf(this.#cx[i], this.#cz[i], mask) + 1]++] = i;
    this.#sorted = true;
  }

  /** Makes room for `capacity` points (keeping those it holds) and a table of at least twice as many buckets. */
  #grow(capacity: number): void {
    const keep = <T extends Int32Array | Float64Array>(from: T, to: T): T => {
      to.set(from.subarray(0, this.#count));
      return to;
    };
    this.#ids = keep(this.#ids, new Int32Array(capacity));
    this.#xs = keep(this.#xs, new Float64Array(capacity));
    this.#zs = keep(this.#zs, new Float64Array(capacity));
    this.#cx = keep(this.#cx, new Int32Array(capacity));
    this.#cz = keep(this.#cz, new Int32Array(capacity));
    [this.#order, this.#hits, this.#d2] = [
      new Int32Array(capacity),
      new Int32Array(capacity),
      new Float64Array(capacity),
    ];
    let buckets = 16;
    while (buckets < 2 * capacity) buckets *= 2;
    [this.#mask, this.#start] = [buckets - 1, new Int32Array(buckets + 2)];
    this.#sorted = false;
  }
}
