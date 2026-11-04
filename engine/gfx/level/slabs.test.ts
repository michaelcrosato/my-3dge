/**
 * @file Unit tests for engine/gfx/level/slabs.ts (T1; WP 13.14, WP 13.36): a storey's slab draws its underside under
 * its floored tiles (not the lowest storey's) and an edge wherever a floored tile meets void or the map's edge, each
 * facing out, standing back into its tile as far as `back` says (out of the plane of a wall under it).
 * @see engine/gfx/level/slabs.ts
 */
import { describe, expect, it } from 'vitest';
import { ceilingGeometry } from './slabs';

const LEVEL = { cols: 4, rows: 3, tile: 1 };
/** A storey of 4 × 3 tiles on `base`, 0.3 m thick, the tiles `void` lists left without floor. */
const storey = (index: number, base: number, ...holes: number[]) => ({
  index,
  base,
  slab: 0.3,
  floored: Array.from({ length: 12 }, (_, i) => !holes.includes(i)),
});

/** The faces of `geometry` by the way they face: [down, out] counted in triangles. */
function faces(geometry: NonNullable<ReturnType<typeof ceilingGeometry>>) {
  const normal = geometry.getAttribute('normal');
  const index = geometry.getIndex()!;
  let [down, out] = [0, 0];
  for (let t = 0; t < index.count; t += 3) {
    const i = index.getX(t);
    if (normal.getY(i) < -0.99) down++;
    else if (Math.abs(normal.getY(i)) < 1e-6) out++;
  }
  return [down, out];
}

describe('ceilingGeometry', () => {
  it("draws an upper storey's underside, its rim round the map and round a stairwell", () => {
    const geometry = ceilingGeometry(LEVEL, storey(1, 3, 5, 6))!;
    // the underside: 10 floored tiles in few rectangles; the rim: 14 edges round the map, 6 round the 2-tile hole
    const [down, out] = faces(geometry);
    expect(down).toBeGreaterThanOrEqual(2);
    expect(out).toBe(2 * (14 + 6));
    const position = geometry.getAttribute('position');
    const ys = new Set(Array.from({ length: position.count }, (_, i) => Math.round(position.getY(i) * 1000) / 1000));
    expect([...ys].sort((a, b) => a - b)).toEqual([2.7, 3]);
  });

  it("leaves the lowest storey's underside out, drawing only its slab's rim, and nothing for a storey with no floor", () => {
    const [down, out] = faces(ceilingGeometry(LEVEL, storey(0, 0))!);
    expect([down, out]).toEqual([0, 2 * 14]);
    expect(ceilingGeometry(LEVEL, { index: 0, base: 0, slab: 0.3, floored: new Array(12).fill(false) })).toBeNull();
  });

  it('stands an edge back into its tile as far as `back` says, and only that tile’s', () => {
    const plain = ceilingGeometry(LEVEL, storey(1, 3))!;
    const back = ceilingGeometry(LEVEL, storey(1, 3), (c, r) => (c === 0 && r === 0 ? 0.01 : 0))!;
    /** The edges' x where they face west, and z where they face north, rounded to the millimetre. */
    const outer = (geometry: typeof plain) => {
      const [position, normal] = [geometry.getAttribute('position'), geometry.getAttribute('normal')];
      const xs = new Set<number>();
      const zs = new Set<number>();
      for (let i = 0; i < position.count; i++) {
        if (normal.getX(i) < -0.99) xs.add(Math.round(position.getX(i) * 1000) / 1000);
        if (normal.getZ(i) < -0.99) zs.add(Math.round(position.getZ(i) * 1000) / 1000);
      }
      return [[...xs].sort(), [...zs].sort()];
    };
    expect(outer(plain)).toEqual([[0], [0]]);
    expect(outer(back)).toEqual([
      [0, 0.01],
      [0, 0.01],
    ]); // tile (0, 0)'s west and north edges, 1 cm in; the rest at 0
    expect(faces(back)).toEqual(faces(plain));
  });
});
