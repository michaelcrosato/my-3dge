/**
 * @file Unit tests for engine/gfx/level/openings.ts (T1; WP 13.14, WP 13.36): the wall over a storey's doors, windows
 * and low ceilings stands from each head to the full top, clipped under a pitched roof, and over an opening in a wall
 * it is that wall's, tile by tile, its boards running on from the wall's foot; each door gets two jambs and a head,
 * each window a sill too, round the opening and out of the wall, lining its reveal `PROUD` and no further, or, where a
 * door's leaf hangs, meeting the leaf, a barrel and a stop at its hinge, so no ray passes round it shut and its swing
 * clears the frame; a railing gets posts at most 1 m apart and two rails as wide as its tiles.
 * @see engine/gfx/level/openings.ts
 */
import { Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { compileLevel } from '../../world/level/compile';
import { leafSide } from '../../world/level/doorways';
import { frustumGeometry } from '../geometry/frustum';
import { boxBetween, FRAME, frameInsets, framesGeometry, headsGeometry, KNUCKLE, POST_GAP, PROUD, railingGeometry, STOP, SWING_CLEAR, wallHeads } from './openings'; // prettier-ignore

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
/** The library's `prop:door` leaf, `[width, height, depth]` (m). */
const LEAF = [0.9, 2.05, 0.045] as const;

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

  it("draws the wall over an opening in a wall as that wall's pieces, its boards running on from the wall's foot", () => {
    const wallAt = (c: number, r: number) => (SHED.legend[GROUND.tiles[r * SHED.cols + c]]?.solid ? 'wall' : undefined);
    const { recipes, tiles } = wallHeads(SHED, GROUND, SHED.openings!, -0.01, wallAt);
    expect([...recipes.keys()]).toEqual(['wall']);
    expect(tiles.size).toBe(2 + 2); // the door's two tiles and the window's two
    const heads = recipes.get('wall')!;
    expect(heads.getAttribute('position').count).toBe(4 * 24); // a box a tile, as the wall's pieces are
    expect(heads.groups).toEqual([]); // one draw call: only its sides show, under the floor and over the frame's head
    const [position, normal, uv] = ['position', 'normal', 'uv'].map((name) => heads.getAttribute(name));
    for (let i = 0; i < position.count; i++)
      if (Math.abs(normal.getY(i)) < 1e-6) expect(uv.getY(i)).toBeCloseTo(position.getY(i) + 0.01, 6); // v from the foot
    expect(headsGeometry(SHED, GROUND, undefined, (c, r) => tiles.has(r * SHED.cols + c))).toBeNull(); // drawn there instead
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
    const side = leafSide(door, LEAF);
    const half = LEAF[2] / 2;
    const insets = frameInsets(door, LEAF);
    expect(insets).toEqual({ hinge: PROUD, latch: side, head: expect.closeTo(0.05, 9), hung: true });
    const frames = framesGeometry(HALL.openings!, HALL.tile, LEAF)!;
    const barrel = frustumGeometry({ radiusBottom: half + KNUCKLE, radiusTop: half + KNUCKLE, height: LEAF[1], radialSegments: 12 }); // prettier-ignore
    expect(frames.getAttribute('position').count).toBe(4 * 24 + barrel.getAttribute('position').count); // and its stop
    // The leaf shut, as engine/sim/doors.ts hangs it: centred in the opening, through the wall's middle, on its floor.
    const [a0, a1, mid] = [1, 2, 0.625];
    const leaf = boxBetween(a0 + side, 0, mid - half, a1 - side, LEAF[1], mid + half);
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
          for (const dz of [1, -1]) {
            const direction = new Vector3(dx, dy, dz).normalize();
            ray.set(new Vector3(x, y, mid).addScaledVector(direction, -1), direction);
            if (!ray.intersectObjects(solid).length) through.push(`(${x.toFixed(2)}, ${y.toFixed(2)}) along ${direction.toArray().map((v) => v.toFixed(2))}`); // prettier-ignore
          }
    expect(through).toEqual([]);
    // Its swing: every point of the leaf turned about its hinge, either way, stays out of the jambs while it is
    // within the wall's depth (the frame's 0.25 m and PROUD each side); the head stands over its top.
    const hinge = a0 + side;
    const within = HALL.tile / 2 + PROUD;
    for (let angle = -1.65; angle <= 1.65; angle += 0.01)
      for (let u = 0; u <= LEAF[0]; u += 0.01)
        for (const w of [-half, half]) {
          const [x, z] = [hinge + u * Math.cos(angle) - w * Math.sin(angle), u * Math.sin(angle) + w * Math.cos(angle)];
          if (Math.abs(z) < within) expect(x > a0 + insets.hinge && x < a1 - insets.latch + 0.001, `the leaf at ${angle.toFixed(2)} rad`).toBe(true); // prettier-ignore
          if (Math.abs(z) < STOP / 2) expect(x > hinge - half - SWING_CLEAR, `the stop at ${angle.toFixed(2)} rad`).toBe(true); // prettier-ignore
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
