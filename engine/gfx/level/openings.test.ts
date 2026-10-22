/**
 * @file Unit tests for engine/gfx/level/openings.ts (T1; WP 13.14): the wall over a storey's doors, windows and low
 * ceilings stands from each head to the full top, clipped under a pitched roof; each door gets two jambs and a head,
 * each window a sill too, round the opening and out of the wall, never inside it; a railing gets posts at most 1 m
 * apart and two rails as wide as its tiles.
 * @see engine/gfx/level/openings.ts
 */
import { describe, expect, it } from 'vitest';
import { compileLevel } from '../../world/level/compile';
import { boxBetween, FRAME, framesGeometry, headsGeometry, POST_GAP, PROUD, railingGeometry } from './openings';

const SHED = compileLevel(
  ['---', 'storey: ground', 'base: 0', 'height: 2.5', '---', '######', '#....:', '#....:', '##++##'].join('\n'),
  { file: 'shed.txt' },
);
const [GROUND] = SHED.storeys!;

/** The lowest and highest y of a geometry's vertices. */
function ys(geometry: NonNullable<ReturnType<typeof headsGeometry>>): [number, number] {
  const position = geometry.getAttribute('position');
  const all = Array.from({ length: position.count }, (_, i) => position.getY(i));
  return [Math.min(...all), Math.max(...all)];
}

describe('headsGeometry', () => {
  it("stands the wall over the door and the window from their 2.1 m heads to the storey's top", () => {
    const heads = headsGeometry(SHED, GROUND)!;
    const [low, high] = ys(heads);
    expect([low, high]).toEqual([expect.closeTo(2.1, 6), expect.closeTo(2.5, 6)]);
    expect(heads.getAttribute('position').count).toBe(2 * 24); // two boxes: the door's run and the window's
  });

  it('is null for a storey with no head', () => {
    const plain = compileLevel(['---', 'storey: a', 'base: 0', 'height: 3', '---', '###', '#.#', '###'].join('\n'));
    expect(headsGeometry(plain, plain.storeys![0])).toBeNull();
  });
});

describe('framesGeometry and railingGeometry', () => {
  it('frames a door with two jambs and a head, a window with a sill too, round the opening and out of the wall', () => {
    const frames = framesGeometry(SHED.openings!, SHED.tile)!;
    expect(frames.getAttribute('position').count).toBe((3 + 4) * 24);
    frames.computeBoundingBox();
    const { min, max } = frames.boundingBox!;
    expect([min.x, max.x, max.z].map((v) => +v.toFixed(6))).toEqual([2 - FRAME, 6 + PROUD, 4 + PROUD]);
    expect([FRAME, PROUD]).toEqual([0.07, 0.01]);
    // Nothing of a frame inside an opening: what bodies pass through is what shows (the door's 1 m, the window's).
    const position = frames.getAttribute('position');
    const t = SHED.tile;
    for (const {
      tiles: [c0, r0, c1, r1],
      bottom,
      top,
    } of SHED.openings!) {
      const within = (v: number, lo: number, hi: number) => v > lo + 1e-6 && v < hi - 1e-6;
      const inside = Array.from({ length: position.count }, (_, i) => i).filter((i) => within(position.getX(i), c0 * t, (c1 + 1) * t) && within(position.getZ(i), r0 * t, (r1 + 1) * t) && within(position.getY(i), bottom, top)); // prettier-ignore
      expect(inside, `the opening at ${c0}, ${r0}`).toEqual([]);
    }
  });

  it('posts a railing at its ends and at most 1 m apart, its rails as wide as its tiles, as its collider is', () => {
    expect(railingGeometry(0.25, [[0, 0, 7, 0]], 0, 1)!.getAttribute('position').count).toBe((3 + 2) * 24);
    const along = railingGeometry(0.25, [[0, 0, 0, 11]], 3, 4)!;
    expect(along.getAttribute('position').count).toBe((4 + 2) * 24);
    along.computeBoundingBox();
    expect([along.boundingBox!.min.x, along.boundingBox!.max.x]).toEqual([0, 0.25]); // the tile's width across
    expect(railingGeometry(0.25, [], 0, 1)).toBeNull();
    expect(POST_GAP).toBe(1);
  });

  it('builds a box between two corners', () => {
    const box = boxBetween(1, 2, 3, 2, 4, 3.5);
    box.computeBoundingBox();
    expect([box.boundingBox!.min.toArray(), box.boundingBox!.max.toArray()]).toEqual([
      [1, 2, 3],
      [2, 4, 3.5],
    ]);
  });
});
