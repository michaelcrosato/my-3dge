/**
 * @file Brazier stands (PLAN.md WP 4.4): `brazierGeometry(level, pieces, bottom, top)` draws a stone foot and a bowl
 * of glowing coals on each piece of a brazier glyph, sized to the glyph's `radius` (its cylinder collider) and its
 * height, and lays the ground under the pieces' tiles (the floor, another glyph, has none there). The flames, their
 * flicker and the torch belong to the brazier prop (WP 4.5), which stands on this.
 *
 * Proportions, the prototype's: the foot a square 0.6 r from the centre to its faces, up to 2/3 of the height; the
 * bowl ten-sided, widening from 0.84 r to 1.1 r up to 11/12 of the height, its top the coals. On the hall's brazier
 * (r 0.3125 m, 0.75 m high) that is the prototype's 6-unit foot, 8 units high, and its bowl, 4.2 to 5.5 units across.
 *
 * Carried from the braziers of `my-3d2dge:src/stress-world/10-hall.js:409-421` (`BRAZ.base`, `bowl`, `coals`), merged
 * into one mesh: thirty braziers are three draw calls, and cast no shadow (their own torch sits on them).
 *
 * Invariants: slot 0 the foot and the bowl, slot 1 the coals, slot 2 the ground; pure in its inputs; every face looks
 * out of the stand; within each piece's tiles.
 *
 * @example
 * // brazierGeometry(level, descriptor.pieces, 0, 0.75): the hall's thirty braziers
 * @see engine/gfx/level/shapes.test.ts
 */
import type { BufferGeometry } from 'three/webgpu';
import type { CompiledLevel, TileRect } from '../../world/level/types';
import { normalize, type Vec3 } from '../geometry/writer';
import { polygon, slotted, upright, type Ground } from './faces';
import { surfaceGeometry } from './surface';

/** The bowl's sides. */
const BOWL_SIDES = 10;
/** The radius of a glyph without one, as a share of the tile: the hall brazier's. */
const RADIUS = 0.3125;

/** The bowl's ring of corners at height `y`, `r` from (cx, cz) to its corners, a flat side facing +Z. */
function ring(cx: number, cz: number, r: number, y: number): Vec3[] {
  return Array.from({ length: BOWL_SIDES }, (_, j) => {
    const angle = Math.PI / BOWL_SIDES + (2 * Math.PI * j) / BOWL_SIDES;
    return [cx + r * Math.sin(angle), y, cz + r * Math.cos(angle)];
  });
}

/** The stands on `pieces` of `level`, from `bottom` to `top` (m), and the ground under them (see the file comment). */
export function brazierGeometry(
  level: Pick<CompiledLevel, 'tile' | 'cols' | 'tiles' | 'legend'>,
  pieces: readonly TileRect[],
  bottom: number,
  top: number,
): BufferGeometry {
  const writers = slotted();
  const [stand, coals] = [writers.slot(0), writers.slot(1)];
  const height = top - bottom;
  for (const [c0, r0, c1, r1] of pieces) {
    const glyph = level.legend[level.tiles[r0 * level.cols + c0]];
    const r = glyph.radius > 0 ? glyph.radius : RADIUS * level.tile;
    const [cx, cz] = [((c0 + c1 + 1) / 2) * level.tile, ((r0 + r1 + 1) / 2) * level.tile];
    const [y1, y2] = [bottom + (height * 2) / 3, bottom + (height * 11) / 12];
    // The foot: four upright faces, each running so that it looks out (faces.ts's `upright`).
    const f = 0.6 * r;
    const corner = (dx: number, dz: number): Ground => [cx + dx * f, cz + dz * f];
    upright(stand, corner(-1, 1), corner(1, 1), bottom, y1);
    upright(stand, corner(1, 1), corner(1, -1), bottom, y1);
    upright(stand, corner(1, -1), corner(-1, -1), bottom, y1);
    upright(stand, corner(-1, -1), corner(-1, 1), bottom, y1);
    // The bowl: its sides, its underside and the coals on top.
    const [lower, upper] = [ring(cx, cz, 0.84 * r, y1), ring(cx, cz, 1.1 * r, y2)];
    for (let j = 0; j < BOWL_SIDES; j++) {
      const next = (j + 1) % BOWL_SIDES;
      const quad = [lower[j], lower[next], upper[next], upper[j]];
      const out = normalize([(lower[j][0] + lower[next][0]) / 2 - cx, 0, (lower[j][2] + lower[next][2]) / 2 - cz]);
      polygon(
        stand,
        quad,
        quad.map(([x, y, z]) => [x * out[2] - z * out[0], y] as const),
        out,
      );
    }
    const flat = (points: Vec3[]) => points.map(([x, , z]) => [x, -z] as const);
    polygon(stand, lower, flat(lower), [0, -1, 0]);
    polygon(coals, upper, flat(upper), [0, 1, 0]);
  }
  return writers.build(pieces.length ? [{ slot: 2, geometry: surfaceGeometry(level.tile, pieces, bottom) }] : []);
}
