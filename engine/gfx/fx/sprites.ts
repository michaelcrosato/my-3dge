/**
 * @file Sprites (PLAN.md WP 6.4): the particles and glows drawn as camera-facing quads through one instanced batch
 * (engine/gfx/instancing.ts, `fx:sprites`), one material, so every emitter shares one pipeline and a burst never
 * builds one. Each frame: `begin(camera)`, `particles(pool)` (every live particle of a pool, engine/gfx/fx/
 * particles.ts), `glow(…)` per glow (a bolt's halo and core), `end()`.
 *
 * - **A soft disc,** shardfall's: opacity `a × (1 − r²)^1.5` across the quad, nothing past its rim.
 * - **One blend for both kinds,** premultiplied: the colour leaves as `rgb × a` and the opacity as `a` for a particle
 *   that covers, 0 for one that adds light, so adding and covering particles share the blend state (One,
 *   OneMinusSrcAlpha) and one draw. The instance colour is the linear colour times its opacity (glowing above 1);
 *   the per-instance attribute `fxAlpha` is the opacity that covers.
 * - **Streaks:** a stretching particle's quad lies along its velocity as the camera sees it, `size + speed × 0.03`
 *   long and `0.45 × size` wide.
 * - Unlit, no fog, depth-tested but never written, drawn after the floor decals and trails (`renderOrder` 4).
 *
 * Carried from `shardfall:crates/pav_render/src/shaders/particle_draw.wgsl` (the soft disc, the premultiplied blend,
 * the streak's axes) and `my-3d2dge:src/stress-world/35-effects.js:73-79` (`quad`: camera-facing quads in an
 * instanced batch), with the 2D engine's bolts (`:100-106`: a halo and a hot core).
 *
 * Invariants: presentation only; at most `capacity` sprites a frame (more are left out and counted in `skipped`);
 * every page exists from the start (`capacity` slots), so nothing is added while playing.
 *
 * @example
 * import { PerspectiveCamera } from 'three/webgpu';
 * const sprites = createSprites({ capacity: 2048 });
 * sprites.begin(new PerspectiveCamera());
 * sprites.glow(0, 1, -3, 0.3, [1, 0.7, 0.3]);
 * sprites.end();
 * sprites.batch.count; // 1
 * @see engine/gfx/fx/sprites.test.ts
 */
import {
  CustomBlending,
  DoubleSide,
  MeshBasicNodeMaterial,
  OneFactor,
  OneMinusSrcAlphaFactor,
  PlaneGeometry,
  Vector3,
  type Camera,
} from 'three/webgpu';
import { attribute, dot, float, max, pow, uv, vec3 } from 'three/tsl';
import { createInstancedBatch, PAGE_SLOTS, type InstancedBatch } from '../instancing';
import type { ParticlePool, ParticleView } from './particles';

/** What `createSprites` takes. */
export interface SpritesOptions {
  /** The most sprites a frame: particles and glows (pages of 1,024 slots). */
  capacity: number;
  /** The batch's name (`fx:sprites`): the ID pass names its pages `<name>/page0`… */
  name?: string;
}

/** The sprites of a frame: see the file comment. */
export interface Sprites {
  readonly batch: InstancedBatch;
  readonly material: MeshBasicNodeMaterial;
  readonly capacity: number;
  /** Sprites left out this frame: over the capacity. */
  readonly skipped: number;
  /** Starts a frame seen by `camera` (its world matrix as last updated). */
  begin(camera: Camera): void;
  /** Draws every live particle of `pool`. */
  particles(pool: ParticlePool): void;
  /** A soft glow at (x, y, z) of `radius` (m), linear `rgb`, adding light (`cover` 0) or covering (`cover` > 0). */
  glow(x: number, y: number, z: number, radius: number, rgb: readonly number[], cover?: number): void;
  /** Uploads what changed. */
  end(): void;
  /** Frees the batch, its geometry and material. */
  dispose(): void;
}

/** The sprites' material: see the file comment. */
export function spriteMaterial(): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, fog: false, side: DoubleSide });
  Object.assign(material, {
    name: 'fx:sprite',
    blending: CustomBlending,
    blendSrc: OneFactor,
    blendDst: OneMinusSrcAlphaFactor,
    blendSrcAlpha: OneFactor,
    blendDstAlpha: OneMinusSrcAlphaFactor,
  });
  const p = uv().mul(2).sub(1);
  const disc = pow(max(float(1).sub(dot(p, p)), 0), 1.5);
  material.colorNode = vec3(disc);
  material.opacityNode = attribute('fxAlpha', 'float').mul(disc);
  return material;
}

/** Makes the sprites; see the file comment. */
export function createSprites(options: SpritesOptions): Sprites {
  const capacity = Math.max(1, Math.floor(options.capacity));
  const geometry = new PlaneGeometry(2, 2);
  const material = spriteMaterial();
  const batch = createInstancedBatch({
    name: options.name ?? 'fx:sprites',
    geometry,
    material,
    attributes: { fxAlpha: 1 },
    pageSlots: PAGE_SLOTS,
    renderOrder: 4,
  });
  batch.count = capacity;
  batch.begin();
  batch.end();
  const [right, up, back, along, across] = Array.from({ length: 5 }, () => new Vector3());
  const matrix = new Float64Array(16);
  matrix[15] = 1;
  const colour = [0, 0, 0];
  const cover = [0];
  const view: ParticleView = {
    ...{ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, size: 0, r: 0, g: 0, b: 0, a: 0 },
    ...{ additive: true, stretch: false },
  };
  let skipped = 0;

  /** Writes one quad: centre (x, y, z), axes `ax` and `ay` (scaled), colour `rgb` × `a`, covering `alpha`. */
  function put(
    x: number,
    y: number,
    z: number,
    ax: Vector3,
    ay: Vector3,
    rgb: readonly number[],
    a: number,
    alpha: number,
  ) {
    if (batch.count >= capacity) {
      skipped++;
      return;
    }
    [matrix[0], matrix[1], matrix[2], matrix[4], matrix[5], matrix[6]] = [ax.x, ax.y, ax.z, ay.x, ay.y, ay.z];
    [matrix[8], matrix[9], matrix[10], matrix[12], matrix[13], matrix[14]] = [back.x, back.y, back.z, x, y, z];
    for (let k = 0; k < 3; k++) colour[k] = rgb[k] * a;
    cover[0] = alpha;
    const slot = batch.add(matrix, colour);
    batch.setAttributeAt('fxAlpha', slot, cover);
  }

  const sprites: Sprites = {
    batch,
    material,
    capacity,
    get skipped() {
      return skipped;
    },
    begin(camera) {
      const e = camera.matrixWorld.elements;
      right.set(e[0], e[1], e[2]).normalize();
      up.set(e[4], e[5], e[6]).normalize();
      back.set(e[8], e[9], e[10]).normalize();
      batch.begin();
      skipped = 0;
    },
    particles(pool) {
      const rgb = [0, 0, 0];
      for (let i = 0; i < pool.count; i++) {
        const p = pool.read(i, view);
        if (!(p.size > 0) || !(p.a > 0)) continue;
        along.copy(right).multiplyScalar(p.size);
        across.copy(up).multiplyScalar(p.size);
        if (p.stretch) {
          const [sx, sy] = [p.vx * right.x + p.vy * right.y + p.vz * right.z, p.vx * up.x + p.vy * up.y + p.vz * up.z];
          const speed = Math.hypot(sx, sy);
          if (speed > 1e-3) {
            const [dx, dy] = [sx / speed, sy / speed];
            along
              .copy(right)
              .multiplyScalar(dx)
              .addScaledVector(up, dy)
              .multiplyScalar(p.size + speed * 0.03);
            across
              .copy(right)
              .multiplyScalar(-dy)
              .addScaledVector(up, dx)
              .multiplyScalar(p.size * 0.45);
          }
        }
        rgb[0] = p.r;
        rgb[1] = p.g;
        rgb[2] = p.b;
        put(p.x, p.y, p.z, along, across, rgb, p.a, p.additive ? 0 : p.a);
      }
    },
    glow(x, y, z, radius, rgb, coverage = 0) {
      along.copy(right).multiplyScalar(radius);
      across.copy(up).multiplyScalar(radius);
      put(x, y, z, along, across, rgb, 1, coverage);
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
  return sprites;
}
