/**
 * @file Roofs (PLAN.md WP 13.13; docs/PLAYGROUND.md §2.1, §6.1): the roof a storey's block gives (`roof: gable`,
 * `hip` or `flat`), over the bounds of the storey's floored tiles and `eaves` past them. `makeRoof` builds the
 * descriptor; `roofHeight(roof, x, z)` is its top's height there, the walkable slope (bodies stand on roofs), and
 * `roofUnder` its underside, which the walls under it rise to; `roofColliders` is its slab as convex hulls (a gable's
 * two planes, a hip's four, a flat roof's one box); `wallUnder` is the hull of a wall under it, clipped to its
 * underside, so a gable's end walls close the attic and no wall stands through the roof.
 *
 * A pitched roof's top meets the storey's ceiling at the footprint's edge (its floor, for an attic, which gives no
 * height) and rises `slope` metres per metre inward: a gable from its two long sides (or the sides across `ridge`) to
 * the ridge, a hip from all four sides to a ridge along the longer side; past the footprint, over the eaves, it keeps
 * falling. A flat roof is a slab on the storey's ceiling. The slab is `ROOF_THICKNESS` deep, measured straight down,
 * so its underside is its top less that.
 *
 * Invariants: pure functions of the descriptor. A roof's top is concave over its area (the lowest of its planes), so
 * the region under it over any rectangle is convex: a wall's hull is that rectangle's corners on the floor and the
 * underside over its corners and over every point where a crease (the ridge, a hip) crosses its edges or ends inside
 * it, and nothing else. The slope is `Math.tan` of the pitch, a function the sim's fdlibm swap leaves alone, which
 * tests/e2e/drift.spec.ts holds equal in Node and Chromium.
 *
 * @example
 * const roof = makeRoof({ roof: 'gable', pitch: 35 }, { storey: 3, base: 6, ceiling: 6, footprint: [0, 0, 16, 12], surface: 'shingle' });
 * [roof.ridge, Math.round(roof.peak * 100) / 100]; // ['x', 10.2]: the ridge runs east to west, 6 m × tan 35° up
 * Math.round(roofHeight(roof, 8, 3) * 100) / 100; // 8.1: halfway up the north slope
 * roofHeight(roof, 8, 20); // -Infinity: off the roof
 * @see engine/world/level/roofs.test.ts
 */
import type { StoreyKeys } from './parse';
import type { Point3, RoofDescriptor } from './types';

/** A roof slab's depth, measured straight down (m). */
export const ROOF_THICKNESS = 0.2;

/** The default roof surface tag. */
export const ROOF_SURFACE = 'shingle';

/** One degree, in radians. */
const DEG = Math.PI / 180;

/** Where a storey stands, for its roof: its index, floor, ceiling, floored tiles' bounds (m) and surface tag. */
export interface RoofSite {
  storey: number;
  base: number;
  /** Its ceiling (m), its floor plus the height it gives (none for an attic): a roof's eaves stand on it. */
  ceiling: number;
  footprint: readonly [x0: number, z0: number, x1: number, z1: number];
  surface: string;
}

/** A storey block's roof keys (`roof`, `pitch`, `ridge`, `eaves`) made into a roof over `site`. */
export function makeRoof(keys: StoreyKeys, site: RoofSite): RoofDescriptor {
  const kind = keys.roof ?? 'flat';
  const [x0, z0, x1, z1] = site.footprint;
  const long = x1 - x0 >= z1 - z0 ? 'x' : 'z';
  const ridge = kind === 'gable' ? (keys.ridge ?? long) : long;
  const pitch = kind === 'flat' ? 0 : (keys.pitch ?? 0);
  const slope = kind === 'flat' ? 0 : Math.tan(pitch * DEG);
  const half = ridge === 'x' ? (z1 - z0) / 2 : (x1 - x0) / 2;
  const eave = kind === 'flat' ? site.ceiling + ROOF_THICKNESS : site.ceiling;
  const peak = kind === 'flat' ? eave : eave + half * slope;
  return {
    kind,
    storey: site.storey,
    surface: site.surface,
    footprint: site.footprint,
    eaves: keys.eaves ?? 0,
    pitch,
    slope,
    ridge,
    eave,
    peak,
    thickness: ROOF_THICKNESS,
  };
}

/** How far (x, z) is inside the footprint from its nearest edge across the ridge, and along it (m; < 0 outside). */
function inside(roof: RoofDescriptor, x: number, z: number): { across: number; along: number } {
  const [x0, z0, x1, z1] = roof.footprint;
  const dx = Math.min(x - x0, x1 - x);
  const dz = Math.min(z - z0, z1 - z);
  return roof.ridge === 'x' ? { across: dz, along: dx } : { across: dx, along: dz };
}

/** Whether (x, z) is under the roof: in its footprint or over its eaves. */
export function onRoof(roof: RoofDescriptor, x: number, z: number): boolean {
  const { across, along } = inside(roof, x, z);
  return across >= -roof.eaves && along >= -roof.eaves;
}

/** The roof's top (m) at (x, z), the surface bodies stand on; −Infinity off it. */
export function roofHeight(roof: RoofDescriptor, x: number, z: number): number {
  if (!onRoof(roof, x, z)) return -Infinity;
  if (roof.kind === 'flat') return roof.eave;
  const { across, along } = inside(roof, x, z);
  const run = roof.kind === 'hip' ? Math.min(across, along) : across;
  return roof.eave + run * roof.slope;
}

/** The roof's underside (m) at (x, z): its top less its thickness; −Infinity off it. */
export function roofUnder(roof: RoofDescriptor, x: number, z: number): number {
  return roofHeight(roof, x, z) - roof.thickness;
}

/** The roof's area (m) with its eaves: `[x0, z0, x1, z1]`. */
function area(roof: RoofDescriptor): [number, number, number, number] {
  const [x0, z0, x1, z1] = roof.footprint;
  const e = roof.eaves;
  return [x0 - e, z0 - e, x1 + e, z1 + e];
}

/** A point on the roof's top at (x, z), and the same point `drop` metres lower. */
function onTop(roof: RoofDescriptor, x: number, z: number, drop = 0): Point3 {
  return [x, roofHeight(roof, x, z) - drop, z];
}

/** The planes of a pitched roof, each its corners on the top (m); a flat roof's one rectangle. */
function planes(roof: RoofDescriptor): [number, number][][] {
  const [ax, az, bx, bz] = area(roof);
  const [x0, z0, x1, z1] = roof.footprint;
  if (roof.kind === 'flat')
    return [
      [
        [ax, az],
        [bx, az],
        [bx, bz],
        [ax, bz],
      ],
    ];
  if (roof.kind === 'gable') {
    if (roof.ridge === 'x') {
      const zc = (z0 + z1) / 2;
      return [
        [
          [ax, az],
          [bx, az],
          [bx, zc],
          [ax, zc],
        ],
        [
          [ax, zc],
          [bx, zc],
          [bx, bz],
          [ax, bz],
        ],
      ];
    }
    const xc = (x0 + x1) / 2;
    return [
      [
        [ax, az],
        [xc, az],
        [xc, bz],
        [ax, bz],
      ],
      [
        [xc, az],
        [bx, az],
        [bx, bz],
        [xc, bz],
      ],
    ];
  }
  const [cx, cz] = [(x0 + x1) / 2, (z0 + z1) / 2];
  if (roof.ridge === 'x') {
    const r = (x1 - x0) / 2 - (z1 - z0) / 2; // the ridge's half length
    return [
      [
        [ax, az],
        [bx, az],
        [cx + r, cz],
        [cx - r, cz],
      ],
      [
        [cx - r, cz],
        [cx + r, cz],
        [bx, bz],
        [ax, bz],
      ],
      [
        [ax, az],
        [cx - r, cz],
        [ax, bz],
      ],
      [
        [bx, az],
        [bx, bz],
        [cx + r, cz],
      ],
    ];
  }
  const r = (z1 - z0) / 2 - (x1 - x0) / 2;
  return [
    [
      [ax, az],
      [cx, cz - r],
      [cx, cz + r],
      [ax, bz],
    ],
    [
      [cx, cz - r],
      [bx, az],
      [bx, bz],
      [cx, cz + r],
    ],
    [
      [ax, az],
      [bx, az],
      [cx, cz - r],
    ],
    [
      [ax, bz],
      [cx, cz + r],
      [bx, bz],
    ],
  ];
}

/** The roof's slab as convex hulls' corners (m): each plane's top and the same corners `thickness` lower. */
export function roofColliders(roof: RoofDescriptor): Point3[][] {
  return planes(roof).map((corners) => [
    ...corners.map(([x, z]) => onTop(roof, x, z)),
    ...corners.map(([x, z]) => onTop(roof, x, z, roof.thickness)),
  ]);
}

/** The roof's creases as segments (m): a gable's ridge, a hip's ridge and its four hips; none for a flat roof. */
function creases(roof: RoofDescriptor): [[number, number], [number, number]][] {
  if (roof.kind === 'flat') return [];
  const [ax, az, bx, bz] = area(roof);
  const [x0, z0, x1, z1] = roof.footprint;
  const [cx, cz] = [(x0 + x1) / 2, (z0 + z1) / 2];
  if (roof.kind === 'gable') {
    return roof.ridge === 'x'
      ? [
          [
            [ax, cz],
            [bx, cz],
          ],
        ]
      : [
          [
            [cx, az],
            [cx, bz],
          ],
        ];
  }
  const [r, w] = roof.ridge === 'x' ? [(x1 - x0) / 2 - (z1 - z0) / 2, 0] : [0, (z1 - z0) / 2 - (x1 - x0) / 2];
  const [e0, e1]: [number, number][] = [
    [cx - r, cz - w],
    [cx + r, cz + w],
  ];
  return [
    [e0, e1],
    [[ax, az], e0],
    [roof.ridge === 'x' ? [ax, bz] : [bx, az], e0],
    [[bx, bz], e1],
    [roof.ridge === 'x' ? [bx, az] : [ax, bz], e1],
  ];
}

/** Where segment p–q crosses the line x = c (or z = c when `axis` is 1), as a point, or null. */
function cross(p: [number, number], q: [number, number], axis: 0 | 1, c: number): [number, number] | null {
  const [a, b] = [p[axis], q[axis]];
  if (a === b || c < Math.min(a, b) || c > Math.max(a, b)) return null;
  const t = (c - a) / (b - a);
  return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
}

/**
 * The corners of the convex hull of a wall under the roof (m): the rectangle `[x0, z0, x1, z1]` from `bottom` up to the
 * roof's underside (see the file comment), over only the part of it where the underside clears `bottom`, so near the
 * eaves, where the underside falls below the floor, no wall stands into the slab (WP 13.18: it had, up to 0.18 m). The
 * floor's corners come first, then the underside's. Null when the underside never rises above `bottom` over it.
 */
export function wallUnder(
  roof: RoofDescriptor,
  rect: readonly [number, number, number, number],
  bottom: number,
): Point3[] | null {
  const [x0, z0, x1, z1] = rect;
  const corners: [number, number][] = [
    [x0, z0],
    [x1, z0],
    [x1, z1],
    [x0, z1],
  ];
  const inRect = ([x, z]: [number, number]) => x >= x0 && x <= x1 && z >= z0 && z <= z1;
  const same = (a: [number, number], b: [number, number]) => a[0] === b[0] && a[1] === b[1];
  // The rectangle's outline, corner by corner with where creases cross each edge, and the creases' ends inside it.
  const outline: [number, number][] = [];
  const inner: [number, number][] = [];
  corners.forEach((from, i) => {
    const to = corners[(i + 1) % 4];
    const axis = from[0] === to[0] ? 0 : 1; // the edge runs along z (x fixed) or along x (z fixed)
    const on: [number, number][] = [];
    for (const [p, q] of creases(roof)) {
      const at = cross(p, q, axis, from[axis]);
      if (at && inRect(at) && !same(at, from) && !same(at, to) && !on.some((o) => same(o, at))) on.push(at);
    }
    const along = (point: [number, number]) => Math.abs(point[1 - axis] - from[1 - axis]);
    outline.push(from, ...on.sort((a, b) => along(a) - along(b)));
  });
  for (const [p, q] of creases(roof)) {
    for (const end of [p, q]) {
      if (inRect(end) && !outline.some((o) => same(o, end)) && !inner.some((o) => same(o, end))) inner.push(end);
    }
  }
  // Clipped where the underside meets `bottom`: it runs straight between the outline's points.
  const under = ([x, z]: [number, number]) => roofUnder(roof, x, z);
  const kept: [number, number][] = [];
  outline.forEach((p, i) => {
    const q = outline[(i + 1) % outline.length];
    const [a, b] = [under(p) - bottom, under(q) - bottom];
    if (a >= 0) kept.push(p);
    if ((a < 0 && b > 0) || (a > 0 && b < 0)) {
      const t = a / (a - b);
      kept.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  });
  const tops = [...kept, ...inner.filter((point) => under(point) >= bottom)];
  const top = tops.map((point): Point3 => [point[0], Math.max(bottom, under(point)), point[1]]);
  if (!top.some((point) => point[1] > bottom)) return null;
  const floor = kept.map(([x, z]): Point3 => [x, bottom, z]);
  return [...floor, ...top];
}
