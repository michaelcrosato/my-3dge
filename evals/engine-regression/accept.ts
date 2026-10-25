/**
 * @file The acceptance of the eval task engine-regression (evals/engine-regression/prompt.md), run by `node x evals`
 * in the attempt's copy, whose start (start.patch) breaks how the level compiler finds the tiles either side of an
 * opening: every door and window of the storey fixtures' house knows the rooms on either side of it, the lower x or z
 * first, as `roomAt` finds them a tile across its wall each way (the compiler's own tests are the task's command).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { defineStoreyFixtureGlyphs } from '../../fixtures/levels/storeys/glyphs';
import { createRegistry } from '../../engine/core/registry';
import { compileLevel } from '../../engine/world/level/compile';
import { roomAt } from '../../engine/world/level/heights';

const registry = createRegistry();
defineStoreyFixtureGlyphs(registry);
const house = compileLevel(readFileSync('fixtures/levels/storeys/house.txt', 'utf8'), { file: 'fixtures/levels/storeys/house.txt', registry }); // prettier-ignore

describe('the rooms either side of each opening', () => {
  it('are the rooms a tile across its wall each way, the lower x or z first', () => {
    const t = house.tile;
    const index = (room: ReturnType<typeof roomAt>) => (room ? house.rooms!.findIndex((r) => r.id === room.id) : -1);
    const openings = house.openings ?? [];
    expect(openings.length).toBeGreaterThan(4);
    for (const opening of openings) {
      const [x, y, z] = opening.center;
      const across =
        opening.axis === 'x'
          ? [
              [x, z - t],
              [x, z + t],
            ]
          : [
              [x - t, z],
              [x + t, z],
            ];
      const expected = across.map(([ax, az]) => index(roomAt(house, ax, y + 0.1, az)));
      expect(opening.rooms, `${opening.kind} at ${opening.center.join(', ')}`).toEqual(expected);
    }
  });

  it('join rooms by doors and give windows onto the outside', () => {
    const openings = house.openings ?? [];
    expect(openings.some((o) => o.kind === 'door' && o.rooms[0] >= 0 && o.rooms[1] >= 0 && o.rooms[0] !== o.rooms[1])).toBe(true); // prettier-ignore
    expect(openings.some((o) => o.kind === 'window' && o.rooms.includes(-1) && o.rooms.some((r) => r >= 0))).toBe(true);
  });
});
