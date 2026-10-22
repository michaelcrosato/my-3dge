/**
 * @file Unit tests for a site's clear points (engine/world/siteNavClear.ts, PLAN.md WP 13.18): a doorway's tiles walk
 * its middle, a tile by a wall's corner keeps clear of it, a ledge's side counts and a step's does not, a tile a link
 * enters is open, a block counts by its own box and only at a body's height, a gap narrower than the body walks its
 * middle.
 * @see engine/world/siteNavClear.ts
 */
import { describe, expect, it } from 'vitest';
import { compileLevel } from './level/compile';
import { NavGrid } from './nav';
import { clearOffset } from './siteNavClear';

/** A level on 0.25 m tiles from its rows, and its grid. */
function grid(...rows: string[]) {
  const level = compileLevel(`---\ntile: 0.25\n---\n${rows.join('\n')}\n`);
  return { level, grid: new NavGrid(level, { radius: 0.1, climb: 0.5 }) };
}

const KEEP = { keep: 0.45, climb: 0.5 };

describe('clearOffset', () => {
  // Two rooms and a 1 m doorway between them (row 5, columns 3 to 6: x 0.75 to 1.75).
  const rooms = grid('##########', ...Array(4).fill('#........#'), '###....###', ...Array(4).fill('#........#'), '##########'); // prettier-ignore

  it("walks a 1 m doorway's outer tiles midway between its jambs", () => {
    expect(clearOffset(rooms.grid, rooms.level.walkable, 5 * 10 + 3, KEEP)).toEqual([0.35, 0]); // x 1.225
    expect(clearOffset(rooms.grid, rooms.level.walkable, 5 * 10 + 6, KEEP)).toEqual([-0.35, 0]); // x 1.275
  });

  it("keeps a tile by a wall's corner clear of it, along the diagonal", () => {
    // Tile (3, 4), its south-west neighbour the doorway's west jamb: 0.18 m from its corner, moved to 0.46 m.
    expect(clearOffset(rooms.grid, rooms.level.walkable, 4 * 10 + 3, KEEP)).toEqual([0.2, -0.2]);
  });

  // A gallery 1 m up east of tile (4, 3).
  const ledge = grid('##########', '#........#', '#........#', '#....====#', '#....====#', '#........#', '##########'); // prettier-ignore

  it('keeps off a side whose floor is more than a climb away, but not off one within it or one a link enters', () => {
    expect(clearOffset(ledge.grid, ledge.level.walkable, 3 * 10 + 4, KEEP)).toEqual([-0.35, 0]);
    expect(clearOffset(ledge.grid, ledge.level.walkable, 3 * 10 + 4, { ...KEEP, climb: 1.5 })).toEqual([0, 0]);
    const entered = new Uint8Array(10 * 7);
    entered[3 * 10 + 5] = 1;
    expect(clearOffset(ledge.grid, ledge.level.walkable, 3 * 10 + 4, { ...KEEP, entered })).toEqual([0, 0]);
  });

  it('keeps off a block by its own box, only one standing where the body does', () => {
    const room = grid('##########', ...Array(5).fill('#........#'), '##########');
    const near = { min: [1.3, 0, 0.5], max: [1.6, 1, 1.2] } as const; // 0.175 m east of tile (4, 3)'s centre
    const over = { min: [1.3, 2, 0.5], max: [1.6, 3, 1.2] } as const; // above a standing body
    const tile = 3 * 10 + 4;
    expect(clearOffset(room.grid, room.level.walkable, tile, { ...KEEP, blocks: [near], stand: 1.88 })).toEqual([-0.3, 0]); // prettier-ignore
    expect(clearOffset(room.grid, room.level.walkable, tile, { ...KEEP, blocks: [over], stand: 1.88 })).toEqual([0, 0]); // prettier-ignore
  });

  it('walks the middle of a gap narrower than the body', () => {
    const corridor = grid('############', ...Array(3).fill('#..........#'), '############'); // 0.75 m wide
    expect(clearOffset(corridor.grid, corridor.level.walkable, 1 * 12 + 5, KEEP)).toEqual([0, 0.25]);
  });
});
