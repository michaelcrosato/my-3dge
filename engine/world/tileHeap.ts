/**
 * @file The tile heap (PLAN.md WP 4.3): an indexed binary min-heap of tiles keyed by a typed array, which navigation's
 * searches run on (engine/world/nav.ts: A* and the flow fields' Dijkstra; engine/world/siteNavGraph.ts's floods, a lazy
 * one's paused on a heap of its own), so a query allocates nothing but its answer.
 * Split from nav.ts at its line cap (WP 10.5).
 *
 * Invariants: ties go to the lower tile index, so equal keys pop in index order on every run; pushing a tile it holds
 * moves it up after its key dropped (decrease-key), never down.
 *
 * @example
 * const heap = new TileHeap(4);
 * heap.start(new Float64Array([3, 1, 1, 0]));
 * [2, 0, 1].forEach((tile) => heap.push(tile));
 * heap.peek(); // 1: the least key, left in
 * [heap.pop(), heap.pop(), heap.pop()]; // [1, 2, 0]: the lower tile first on a tie
 * @see engine/world/nav.test.ts
 */

/** An indexed binary min-heap of tiles keyed by `keys[tile]`, ties to the lower tile; pushing a held tile re-sorts it. */
export class TileHeap {
  readonly #heap: Int32Array;
  readonly #at: Int32Array;
  #keys: Float64Array = new Float64Array(0);
  size = 0; // how many tiles it holds

  constructor(tiles: number) {
    [this.#heap, this.#at] = [new Int32Array(tiles), new Int32Array(tiles).fill(-1)];
  }

  /** Empties it and keys it by `keys`. */
  start(keys: Float64Array): void {
    for (let k = 0; k < this.size; k++) this.#at[this.#heap[k]] = -1;
    this.size = 0;
    this.#keys = keys;
  }

  /** Adds `tile`, or moves it up after its key dropped. */
  push(tile: number): void {
    const heap = this.#heap;
    let k = this.#at[tile] < 0 ? this.size++ : this.#at[tile];
    for (let parent = (k - 1) >> 1; k > 0 && this.#less(tile, heap[parent]); k = parent, parent = (k - 1) >> 1) {
      heap[k] = heap[parent];
      this.#at[heap[k]] = k;
    }
    heap[k] = tile;
    this.#at[tile] = k;
  }

  /** The tile with the least key, left in it; −1 when it is empty. */
  peek(): number {
    return this.size ? this.#heap[0] : -1;
  }

  /** Removes and returns the tile with the least key. */
  pop(): number {
    const heap = this.#heap;
    const top = heap[0];
    const last = heap[--this.size];
    this.#at[top] = -1;
    if (this.size === 0) return top;
    let k = 0;
    for (let child = 1; child < this.size; k = child, child = 2 * k + 1) {
      if (child + 1 < this.size && this.#less(heap[child + 1], heap[child])) child++;
      if (!this.#less(heap[child], last)) break;
      heap[k] = heap[child];
      this.#at[heap[k]] = k;
    }
    heap[k] = last;
    this.#at[last] = k;
    return top;
  }

  #less(a: number, b: number): boolean {
    return this.#keys[a] < this.#keys[b] || (this.#keys[a] === this.#keys[b] && a < b);
  }
}
