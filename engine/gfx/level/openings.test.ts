/**
 * @file Unit tests for engine/gfx/level/openings.ts (T1; WP 13.14): the wall over a storey's doors, windows and low
 * ceilings stands from each head to the full top, clipped under a pitched roof; each door gets two jambs and a head,
 * each window a sill too, flush with the wall; a railing gets posts at most 1 m apart and two rails.
 * @see engine/gfx/level/openings.ts
 */
import { describe, expect, it } from 'vitest';
import { compileLevel } from '../../world/level/compile';
import { boxBetween, FRAME, framesGeometry, headsGeometry, POST_GAP, railingGeometry } from './openings';

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
  it('frames a door with two jambs and a head, a window with a sill too, flush with the wall', () => {
    const frames = framesGeometry(SHED.openings!, SHED.tile)!;
    expect(frames.getAttribute('position').count).toBe((3 + 4) * 24);
    frames.computeBoundingBox();
    expect([frames.boundingBox!.min.x, frames.boundingBox!.max.x, frames.boundingBox!.max.z]).toEqual([2, 6, 4]);
    expect(FRAME).toBe(0.07);
  });

  it('posts a railing at its ends and at most 1 m apart, with a top and a bottom rail', () => {
    expect(railingGeometry(0.25, [[0, 0, 7, 0]], 0, 1)!.getAttribute('position').count).toBe((3 + 2) * 24);
    expect(railingGeometry(0.25, [[0, 0, 0, 11]], 3, 4)!.getAttribute('position').count).toBe((4 + 2) * 24);
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
