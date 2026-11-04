/**
 * @file Unit tests for engine/world/level/doorways.ts (T1; WP 13.36): a leaf hangs in a door opening as wide as it to
 * 0.2 m wider and as tall, never in a window, a wider one or a lower one; centred, 5 cm a side in the door glyph's 1 m.
 * @see engine/world/level/doorways.ts
 */
import { describe, expect, it } from 'vitest';
import { compileLevel } from './compile';
import { LEVEL_DOOR, leafFits, leafOpenings, leafSide, PLAY } from './doorways';
import type { OpeningDescriptor } from './types';

const LEAF = [0.9, 2.05, 0.045] as const;
const door = (width: number, top = 2.1) => ({ kind: 'door', width, bottom: 0, top }) as OpeningDescriptor;

describe('doorways', () => {
  it('hangs a leaf in a door opening as wide as it to 0.2 m wider and as tall, and nowhere else', () => {
    expect([LEVEL_DOOR, PLAY]).toEqual(['prop:door', 0.2]);
    expect([0.9, 1, 1.1].map((width) => leafFits(door(width), LEAF))).toEqual([true, true, true]);
    expect(leafFits(door(0.85), LEAF)).toBe(false); // too narrow
    expect(leafFits(door(1.25), LEAF)).toBe(false); // a garage's: the scene's to fill
    expect(leafFits(door(1, 1.4), LEAF)).toBe(false); // a crawlspace's low door
    expect(leafFits({ ...door(1), kind: 'window' }, LEAF)).toBe(false);
  });

  it("lists a level's door openings a leaf fits, in order, and centres the leaf: 5 cm a side in 1 m", () => {
    const shed = compileLevel(['---', 'storey: ground', 'base: 0', 'height: 2.5', '---', '######', '#....:', '#....:', '##++##'].join('\n')); // prettier-ignore
    expect(shed.openings!.map((opening) => opening.kind)).toEqual(['door', 'window']);
    expect(leafOpenings(shed, LEAF)).toEqual([]); // its door is two 1 m tiles: too wide for 0.9 m, the scene's
    const [only, ...rest] = leafOpenings(shed, [1.9, 2, 0.04]);
    expect([only.kind, only.width, rest]).toEqual(['door', 2, []]);
    expect(leafSide(door(1), LEAF)).toBeCloseTo(0.05, 9);
    expect(leafSide(door(0.9), LEAF)).toBe(0);
  });
});
