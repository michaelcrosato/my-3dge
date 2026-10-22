/**
 * @file Storey plans (PLAN.md WP 13.18): how the playground writes its buildings as storeys (level format 2,
 * engine/world/level/parse.ts) from rectangles in metres, not character by character. `new Plan(width, depth, tile)`
 * is one storey's map, every tile void (`~`) until painted; `fill(rect, char)` paints a rectangle's tiles, `box(rect,
 * edge, inside)` its edge one tile thick and its inside, `line(rect, char)` a run along a wall (a door, a window, a
 * railing); `levelText(header, storeys)` writes the level's text: its front matter, then each storey's block (its keys:
 * `storey`, `base`, `height` or a roof's) and map, bottom first. A rectangle is `[x0, z0, x1, z1]` in the map's metres,
 * its north-west corner at 0, 0, +X east and +Z south (PLAN.md §6.3), on whole tiles.
 *
 * Invariants: pure; a rectangle off whole tiles or outside the map is refused, naming it and the fix; later paint
 * covers earlier, so a plan reads as the order a builder works in: walls, then rooms, then doors and windows.
 *
 * Game code, sim-side: it imports nothing.
 *
 * @example
 * const hut = new Plan(2, 1.5, 0.5).box([0, 0, 2, 1.5], '#', '.').line([0.5, 1, 1.5, 1.5], '+');
 * hut.map; // '####\n#..#\n#++#'
 * @see labs/playground/levels/house.test.ts
 */
/** A rectangle of a plan, [x0, z0, x1, z1] (m). */
export type Rect = readonly [x0: number, z0: number, x1: number, z1: number];

/** One storey's block: its keys (`storey`, `base`, `height`, a roof's) and its plan. */
export interface StoreyBlock {
  readonly keys: Readonly<Record<string, string | number>>;
  readonly plan: Plan;
}

/** One storey's map, painted in rectangles (see the file comment). */
export class Plan {
  /** The map's width, west to east, and depth, north to south, and its tile (m). */
  readonly width: number;
  readonly depth: number;
  readonly tile: number;
  readonly #rows: string[][];

  constructor(width: number, depth: number, tile: number, fill = '~') {
    [this.width, this.depth, this.tile] = [width, depth, tile];
    const [cols, rows] = [this.#tiles(width, 'width'), this.#tiles(depth, 'depth')];
    this.#rows = Array.from({ length: rows }, () => Array<string>(cols).fill(fill));
  }

  /** Paints every tile of `rect` with `char`. */
  fill(rect: Rect, char: string): this {
    const [c0, r0, c1, r1] = this.#cells(rect);
    for (let r = r0; r < r1; r++) for (let c = c0; c < c1; c++) this.#rows[r][c] = char;
    return this;
  }

  /** Paints `rect`'s edge one tile thick with `edge`, and its inside with `inside` when given. */
  box(rect: Rect, edge: string, inside?: string): this {
    const [x0, z0, x1, z1] = rect;
    const t = this.tile;
    if (inside !== undefined && x1 - x0 > 2 * t && z1 - z0 > 2 * t) this.fill([x0 + t, z0 + t, x1 - t, z1 - t], inside);
    this.fill([x0, z0, x1, z0 + t], edge).fill([x0, z1 - t, x1, z1], edge);
    return this.fill([x0, z0, x0 + t, z1], edge).fill([x1 - t, z0, x1, z1], edge);
  }

  /** Paints a run along a wall: `rect` one tile thick across it (a door's 1 m, a window's, a railing). */
  line(rect: Rect, char: string): this {
    return this.fill(rect, char);
  }

  /** The character at (x, z) (m). */
  at(x: number, z: number): string {
    return this.#rows[Math.floor(z / this.tile)][Math.floor(x / this.tile)];
  }

  /** The map, a row a line. */
  get map(): string {
    return this.#rows.map((row) => row.join('')).join('\n');
  }

  /** `metres` as whole tiles, or `CORE_BAD_SPEC` naming `what`. */
  #tiles(metres: number, what: string): number {
    const n = Math.round(metres / this.tile);
    if (Math.abs(n * this.tile - metres) > 1e-9 || n < 0) throw new Error(`a storey plan: its ${what} ${metres} m is not whole ${this.tile} m tiles: give metres on whole tiles`); // prettier-ignore
    return n;
  }

  /** `rect`'s tiles, [c0, r0, c1, r1) (columns and rows, the ends past the last), checked. */
  #cells(rect: Rect): [number, number, number, number] {
    const [c0, r0, c1, r1] = rect.map((v, i) => this.#tiles(v, `rectangle [${rect.join(', ')}]'s ${['x0', 'z0', 'x1', 'z1'][i]}`)); // prettier-ignore
    const [cols, rows] = [this.#rows[0]?.length ?? 0, this.#rows.length];
    if (c1 < c0 || r1 < r0 || c1 > cols || r1 > rows) throw new Error(`a storey plan: the rectangle [${rect.join(', ')}] is not inside its ${this.width} × ${this.depth} m: give x0 ≤ x1 and z0 ≤ z1 inside it`); // prettier-ignore
    return [c0, r0, c1, r1];
  }
}

/** A level's text from its front matter (`description`, `tile`) and its storeys, bottom first (see the file comment). */
export function levelText(header: Readonly<Record<string, string | number>>, storeys: readonly StoreyBlock[]): string {
  const block = (keys: Readonly<Record<string, string | number>>) => `---\n${Object.entries(keys).map(([key, value]) => `${key}: ${value}`).join('\n')}\n---\n`; // prettier-ignore
  return block(header) + storeys.map((storey) => `${block(storey.keys)}${storey.plan.map}\n`).join('');
}
