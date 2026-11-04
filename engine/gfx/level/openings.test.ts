/**
 * @file Unit tests for engine/gfx/level/openings.ts (T1; WP 13.14, WP 13.36): the wall over a storey's doors, windows
 * and low ceilings stands from each head to the full top, clipped under a pitched roof, and over an opening in a wall
 * its faces are faced with that wall's, tile by tile, their boards running on from the wall's foot; each door gets two
 * jambs and a head, each window a sill too, round the opening and out of the wall, lining its reveal `PROUD` and no
 * further, or, where a door's leaf hangs and there is room, meeting the leaf, a barrel and a stop at its hinge, so no
 * ray passes round it shut and its swing clears the frame, its fittings too; a railing gets posts at most 1 m apart and
 * two rails as wide as its tiles.
 * @see engine/gfx/level/openings.ts
 */
import { Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { compileLevel } from '../../world/level/compile';
import { DOOR_SWING, leafSide, type DoorLeaf } from '../../world/level/doorways';
import type { OpeningDescriptor } from '../../world/level/types';
import { frustumGeometry } from '../geometry/frustum';
import { boxBetween, FACING, FRAME, frameInsets, framesGeometry, headsGeometry, KNUCKLE, LEAST_LINING, POST_GAP, PROUD, railingGeometry, STOP, SWING_CLEAR, wallFacings } from './openings'; // prettier-ignore

const SHED = compileLevel(
  ['---', 'storey: ground', 'base: 0', 'height: 2.5', '---', '######', '#....:', '#....:', '##++##'].join('\n'),
  { file: 'shed.txt' },
);
const [GROUND] = SHED.storeys!;
/** A hall with a 1 m door on 0.25 m tiles (x 1 to 2, its wall z 0.5 to 0.75), as the house's are: a leaf hangs there. */
const HALL = compileLevel(
  ['---', 'tile: 0.25', '---', '---', 'storey: ground', 'base: 0', 'height: 3', '---', '############', '#..........#', '####++++####'].join('\n'), // prettier-ignore
  { file: 'hall.txt' },
);
/** The library's `prop:door` leaf: its body, and its straps 1 cm out of its +Z face (engine/gfx/level/runs.ts `doorLeaf`). */
const LEAF: DoorLeaf = { size: [0.9, 2.05, 0.045], reach: 0.0325 };
/** A shed's 1 m door in a 0.5 m wall, on 0.5 m tiles (labs/playground/levels/yard.ts's). */
const SHED_DOOR = compileLevel(['---', 'tile: 0.5', '---', '---', 'storey: ground', 'base: 0', 'height: 2.5', '---', '######', '#....#', '##++##'].join('\n')).openings![0]; // prettier-ignore
/** Where `leaf`'s points within `depth` (m) of the wall's middle stand along it, from its hinge, turned either way. */
function swept(leaf: DoorLeaf, depth: number, faces: readonly number[]): { angle: number; x: number; z: number }[] {
  const points: { angle: number; x: number; z: number }[] = [];
  for (let angle = -DOOR_SWING; angle <= DOOR_SWING + 1e-9; angle += 0.005)
    for (let u = 0; u <= leaf.size[0]; u += 0.005)
      for (const w of faces) {
        const [x, z] = [u * Math.cos(angle) - w * Math.sin(angle), u * Math.sin(angle) + w * Math.cos(angle)];
        if (Math.abs(z) < depth / 2 + PROUD) points.push({ angle, x, z });
      }
  return points;
}

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

  it("faces the wall over an opening in a wall with the wall's sides, out of the head's, its boards running on", () => {
    const wallAt = (c: number, r: number) => (SHED.legend[GROUND.tiles[r * SHED.cols + c]]?.solid ? 'wall' : undefined);
    const facings = wallFacings(SHED, GROUND, SHED.openings!, -0.01, wallAt);
    expect([...facings.keys()]).toEqual(['wall']);
    const facing = facings.get('wall')!;
    expect([facing.getIndex()!.count, facing.groups]).toEqual([4 * 2 * 6, []]); // two faces a tile, one draw group
    const [position, uv] = ['position', 'uv'].map((name) => facing.getAttribute(name));
    const index = facing.getIndex()!;
    const used = [...new Set(Array.from({ length: index.count }, (_, i) => index.getX(i)))];
    const t = SHED.tile;
    const near = (v: number, ...at: number[]) => at.some((face) => Math.abs(v - face) < 1e-5); // float32 positions
    // FACING out of the head's faces: the door's (row 3, along x) and the window's (column 5, along z)
    const off = used.filter((i) => !near(position.getZ(i), 3 * t - FACING, 4 * t + FACING) && !near(position.getX(i), 5 * t - FACING, 6 * t + FACING)); // prettier-ignore
    expect(off.map((i) => [position.getX(i), position.getY(i), position.getZ(i)])).toEqual([]);
    for (const i of used) expect(uv.getY(i)).toBeCloseTo(position.getY(i) + 0.01, 6); // v from the wall's foot
    expect(headsGeometry(SHED, GROUND)).not.toBeNull(); // the head keeps its top, underside and shadow
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
    // Nothing of a frame further inside an opening than the lining of its reveal, `PROUD` (WP 13.36: the jambs and the
    // head had stood in the plane of the wall's cut ends, z-fighting): what bodies pass through is what shows.
    const position = frames.getAttribute('position');
    const t = SHED.tile;
    for (const {
      kind,
      tiles: [c0, r0, c1, r1],
      bottom,
      top,
    } of SHED.openings!) {
      const within = (v: number, lo: number, hi: number) => v > lo + 1e-6 && v < hi - 1e-6;
      const foot = kind === 'window' ? bottom + PROUD : bottom;
      const inside = Array.from({ length: position.count }, (_, i) => i).filter((i) => within(position.getX(i), c0 * t + PROUD, (c1 + 1) * t - PROUD) && within(position.getZ(i), r0 * t, (r1 + 1) * t) && within(position.getY(i), foot, top - PROUD)); // prettier-ignore
      expect(inside, `the opening at ${c0}, ${r0}`).toEqual([]);
    }
    expect(frameInsets(SHED.openings![0])).toEqual({ hinge: PROUD, latch: PROUD, head: PROUD, hung: false });
  });

  it('frames a door a leaf hangs in to meet it shut, a barrel at its hinge: no ray passes round it, its swing clears', () => {
    const [door] = HALL.openings!;
    const side = leafSide(door, LEAF.size);
    const half = LEAF.size[2] / 2;
    const insets = frameInsets(door, LEAF);
    expect(insets).toEqual({ hinge: expect.any(Number), latch: side, head: expect.closeTo(0.05, 9), hung: true });
    expect(insets.hinge > LEAST_LINING && insets.hinge < PROUD).toBe(true); // as deep as its swing leaves room for
    const frames = framesGeometry(HALL.openings!, HALL.tile, LEAF)!;
    const radius = (half + KNUCKLE) / Math.cos(Math.PI / 12);
    const barrel = frustumGeometry({ radiusBottom: radius, radiusTop: radius, height: LEAF.size[1], radialSegments: 12 }); // prettier-ignore
    expect(frames.getAttribute('position').count).toBe(4 * 24 + barrel.getAttribute('position').count); // and its stop
    // The leaf shut, as engine/sim/doors.ts hangs it: centred in the opening, through the wall's middle, on its floor.
    const [a0, a1, mid] = [1, 2, 0.625];
    const leaf = boxBetween(a0 + side, 0, mid - half, a1 - side, LEAF.size[1], mid + half);
    const material = new MeshBasicMaterial();
    const solid = [new Mesh(frames, material), new Mesh(leaf, material)];
    // Rays at the wall's middle plane over the opening, straight and slanting both ways, from both sides.
    const ray = new Raycaster();
    const through: string[] = [];
    for (let x = a0 - 0.02; x <= a1 + 0.02; x += 0.01)
      for (let y = 0.01; y < door.top + 0.02; y += 0.01)
        for (const [dx, dy] of [
          [0, 0],
          [0.6, 0],
          [-0.6, 0],
          [0, 0.6],
          [0, -0.6],
        ])
          // prettier-ignore
          for (const dz of [1, -1]) {
            const direction = new Vector3(dx, dy, dz).normalize();
            ray.set(new Vector3(x, y, mid).addScaledVector(direction, -1), direction);
            if (!ray.intersectObjects(solid).length) through.push(`(${x.toFixed(2)}, ${y.toFixed(2)}) along ${direction.toArray().map((v) => v.toFixed(2))}`); // prettier-ignore
          }
    expect(through).toEqual([]);
    // Its swing: every point of the leaf and its fittings, turned about its hinge either way, stays out of the jambs
    // within the frame's depth (the latch's 0.28 mm at the first degrees, its corner's arc, under a pixel, allowed),
    // and out of its stop; the head stands over its top.
    for (const { angle, x, z } of swept(LEAF, HALL.tile, [-LEAF.reach, LEAF.reach]))
      expect(x > insets.hinge - side && x < 1 - side - insets.latch + 0.0003 + 1e-9, `the leaf at ${angle.toFixed(3)} rad`).toBe(Math.abs(z) < HALL.tile / 2 + PROUD); // prettier-ignore
    for (const { angle, x, z } of swept(LEAF, HALL.tile, [-half, half]))
      if (Math.abs(z) < STOP / 2) expect(x > -half - SWING_CLEAR, `the stop at ${angle.toFixed(3)} rad`).toBe(true);
  });

  it('meets a leaf in a deep wall as far as its swing leaves room, and frames one with no room to meet as plain', () => {
    const deep = frameInsets(SHED_DOOR, LEAF); // a 1 m door in a 0.5 m wall, the shed's
    expect([deep.hung, deep.hinge]).toEqual([true, LEAST_LINING]);
    const side = leafSide(SHED_DOOR, LEAF.size);
    for (const { angle, x } of swept(LEAF, SHED_DOOR.depth, [-LEAF.size[2] / 2, LEAF.size[2] / 2]))
      expect(x > deep.hinge - side, `the leaf at ${angle.toFixed(3)} rad`).toBe(true); // its body clears; its straps reach the lining (ADR-0025 amendment 54)
    const door = (width: number, top = 2.1) => ({ ...SHED_DOOR, width, top }) as OpeningDescriptor;
    for (const width of [0.9, 0.95]) expect(frameInsets(door(width), LEAF).hung, `${width} m`).toBe(false); // no room: plain
    expect(frameInsets(door(0.97), LEAF).hung).toBe(true);
    expect(frameInsets(door(1, 2.055), LEAF)).toEqual({
      hinge: LEAST_LINING,
      latch: expect.closeTo(0.05, 9),
      head: expect.closeTo(0.005, 9),
      hung: true,
    }); // its head on the leaf's top // prettier-ignore // its head on the leaf's top
    for (const width of [0.9, 0.95, 0.97])
      expect(() => framesGeometry([door(width)], 0.5, LEAF), `${width} m`).not.toThrow();
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
