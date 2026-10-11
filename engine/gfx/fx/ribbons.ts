/**
 * @file Socket trails (PLAN.md WP 6.4): ribbons between a part's base and tip over its last positions, a blade's
 * sweep or a claw's, from an animator's trail (engine/anim/character.ts `TrailSample`: base, tip, weight), fading to
 * nothing at the tail. Every ribbon of a frame is in one mesh (`fx:ribbons`), so all of them cost one draw and one
 * pipeline: `capacity` ribbons of up to `samples` samples, each sample two vertices; a ribbon with fewer samples
 * folds its unused ones onto its newest, so their triangles are empty.
 *
 * Each frame: `begin()`, `add(trail, rgb)` per trail (its newest `samples` samples, two at least), `end()`. A
 * sample k of n (oldest first) is lit `((k + 1) / n)^1.5 × 0.85 × weight`, the tip at that and the base at half,
 * in the linear colour `rgb`; the ribbons add light, double-sided, depth-tested but never written (`renderOrder` 3).
 *
 * Carried from `my-3d2dge:src/stress-world/35-effects.js:45-71` (`RIBBONS`: 12 samples, the fade, one material for
 * every trail) and its tints (`HERO_TRAIL` `#d8f2ff`, `CLAW_TRAIL` `#ff7a5a`: `TRAIL_TINTS`).
 *
 * Invariants: presentation only; at most `capacity` ribbons a frame (more are counted in `skipped`); the buffers are
 * made once and uploaded over the part used.
 *
 * @example
 * const ribbons = createRibbons({ capacity: 8 });
 * ribbons.begin();
 * ribbons.add([{ base: [0, 1, 0], tip: [0, 1.6, 0] }, { base: [0.2, 1, 0], tip: [0.5, 1.5, 0] }], [0.7, 0.9, 1]);
 * ribbons.end();
 * ribbons.count; // 1
 * @see engine/gfx/fx/ribbons.test.ts
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Mesh,
  MeshBasicNodeMaterial,
} from 'three/webgpu';
import { pointOf, type PointLike } from '../../world/telegraphs';

/** The tints of the Stress test's trails: the hero's blade and the monsters' claws. */
export const TRAIL_TINTS = { blade: '#d8f2ff', claw: '#ff7a5a' } as const;

/** One sample of a trail: where the part's base and tip were, and its ribbon's weight (1). */
export interface TrailSampleLike {
  readonly base: PointLike;
  readonly tip: PointLike;
  readonly weight?: number;
}

/** What `createRibbons` takes. */
export interface RibbonsOptions {
  /** The most ribbons a frame. */
  capacity: number;
  /** The most samples a ribbon draws (12, the animator's trail). */
  samples?: number;
  /** The mesh's name (`fx:ribbons`). */
  name?: string;
}

/** The ribbons of a frame: see the file comment. */
export interface Ribbons {
  readonly mesh: Mesh;
  readonly capacity: number;
  readonly samples: number;
  /** Ribbons this frame. */
  readonly count: number;
  /** Ribbons left out this frame: over the capacity. */
  readonly skipped: number;
  begin(): void;
  /** Adds a ribbon along `trail` (oldest first) in linear `rgb`; one of fewer than two samples draws nothing. */
  add(trail: readonly TrailSampleLike[], rgb: readonly number[]): void;
  end(): void;
  dispose(): void;
}

/** Makes the ribbons; see the file comment. */
export function createRibbons(options: RibbonsOptions): Ribbons {
  const capacity = Math.max(1, Math.floor(options.capacity));
  const samples = Math.max(2, Math.floor(options.samples ?? 12));
  const vertices = capacity * samples * 2;
  const positions = new Float32Array(vertices * 3);
  const colours = new Float32Array(vertices * 3);
  const normals = new Float32Array(vertices * 3);
  for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
  const index: number[] = [];
  for (let r = 0; r < capacity; r++) {
    for (let k = 0; k < samples - 1; k++) {
      const a = (r * samples + k) * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setIndex(index);
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('color', new BufferAttribute(colours, 3));
  geometry.setAttribute('normal', new BufferAttribute(normals, 3));
  const material = new MeshBasicNodeMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    fog: false,
    blending: AdditiveBlending,
  });
  material.name = 'fx:ribbon';
  const mesh = new Mesh(geometry, material);
  Object.assign(mesh, { name: options.name ?? 'fx:ribbons', frustumCulled: false, renderOrder: 3, visible: false });
  let [count, skipped, uploaded] = [0, 0, 0];

  /** Writes vertex `v`'s position `p` and colour `rgb` × `k`. */
  function vertex(v: number, p: PointLike, rgb: readonly number[], k: number) {
    const [x, y, z] = pointOf(p);
    positions.set([x, y, z], v * 3);
    colours.set([rgb[0] * k, rgb[1] * k, rgb[2] * k], v * 3);
  }

  const ribbons: Ribbons = {
    mesh,
    capacity,
    samples,
    get count() {
      return count;
    },
    get skipped() {
      return skipped;
    },
    begin() {
      [count, skipped] = [0, 0];
    },
    add(trail, rgb) {
      const n = Math.min(samples, trail.length);
      if (n < 2) return;
      if (count >= capacity) {
        skipped++;
        return;
      }
      const first = count * samples * 2;
      for (let k = 0; k < samples; k++) {
        const s = trail[trail.length - n + Math.min(k, n - 1)];
        const lit = k < n ? Math.pow((k + 1) / n, 1.5) * 0.85 * (s.weight ?? 1) : 0;
        vertex(first + k * 2, s.base, rgb, lit * 0.5);
        vertex(first + k * 2 + 1, s.tip, rgb, lit);
      }
      count++;
    },
    end() {
      mesh.visible = count > 0;
      geometry.setDrawRange(0, count * (samples - 1) * 6);
      const used = Math.max(count, uploaded) * samples * 2 * 3;
      uploaded = count;
      if (!used) return;
      for (const name of ['position', 'color'] as const) {
        const attribute = geometry.getAttribute(name) as BufferAttribute;
        attribute.clearUpdateRanges();
        attribute.addUpdateRange(0, used);
        attribute.needsUpdate = true;
      }
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      mesh.removeFromParent();
    },
  };
  return ribbons;
}
