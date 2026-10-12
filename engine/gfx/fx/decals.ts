/**
 * @file Floor decals (PLAN.md WP 6.4): flat shapes lying on the floor, drawn by one instanced batch of quads
 * (engine/gfx/instancing.ts, `fx:decals`) whose material cuts each shape out of its quad by its signed distance, so
 * every edge is crisp at any size and every decal shares one pipeline and one draw. Telegraphs (engine/world/
 * telegraphs.ts) fill as they wind up; shockwave rings and scorches are decals too (engine/gfx/fx/effects.ts).
 *
 * Each frame: `begin()`, then per decal `sector(…)` (from `inner` to `outer` metres within `halfAngle` either side
 * of the facing; π all round: a disc or a ring) or `line(…)` (a strip `width` wide, `length` forward), or
 * `telegraph(t, place)`, then `end()`. A decal paints its `fill` (the sector out to the `fill` radius, the strip's
 * first `fill` metres) at opacity `alpha`, and a rim 4 cm wide inside its whole outline at opacity `edge`, in a
 * linear colour; it covers (premultiplied, as the sprites blend) and lies 2 cm above the floor's height it is given,
 * both faces in one pass (`forceSinglePass`: r182 would draw a transparent double-sided object twice).
 * A sector's quad is the outer radius round its origin, a strip's the square round its middle; the per-instance
 * attributes are `fxShape` (kind, then inner, outer and half angle, or half width and half length) and `fxPaint`
 * (fill, the quad's half side, alpha, edge).
 *
 * Carried from `my-3d2dge:src/stress-world/35-effects.js:12-44` (`floorPool`: arcs and rings on the floor, one
 * material for the pool so a fight's first shape builds no shader), drawn by distance instead of rebuilt meshes.
 *
 * Invariants: presentation only; at most `capacity` decals a frame (more are counted in `skipped`); every page exists
 * from the start; the same calls draw the same instances.
 *
 * @example
 * const decals = createDecals({ capacity: 1024 });
 * decals.begin();
 * decals.sector([0, 0, 0], 0, 0.3, 2, 0.8, 1.2, [1, 0.06, 0.04], 0.5, 0.6); // an arc, filled out to 1.2 m
 * decals.end();
 * decals.batch.count; // 1
 * @see engine/gfx/fx/decals.test.ts
 */
import {
  CustomBlending,
  DoubleSide,
  MeshBasicNodeMaterial,
  OneFactor,
  OneMinusSrcAlphaFactor,
  PlaneGeometry,
  type Node,
} from 'three/webgpu';
import {
  abs,
  attribute,
  clamp,
  cos,
  dot,
  float,
  fwidth,
  length,
  max,
  min,
  select,
  sign,
  sin,
  uv,
  vec2,
  vec3,
} from 'three/tsl';
import { toLinear } from '../../core/color';
import { pointOf, telegraphFill, type PointLike, type Telegraph, type TelegraphPlace } from '../../world/telegraphs';
import { createInstancedBatch, PAGE_SLOTS, type InstancedBatch } from '../instancing';

/** How far above the floor a decal lies (m), and how wide its rim is (m). */
export const DECAL = { lift: 0.02, rim: 0.04 } as const;

/** What `createDecals` takes. */
export interface DecalsOptions {
  /** The most decals a frame (pages of 1,024 slots). */
  capacity: number;
  /** The batch's name (`fx:decals`). */
  name?: string;
}

/** The decals of a frame: see the file comment. */
export interface Decals {
  readonly batch: InstancedBatch;
  readonly material: MeshBasicNodeMaterial;
  readonly capacity: number;
  /** Decals left out this frame: over the capacity. */
  readonly skipped: number;
  begin(): void;
  /** A sector at `at` (on the floor) facing `yaw`; see the file comment. */
  sector(
    at: PointLike,
    yaw: number,
    inner: number,
    outer: number,
    halfAngle: number,
    fill: number,
    rgb: readonly number[],
    alpha: number,
    edge: number,
  ): void;
  /** A strip from `at` forward along `yaw`; see the file comment. */
  line(
    at: PointLike,
    yaw: number,
    length: number,
    width: number,
    fill: number,
    rgb: readonly number[],
    alpha: number,
    edge: number,
  ): void;
  /** Telegraph `t` where `place` puts it, filled as far as its wind-up has run. */
  telegraph(t: Telegraph, place: TelegraphPlace): void;
  end(): void;
  dispose(): void;
}

/** The signed distance of `p` to a box of half extents `b` round the origin. */
const box = (p: Node, b: Node) => {
  const d = abs(p).sub(b);
  return length(max(d, 0)).add(min(max(d.x, d.y), 0));
};

/** The signed distance of `p` to the sector of radius `r` within `half` of +Y, cut at `inner` (iq's pie, mirrored). */
const sector = (p: Node, rho: Node, r: Node, inner: Node, half: Node) => {
  const q = vec2(abs(p.x), p.y);
  const c = vec2(sin(half), cos(half));
  const pie = max(rho.sub(r), length(q.sub(c.mul(clamp(dot(q, c), 0, r)))).mul(sign(c.y.mul(q.x).sub(c.x.mul(q.y)))));
  return max(select(half.greaterThanEqual(3.14159), rho.sub(r), pie), inner.sub(rho));
};

/** The decals' material: see the file comment. */
export function decalMaterial(): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, fog: false, side: DoubleSide });
  material.forceSinglePass = true;
  Object.assign(material, {
    name: 'fx:decal',
    blending: CustomBlending,
    blendSrc: OneFactor,
    blendDst: OneMinusSrcAlphaFactor,
    blendSrcAlpha: OneFactor,
    blendDstAlpha: OneMinusSrcAlphaFactor,
  });
  const shape = attribute('fxShape', 'vec4');
  const paint = attribute('fxPaint', 'vec4');
  const p = uv().mul(2).sub(1).mul(paint.y);
  const rho = length(p);
  const isSector = shape.x.lessThan(0.5);
  const full = select(isSector, sector(p, rho, shape.z, shape.y, shape.w), box(p, vec2(shape.y, shape.z)));
  const fillHalf = paint.x.mul(0.5);
  const strip = box(p.sub(vec2(0, shape.z.negate().add(fillHalf))), vec2(shape.y, fillHalf));
  const filled = select(isSector, sector(p, rho, paint.x, shape.y, shape.w), strip);
  const fw = max(fwidth(full), 1e-4);
  const inFill = clamp(float(0.5).sub(filled.div(fw)), 0, 1);
  const inside = clamp(float(0.5).sub(full.div(fw)), 0, 1);
  const rim = inside.mul(clamp(float(0.5).add(full.add(DECAL.rim).div(fw)), 0, 1));
  const a = max(paint.z.mul(inFill), paint.w.mul(rim));
  material.colorNode = vec3(a);
  material.opacityNode = a;
  return material;
}

/** Makes the decals; see the file comment. */
export function createDecals(options: DecalsOptions): Decals {
  const capacity = Math.max(1, Math.floor(options.capacity));
  const geometry = new PlaneGeometry(2, 2);
  const material = decalMaterial();
  const batch = createInstancedBatch({
    name: options.name ?? 'fx:decals',
    geometry,
    material,
    attributes: { fxShape: 4, fxPaint: 4 },
    pageSlots: PAGE_SLOTS,
    renderOrder: 1,
  });
  batch.count = capacity;
  batch.begin();
  batch.end();
  const matrix = new Float64Array(16);
  const [shape, paint, colour] = [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0],
  ];
  let skipped = 0;

  /** Writes one decal: its quad of half side `s` round (cx, y, cz) along `yaw`, in `rgb`, with `shape` and `paint`. */
  function put(cx: number, y: number, cz: number, yaw: number, s: number, rgb: readonly number[]) {
    if (batch.count >= capacity) {
      skipped++;
      return;
    }
    const [sn, cs] = [Math.sin(yaw), Math.cos(yaw)];
    matrix.set([-cs * s, 0, sn * s, 0, sn * s, 0, cs * s, 0, 0, 1, 0, 0, cx, y + DECAL.lift, cz, 1]);
    for (let k = 0; k < 3; k++) colour[k] = rgb[k];
    paint[1] = s;
    const slot = batch.add(matrix, colour);
    batch.setAttributeAt('fxShape', slot, shape);
    batch.setAttributeAt('fxPaint', slot, paint);
  }

  const decals: Decals = {
    batch,
    material,
    capacity,
    get skipped() {
      return skipped;
    },
    begin() {
      batch.begin();
      skipped = 0;
    },
    sector(at, yaw, inner, outer, halfAngle, fill, rgb, alpha, edge) {
      if (!(outer > 0)) return;
      const [x, y, z] = pointOf(at);
      [shape[0], shape[1], shape[2], shape[3]] = [0, inner, outer, Math.min(Math.PI, halfAngle)];
      [paint[0], paint[2], paint[3]] = [fill, alpha, edge];
      put(x, y, z, yaw, outer, rgb);
    },
    line(at, yaw, length, width, fill, rgb, alpha, edge) {
      if (!(length > 0 && width > 0)) return;
      const [x, y, z] = pointOf(at);
      const half = length / 2;
      [shape[0], shape[1], shape[2], shape[3]] = [1, width / 2, half, 0];
      [paint[0], paint[2], paint[3]] = [Math.min(length, Math.max(0, fill)), alpha, edge];
      put(x + Math.sin(yaw) * half, y, z + Math.cos(yaw) * half, yaw, Math.max(half, width / 2), rgb);
    },
    telegraph(t, place) {
      const k = place.size ?? 1;
      const u = Math.min(1, Math.max(0, place.u));
      const alpha = t.alpha[0] + (t.alpha[1] - t.alpha[0]) * u;
      const rgb = toLinear(t.color);
      const fill = telegraphFill(t, u) * k;
      if (t.shape === 'line') {
        decals.line(place.position, place.yaw, t.length * k, t.width * k, fill, rgb, alpha, t.edge);
        return;
      }
      const inner = t.shape === 'cone' ? 0 : t.inner * k;
      const half = t.shape === 'ring' ? Math.PI : t.halfAngle;
      decals.sector(place.position, place.yaw, inner, t.radius * k, half, fill, rgb, alpha, t.edge);
    },
    end() {
      batch.end();
    },
    dispose() {
      batch.dispose();
      geometry.dispose();
      material.dispose();
    },
  };
  return decals;
}
