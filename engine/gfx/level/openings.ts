/**
 * @file Openings drawn (PLAN.md WP 13.14, WP 13.36; docs/PLAYGROUND.md §6.1, §7.1): the parts round a storey's doors
 * and windows, and its railings. `headsGeometry(level, storey, roof?)` is the wall over each opening and low ceiling:
 * for every glyph with a head, its tiles merged into few rectangles, each a box from the head up to the storey's full
 * top, or under a pitched roof up to its underside (engine/gfx/level/walls.ts), as the colliders stand
 * (engine/world/level/storeys.ts). `wallFacings(level, storey, openings, foot, wallAt)` faces the wall over an opening
 * in a wall with that wall's look: on each of the wall's two faces a skin `FACING` out of the head's (never in their
 * plane), a tile at a time as the wall's pieces are, closed at its top and at the run's ends (open, its 3 mm step
 * showed the head's paint behind it as pinholes at a grazing look), its v from the wall's `foot`, so a siding's boards
 * and a brick's courses run on over the opening while the head keeps its top, its underside and its shadow.
 *
 * `framesGeometry(openings, tile, leaf?)` is the frame round each: two jambs and a head of planks `FRAME` wide on the
 * wall round the opening, and a window's sill, standing `PROUD` out of the wall's faces and lining its reveal `PROUD`
 * deep, so no face of the frame lies in the plane of the wall's cut ends (they fought, z-fighting); bodies pass a
 * centimetre inside the drawn jambs (WP 13.18: they had stood 7 cm inside). Where a level's door `leaf` hangs
 * (engine/world/level/doorways.ts, as engine/sim/doors.ts hangs it), the frame meets it shut (`frameInsets`): the
 * latch jamb against its edge and the head on its top, through the wall; at the hinge a barrel whose flats stand
 * `KNUCKLE` out of its faces, a `STOP` in the wall's middle and a lining as deep as its swing leaves room for (turned
 * past a quarter it leans back towards that jamb, its fittings furthest), so no ray passes round a shut door and it
 * swings clear. An opening too narrow or too low to meet its leaf so keeps the plain lining. `railingGeometry(tile,
 * pieces, bottom, top)` is a railing along each run of tiles: posts at its ends and at most `POST_GAP` apart, a top
 * and a bottom rail as wide as its tiles, the railing's collider (a box over them), so what stops a body is drawn, and
 * its tiles' floor at its foot, welded as a floor is (engine/gfx/level/surface.ts): no other floor is drawn on them,
 * and under the bottom rail the storey below, the ground or a wall's paint top showed through (WP 13.38).
 *
 * Boxes are engine/gfx/geometry/box.ts's (UVs in metres), merged into one geometry each (one draw call a storey).
 *
 * Invariants: pure in their inputs; null (an empty map) when there is nothing to draw.
 *
 * @example
 * // headsGeometry(level, level.storeys[1]); // the walls over the ground floor's doors and windows
 * railingGeometry(0.25, [[0, 0, 7, 0]], 0, 1)!.getAttribute('position').count; // 138: 3 posts, 2 rails, its floor
 * @see engine/gfx/level/openings.test.ts
 */
import type { BufferGeometry } from 'three/webgpu';
import { DOOR_SWING, leafFits, leafSide, type DoorLeaf } from '../../world/level/doorways';
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
import { createWriter, cross, dot, normalize, type Vec3, type Writer } from '../geometry/writer';
import { surfaceGeometry } from './surface';
import { writeHull } from './walls';

/** A frame's width round an opening (m). */
export const FRAME = 0.07;
/** How far a frame stands out of the wall's faces and into its opening (m), so its faces never share the wall's. */
export const PROUD = 0.01;
/** A frame's least lining (m), where a leaf's swing leaves no more: never in the plane of the wall's cut end. */
export const LEAST_LINING = 0.002;
/** How far a hung leaf's barrel's flats stand out of its faces at the hinge (m): a hinge's knuckle. */
export const KNUCKLE = 0.003;
/** How far a hung leaf's hinge parts stand clear of its sweep about the hinge (m). */
export const SWING_CLEAR = 0.001;
/** A hung leaf's hinge stop, through the wall (m): a strip in its middle, which the leaf turning past a quarter clears. */
export const STOP = 0.01;
/** How far a wall's facing over an opening stands out of the head's faces (m). */
export const FACING = 0.003;
/** How far a facing's ends lean their shading out of the run's end from the face's (the tangent, about 3°). */
const END_LEAN = 0.05;
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

/** The wall over `storey`'s openings and low ceilings (see the file comment), `roof` its pitched roof when it has one; null when it has none. */ // prettier-ignore
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

/**
 * The facing over each of `openings` (on `storey`) in a wall (see the file comment), by the recipe `wallAt(col, row)`
 * names for the wall at either end of it (undefined where none stands): a geometry each, one draw group.
 */
export function wallFacings(
  level: Pick<CompiledLevel, 'tile'>,
  storey: Pick<StoreyDescriptor, 'fullTop'>,
  openings: readonly OpeningDescriptor[],
  foot: number,
  wallAt: (col: number, row: number) => string | undefined,
): Map<string, BufferGeometry> {
  const t = level.tile;
  const pieces = new Map<string, BufferGeometry[]>();
  for (const { axis, tiles: rect, top } of openings) {
    const [c0, r0, c1, r1] = rect;
    const ends: [number, number][] = axis === 'x' ? [[c0 - 1, r0], [c1 + 1, r0]] : [[c0, r0 - 1], [c0, r1 + 1]]; // prettier-ignore
    const recipe = ends.map(([c, r]) => wallAt(c, r)).find((name) => name !== undefined);
    if (recipe === undefined || storey.fullTop <= top) continue;
    const [lo, hi] = axis === 'x' ? [c0, c1] : [r0, r1]; // its tiles along the wall
    const faces = axis === 'x' ? [r0 * t, (r1 + 1) * t] : [c0 * t, (c1 + 1) * t]; // the wall's two faces
    const at = (a: number, y: number, b: number): Vec3 => (axis === 'x' ? [a, y, b] : [b, y, a]);
    const writer = createWriter();
    for (let i = lo; i <= hi; i++)
      for (const [s, face] of [[-1, faces[0]], [1, faces[1]]] as const)
        writeSkin(writer, at, [i * t, (i + 1) * t], [face, face + s * FACING], [top, storey.fullTop], [i === lo, i === hi]); // prettier-ignore
    const piece = writer.build();
    const uv = piece.getAttribute('uv');
    for (let v = 0; v < uv.count; v++) uv.setY(v, uv.getY(v) + top - foot); // its boards run on from the wall's foot
    pieces.set(recipe, [...(pieces.get(recipe) ?? []), piece]);
  }
  const facings = new Map<string, BufferGeometry>();
  for (const [recipe, faces] of [...pieces].sort(([a], [b]) => byText(a, b))) facings.set(recipe, joined(faces)!);
  return facings;
}

/**
 * Writes a facing's skin over the tile `[a0, a1]` along its wall (see the file comment), on the wall's face `b[0]`
 * standing out to `b[1]`, from `y[0]` to `y[1]`: its face, then a bevel back to the wall's face at its top (never level,
 * so never in a floor's plane), and its ends where `ends` (low, high) says the run ends. Every part is shaded as the
 * face (its normal, an end's leant 3° out of it, and its texture's u and v run on), so its 3 mm read as the wall's
 * siding at a grazing look: an end shaded as itself, facing along the wall, drew a dark dotted line up a head's edge.
 * `at(a, y, b)` places a point.
 */
function writeSkin(
  writer: Writer,
  at: (a: number, y: number, b: number) => Vec3,
  [a0, a1]: readonly [number, number],
  [face, out]: readonly [number, number],
  [y0, y1]: readonly [number, number],
  ends: readonly [boolean, boolean],
): void {
  const up: Vec3 = [0, 1, 0];
  const minus = (p: Vec3, q: Vec3): Vec3 => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
  const normal = normalize(minus(at(a0, 0, out), at(a0, 0, face)));
  const u = cross(up, normal); // the face's u, left to right seen from outside, as box.ts's
  const [left, right] = dot(minus(at(a1, 0, 0), at(a0, 0, 0)), u) > 0 ? [a0, a1] : [a1, a0];
  const u0 = dot(at(left, 0, out), u);
  // A flat polygon, its corners counter-clockwise seen from outside it, shaded (`shade`) and textured as the face.
  const polygon = (corners: readonly Vec3[], shade: Vec3 = normal) => {
    const first = writer.count;
    for (const p of corners) writer.vertex(p, shade, [dot(p, u) - u0, p[1] - y0]);
    for (let i = 1; i + 1 < corners.length; i++) writer.triangle(first, first + i, first + i + 1);
  };
  const bevel = y1 - Math.abs(out - face);
  polygon([at(left, y0, out), at(right, y0, out), at(right, bevel, out), at(left, bevel, out)]);
  polygon([at(left, bevel, out), at(right, bevel, out), at(right, y1, face), at(left, y1, face)]);
  for (const [a, end, side] of [
    [a0, ends[0], -1],
    [a1, ends[1], 1],
  ] as const) {
    if (!end) continue;
    const e = normalize(minus(at(a + side, 0, face), at(a, 0, face))); // out of the run's end
    const corners: [number, number][] = dot(minus(at(a, 0, out), at(a, 0, face)), cross(up, e)) > 0 ? [[face, y0], [out, y0], [out, bevel], [face, y1]] : [[out, y0], [face, y0], [face, y1], [out, bevel]]; // prettier-ignore
    // The face's normal leant `END_LEAN` out of the run's end, so it points to the side the end faces (a triangle
    // shaded from behind would be culled or lit wrong, engine/gfx/geometry/inspect.ts) and shades as the face.
    polygon(corners.map(([b, y]) => at(a, y, b)), normalize([normal[0] + END_LEAN * e[0], normal[1], normal[2] + END_LEAN * e[2]])); // prettier-ignore
  }
}

/**
 * How far `opening`'s frame stands into it (m): at its `a0` end (the lower end along its wall, where a leaf's hinge
 * is), its `a1` end and down from its head; `PROUD` each, lining the reveal, or where `leaf` hangs and there is room
 * (`hung`), meeting it shut (see the file comment).
 */
export function frameInsets(
  opening: OpeningDescriptor,
  leaf?: DoorLeaf,
): { hinge: number; latch: number; head: number; hung: boolean } {
  const plain = { hinge: PROUD, latch: PROUD, head: PROUD, hung: false };
  if (!leaf || !leafFits(opening, leaf.size)) return plain;
  const side = leafSide(opening, leaf.size);
  const head = opening.top - opening.bottom - leaf.size[1];
  if (side < leaf.size[2] / 2 + SWING_CLEAR + LEAST_LINING || head < LEAST_LINING) return plain; // no room to meet it
  // Turned past a quarter, the leaf leans back towards the hinge jamb, furthest within the frame's depth.
  const lean = Math.max(leaf.reach, leaf.reach * Math.sin(DOOR_SWING) - (opening.depth / 2 + PROUD) * Math.min(0, Math.cos(DOOR_SWING))); // prettier-ignore
  return { hinge: Math.min(PROUD, Math.max(LEAST_LINING, side - lean - SWING_CLEAR)), latch: side, head, hung: true };
}

/** The frame round each of `openings` (see the file comment), meeting `leaf` where it hangs; null when there are none. */
export function framesGeometry(
  openings: readonly OpeningDescriptor[],
  tile: number,
  leaf?: DoorLeaf,
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
      const half = leaf!.size[2] / 2;
      const radius = (half + KNUCKLE) / Math.cos(Math.PI / 12); // the hinge's barrel, round the axis the leaf turns about
      const [a, b] = [a0 + leafSide(opening, leaf!.size), (b0 + b1) / 2];
      const barrel = frustumGeometry({ radiusBottom: radius, radiusTop: radius, height: lintel - bottom, radialSegments: 12 }); // prettier-ignore
      parts.push(opening.axis === 'x' ? barrel.translate(a, bottom, b) : barrel.translate(b, bottom, a));
      const stop = a - half - SWING_CLEAR; // its stop, from the jamb to the barrel
      if (stop - (a0 + hinge) > 1e-6) parts.push(box(a0 + hinge, b - STOP / 2, stop, b + STOP / 2, bottom, lintel));
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
    // Its tiles' floor, seen under the bottom rail: no floor is drawn on a railing's tiles (a hole to the storey or the
    // ground below, or a wall's paint top showing a centimetre under the floor beside it).
    parts.push(surfaceGeometry(tile, [[c0, r0, c1, r1]], bottom));
  }
  return joined(parts);
}
