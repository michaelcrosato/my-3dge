/**
 * @file Pillar parts (PLAN.md WP 2.4): the prototype's pillar, a plinth, a shaft of dressed stone and a capital of two
 * slabs, as sizes (`pillarParts`) and as one geometry (`pillarGeometry`: the parts' boxes merged, sides then tops, so a
 * pillar is two draw calls however many stand). Sized to a footprint `width` (2 m, a 2 × 2-tile pillar) and a
 * `height` (3.5 m) by the prototype's proportions: the plinth and the lower capital 34/32 of the footprint, the shaft
 * 28/32, the upper capital (the abacus) 38/32; the plinth 6/56 of the height, the shaft 42/56, each capital slab 4/56.
 * The level meshes use them for pillars with plinths and capitals (WP 4.4); props may too.
 *
 * Carried from the pillar parts of `my-3d2dge:src/stress-world/10-hall.js:363-370` (plinth 0–6, shaft 6–48, capital
 * 48–52 and 52–56 units, on a 32-unit footprint).
 *
 * Invariants: the parts stack from 0 to `height` without gaps, in order; the capitals overhang the footprint as the
 * prototype's did (the collider stays the footprint); every part is a `boxGeometry` (UVs in metres).
 *
 * @example
 * pillarParts().map((part) => [part.name, part.from, part.to]); // [['plinth', 0, 0.375], ['shaft', 0.375, 3], ['capital', 3, 3.25], ['abacus', 3.25, 3.5]]
 * pillarGeometry().groups.length; // 2: sides, then tops and bottoms
 * @see engine/gfx/geometry/kit.test.ts
 */
import type { BufferGeometry } from 'three/webgpu';
import { boxGeometry } from './box';
import { assertSizes } from './checks';
import { mergeGeometries, sidesThenTops } from './groups';

/** A pillar's footprint and height in metres. */
export interface PillarOptions {
  /** The footprint's side: two tiles of 1 m. */
  width?: number;
  height?: number;
}

/** One part of a pillar: a square slab `width` across, from height `from` to `to` (m). */
export interface PillarPart {
  name: 'plinth' | 'shaft' | 'capital' | 'abacus';
  width: number;
  from: number;
  to: number;
}

/** The prototype's parts in its units: [name, width of 32, from, to of 56]. */
const PARTS: readonly [PillarPart['name'], number, number, number][] = [
  ['plinth', 34, 0, 6],
  ['shaft', 28, 6, 48],
  ['capital', 34, 48, 52],
  ['abacus', 38, 52, 56],
];

/** A pillar's parts, bottom to top (see the file comment). Throws `GFX_BAD_GEOMETRY` for a size ≤ 0. */
export function pillarParts({ width = 2, height = 3.5 }: PillarOptions = {}): PillarPart[] {
  assertSizes('pillar', { width, height });
  return PARTS.map(([name, across, from, to]) => ({
    name,
    width: (width * across) / 32,
    from: (height * from) / 56,
    to: (height * to) / 56,
  }));
}

/** A pillar as one geometry standing on the ground: its parts' boxes, sides then tops. */
export function pillarGeometry(options: PillarOptions = {}): BufferGeometry {
  const boxes = pillarParts(options).map(({ width, from, to }) => {
    const box = boxGeometry({ width, height: to - from, depth: width });
    return box.translate(0, from, 0);
  });
  const merged = sidesThenTops(mergeGeometries(boxes));
  boxes.forEach((box) => box.dispose());
  return merged;
}
