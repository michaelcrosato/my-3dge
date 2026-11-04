/**
 * @file Doorways (PLAN.md WP 13.16, WP 13.36): which door openings of a level written as storeys a door's leaf hangs
 * in, the one rule engine/sim/doors.ts's `addLevelDoors` hangs the leaves by and engine/gfx/level/openings.ts frames
 * them by, so the frame drawn meets the leaf that hangs there. `LEVEL_DOOR` names the leaf a level's door openings
 * hang (the library's `prop:door`, 0.9 × 2.05 m); `leafFits(opening, size)` says whether a leaf of `size` (its prop's
 * body size, `[width, height, depth]` in metres) hangs in an opening: a door opening as wide as the leaf to `PLAY`
 * wider, and as tall, as the door glyph's 1 m is for a 0.9 m leaf; a wider or a lower one (a garage's, a crawlspace's)
 * is the scene's to fill. `leafOpenings(level, size)` lists the openings it fits, in the level's order.
 *
 * Where one hangs: centred in the opening on its floor, its hinged edge `leafSide(opening, size)` from the opening's
 * west or north end (the lower end along the wall's axis), the same clearance at the other side.
 *
 * `DOOR_SWING` is how far a door turns open, either way; `DoorLeaf` is a leaf as its frames meet it, a level entry's
 * `doors` (engine/world/level/level.ts) read by engine/gfx/level/runs.ts's `levelLooks`.
 *
 * Invariants: pure in the opening and the size; no registry, no sim.
 *
 * @example
 * leafFits({ kind: 'door', width: 1, bottom: 0, top: 2.1 } as OpeningDescriptor, [0.9, 2.05, 0.045]); // true
 * leafSide({ width: 1 } as OpeningDescriptor, [0.9, 2.05, 0.045]); // 0.05: 5 cm a side
 * @see engine/world/level/doorways.test.ts
 */
import type { CompiledLevel, OpeningDescriptor } from './types';

/** The prop a level's door openings hang (engine/sim/doors.ts `addLevelDoors`). */
export const LEVEL_DOOR = 'prop:door';

/** A door's swing open (rad), either way: a quarter turn and a little more (engine/sim/doors.ts turns it so far). */
export const DOOR_SWING = 1.65;

/**
 * A leaf as its frames meet it: its prop's body `size`, `[width, height, depth]` (m), and `reach`, how far its drawn
 * parts stand from its middle plane on its fuller face (m: its fittings, `prop:door`'s straps, 3.25 cm).
 */
export interface DoorLeaf {
  readonly size: readonly number[];
  readonly reach: number;
}

/** How much wider than its leaf an opening a door hangs in may be (m). */
export const PLAY = 0.2;

/** Whether a leaf of `size` (`[width, height, depth]`, m) hangs in `opening` (see the file comment). */
export function leafFits(
  opening: Pick<OpeningDescriptor, 'kind' | 'width' | 'bottom' | 'top'>,
  size: readonly number[],
): boolean {
  const [width, height] = size;
  return opening.kind === 'door' && opening.width >= width && opening.width <= width + PLAY && opening.top - opening.bottom >= height; // prettier-ignore
}

/** The openings of `level` a leaf of `size` hangs in (see the file comment), in order. */
export function leafOpenings(level: Pick<CompiledLevel, 'openings'>, size: readonly number[]): OpeningDescriptor[] {
  return (level.openings ?? []).filter((opening) => leafFits(opening, size));
}

/** The clearance (m) at each side of a leaf of `size` hung in `opening`: centred, its hinged edge that far from `a0`. */
export function leafSide(opening: Pick<OpeningDescriptor, 'width'>, size: readonly number[]): number {
  return Math.max(0, opening.width - size[0]) / 2;
}
