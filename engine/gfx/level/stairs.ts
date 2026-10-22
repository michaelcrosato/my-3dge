/**
 * @file Stairs (PLAN.md WP 4.4): `stairsGeometry(tile, ramps, ground)` draws each ramp (engine/world/level/types.ts,
 * `RampDescriptor`) as a flight of steps standing on the ground at height `ground`: `stepsOf(ramp)` steps, two per
 * metre of run, rising evenly from the ramp's bottom to its top toward the side it `rises` to. All the flights given
 * are one mesh, and a flight is about 130 vertices, where the prototype made a mesh per step (20 for its two flights).
 *
 * The ramp's slope runs through the middle of every tread: step k of n stands `bottom + (top − bottom)·(k + ½)/n`
 * high, so a foot on the hull wedge (engine/world/level/colliders.ts) is never more than half a riser above or below
 * the tread it shows (5 cm on the hall's stairs: ten 0.1 m risers over 5 m). The prototype put each tread's back
 * edge on the slope, so feet sank up to a whole riser into the steps.
 *
 * Faces: each tread facing up and each riser facing down the flight (slot 1 and slot 0); the two sides, each one
 * staircase-shaped face fanned from its high bottom corner, so its corners are the treads' and risers' and nothing
 * meets an edge part-way (no T-junctions, no cracks); the back of the top step, against what the stairs climb to.
 * The flight stands on the ground, which hides its bottom: it has none.
 *
 * Carried from the stairs of `my-3d2dge:src/stress-world/10-hall.js:383-391` (two steps per tile of run, dressed
 * stone), as one solid per flight instead of a box per step, rising toward any side.
 *
 * Invariants: slot 0 the risers, sides and back, slot 1 the treads; pure in its inputs; every face looks out of the
 * flight; the flight fills exactly its ramp's tiles, from `ground` up to below the ramp's top.
 *
 * @example
 * stepsOf({ tiles: [11, 5, 13, 9], rises: 'north' }, 1); // 10: 5 m of run, two steps per metre
 * @see engine/gfx/level/shapes.test.ts
 */
import type { BufferGeometry } from 'three/webgpu';
import type { RampDescriptor } from '../../world/level/types';
import type { Vec3 } from '../geometry/writer';
import { polygon, slotted, tread, upright, type Ground } from './faces';

/** The run of one step (m): two steps per metre, as the prototype's two per tile. */
export const STEP_RUN = 0.5;

/** The ramp's run (m), along the way it rises. */
export function runOf(ramp: Pick<RampDescriptor, 'tiles' | 'rises'>, tile: number): number {
  const [c0, r0, c1, r1] = ramp.tiles;
  return (ramp.rises === 'north' || ramp.rises === 'south' ? r1 - r0 + 1 : c1 - c0 + 1) * tile;
}

/** How many steps a ramp's flight has: its run in `STEP_RUN`s, at least one. */
export function stepsOf(ramp: Pick<RampDescriptor, 'tiles' | 'rises'>, tile: number): number {
  return Math.max(1, Math.round(runOf(ramp, tile) / STEP_RUN));
}

/**
 * A ramp's frame on the ground: the point `s` metres up its run and `w` metres across it (from its left side, seen
 * climbing), so the flight is written once for the four ways a ramp can rise (engine/gfx/level/ramp.ts's wedge too).
 */
export function frameOf(ramp: RampDescriptor, tile: number): { at: (s: number, w: number) => Ground; width: number } {
  const [c0, r0, c1, r1] = ramp.tiles;
  const [x0, z0, x1, z1] = [c0 * tile, r0 * tile, (c1 + 1) * tile, (r1 + 1) * tile];
  switch (ramp.rises) {
    case 'north':
      return { at: (s, w) => [x0 + w, z1 - s], width: x1 - x0 };
    case 'south':
      return { at: (s, w) => [x1 - w, z0 + s], width: x1 - x0 };
    case 'west':
      return { at: (s, w) => [x1 - s, z1 - w], width: z1 - z0 };
    case 'east':
      return { at: (s, w) => [x0 + s, z0 + w], width: z1 - z0 };
  }
}

/** How many steps a ramp's flight is drawn in. */
export type StepCount = (ramp: RampDescriptor, tile: number) => number;

/** Writes one flight of `n` steps into `writers`. */
function flight(
  writers: ReturnType<typeof slotted>,
  ramp: RampDescriptor,
  tile: number,
  ground: number,
  n: number,
): void {
  const { at, width } = frameOf(ramp, tile);
  const run = runOf(ramp, tile);
  const s = (k: number) => (run * k) / n;
  const h = (k: number) => ramp.bottom + ((ramp.top - ramp.bottom) * (k + 0.5)) / n;
  const [sides, treads] = [writers.slot(0), writers.slot(1)];
  for (let k = 0; k < n; k++) {
    const [a, b] = [at(s(k), 0), at(s(k + 1), width)];
    tread(treads, [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])], h(k));
    // The riser faces down the flight: its edge runs left to right, seen climbing.
    upright(sides, at(s(k), 0), at(s(k), width), k ? h(k - 1) : ground, h(k));
  }
  upright(sides, at(run, width), at(run, 0), ground, h(n - 1));
  // A side: from its high bottom corner, the profile down the steps, then its low bottom corner.
  for (const w of [0, width]) {
    const point = (sk: number, y: number): Vec3 => {
      const [x, z] = at(sk, w);
      return [x, y, z];
    };
    const points: Vec3[] = [point(run, ground)];
    for (let k = n - 1; k >= 0; k--) points.push(point(s(k + 1), h(k)), point(s(k), h(k)));
    points.push(point(0, ground));
    const [ax, az] = at(0, 0);
    const [lx, lz] = at(0, width);
    const out: Vec3 = w ? [lx - ax, 0, lz - az] : [ax - lx, 0, az - lz];
    // u along the run, v up, both in metres, as an upright face's.
    const [ux, uz] = [at(1, w)[0] - at(0, w)[0], at(1, w)[1] - at(0, w)[1]];
    polygon(
      sides,
      points,
      points.map(([x, y, z]) => [(x * ux + z * uz) * (w ? 1 : -1), y] as const),
      out,
    );
  }
}

/**
 * The flights of `ramps`, standing on the ground at `ground` (m), tiles `tile` metres wide (see the file comment), each
 * in `steps(ramp, tile)` steps (`stepsOf` by default; a storey's flights rise by the riser: engine/gfx/level/flights.ts).
 */
export function stairsGeometry(
  tile: number,
  ramps: readonly RampDescriptor[],
  ground: number,
  steps: StepCount = stepsOf,
): BufferGeometry {
  const writers = slotted();
  for (const ramp of ramps) flight(writers, ramp, tile, ground, steps(ramp, tile));
  return writers.build();
}
