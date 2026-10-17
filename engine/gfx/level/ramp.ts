/**
 * @file Smooth ramps (PLAN.md WP 13.1; docs/PLAYGROUND.md §2.3): `rampGeometry(tile, ramps, ground)` draws each ramp
 * (engine/world/level/types.ts, `RampDescriptor`) as the smooth wedge its hull collider is
 * (engine/world/level/shapes.ts, `wedgePoints`): the slope from the ramp's bottom to its top toward the side it
 * `rises` to, its two sides, its back where it meets what it climbs to, and its front when it starts above the ground.
 * Stairs (engine/gfx/level/stairs.ts) draw a flight of steps over the same wedge; a ramp draws the wedge itself, so a
 * body sliding down it is seen on the very surface it slides on (the playground's slide ramps).
 *
 * UVs are in metres: the slope's u runs across the ramp and its v up the slope's own length, so a texture is not
 * stretched however steep the ramp; the sides and the back are upright faces (engine/gfx/level/faces.ts).
 *
 * Invariants: slot 0 the sides, back and front, slot 1 the slope; pure in its inputs; every face looks out of the
 * wedge; the wedge fills exactly its ramp's tiles, and the slope at any point is `rampHeight` there. It stands on the
 * ground at `ground`, which hides its bottom: it has none.
 *
 * @example
 * const tiles = [0, 0, 3, 11] as const;
 * const ramp = { glyph: 'glyph:slide', surface: 'stone', tiles, rises: 'north', bottom: 0, top: 2 } as const;
 * rampGeometry(1, [ramp], 0).groups.length; // 2: the sides and back, then the slope
 * @see engine/gfx/level/shapes.test.ts
 */
import type { BufferGeometry } from 'three/webgpu';
import type { RampDescriptor } from '../../world/level/types';
import type { Vec3 } from '../geometry/writer';
import { polygon, slotted, upright } from './faces';
import { frameOf, runOf } from './stairs';

/** Writes one ramp's wedge into `writers` (see the file comment). */
function wedge(writers: ReturnType<typeof slotted>, ramp: RampDescriptor, tile: number, ground: number): void {
  const { at, width } = frameOf(ramp, tile);
  const run = runOf(ramp, tile);
  const [low, high] = [Math.max(ramp.bottom, ground), Math.max(ramp.top, ground)];
  const [sides, slope] = [writers.slot(0), writers.slot(1)];
  const point = (s: number, w: number, y: number): Vec3 => {
    const [x, z] = at(s, w);
    return [x, y, z];
  };
  const [ox, oz] = at(0, 0);
  const [cx, cz] = [at(0, 1)[0] - ox, at(0, 1)[1] - oz]; // one metre across
  const [rx, rz] = [at(1, 0)[0] - ox, at(1, 0)[1] - oz]; // one metre up the run
  const length = Math.hypot(run, high - low);
  const corners = [point(0, 0, low), point(0, width, low), point(run, width, high), point(run, 0, high)];
  polygon(
    slope,
    corners,
    corners.map(([x, , z]) => {
      const [dx, dz] = [x - ox, z - oz];
      return [dx * cx + dz * cz, ((dx * rx + dz * rz) / run) * length] as const;
    }),
    [0, 1, 0],
  );
  upright(sides, at(run, width), at(run, 0), ground, high);
  if (low > ground) upright(sides, at(0, 0), at(0, width), ground, low);
  for (const w of [0, width]) {
    const points =
      low > ground
        ? [point(0, w, ground), point(run, w, ground), point(run, w, high), point(0, w, low)]
        : [point(0, w, ground), point(run, w, ground), point(run, w, high)];
    const out: Vec3 = w ? [cx, 0, cz] : [-cx, 0, -cz];
    polygon(
      sides,
      points,
      points.map(([x, y, z]) => [((x - ox) * rx + (z - oz) * rz) * (w ? -1 : 1), y] as const),
      out,
    );
  }
}

/** The wedges of `ramps`, standing on the ground at `ground` (m), tiles `tile` metres wide (see the file comment). */
export function rampGeometry(tile: number, ramps: readonly RampDescriptor[], ground: number): BufferGeometry {
  const writers = slotted();
  for (const ramp of ramps) wedge(writers, ramp, tile, ground);
  return writers.build();
}
