/**
 * @file Navigation on a level (PLAN.md WP 4.3, §5.8, I-22): the walkable grid with a climb limit, A* paths smoothed
 * by line of sight, and cached flow fields that lead every tile to one goal or several.
 *
 * `new NavGrid(level, options)` reads a compiled level once. A tile is open when its glyph is walkable; a step goes
 * to one of its 8 neighbours (`NAV_DIRECTIONS`) when the floor along the line between their centres never rises more
 * than `climb` metres from one sample to the next (`canStep`, engine/world/level/walk.ts). So stairs and the dais's
 * edge climb gently, while a gallery's edge is a wall from below and a drop from above: steps are one-way where
 * floors differ (one-way ledges). A diagonal also needs both ways round its corner, so no route cuts a corner past a
 * wall or up a ledge. The climb limit is data: the crowd's `NAV_CLIMB` by default, or a hero's jump reach from the
 * feel meter (`measureFeel(hero).reach`, engine/sim/feelCourse.ts), since `world` never imports `physics`. Queries take
 * metres on the ground (x east, z south) and answer with tiles (row-major indices) or points.
 *
 * Invariants: navigation is derived data, a pure function of the level and the options: never saved, and rebuilt the
 * same (after a restore, in another runtime); the field cache only saves work. Ties go to the lower tile index. The
 * searches run on typed arrays the grid keeps (an indexed binary heap), so a query allocates only its answer.
 *
 * Carried from `my-3d2dge:src/stress-world/10-hall.js:126-178` (`PASS`: 8 steps sampled along the line, up at most
 * `CLIMB`, no corner cutting; `FLOW`: Dijkstra walked backwards) and shardfall@fa2dab6 `crates/pav_core/src/nav.rs:
 * 104-292` (`nearest_open`, `clear`, `path` with string-pulling, `flow` with reach, the look-ahead `dir`, ties by
 * index), in metres, the corner rule extended to climbs.
 *
 * @example
 * import { compileLevel } from './level/compile';
 * const grid = new NavGrid(compileLevel('#######\n#.....#\n#.###.#\n#.=...#\n#######\n'));
 * grid.findPath({ x: 1.5, z: 1.5 }, { x: 4.5, z: 3.5 })?.map((p) => [p.x, p.z]); // [[5.5, 1.5], [5.5, 3.5], [4.5, 3.5]]
 * const field = grid.flowField(grid.cellAt(1.5, 3.5));
 * [field.distanceAt(2.5, 3.5), field.distanceAt(3.5, 3.5)]; // [1, 10]: down off the ledge, or round by the north
 * field.direction(3.5, 3.5)?.toArray(); // [1, 0, 0]: east, never up the ledge's face
 * grid.flowField(grid.cellAt(2.5, 3.5)).distanceAt(1.5, 3.5); // Infinity: no stairs lead up
 * @see engine/world/nav.test.ts
 */
import { codeError } from '../core/log';
import { Vector3 } from '../core/math';
import { defineSchema, parse, type SpecOf } from '../core/schema';
import type { CompiledLevel } from './level/types';
import { NAV_CLIMB } from './level/validate';
import { canStep as levelStep } from './level/walk';

/** The 8 neighbours, as [columns east, rows south]: east, west, south, north, then the diagonals (bit k of a step). */
// prettier-ignore
export const NAV_DIRECTIONS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const;

/** How many tiles downhill `FlowField.direction` looks ahead (shardfall's 3). */
export const LOOK_AHEAD = 3;

/** How many rings of tiles `nearestOpen` searches round a blocked point (shardfall's 5). */
export const NEAREST_RINGS = 5;

/** A point on the ground (m): x east, z south. A `Vector3` is one. */
export type GroundPoint = Readonly<{ x: number; z: number }>;

/** The options of `new NavGrid(level, options)`. */
export const NAV_GRID_FIELDS = defineSchema({
  climb: { type: 'number', default: NAV_CLIMB, minimum: 0, unit: 'm', description: 'The most a step climbs.' },
  radius: { type: 'number', default: 0.3, minimum: 0, unit: 'm', description: 'A body’s reach, below half a tile.' },
  fields: { type: 'integer', default: 16, minimum: 1, description: 'How many flow fields it keeps (the last made).' },
});

/** What `new NavGrid` takes: each field of `NAV_GRID_FIELDS`, optional. */
export type NavGridOptions = SpecOf<typeof NAV_GRID_FIELDS>;

/** What `flowField` takes. */
export interface FlowOptions {
  /** How far the field reaches (m of walking): tiles farther stay Infinity. Infinity by default. */
  reach?: number;
}

/** Bit k of a tile's steps for each (columns, rows) offset, at (rows + 1)·3 + columns + 1; −1 for no offset. */
const DIRECTION_OF = [7, 3, 5, 1, -1, 0, 6, 2, 4];

/** An indexed binary min-heap of tiles keyed by `keys[tile]`, ties to the lower tile; pushing a held tile re-sorts it. */
class TileHeap {
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

/** The walkable grid of a compiled level, and the searches over it (see the file comment). */
export class NavGrid {
  /** The level it was built from, its size in tiles and its tile (m). */
  readonly level: CompiledLevel;
  readonly cols: number;
  readonly rows: number;
  readonly tile: number;
  /** The climb limit and the bodies' radius (m). */
  readonly climb: number;
  readonly radius: number;
  /** Per tile: 1 when open (walkable). */
  readonly open: Uint8Array;
  /** Per tile: bit k set when a body steps from it to its neighbour `NAV_DIRECTIONS[k]`. */
  readonly steps: Uint8Array;
  /** Each direction's step length (m) and index offset; the field cache; the heap and A*'s costs and links. */
  readonly #length = new Float64Array(8);
  readonly #offset = new Int32Array(8);
  readonly #fields = new Map<string, FlowField>();
  readonly #capacity: number;
  readonly #heap: TileHeap;
  readonly #cost: Float64Array;
  readonly #score: Float64Array;
  readonly #prev: Int32Array;

  /** Builds the grid of `level`: its open tiles and their steps under the climb limit. */
  constructor(level: CompiledLevel, options: NavGridOptions = {}) {
    const where = 'new NavGrid(level, options)';
    const { climb, radius, fields } = parse(NAV_GRID_FIELDS, options, where);
    if (radius >= level.tile / 2) {
      const problems = `radius ${radius} m is half the ${level.tile} m tile or more; give one below ${level.tile / 2} m`;
      throw codeError('CORE_BAD_SPEC', { where, problems });
    }
    const { cols, rows, tile } = level;
    const n = cols * rows;
    [this.level, this.cols, this.rows, this.tile, this.climb, this.radius] = [level, cols, rows, tile, climb, radius];
    [this.#capacity, this.#heap, this.#prev] = [fields, new TileHeap(n), new Int32Array(n)];
    [this.#cost, this.#score] = [new Float64Array(n), new Float64Array(n)];
    const open = (this.open = Uint8Array.from(level.walkable, (walkable) => (walkable ? 1 : 0)));
    const steps = (this.steps = new Uint8Array(n));
    const bit = (dc: number, dr: number) => 1 << DIRECTION_OF[(dr + 1) * 3 + dc + 1];
    // A diagonal needs both ways round its corner (the orthogonal steps, made first), then its own line's climb.
    const round = (i: number, dc: number, dr: number) =>
      steps[i] & bit(dc, 0) && steps[i + dc] & bit(0, dr) && steps[i] & bit(0, dr) && steps[i + dr * cols] & bit(dc, 0);
    for (let k = 0; k < 8; k++) {
      const [dc, dr] = NAV_DIRECTIONS[k];
      [this.#length[k], this.#offset[k]] = [dc && dr ? tile * Math.SQRT2 : tile, dr * cols + dc];
      for (let i = 0; i < n; i++) {
        if (!open[i] || (k >= 4 && !round(i, dc, dr))) continue;
        if (levelStep(level, i % cols, Math.floor(i / cols), dc, dr, climb)) steps[i] |= 1 << k;
      }
    }
  }

  /** The tile under (x, z) metres, or −1 off the map. */
  cellAt(x: number, z: number): number {
    const col = Math.floor(x / this.tile);
    const row = Math.floor(z / this.tile);
    return col >= 0 && row >= 0 && col < this.cols && row < this.rows ? row * this.cols + col : -1;
  }

  /** The tile's centre on its floor (m). */
  center(cell: number, out = new Vector3()): Vector3 {
    const col = cell % this.cols;
    return out.set((col + 0.5) * this.tile, this.level.floor[cell], ((cell - col) / this.cols + 0.5) * this.tile);
  }

  /**
   * The open tile under (x, z), else the open tile whose centre is nearest it within `NEAREST_RINGS` tiles each way
   * (ties to the lower index): for starts and goals on a wall's margin or a low wall's top. −1 when there is none.
   */
  nearestOpen(x: number, z: number): number {
    const here = this.cellAt(x, z);
    if (here >= 0 && this.open[here]) return here;
    const [col, row, rings] = [Math.floor(x / this.tile), Math.floor(z / this.tile), NEAREST_RINGS];
    let [best, low] = [-1, Infinity];
    for (let r = Math.max(0, row - rings); r <= Math.min(this.rows - 1, row + rings); r++) {
      for (let c = Math.max(0, col - rings); c <= Math.min(this.cols - 1, col + rings); c++) {
        const [dx, dz] = [(c + 0.5) * this.tile - x, (r + 0.5) * this.tile - z];
        if (this.open[r * this.cols + c] && dx * dx + dz * dz < low)
          [best, low] = [r * this.cols + c, dx * dx + dz * dz];
      }
    }
    return best;
  }

  /** Whether a body on tile `from` walks onto tile `to`: the same open tile, or a neighbour it has a step to. */
  canStep(from: number, to: number): boolean {
    if (from < 0 || to < 0 || !this.open[from]) return false;
    const cols = this.cols;
    return this.#step(from % cols, Math.floor(from / cols), to % cols, Math.floor(to / cols));
  }

  /** `canStep` by columns and rows, from an open tile: the same tile, or a neighbour on the map it has a step to. */
  #step(col: number, row: number, toCol: number, toRow: number): boolean {
    if (toCol === col && toRow === row) return true;
    const dc = toCol - col;
    const dr = toRow - row;
    if (dc < -1 || dc > 1 || dr < -1 || dr > 1) return false; // and no step leads off the map
    return (this.steps[row * this.cols + col] & (1 << DIRECTION_OF[(dr + 1) * 3 + dc + 1])) !== 0;
  }

  /**
   * Whether a body `radius` metres round walks the straight line from (ax, az) to (bx, bz): each sample (at most half
   * a tile and 2·radius apart) on a tile the last one steps to, and the tiles under its square's corners stepped to
   * from its own, so a body passes a gallery's face only from above.
   */
  lineOfSight(ax: number, az: number, bx: number, bz: number): boolean {
    const [dx, dz, r, t] = [bx - ax, bz - az, this.radius, this.tile];
    const n = Math.ceil(Math.sqrt(dx * dx + dz * dz) / Math.max(Math.min(t / 2, 2 * r), t / 8));
    let [col, row] = [Math.floor(ax / t), Math.floor(az / t)];
    if (!this.open[this.cellAt(ax, az)]) return false;
    for (let s = 0; s <= n; s++) {
      const x = n ? ax + (dx * s) / n : ax;
      const z = n ? az + (dz * s) / n : az;
      const c = Math.floor(x / t);
      if (!this.#step(col, row, c, Math.floor(z / t))) return false;
      col = c;
      row = Math.floor(z / t);
      const [west, east] = [Math.floor((x - r) / t), Math.floor((x + r) / t)];
      const [north, south] = [Math.floor((z - r) / t), Math.floor((z + r) / t)];
      if (!(this.#step(col, row, west, north) && this.#step(col, row, east, north))) return false;
      if (!(this.#step(col, row, west, south) && this.#step(col, row, east, south))) return false;
    }
    return true;
  }

  /**
   * A* (octile estimate) from the open tile nearest `from` to the one nearest `to`, smoothed by line of sight (each
   * waypoint the farthest tile centre still in a clear line from the last): the waypoints after `from`, on their
   * floors, the last the goal tile's centre. Null when either has no open tile near it, or no route leads there.
   */
  findPath(from: GroundPoint, to: GroundPoint): Vector3[] | null {
    const [start, goal] = [this.nearestOpen(from.x, from.z), this.nearestOpen(to.x, to.z)];
    if (start < 0 || goal < 0) return null;
    const [cost, prev] = [this.#cost.fill(Infinity), this.#prev.fill(-1)];
    const [score, heap, cols] = [this.#score, this.#heap, this.cols];
    const estimate = (i: number) => {
      const dc = Math.abs((i % cols) - (goal % cols));
      const dr = Math.abs(Math.floor(i / cols) - Math.floor(goal / cols));
      return (Math.max(dc, dr) + (Math.SQRT2 - 1) * Math.min(dc, dr)) * this.tile;
    };
    [cost[start], score[start]] = [0, estimate(start)];
    for (heap.start(score), heap.push(start); heap.size;) {
      const i = heap.pop();
      if (i === goal) break;
      for (let k = 0; k < 8; k++) {
        // The estimate is consistent, so a tile once popped is never relaxed again.
        const j = i + this.#offset[k];
        if (!(this.steps[i] & (1 << k)) || !(cost[i] + this.#length[k] < cost[j])) continue;
        cost[j] = cost[i] + this.#length[k];
        prev[j] = i;
        score[j] = cost[j] + estimate(j);
        heap.push(j);
      }
    }
    heap.start(score);
    if (!(cost[goal] < Infinity)) return null;
    const cells: number[] = [];
    for (let at = goal; at >= 0; at = prev[at]) cells.unshift(at);
    const out: Vector3[] = [];
    let [ax, az] = [from.x, from.z];
    for (let k = 0, far = 1; k + 1 < cells.length; k = far, far = k + 1) {
      const point = new Vector3();
      while (far + 1 < cells.length && this.lineOfSight(ax, az, this.center(cells[far + 1], point).x, point.z)) far++;
      out.push(this.center(cells[far], point));
      [ax, az] = [point.x, point.z];
    }
    return out.length ? out : [this.center(goal)];
  }

  /**
   * The flow field toward `goals` (a tile or several, each open) within `reach`: every tile's walking distance to its
   * nearest goal, by Dijkstra run backwards along the steps. The cached one when the same goals and reach were asked
   * for lately, else a new one, which may push the oldest out of the cache.
   */
  flowField(goals: number | readonly number[], options: FlowOptions = {}): FlowField {
    const list = typeof goals === 'number' ? [goals] : [...new Set(goals)].sort((a, b) => a - b);
    const reach = options.reach ?? Infinity;
    const problems = list.filter((g) => !this.open[g]).map((g) => `goal ${g} is no open tile (see nearestOpen)`);
    if (!list.length) problems.push('no goal tile: name one or more open tiles (navGrid.cellAt(x, z))');
    if (!(reach > 0)) problems.push(`reach ${reach} is not above 0: give metres of walking, or Infinity`);
    if (problems.length)
      throw codeError('CORE_BAD_SPEC', { where: 'navGrid.flowField', problems: problems.join('; ') });
    const key = `${list.join(',')}@${reach}`;
    const field = this.#fields.get(key) ?? new FlowField(this, list, reach, this.#flood(list, reach));
    this.#fields.delete(key);
    if (this.#fields.size >= this.#capacity) this.#fields.delete(this.#fields.keys().next().value as string);
    this.#fields.set(key, field);
    return field;
  }

  /** Dijkstra from the goals, backwards along the steps: each tile's walking distance (m) within reach. */
  #flood(goals: readonly number[], reach: number): Float64Array {
    const distance = new Float64Array(this.open.length).fill(Infinity);
    const heap = this.#heap;
    heap.start(distance);
    for (const goal of goals) {
      distance[goal] = 0;
      heap.push(goal);
    }
    while (heap.size) {
      const i = heap.pop();
      const col = i % this.cols;
      const row = (i - col) / this.cols;
      for (let k = 0; k < 8; k++) {
        const j = i - this.#offset[k]; // the neighbour that steps toward i in direction k
        const c = col - NAV_DIRECTIONS[k][0];
        const r = row - NAV_DIRECTIONS[k][1];
        if (c < 0 || r < 0 || c >= this.cols || r >= this.rows || !(this.steps[j] & (1 << k))) continue;
        const next = distance[i] + this.#length[k];
        if (next > reach || !(next < distance[j])) continue;
        distance[j] = next;
        heap.push(j);
      }
    }
    return distance;
  }
}

/** Every tile's walking distance to a goal set: walk downhill to get there. Made by `NavGrid.flowField`. */
export class FlowField {
  readonly grid: NavGrid;
  /** The goal tiles, sorted, and how far it reaches (m). */
  readonly goals: readonly number[];
  readonly reach: number;
  /** Per tile: its walking distance to the nearest goal (m); Infinity where no route leads within reach. Read only. */
  readonly distance: Float64Array;
  /** `direction`'s tiles downhill. */
  readonly #chain = new Int32Array(LOOK_AHEAD);

  /** A field over `grid`: what `grid.flowField` computed. */
  constructor(grid: NavGrid, goals: readonly number[], reach: number, distance: Float64Array) {
    [this.grid, this.goals, this.reach, this.distance] = [grid, Object.freeze([...goals]), reach, distance];
  }

  /** The walking distance (m) from (x, z) to the nearest goal: its open tile's, or the nearest open tile's. */
  distanceAt(x: number, z: number): number {
    return this.distance[this.grid.nearestOpen(x, z)] ?? Infinity;
  }

  /** The neighbour a body on `cell` steps to downhill: the lowest, ties to the lower index; −1 when none is lower. */
  downhill(cell: number): number {
    const { steps, cols } = this.grid;
    let best = -1;
    for (let k = 0; k < 8; k++) {
      if (!(steps[cell] & (1 << k))) continue;
      const j = cell + NAV_DIRECTIONS[k][1] * cols + NAV_DIRECTIONS[k][0];
      const low = this.distance[best < 0 ? cell : best];
      if (this.distance[j] < low || (best >= 0 && this.distance[j] === low && j < best)) best = j;
    }
    return best;
  }

  /**
   * The way to walk from (x, z), a unit vector on the ground: toward the farthest of the next `LOOK_AHEAD` tiles
   * downhill in a clear line (else the next one), or the goal tile's centre once there. Null when no route leads to a
   * goal within reach, or (x, z) is within a millimetre of where it leads.
   */
  direction(x: number, z: number, out = new Vector3()): Vector3 | null {
    const [grid, chain] = [this.grid, this.#chain];
    const here = grid.nearestOpen(x, z);
    if (here < 0 || !(this.distance[here] < Infinity)) return null;
    let n = 0;
    for (let cell = this.downhill(here); cell >= 0 && n < LOOK_AHEAD; cell = this.downhill(cell)) chain[n++] = cell;
    let aim = n ? chain[0] : here;
    for (let k = n - 1; k > 0 && aim === chain[0]; k--) {
      if (grid.lineOfSight(x, z, grid.center(chain[k], out).x, out.z)) aim = chain[k];
    }
    grid.center(aim, out);
    const dx = out.x - x;
    const dz = out.z - z;
    const length = Math.sqrt(dx * dx + dz * dz);
    return length < 1e-3 ? null : out.set(dx / length, 0, dz / length);
  }
}
