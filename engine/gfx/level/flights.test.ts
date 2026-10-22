/**
 * @file Unit tests for engine/gfx/level/flights.ts (T1; WP 13.14): a flight between storeys climbs in risers of about
 * 0.18 m, the ramp's slope through the middle of every tread, from its storey's floor up to below the next one's.
 * @see engine/gfx/level/flights.ts
 */
import { describe, expect, it } from 'vitest';
import type { RampDescriptor } from '../../world/level/types';
import { flightGeometry, RISER, risersOf } from './flights';

const RAMP: RampDescriptor = { glyph: 'glyph:flight', surface: 'stone', tiles: [1, 2, 2, 9], rises: 'north', bottom: 0, top: 3 }; // prettier-ignore

describe('flightGeometry', () => {
  it('climbs 3 m in 17 risers of 0.176 m, and a gallery’s metre in 6', () => {
    expect([risersOf(RAMP), risersOf({ bottom: 0, top: 1 }), risersOf({ bottom: 0, top: 0.05 }), RISER]).toEqual([17, 6, 1, 0.18]); // prettier-ignore
  });

  it('lays each tread level, half a riser off the slope, within the flight’s tiles and below the floor above', () => {
    const geometry = flightGeometry(0.5, [RAMP], 0);
    const position = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');
    const treads = new Set<number>();
    for (let i = 0; i < position.count; i++) {
      const [x, y, z] = [position.getX(i), position.getY(i), position.getZ(i)];
      expect(x).toBeGreaterThanOrEqual(0.5 - 1e-9);
      expect(x).toBeLessThanOrEqual(1.5 + 1e-9);
      expect(z).toBeGreaterThanOrEqual(1 - 1e-9);
      expect(z).toBeLessThanOrEqual(5 + 1e-9);
      expect(y).toBeLessThan(3);
      if (normal.getY(i) > 0.99) treads.add(Math.round(y * 1e6) / 1e6);
    }
    expect([...treads].sort((a, b) => a - b)).toEqual(Array.from({ length: 17 }, (_, k) => Math.round(((3 * (k + 0.5)) / 17) * 1e6) / 1e6)); // prettier-ignore
    expect(geometry.groups.map((group) => group.materialIndex)).toEqual([0, 1]);
  });
});
