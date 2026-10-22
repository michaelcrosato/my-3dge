/**
 * @file Unit tests for navigation over terrain (engine/world/terrainNav.ts, and the surfaces engine/world/nav.ts's grid
 * walks): a terrain's cells are tiles from its own corner, open where neither triangle rises past the grade; queries
 * answer in world metres; a path climbs a gentle hill and goes round a steep one; no step enters a cell over the
 * grade, and the climb limit holds a step up between samples as on a level, never a step down.
 * @see engine/world/terrainNav.ts
 */
import { describe, expect, it } from 'vitest';
import { NavGrid } from './nav';
import { makeTerrain, terrainHeight } from './terrain';
import { terrainNavGrid, terrainNavSurface } from './terrainNav';

describe('terrainNavGrid', () => {
  it('lays its tiles from the terrain’s corner, open where the ground is walkable, floors on the ground', () => {
    const ground = makeTerrain({ size: [8, 8], origin: [10, 0.5, -4], hills: [{ at: [18, 0], radius: 4, height: 8 }] });
    const grid = terrainNavGrid(ground);
    expect([grid.cols, grid.rows, grid.tile, grid.origin]).toEqual([8, 8, 1, [10, -4]]);
    expect([grid.cellAt(10, -4), grid.cellAt(17.9, 3.9), grid.cellAt(9.9, 0), grid.cellAt(12, 4)]).toEqual([0, 63, -1, -1]); // prettier-ignore
    expect(grid.open[grid.cellAt(10.5, -3.5)]).toBe(1);
    expect(grid.open[grid.cellAt(16.5, 0.5)]).toBe(0); // the dome's flank, over 45°
    const centre = grid.center(grid.cellAt(12.5, 1.5));
    expect(centre.toArray()).toEqual([12.5, terrainHeight(ground, 12.5, 1.5), 1.5]);
    expect(grid.nearestOpen(16.5, 0.5)).toBeGreaterThanOrEqual(0);
  });

  it('climbs a gentle hill and goes round a steep one', () => {
    const gentle = makeTerrain({ size: [30, 10], hills: [{ at: [15, 5], radius: 12, height: 3 }] });
    const easy = terrainNavGrid(gentle);
    expect(easy.findPath({ x: 1, z: 5 }, { x: 29, z: 5 })).toHaveLength(1); // straight over its top
    expect(easy.lineOfSight(1, 5, 29, 5)).toBe(true);
    const steep = makeTerrain({ size: [30, 30], hills: [{ at: [15, 15], radius: 6, height: 12 }] });
    const grid = terrainNavGrid(steep);
    const round = grid.findPath({ x: 1, z: 15 }, { x: 29, z: 15 })!;
    expect(round.length).toBeGreaterThan(1);
    for (const point of round) expect(Math.hypot(point.x - 15, point.z - 15)).toBeGreaterThan(2);
    expect(terrainNavGrid(steep, { grade: 5 }).open.every((open) => open === 1)).toBe(true); // none past 5 m a metre
  });

  it('steps into no cell over the grade, and holds a step up to the climb limit between samples', () => {
    const steep = makeTerrain({ size: [12, 12], hills: [{ at: [12, 6], radius: 6, height: 12 }] });
    const surface = terrainNavSurface(steep);
    const closed = Array.from(surface.walkable).findIndex((walkable) => !walkable);
    const [col, row] = [closed % surface.cols, Math.floor(closed / surface.cols)];
    expect(surface.canStep(col - 1, row, 1, 0, 10)).toBe(false); // from the open cell west of it
    expect(surface.canStep(col - 1, row, 0, 0, 10)).toBe(true);
    // A ramp rising 0.5 m a metre: each of a step's 8 samples climbs 6 cm, so a 5 cm limit holds a body to going down.
    const ramp = makeTerrain({ size: [8, 2], hills: [{ at: [8, 1], radius: 8, height: 4 }] });
    const along = terrainNavSurface(ramp);
    expect([along.canStep(3, 0, 1, 0, 0.05), along.canStep(4, 0, -1, 0, 0.05), along.canStep(3, 0, 1, 0, 0.3)]).toEqual([false, true, true]); // prettier-ignore
    expect(new NavGrid(along, { climb: 0.05 }).steps).not.toEqual(new NavGrid(along, { climb: 0.3 }).steps);
  });
});
