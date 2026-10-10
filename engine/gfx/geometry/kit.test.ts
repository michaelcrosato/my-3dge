/**
 * @file Unit tests for the geometry kit (engine/gfx/geometry/: box, roundedBox, limb, ramp, frustum, pillar, ring,
 * groups, writer, inspect, checks), in Node: each builder's vertex and triangle counts, its bounds, its normals (of
 * length 1, agreeing with the winding, and outward: a closed shape's signed volume, positive only when every face
 * points out, equals its volume computed by hand), its UVs in metres, and the QA measures all clean; `sidesThenTops`'
 * two groups; `mergeGeometries`; `GFX_BAD_GEOMETRY` for sizes a builder cannot build; and `inspectGeometry` counting
 * seeded faults.
 * @see engine/gfx/geometry/box.ts
 * @see engine/gfx/geometry/inspect.ts
 */
import { BufferAttribute, BufferGeometry, Float32BufferAttribute } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { boxGeometry } from './box';
import { frustumGeometry } from './frustum';
import { mergeGeometries, sidesThenTops } from './groups';
import { inspectGeometry, type GeometryReport } from './inspect';
import { limbGeometry } from './limb';
import { pillarGeometry, pillarParts } from './pillar';
import { rampGeometry } from './ramp';
import { ringGeometry } from './ring';
import { roundedBoxGeometry } from './roundedBox';

/** The signed volume enclosed by `geometry`'s triangles: positive when they all face out of a closed shape. */
function signedVolume(geometry: BufferGeometry): number {
  const p = geometry.getAttribute('position');
  const index = Array.from(geometry.getIndex()!.array as ArrayLike<number>);
  let sum = 0;
  for (let t = 0; t < index.length; t += 3) {
    const [a, b, c] = [index[t], index[t + 1], index[t + 2]].map((i) => [p.getX(i), p.getY(i), p.getZ(i)]);
    sum += a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
  }
  return sum / 6;
}

/** The report's fault counts, which must all be 0. */
const faults = (report: GeometryReport) => ({
  missing: report.missing,
  badIndex: report.badIndex,
  nonFinite: report.nonFinite,
  degenerate: report.degenerate,
  badNormals: report.badNormals,
  flipped: report.flipped,
});
const CLEAN = { missing: [], badIndex: 0, nonFinite: 0, degenerate: 0, badNormals: 0, flipped: 0 };

/** How many vertex normals of a convex shape point towards the mean of its vertices (a point inside it): 0. */
function outward(geometry: BufferGeometry): number {
  const p = geometry.getAttribute('position');
  const n = geometry.getAttribute('normal');
  const centre = [0, 0, 0];
  for (let i = 0; i < p.count; i++) [p.getX(i), p.getY(i), p.getZ(i)].forEach((x, k) => (centre[k] += x / p.count));
  let inward = 0;
  for (let i = 0; i < p.count; i++) {
    const d = [p.getX(i) - centre[0], p.getY(i) - centre[1], p.getZ(i) - centre[2]];
    if (d[0] * n.getX(i) + d[1] * n.getY(i) + d[2] * n.getZ(i) <= 0) inward++;
  }
  return inward;
}

/** The largest u and v of the vertices `first` to `first + count`. */
function uvSpan(geometry: BufferGeometry, first: number, count: number): [number, number] {
  const uv = geometry.getAttribute('uv');
  let [u, v] = [0, 0];
  for (let i = first; i < first + count; i++) [u, v] = [Math.max(u, uv.getX(i)), Math.max(v, uv.getY(i))];
  return [u, v];
}

/** The polygon area of `n` sides with corner radius `r`. */
const polygon = (n: number, r: number) => (n / 2) * r * r * Math.sin((2 * Math.PI) / n);

describe('boxGeometry', () => {
  it('stands on the ground with 24 vertices, 12 triangles, outward flat normals and UVs in metres', () => {
    const box = boxGeometry({ width: 2, height: 3, depth: 1 });
    const report = inspectGeometry(box);
    expect([report.vertices, report.triangles]).toEqual([24, 12]);
    expect(faults(report)).toEqual(CLEAN);
    expect([report.min, report.max]).toEqual([
      [-1, 0, -0.5],
      [1, 3, 0.5],
    ]);
    expect(signedVolume(box)).toBeCloseTo(6, 6);
    expect(outward(box)).toBe(0);
    // Faces in BoxGeometry's order (+X, -X, +Y, -Y, +Z, -Z), UVs spanning each face in metres.
    expect([0, 1, 2, 3, 4, 5].map((face) => uvSpan(box, face * 4, 4))).toEqual([
      [1, 3],
      [1, 3],
      [2, 1],
      [2, 1],
      [2, 3],
      [2, 3],
    ]);
    expect(box.groups.map((group) => group.materialIndex)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('keeps BoxGeometry’s face orientation: u to the right and v up, seen from outside', () => {
    const box = boxGeometry();
    const p = box.getAttribute('position');
    const uv = box.getAttribute('uv');
    // The +Z face's corner with UV (0, 0) is its lower left seen from +Z: x -0.5, y 0.
    const corner = [16, 17, 18, 19].find((i) => uv.getX(i) === 0 && uv.getY(i) === 0)!;
    expect([p.getX(corner), p.getY(corner), p.getZ(corner)]).toEqual([-0.5, 0, 0.5]);
    // The top's v runs towards -Z.
    const top = [8, 9, 10, 11].find((i) => uv.getX(i) === 0 && uv.getY(i) === 0)!;
    expect([p.getX(top), p.getZ(top)]).toEqual([-0.5, 0.5]);
  });
});

describe('roundedBoxGeometry', () => {
  it('rounds every edge with smooth outward normals, keeping the bounds and the volume of the rounded shape', () => {
    const [w, h, d, r] = [1, 0.8, 0.6, 0.1];
    const shape = roundedBoxGeometry({ width: w, height: h, depth: d, radius: r, segments: 2 });
    const report = inspectGeometry(shape);
    expect([report.vertices, report.triangles]).toEqual([216, 300]);
    expect(faults(report)).toEqual(CLEAN);
    expect(report.min.map((x) => +x.toFixed(6))).toEqual([-0.5, 0, -0.3]);
    expect(report.max.map((x) => +x.toFixed(6))).toEqual([0.5, 0.8, 0.3]);
    expect(outward(shape)).toBe(0);
    const [a, b, c] = [w - 2 * r, h - 2 * r, d - 2 * r];
    const exact =
      a * b * c + 2 * r * (a * b + a * c + b * c) + Math.PI * r * r * (a + b + c) + (4 / 3) * Math.PI * r ** 3;
    expect(signedVolume(shape) / exact).toBeGreaterThan(0.995);
    expect(signedVolume(shape) / exact).toBeLessThanOrEqual(1);
  });

  it('rounds a side completely at half its size, and is a box at radius 0', () => {
    const slab = roundedBoxGeometry({ width: 1, height: 0.4, depth: 1, radius: 0.2, segments: 3 });
    expect(faults(inspectGeometry(slab))).toEqual(CLEAN);
    expect(inspectGeometry(slab).vertices).toBe(352);
    expect(inspectGeometry(roundedBoxGeometry({ radius: 0 })).vertices).toBe(24);
    expect(() => roundedBoxGeometry({ height: 0.4, radius: 0.3 })).toThrow(
      /GFX_BAD_GEOMETRY.*radius 0\.3 is above half/,
    );
  });
});

describe('limbGeometry', () => {
  it('is the smooth hull of two spheres, from -radiusStart to length + radiusEnd up +Y', () => {
    const limb = limbGeometry({ length: 0.4, radiusStart: 0.06, radiusEnd: 0.04, radialSegments: 8, capSegments: 3 });
    const report = inspectGeometry(limb);
    expect([report.vertices, report.triangles]).toEqual([72, 96]);
    expect(faults(report)).toEqual(CLEAN);
    expect(report.min[1]).toBeCloseTo(-0.06, 6);
    expect(report.max[1]).toBeCloseTo(0.44, 6);
    expect(
      Math.max(...report.max.filter((_, k) => k !== 1), ...report.min.filter((_, k) => k !== 1).map(Math.abs)),
    ).toBeLessThanOrEqual(0.06);
    expect(outward(limb)).toBe(0);
  });

  it('is a capsule for equal radii, its volume within the 12-gon’s share of the round one', () => {
    const capsule = limbGeometry({ length: 1, radiusStart: 0.2, radiusEnd: 0.2 });
    expect(faults(inspectGeometry(capsule))).toEqual(CLEAN);
    const round = Math.PI * 0.04 * 1 + (4 / 3) * Math.PI * 0.008;
    const share = polygon(12, 1) / Math.PI;
    expect(signedVolume(capsule) / round).toBeGreaterThan(share * 0.97);
    expect(signedVolume(capsule) / round).toBeLessThan(1);
  });

  it('refuses a limb no longer than the difference of its radii', () => {
    expect(() => limbGeometry({ length: 0.1, radiusStart: 0.2, radiusEnd: 0.05 })).toThrow(
      /GFX_BAD_GEOMETRY.*limb: its length 0\.1 is not above the difference of its radii/,
    );
  });
});

describe('rampGeometry', () => {
  it('rises towards +Z with flat faces, 24 vertices, or 18 as a wedge', () => {
    const ramp = rampGeometry({ width: 2, depth: 4, low: 0.5, high: 1 });
    const wedge = rampGeometry({ width: 2, depth: 4, low: 0, high: 1 });
    for (const [shape, counts, volume] of [
      [ramp, [24, 12], 6],
      [wedge, [18, 8], 4],
    ] as const) {
      const report = inspectGeometry(shape);
      expect([report.vertices, report.triangles]).toEqual(counts);
      expect(faults(report)).toEqual(CLEAN);
      expect([report.min, report.max]).toEqual([
        [-1, 0, -2],
        [1, 1, 2],
      ]);
      expect(signedVolume(shape)).toBeCloseTo(volume, 6);
      expect(outward(shape)).toBe(0);
    }
    // The slope's first vertex is its low -X corner, its normal up and back towards -Z.
    const n = ramp.getAttribute('normal');
    expect([n.getX(0), n.getY(0), n.getZ(0)].map((x) => +x.toFixed(6))).toEqual([
      0,
      +(4 / Math.hypot(4, 0.5)).toFixed(6),
      +(-0.5 / Math.hypot(4, 0.5)).toFixed(6),
    ]);
    // UVs in metres along the slope.
    expect(uvSpan(ramp, 0, 4).map((x) => +x.toFixed(6))).toEqual([2, +Math.hypot(4, 0.5).toFixed(6)]);
    expect(() => rampGeometry({ low: 2, high: 1 })).toThrow(/GFX_BAD_GEOMETRY.*low 2 is above high 1/);
  });
});

describe('frustumGeometry', () => {
  it('is an octagon with a flat side facing +Z, flat sides and caps, and the volume of its polygons', () => {
    const dais = frustumGeometry({ radiusBottom: 2, radiusTop: 1.6, height: 0.5, radialSegments: 8 });
    const report = inspectGeometry(dais);
    expect([report.vertices, report.triangles]).toEqual([50, 32]);
    expect(faults(report)).toEqual(CLEAN);
    expect(report.max[2]).toBeCloseTo(2 * Math.cos(Math.PI / 8), 6);
    expect([report.min[1], report.max[1]]).toEqual([0, 0.5]);
    const [a1, a2] = [polygon(8, 2), polygon(8, 1.6)];
    expect(signedVolume(dais)).toBeCloseTo((0.5 / 3) * (a1 + a2 + Math.sqrt(a1 * a2)), 6);
    expect(outward(dais)).toBe(0);
  });

  it('makes cones and smooth frustums', () => {
    const cone = frustumGeometry({ radiusBottom: 1, radiusTop: 0, height: 2, radialSegments: 6 });
    expect(faults(inspectGeometry(cone))).toEqual(CLEAN);
    expect([inspectGeometry(cone).vertices, inspectGeometry(cone).triangles]).toEqual([25, 12]);
    expect(signedVolume(cone)).toBeCloseTo((polygon(6, 1) * 2) / 3, 6);
    const smooth = frustumGeometry({ radiusBottom: 1, radiusTop: 0.5, height: 2, radialSegments: 16, smooth: true });
    expect(faults(inspectGeometry(smooth))).toEqual(CLEAN);
    expect(outward(smooth)).toBe(0);
    const [a1, a2] = [polygon(16, 1), polygon(16, 0.5)];
    expect(signedVolume(smooth)).toBeCloseTo((2 / 3) * (a1 + a2 + Math.sqrt(a1 * a2)), 6);
    expect(() => frustumGeometry({ radialSegments: 2 })).toThrow(/GFX_BAD_GEOMETRY.*radialSegments is 2/);
  });
});

describe('pillarParts and pillarGeometry', () => {
  it("stacks the prototype's parts from 0 to the height, merged into two groups", () => {
    expect(pillarParts().map(({ name, width, from, to }) => [name, width, from, to])).toEqual([
      ['plinth', 2.125, 0, 0.375],
      ['shaft', 1.75, 0.375, 3],
      ['capital', 2.125, 3, 3.25],
      ['abacus', 2.375, 3.25, 3.5],
    ]);
    const pillar = pillarGeometry();
    const report = inspectGeometry(pillar);
    expect([report.vertices, report.triangles]).toEqual([96, 48]);
    expect(faults(report)).toEqual(CLEAN);
    expect([report.min, report.max]).toEqual([
      [-1.1875, 0, -1.1875],
      [1.1875, 3.5, 1.1875],
    ]);
    const volume = pillarParts().reduce((sum, part) => sum + part.width ** 2 * (part.to - part.from), 0);
    expect(signedVolume(pillar)).toBeCloseTo(volume, 6);
    expect(pillar.groups).toEqual([
      { start: 0, count: 96, materialIndex: 0 },
      { start: 96, count: 48, materialIndex: 1 },
    ]);
  });
});

describe('ringGeometry', () => {
  it('lies flat facing up, or stands as a band with its walls facing out and in', () => {
    const flat = ringGeometry({ innerRadius: 0.8, outerRadius: 1, radialSegments: 16 });
    const report = inspectGeometry(flat);
    expect([report.vertices, report.triangles]).toEqual([34, 32]);
    expect(faults(report)).toEqual(CLEAN);
    expect([report.min, report.max]).toEqual([
      [-1, 0, -1],
      [1, 0, 1],
    ]);
    const n = flat.getAttribute('normal');
    expect(Array.from({ length: n.count }, (_, i) => n.getY(i)).every((y) => y === 1)).toBe(true);
    const band = ringGeometry({ innerRadius: 0.8, outerRadius: 1, height: 0.3, radialSegments: 16 });
    expect(faults(inspectGeometry(band))).toEqual(CLEAN);
    expect(signedVolume(band)).toBeCloseTo((polygon(16, 1) - polygon(16, 0.8)) * 0.3, 6);
    const disc = ringGeometry({ innerRadius: 0, outerRadius: 1, radialSegments: 16 });
    expect(faults(inspectGeometry(disc))).toEqual(CLEAN);
    expect(inspectGeometry(disc).triangles).toBe(16);
    expect(() => ringGeometry({ innerRadius: 1, outerRadius: 1 })).toThrow(
      /GFX_BAD_GEOMETRY.*innerRadius 1 is not below/,
    );
  });
});

describe('sidesThenTops', () => {
  it('sorts triangles by their own normals into sides then tops, keeping each one and its winding', () => {
    const box = sidesThenTops(boxGeometry());
    expect(box.groups).toEqual([
      { start: 0, count: 24, materialIndex: 0 },
      { start: 24, count: 12, materialIndex: 1 },
    ]);
    expect(signedVolume(box)).toBeCloseTo(1, 6);
    const n = box.getAttribute('normal');
    const index = box.getIndex()!;
    const ups = Array.from({ length: 36 }, (_, k) => Math.abs(n.getY(index.getX(k))));
    expect(ups.slice(0, 24).every((y) => y === 0)).toBe(true);
    expect(ups.slice(24).every((y) => y === 1)).toBe(true);
    // A gentle slope is a top, a steep one a side; a shape with no tops gets no empty group.
    const gentle = sidesThenTops(rampGeometry({ depth: 4, high: 1 }));
    expect(gentle.groups.map((group) => group.count)).toEqual([12, 12]);
    const steep = sidesThenTops(rampGeometry({ depth: 1, high: 3 }));
    expect(steep.groups.map((group) => group.count)).toEqual([18, 6]);
    const ring = sidesThenTops(ringGeometry({ innerRadius: 0.5, height: 0.2, radialSegments: 8 }));
    expect(ring.groups.map((group) => group.materialIndex)).toEqual([0, 1]);
    const walls = new BufferGeometry();
    walls.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
    expect(sidesThenTops(walls).groups).toEqual([{ start: 0, count: 3, materialIndex: 0 }]);
  });
});

describe('mergeGeometries', () => {
  it('joins parts end to end, offsetting indices and groups, and refuses parts with other attributes', () => {
    const merged = mergeGeometries([boxGeometry(), boxGeometry({ width: 2 }).translate(0, 1, 0)]);
    const report = inspectGeometry(merged);
    expect([report.vertices, report.triangles]).toEqual([48, 24]);
    expect(faults(report)).toEqual(CLEAN);
    expect(merged.groups.length).toBe(12);
    expect(merged.groups[6]).toEqual({ start: 36, count: 6, materialIndex: 0 });
    expect(signedVolume(merged)).toBeCloseTo(3, 6);
    const bare = new BufferGeometry();
    bare.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
    expect(() => mergeGeometries([boxGeometry(), bare])).toThrow(/GFX_BAD_GEOMETRY.*part 1 has attributes position/);
    expect(() => mergeGeometries([])).toThrow(/GFX_BAD_GEOMETRY/);
  });
});

describe('the size checks', () => {
  it('refuses zero, negative and NaN sizes, naming the shape and what to pass', () => {
    expect(() => boxGeometry({ width: 0 })).toThrow(
      '[GFX_BAD_GEOMETRY] cannot build the box: width is 0: pass width in metres, above 0',
    );
    expect(() => boxGeometry({ depth: Number.NaN })).toThrow(/depth is NaN/);
    expect(() => ringGeometry({ height: -1 })).toThrow(/height in metres, at least 0/);
    expect(() => limbGeometry({ radialSegments: 2.5 })).toThrow(/radialSegments as a whole number, at least 3/);
  });
});

describe('inspectGeometry', () => {
  it('counts missing attributes, bad indices, NaN, degenerate triangles, bad normals and flipped windings', () => {
    const geometry = new BufferGeometry();
    // Triangle 0 is fine; 1 is wound against its normals; 2 is degenerate (two equal corners); 3 names vertex 9.
    geometry.setAttribute(
      'position',
      new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, Number.NaN, 0, 0], 3),
    );
    geometry.setAttribute('normal', new Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 2, 0, 0, 1], 3));
    geometry.setIndex(new BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 1, 0, 3, 1, 0, 1, 9]), 1));
    const report = inspectGeometry(geometry);
    expect(report).toMatchObject({
      vertices: 5,
      triangles: 4,
      missing: ['uv'],
      badIndex: 1,
      nonFinite: 1,
      degenerate: 1,
      badNormals: 1,
      flipped: 1,
      min: [0, 0, 0],
      max: [1, 1, 0],
    });
  });
});
