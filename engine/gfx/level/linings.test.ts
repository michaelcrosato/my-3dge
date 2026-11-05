/**
 * @file Unit tests for engine/gfx/level/linings.ts (T1; WP 13.40): a lining is a quad on its face of a piece, `FACING`
 * out of it, facing out, its ends `FACING` past the piece; only a lined recipe's faces toward a room's floor are lined,
 * one part a face's way, each cell its wall piece's, with a stump as tall as the wall's cut; nothing on a level without
 * rooms.
 * @see engine/gfx/level/linings.ts
 */
import { describe, expect, it } from 'vitest';
import type { CompiledLevel } from '../../world/level/types';
import type { LevelCell } from './cells';
import { LINING_FACES, liningGeometry, liningParts } from './linings';
import { FACING } from './openings';

/** The extent of `geometry` on each axis, rounded to the tenth of a millimetre. */
function extent(geometry: ReturnType<typeof liningGeometry>) {
  geometry.computeBoundingBox();
  const { min, max } = geometry.boundingBox!;
  const r = (v: number) => Math.round(v * 1e4) / 1e4;
  return [min.toArray().map(r), max.toArray().map(r)];
}

describe('liningGeometry', () => {
  it('stands each face’s quad FACING out of it, facing out, past its ends', () => {
    for (const [face, { dc, dr }] of LINING_FACES.entries()) {
      const quad = liningGeometry(face, [0.5, 0.5], 2.7);
      const normal = quad.getAttribute('normal');
      expect([normal.getX(0), normal.getZ(0)].map((v) => Math.round(v))).toEqual([dc, dr]);
      const out = 0.25 + FACING;
      const [lo, hi] = extent(quad);
      const along = dc ? [lo[2], hi[2]] : [lo[0], hi[0]];
      expect(along.map((v) => Math.abs(v))).toEqual([out, out]); // past its ends by FACING
      expect(dc ? lo[0] : lo[2]).toBeCloseTo(dc ? dc * out : dr * out, 6); // in its face's plane, out of it
      expect([lo[1], hi[1]]).toEqual([0, 2.7]);
    }
  });
});

describe('liningParts', () => {
  /** A storey 4 × 3 on 0.5 m tiles: a wall along its middle row, room 0 to the north, the outdoors to the south. */
  const view = (rooms: boolean) => {
    const solid = [false, false, false, false, true, true, true, true, false, false, false, false];
    const room = [0, 0, 0, 0, -1, -1, -1, -1, -1, -1, -1, -1];
    return { cols: 4, rows: 3, tile: 0.5, solid, ...(rooms ? { room } : {}) } as unknown as CompiledLevel;
  };
  const cells: LevelCell[] = [0, 1, 2, 3].map((col) => ({ tiles: [col, 1, col, 1], centre: [col * 0.5 + 0.25, 0, 0.75], size: [0.5, 0.5], out: [0, 1] })); // prettier-ignore
  const wall = { recipe: 'wall', cells, bottom: 0, top: 2.7, cut: { height: 0.4375, when: 'either' as const } };

  it('lines a lined recipe’s faces toward a room, one part a way, with its wall’s cells and a stump of its cut', () => {
    const parts = liningParts(view(true), [wall, { ...wall, recipe: 'partition' }], (recipe) => (recipe === 'wall' ? 'material:wallpaper' : undefined)); // prettier-ignore
    expect(parts.map((part) => [part.name, part.material, part.cells.length])).toEqual([['lining:wall:north', 'material:wallpaper', 4]]); // prettier-ignore
    expect(parts[0].cells).toEqual(cells); // its wall's: the cutaway cuts them together
    expect(extent(parts[0].cut!.geometry())[1][1]).toBe(0.4375); // the stump, as tall as the wall's
    expect(parts[0].cut!.when).toBe('either');
  });

  it('lines a face behind a low solid toward a room (a counter), not one behind a tall solid', () => {
    // a storey 4 × 4: the wall on row 1, under it a row of counters 0.9 m high (columns 0 and 1) and of a tall
    // cupboard (columns 2 and 3), then room 0; the outdoors to the north
    const base = view(true) as unknown as { solid: boolean[]; room: number[] };
    const solid = [...base.solid, false, false, false, false].map((one, i) => one || (i >= 8 && i < 12));
    const room = [-1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, 0, 0, 0, 0];
    const top = solid.map((one, i) => (i >= 8 && i < 10 ? 0.9 : one ? 2.7 : 0));
    const behind = {
      cols: 4,
      rows: 4,
      tile: 0.5,
      solid,
      room,
      top,
      floor: solid.map(() => 0),
    } as unknown as CompiledLevel;
    const parts = liningParts(behind, [wall], () => 'material:wallpaper');
    expect(parts.map((part) => [part.name, part.cells.map(({ tiles }) => tiles[0])])).toEqual([['lining:wall:south', [0, 1]]]); // prettier-ignore
  });

  it('lines nothing on a level without rooms', () => {
    expect(liningParts(view(false), [wall], () => 'material:wallpaper')).toEqual([]);
  });
});
