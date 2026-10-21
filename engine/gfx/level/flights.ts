/**
 * @file Flights of stairs between storeys (PLAN.md WP 13.14; docs/PLAYGROUND.md §6.1): `flightGeometry(tile, ramps,
 * ground)` draws each ramp a flight glyph makes (engine/world/level/storeys.ts: a storey's floor to the next one's) as
 * a house's stairs: `risersOf(ramp)` steps rising about `RISER` metres each, so 3 m between floors climb in 17 steps
 * of 0.176 m, the flight's run shared out as their treads. v2's stairs (engine/gfx/level/stairs.ts), whose faces these
 * are, take two steps a metre of run: right for a gallery's metre, a 0.375 m riser up a storey.
 *
 * Invariants: as stairsGeometry's: slot 0 the risers, sides and back, slot 1 the treads; the ramp's slope through the
 * middle of every tread; standing on its storey's floor (`ground`), which hides its bottom.
 *
 * @example
 * risersOf({ bottom: 0, top: 3 }); // 17: 0.176 m each
 * @see engine/gfx/level/flights.test.ts
 */
import type { BufferGeometry } from 'three/webgpu';
import type { RampDescriptor } from '../../world/level/types';
import { stairsGeometry } from './stairs';

/** A house stair's riser (m): about 7 inches. */
export const RISER = 0.18;

/** How many steps a flight climbs: its rise in `RISER`s, at least one. */
export function risersOf(ramp: Pick<RampDescriptor, 'bottom' | 'top'>): number {
  return Math.max(1, Math.round((ramp.top - ramp.bottom) / RISER));
}

/** The flights of `ramps`, standing on their storey's floor at `ground` (m), tiles `tile` metres wide. */
export function flightGeometry(tile: number, ramps: readonly RampDescriptor[], ground: number): BufferGeometry {
  return stairsGeometry(tile, ramps, ground, risersOf);
}
