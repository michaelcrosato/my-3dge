/**
 * @file Openings drawn (PLAN.md WP 13.14, WP 13.36; docs/PLAYGROUND.md §6.1, §7.1): the parts round a storey's doors
 * and windows, and its railings. `headsGeometry(level, storey, roof?, except?)` is the wall over each opening and low
 * ceiling: for every glyph with a head, its tiles merged into few rectangles, each a box from the head up to the
 * storey's full top, or under a pitched roof up to its underside (engine/gfx/level/walls.ts), as the colliders stand
 * (engine/world/level/storeys.ts); tiles `except` accepts are left to `wallHeads(level, storey, openings, foot,
 * wallAt)`, the wall over an opening in a wall drawn as that wall: a box a tile like its pieces, its sides' v from the
 * wall's `foot`, so a siding's boards and a brick's courses run on over the opening, a geometry per wall recipe drawn
 * in its sides' material (one draw call, as the heads are).
 *
 * `framesGeometry(openings, tile, leaf?)` is the frame round each: two jambs and a head of planks `FRAME` wide on the
 * wall round the opening, and a window's sill, standing `PROUD` out of the wall's faces and lining its reveal `PROUD`
 * deep, so no face of the frame lies in the plane of the wall's cut ends (they fought, z-fighting) and the opening
 * drawn is, to a centimetre, the one bodies pass through (WP 13.18: the jambs had stood inside it, 7 cm a side). Where
 * a door's `leaf` hangs (engine/world/level/doorways.ts, as engine/sim/doors.ts hangs it), the frame meets it shut:
 * the latch jamb against its edge and the head on its top, through the wall, and at the hinge a barrel `KNUCKLE` out
 * of its faces and a `STOP` in the wall's middle from the jamb to it, clear of the leaf's sweep (turned past a quarter,
 * it leans back towards the jamb), so no ray passes round a shut door and it swings clear (`frameInsets`). `railingGeometry(tile, pieces, bottom, top)` is a railing along each run of tiles: posts at its
 * ends and at most `POST_GAP` apart, and a top and a bottom rail as wide as its tiles, the railing's collider (a box
 * over them), so what stops a body is drawn.
 *
 * Boxes are engine/gfx/geometry/box.ts's (UVs in metres), merged into one geometry each (one draw call a storey).
 *
 * Invariants: pure in their inputs; null (an empty map) when there is nothing to draw.
 *
 * @example
 * // headsGeometry(level, level.storeys[1]); // the walls over the ground floor's doors and windows
 * railingGeometry(0.25, [[0, 0, 7, 0]], 0, 1)!.getAttribute('position').count; // 3 posts and 2 rails: 120 vertices
 * @see engine/gfx/level/openings.test.ts
 */
import type { BufferGeometry } from 'three/webgpu';
import { leafFits, leafSide } from '../../world/level/doorways';
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
import { frustumGeometry } from '../geometry/frustum';
import { mergeGeometries } from '../geometry/groups';
import { createWriter } from '../geometry/writer';
import { writeHull } from './walls';

/** A frame's width round an opening (m). */
export const FRAME = 0.07;
/** How far a frame stands out of the wall's faces and into its opening (m), so its faces never share the wall's. */
export const PROUD = 0.01;
/** How far a hung leaf's barrel stands out of its faces at the hinge (m): a hinge's knuckle, never in their planes. */
export const KNUCKLE = 0.003;
/** How far a hung leaf's hinge stop stands clear of its edge's sweep about the hinge (m). */
export const SWING_CLEAR = 0.001;
/** A hung leaf's hinge stop, through the wall (m): a strip in its middle, which the leaf turning past a quarter clears. */
export const STOP = 0.01;
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
 * The wall over `storey`'s openings and low ceilings (see the file comment), `roof` its pitched roof when it has one,
 * leaving out the tiles `except` accepts; null when it has none.
 */
export function headsGeometry(
  level: Pick<CompiledLevel, 'cols' | 'rows' | 'tile' | 'legend'>,
  storey: Pick<StoreyDescriptor, 'tiles' | 'base' | 'fullTop'>,
  roof?: RoofDescriptor,
  except: (col: number, row: number) => boolean = () => false,
): BufferGeometry | null {
  const { cols, rows, tile: t } = level;
  const parts: BufferGeometry[] = [];
  const writer = createWriter();
  const headed = [...new Set(storey.tiles)].map((char) => level.legend[char]).filter((glyph) => (glyph.head ?? 0) > 0);
  for (const glyph of headed.sort((a, b) => byText(a.id, b.id))) {
    const bottom = storey.base + (glyph.head ?? 0);
    for (const [c0, r0, c1, r1] of mergeRects(
      cols,
      rows,
      (c, r) => storey.tiles[r * cols + c] === glyph.char && !except(c, r),
    )) {
      // prettier-ignore
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

/**
 * The wall over each of `openings` (on `storey`) that stands in a wall, as that wall (see the file comment): by the
 * recipe `wallAt(col, row)` names for the wall at either end of it (undefined where none stands), a geometry of a box
 * a tile, its sides' v in metres from `foot`, the wall's own foot, in one draw group (its top lies under the floor and
 * its underside in the frame's head: only its sides show); and the tiles drawn.
 */
export function wallHeads(
  level: Pick<CompiledLevel, 'cols' | 'tile'>,
  storey: Pick<StoreyDescriptor, 'fullTop'>,
  openings: readonly OpeningDescriptor[],
  foot: number,
  wallAt: (col: number, row: number) => string | undefined,
): { recipes: Map<string, BufferGeometry>; tiles: Set<number> } {
  const { cols, tile: t } = level;
  const pieces = new Map<string, BufferGeometry[]>();
  const tiles = new Set<number>();
  for (const { axis, tiles: rect, top } of openings) {
    const [c0, r0, c1, r1] = rect;
    const ends: [number, number][] = axis === 'x' ? [[c0 - 1, r0], [c1 + 1, r0]] : [[c0, r0 - 1], [c0, r1 + 1]]; // prettier-ignore
    const recipe = ends.map(([c, r]) => wallAt(c, r)).find((name) => name !== undefined);
    if (recipe === undefined || storey.fullTop <= top) continue;
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) {
        const piece = boxGeometry({ width: t, height: storey.fullTop - top, depth: t }).translate((c + 0.5) * t, top, (r + 0.5) * t); // prettier-ignore
        const [normal, uv] = [piece.getAttribute('normal'), piece.getAttribute('uv')];
        for (let i = 0; i < uv.count; i++) if (normal.getY(i) === 0) uv.setY(i, uv.getY(i) + top - foot); // its boards run on
        pieces.set(recipe, [...(pieces.get(recipe) ?? []), piece]);
        tiles.add(r * cols + c);
      }
  }
  const recipes = new Map<string, BufferGeometry>();
  for (const [recipe, boxes] of [...pieces].sort(([a], [b]) => byText(a, b))) {
    const geometry = joined(boxes)!;
    geometry.clearGroups(); // one draw group: the boxes' faces all take the wall's sides' material
    recipes.set(recipe, geometry);
  }
  return { recipes, tiles };
}

/**
 * How far `opening`'s frame stands into it (m): at its `a0` end (where a leaf's hinge is), its `a1` end and down from
 * its head. `PROUD` each, lining the reveal; where `leaf` (`[width, height, depth]`) hangs (`hung`), meeting it shut
 * (see the file comment).
 */
export function frameInsets(
  opening: OpeningDescriptor,
  leaf?: readonly number[],
): { hinge: number; latch: number; head: number; hung: boolean } {
  if (!leaf || !leafFits(opening, leaf)) return { hinge: PROUD, latch: PROUD, head: PROUD, hung: false };
  const side = leafSide(opening, leaf);
  return {
    hinge: PROUD, // a leaf turned past a quarter leans back towards it: its stop and its barrel close the gap
    latch: Math.max(PROUD, side),
    head: Math.max(PROUD, opening.top - opening.bottom - leaf[1]),
    hung: true,
  };
}

/** The frame round each of `openings` (see the file comment), meeting `leaf` where it hangs; null when there are none. */
export function framesGeometry(
  openings: readonly OpeningDescriptor[],
  tile: number,
  leaf?: readonly number[],
): BufferGeometry | null {
  const parts: BufferGeometry[] = [];
  for (const opening of openings) {
    const [c0, r0, c1, r1] = opening.tiles;
    const [x0, z0, x1, z1] = [c0 * tile, r0 * tile, (c1 + 1) * tile, (r1 + 1) * tile];
    const { bottom, top } = opening;
    // Along the wall (a) and through it (b), standing out of its faces: the jambs at a's ends, lining the reveal, the
    // head over the opening and a window's sill under it, its jambs on the sill.
    const [a0, a1, b0, b1] = opening.axis === 'x' ? [x0, x1, z0 - PROUD, z1 + PROUD] : [z0, z1, x0 - PROUD, x1 + PROUD]; // prettier-ignore
    const box = (p0: number, q0: number, p1: number, q1: number, y0: number, y1: number) =>
      opening.axis === 'x' ? boxBetween(p0, y0, q0, p1, y1, q1) : boxBetween(q0, y0, p0, q1, y1, p1);
    const { hinge, latch, head, hung } = frameInsets(opening, leaf);
    const [foot, lintel] = [opening.kind === 'window' ? bottom + PROUD : bottom, top - head];
    parts.push(box(a0 - FRAME, b0, a0 + hinge, b1, foot, lintel), box(a1 - latch, b0, a1 + FRAME, b1, foot, lintel));
    parts.push(box(a0 - FRAME, b0, a1 + FRAME, b1, lintel, top + FRAME));
    if (opening.kind === 'window') parts.push(box(a0 - FRAME, b0, a1 + FRAME, b1, bottom - FRAME, bottom + PROUD)); // over the wall's top, never in its plane
    if (hung) {
      const radius = leaf![2] / 2 + KNUCKLE; // the hinge's barrel, round the axis the leaf turns about
      const [a, b] = [a0 + leafSide(opening, leaf!), (b0 + b1) / 2];
      const barrel = frustumGeometry({ radiusBottom: radius, radiusTop: radius, height: lintel - bottom, radialSegments: 12 }); // prettier-ignore
      parts.push(opening.axis === 'x' ? barrel.translate(a, bottom, b) : barrel.translate(b, bottom, a));
      parts.push(box(a0 + hinge, b - STOP / 2, a - leaf![2] / 2 - SWING_CLEAR, b + STOP / 2, bottom, lintel)); // its stop
    }
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
    // Across the run: the posts in its middle, the rails its whole width, as its collider stands.
    const [w0, w1] = along === 'x' ? [z0, z1] : [x0, x1];
    const mid = (w0 + w1) / 2;
    const box = (p0: number, p1: number, y0: number, y1: number, b0 = mid - BAR / 2, b1 = mid + BAR / 2) =>
      along === 'x' ? boxBetween(p0, y0, b0, p1, y1, b1) : boxBetween(b0, y0, p0, b1, y1, p1);
    const posts = Math.max(1, Math.ceil((a1 - a0 - BAR) / POST_GAP));
    for (let k = 0; k <= posts; k++) {
      const at = a0 + ((a1 - a0 - BAR) * k) / posts;
      parts.push(box(at, at + BAR, bottom, top - BAR));
    }
    parts.push(box(a0, a1, top - BAR, top, w0, w1), box(a0, a1, bottom + 0.1, bottom + 0.1 + BAR, w0, w1));
  }
  return joined(parts);
}
