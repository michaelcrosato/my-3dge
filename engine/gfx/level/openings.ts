/**
 * @file Openings drawn (PLAN.md WP 13.14; docs/PLAYGROUND.md §6.1, §7.1): the parts round a storey's doors and
 * windows, and its railings. `headsGeometry(level, storey)` is the wall over each opening and low ceiling: for every
 * glyph with a head, its tiles merged into few rectangles, each a box from the head up to the storey's full top, or
 * under a pitched roof up to its underside (engine/gfx/level/walls.ts), as the colliders stand
 * (engine/world/level/storeys.ts). `framesGeometry(openings)` is the frame round each: two jambs and a head of planks
 * `FRAME` wide, and a window's sill, flush with the wall's faces. `railingGeometry(tile, pieces, bottom, top)` is a
 * railing along each run of tiles: posts at its ends and at most `POST_GAP` apart, a top rail and a bottom rail.
 *
 * Boxes are engine/gfx/geometry/box.ts's (UVs in metres), merged into one geometry each (one draw call a storey).
 *
 * Invariants: pure in their inputs; null when there is nothing to draw.
 *
 * @example
 * // headsGeometry(level, level.storeys[1]); // the walls over the ground floor's doors and windows
 * railingGeometry(0.25, [[0, 0, 7, 0]], 0, 1)!.getAttribute('position').count; // 3 posts and 2 rails: 120 vertices
 * @see engine/gfx/level/openings.test.ts
 */
import type { BufferGeometry } from 'three/webgpu';
import { byText } from '../../world/level/grid';
import { mergeRects } from '../../world/level/rects';
import { wallUnder } from '../../world/level/roofs';
import type {
  CompiledLevel,
  OpeningDescriptor,
  RoofDescriptor,
  StoreyDescriptor,
  TileRect,
} from '../../world/level/types';
import { boxGeometry } from '../geometry/box';
import { mergeGeometries } from '../geometry/groups';
import { createWriter } from '../geometry/writer';
import { writeHull } from './walls';

/** A frame's width round an opening (m). */
export const FRAME = 0.07;
/** How far apart a railing's posts stand, at most (m). */
export const POST_GAP = 1;
/** A railing's post and rails, across (m). */
const BAR = 0.06;

/** A box from `[x0, y0, z0]` to `[x1, y1, z1]` (m), UVs in metres. */
export function boxBetween(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): BufferGeometry {
  return boxGeometry({ width: x1 - x0, height: y1 - y0, depth: z1 - z0 }).translate((x0 + x1) / 2, y0, (z0 + z1) / 2);
}

/** `geometries` merged, disposing each; null when there are none. */
function joined(geometries: BufferGeometry[]): BufferGeometry | null {
  if (!geometries.length) return null;
  const merged = mergeGeometries(geometries);
  for (const geometry of geometries) geometry.dispose();
  return merged;
}

/**
 * The wall over `storey`'s openings and low ceilings (see the file comment), `roof` its pitched roof when it has one;
 * null when it has none.
 */
export function headsGeometry(
  level: Pick<CompiledLevel, 'cols' | 'rows' | 'tile' | 'legend'>,
  storey: Pick<StoreyDescriptor, 'tiles' | 'base' | 'fullTop'>,
  roof?: RoofDescriptor,
): BufferGeometry | null {
  const { cols, rows, tile: t } = level;
  const parts: BufferGeometry[] = [];
  const writer = createWriter();
  const headed = [...new Set(storey.tiles)].map((char) => level.legend[char]).filter((glyph) => (glyph.head ?? 0) > 0);
  for (const glyph of headed.sort((a, b) => byText(a.id, b.id))) {
    const bottom = storey.base + (glyph.head ?? 0);
    for (const [c0, r0, c1, r1] of mergeRects(cols, rows, (c, r) => storey.tiles[r * cols + c] === glyph.char)) {
      const [x0, z0, x1, z1] = [c0 * t, r0 * t, (c1 + 1) * t, (r1 + 1) * t];
      if (roof && roof.kind !== 'flat') {
        const points = wallUnder(roof, [x0, z0, x1, z1], bottom);
        if (points) writeHull(writer, points);
      } else if (storey.fullTop > bottom) parts.push(boxBetween(x0, bottom, z0, x1, storey.fullTop, z1));
    }
  }
  if (writer.count) parts.push(writer.build());
  return joined(parts);
}

/** The frame round each of `openings` (see the file comment); null when there are none. */
export function framesGeometry(openings: readonly OpeningDescriptor[], tile: number): BufferGeometry | null {
  const parts: BufferGeometry[] = [];
  for (const opening of openings) {
    const [c0, r0, c1, r1] = opening.tiles;
    const [x0, z0, x1, z1] = [c0 * tile, r0 * tile, (c1 + 1) * tile, (r1 + 1) * tile];
    const { bottom, top } = opening;
    // Along the wall (a) and through it (b), flush with its faces: the jambs stand at a's ends, the head and sill span a.
    const [a0, a1, b0, b1] = opening.axis === 'x' ? [x0, x1, z0, z1] : [z0, z1, x0, x1];
    const box = (p0: number, q0: number, p1: number, q1: number, y0: number, y1: number) =>
      opening.axis === 'x' ? boxBetween(p0, y0, q0, p1, y1, q1) : boxBetween(q0, y0, p0, q1, y1, p1);
    parts.push(box(a0, b0, a0 + FRAME, b1, bottom, top), box(a1 - FRAME, b0, a1, b1, bottom, top));
    parts.push(box(a0, b0, a1, b1, top - FRAME, top));
    if (opening.kind === 'window') parts.push(box(a0, b0, a1, b1, bottom, bottom + FRAME));
  }
  return joined(parts);
}

/** A railing along each run of `pieces` (tiles `tile` m wide), from `bottom` to `top` (m); null when there are none. */
export function railingGeometry(
  tile: number,
  pieces: readonly TileRect[],
  bottom: number,
  top: number,
): BufferGeometry | null {
  const parts: BufferGeometry[] = [];
  for (const [c0, r0, c1, r1] of pieces) {
    const [x0, z0, x1, z1] = [c0 * tile, r0 * tile, (c1 + 1) * tile, (r1 + 1) * tile];
    const along = x1 - x0 >= z1 - z0 ? 'x' : 'z';
    const [a0, a1] = along === 'x' ? [x0, x1] : [z0, z1];
    const mid = along === 'x' ? (z0 + z1) / 2 : (x0 + x1) / 2;
    const [b0, b1] = [mid - BAR / 2, mid + BAR / 2];
    const box = (p0: number, p1: number, y0: number, y1: number) =>
      along === 'x' ? boxBetween(p0, y0, b0, p1, y1, b1) : boxBetween(b0, y0, p0, b1, y1, p1);
    const posts = Math.max(1, Math.ceil((a1 - a0 - BAR) / POST_GAP));
    for (let k = 0; k <= posts; k++) {
      const at = a0 + ((a1 - a0 - BAR) * k) / posts;
      parts.push(box(at, at + BAR, bottom, top - BAR));
    }
    parts.push(box(a0, a1, top - BAR, top), box(a0, a1, bottom + 0.1, bottom + 0.1 + BAR));
  }
  return joined(parts);
}
