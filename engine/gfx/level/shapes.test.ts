/**
 * @file Unit tests for the v2 level shapes (engine/gfx/level/shapes.ts, stairs.ts, slab.ts, dais.ts, brazier.ts,
 * faces.ts), in Node on the hall (labs/box/levels/hall.txt): its eight meshes clean by the QA measures and inside the
 * level's bounds, in 15 draw calls, 24 with a shadow map; each flight of stairs one solid of ten steps, every tread
 * at the ramp's height at its middle; the gallery's walk 1 m up and its sides along the outline only, facing out;
 * the dais on its hull's very corners; thirty brazier stands; no hole in the ground at any corner of a v2 glyph's
 * tiles; and, split into runs as the stage splits them (engine/gfx/stage.ts), each flight and the dais drawn once.
 * @see engine/gfx/level/shapes.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Box3, MeshBasicMaterial, Raycaster, Vector3, type BufferGeometry, type Object3D } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { compileLevel } from '../../world/level/compile';
import { floorHeight } from '../../world/level/heights';
import { frustumPoints } from '../../world/level/shapes';
import { inspectGeometry } from '../geometry/inspect';
import { createLevelMeshes } from './meshes';
import { splitRuns } from './runs';
import { slabGeometry } from './slab';
import { STEP_RUN, stepsOf } from './stairs';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const hall = compileLevel(readFileSync(join(ROOT, 'labs', 'box', 'levels', 'hall.txt'), 'utf8'), { file: 'hall.txt' });
const material = new MeshBasicMaterial();
const meshes = createLevelMeshes(hall, { materials: { get: () => material } });
const part = (recipe: string) => meshes.parts.find((each) => each.recipe === recipe)!;

/** The triangles of `geometry`'s group `group` as corner triples [x, y, z][3], with their face normals. */
function triangles(geometry: BufferGeometry, group: number) {
  const p = geometry.getAttribute('position');
  const n = geometry.getAttribute('normal');
  const index = geometry.getIndex()!;
  const { start, count } = geometry.groups[group] ?? { start: 0, count: index.count };
  return Array.from({ length: count / 3 }, (_, t) => {
    const ids = [0, 1, 2].map((k) => index.getX(start + t * 3 + k));
    return {
      corners: ids.map((i) => [p.getX(i), p.getY(i), p.getZ(i)]),
      normal: [n.getX(ids[0]), n.getY(ids[0]), n.getZ(ids[0])],
    };
  });
}

describe('the hall in v2 shapes', () => {
  it('draws eight meshes, clean by the QA measures and inside its bounds, in 15 calls, 24 with a shadow map', () => {
    expect(meshes.parts.map(({ name, shape, mesh }) => [name, shape, mesh.castShadow])).toEqual([
      ['level:hall/brazier', 'brazier', false],
      ['level:hall/dais', 'dais', false],
      ['level:hall/floor', 'surface', false],
      ['level:hall/gallery', 'slab', true],
      ['level:hall/lowWall', 'block', true],
      ['level:hall/pillar', 'pillar', true],
      ['level:hall/stairs', 'stairs', true],
      ['level:hall/wall', 'block', true],
    ]);
    for (const { name, mesh } of meshes.parts) {
      const report = inspectGeometry(mesh.geometry);
      expect(
        [report.missing, report.badIndex, report.nonFinite, report.degenerate, report.badNormals, report.flipped],
        name,
      ).toEqual([[], 0, 0, 0, 0, 0]);
    }
    const box = new Box3().setFromObject(meshes.root, true);
    expect([box.min.toArray(), box.max.toArray()]).toEqual([[...hall.bounds.min], [...hall.bounds.max]]);
    // brazier 3, dais 2, floor 1, gallery 2, low walls 2, pillars 2, stairs 1, walls 2; casting: 2 + 2 + 2 + 1 + 2.
    expect([meshes.drawCalls(), meshes.drawCalls(1)]).toEqual([15, 24]);
  });

  it('draws each flight of stairs as one solid of ten steps, every tread at the ramp’s height at its middle', () => {
    const stairs = part('stairs').mesh.geometry;
    expect(hall.ramps.map((ramp) => stepsOf(ramp, hall.tile))).toEqual([10, 10]);
    expect(STEP_RUN).toBe(0.5);
    // Per flight: 10 treads and 10 risers (4 corners each), the back, and two sides of 2 · 10 + 2 corners.
    expect(inspectGeometry(stairs)).toMatchObject({ vertices: 2 * (80 + 4 + 44), min: [11, 0, 5] });
    expect(inspectGeometry(stairs).max.map((x) => +x.toFixed(6))).toEqual([54, 0.95, 10]);
    // Every tread is a 3 × 0.5 m rectangle; at its middle, the ramp (the hull the feet stand on) is at its height.
    const tops = triangles(stairs, 0).filter(({ normal }) => normal[1] === 1);
    expect(tops.length).toBe(2 * 10 * 2);
    for (const { corners } of tops) {
      const [xs, zs] = [corners.map(([x]) => x), corners.map(([, , z]) => z)];
      const [cx, cz] = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2];
      expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(0.5, 9);
      expect(corners[0][1]).toBeCloseTo(floorHeight(hall, cx, cz), 6);
    }
    // Every face looks out of the flight: a step behind its face, open air before it. Both flights rise north, ten
    // 0.5 m steps over rows 5–9, step k (from the south) 0.1 · (k + ½) m high.
    const inside = ([x, y, z]: number[]) => {
      const ramp = hall.ramps.find(({ tiles: [c0, , c1] }) => x > c0 && x < c1 + 1);
      const k = Math.floor((10 - z) / STEP_RUN);
      return !!ramp && z > 5 && z < 10 && y > 0 && y < 0.1 * (k + 0.5);
    };
    for (const { corners, normal } of triangles(stairs, 0)) {
      const middle = [0, 1, 2].map((k) => corners.reduce((sum, c) => sum + c[k], 0) / 3);
      // A side's fan triangle can be long and thin: test it a third of the way from its far corner to the middle.
      const probe = middle.map((m, k) => (2 * m + corners[1][k]) / 3);
      const near = (sign: number) => probe.map((m, k) => m + sign * normal[k] * 1e-3);
      expect([inside(near(-1)), inside(near(1))], `${probe.map((x) => x.toFixed(3))}`).toEqual([true, false]);
    }
  });

  it('draws the gallery as its walk 1 m up and its sides along the outline only, each facing out', () => {
    const gallery = part('gallery').mesh;
    const [sides, walk] = [triangles(gallery.geometry, 0), triangles(gallery.geometry, 1)];
    // Two 20 × 4 galleries: 2 · 21 · 5 walk corners; 2 · 48 outline edges, one quad each.
    expect(inspectGeometry(gallery.geometry).vertices).toBe(2 * 105 + 2 * 48 * 4);
    expect([sides.length, walk.length]).toEqual([2 * 48 * 2, 2 * 80 * 2]);
    expect(walk.every(({ corners }) => corners.every(([, y]) => y === 1))).toBe(true);
    const isGallery = (x: number, z: number) => hall.tiles[Math.floor(z) * hall.cols + Math.floor(x)] === '=';
    for (const { corners, normal } of sides) {
      const [mx, mz] = [0, 2].map((k) => corners.reduce((sum, c) => sum + c[k], 0) / 3);
      expect(isGallery(mx - normal[0] * 0.01, mz - normal[2] * 0.01)).toBe(true);
      expect(isGallery(mx + normal[0] * 0.01, mz + normal[2] * 0.01)).toBe(false);
    }
    expect(
      slabGeometry(
        1,
        [
          [0, 0, 0, 0],
          [1, 0, 1, 0],
        ],
        0,
        1,
      ).groups.map((group) => group.count),
    ).toEqual([36, 12]);
  });

  it("stands the dais on its hull's corners, its top 0.5 m up", () => {
    const [dais] = hall.daises;
    const geometry = part('dais').mesh.geometry;
    const p = geometry.getAttribute('position');
    const corners = new Set(Array.from({ length: p.count }, (_, i) => [p.getX(i), p.getY(i), p.getZ(i)].join(',')));
    for (const point of frustumPoints(dais)) expect(corners.has(point.map((x) => Math.fround(x)).join(','))).toBe(true);
    // The edge: 8 sloped quads (slot 0); the top, and the ground under the dais's tiles (slot 1).
    expect(triangles(geometry, 0).length).toBe(16);
    expect(inspectGeometry(geometry)).toMatchObject({ min: [26.5, 0, 16.5], max: [37.5, 0.5, 27.5] });
    // The edge looks out and up, away from the dais's centre.
    for (const { corners, normal } of triangles(geometry, 0)) {
      const [mx, mz] = [0, 2].map((k) => corners.reduce((sum, c) => sum + c[k], 0) / 3);
      expect(normal[0] * (mx - dais.center[0]) + normal[2] * (mz - dais.center[1])).toBeGreaterThan(0);
      expect(normal[1]).toBeGreaterThan(0);
    }
  });

  it('stands thirty braziers, each a foot and a bowl of glowing coals within its tile', () => {
    const brazier = part('brazier');
    expect(brazier.glyphs).toEqual(['glyph:brazier']);
    const geometry = brazier.mesh.geometry;
    expect(geometry.groups.map((group) => group.materialIndex)).toEqual([0, 1, 2]);
    const coals = triangles(geometry, 1);
    // Ten-sided coals: 8 triangles each.
    expect(coals.length).toBe(30 * 8);
    expect(coals.every(({ corners }) => corners.every(([, y]) => y === 0.6875))).toBe(true);
    const [low, high] = [inspectGeometry(geometry).min, inspectGeometry(geometry).max];
    expect([low[1], high[1]]).toEqual([0, 0.6875]);
    // The foot and the bowl look out from the stand's axis, the bowl's underside down.
    const torches = new Set(hall.lights.map(({ col, row }) => `${col},${row}`));
    for (const { corners, normal } of triangles(geometry, 0)) {
      const [mx, my, mz] = [0, 1, 2].map((k) => corners.reduce((sum, c) => sum + c[k], 0) / 3);
      const [cx, cz] = [Math.floor(mx) + 0.5, Math.floor(mz) + 0.5];
      expect(torches.has(`${Math.floor(mx)},${Math.floor(mz)}`)).toBe(true);
      if (normal[1] === -1) expect(my).toBeCloseTo(0.5, 6);
      else expect(normal[0] * (mx - cx) + normal[2] * (mz - cz)).toBeGreaterThan(0);
    }
  });

  it("leaves no hole in the ground at the corners of any v2 glyph's tiles", () => {
    const ray = new Raycaster();
    const targets: Object3D[] = ['floor', 'gallery', 'stairs', 'dais', 'brazier'].map((recipe) => part(recipe).mesh);
    const down = new Vector3(0, -1, 0);
    let rays = 0;
    for (let row = 0; row < hall.rows; row++) {
      for (let col = 0; col < hall.cols; col++) {
        if (!'=^ot'.includes(hall.tiles[row * hall.cols + col])) continue;
        for (const [dx, dz] of [
          [0.02, 0.02],
          [0.98, 0.02],
          [0.02, 0.98],
          [0.98, 0.98],
          [0.5, 0.5],
        ]) {
          ray.set(new Vector3(col + dx, 5, row + dz), down);
          rays++;
          expect(ray.intersectObjects(targets, false).length, `${col + dx}, ${row + dz}`).toBeGreaterThan(0);
        }
      }
    }
    const count = (char: string) => hall.tiles.filter((each) => each === char).length;
    expect([count('='), count('^'), count('o'), count('t')]).toEqual([160, 30, 87, 30]);
    expect(rays).toBe(5 * (160 + 30 + 87 + 30));
  });

  it('split into runs as the stage splits it, draws each flight and the dais once', () => {
    const split = createLevelMeshes(splitRuns(hall).level, { materials: { get: () => material } });
    const stairs = split.parts.filter((each) => each.recipe === 'stairs');
    expect(stairs.map((each) => inspectGeometry(each.mesh.geometry).vertices)).toEqual([128, 128]);
    const daises = split.parts.filter((each) => each.recipe === 'dais');
    expect(daises.length).toBeGreaterThan(1);
    expect(daises.filter((each) => inspectGeometry(each.mesh.geometry).max[1] === 0.5)).toHaveLength(1);
  });
});
