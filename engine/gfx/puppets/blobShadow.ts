/**
 * @file Blob shadows (PLAN.md WP 3.8): a soft dark disc on the floor under each body, all of them in one instanced
 * batch (engine/gfx/instancing.ts), so a crowd's shadows cost one draw call. `createBlobShadows({ materials })`
 * makes the batch; between `begin()` and `end()`, `add(x, floorY, z, radius, height, alpha)` lays one disc. The
 * caller says where the floor is (a level's height, a physics probe through the sim's `QueryView`): this module
 * never asks.
 *
 * The rule, carried from `shadowAt`: a body `height` metres above its floor casts a disc of `radius × blobScale
 * (height)`, the scale falling from 1 on the floor to 0.35 at 5 m and above, times `alpha` (a body fading in or out
 * shrinks its shadow), lying 1.25 cm above the floor so the floor never hides it. It is drawn with
 * `material:blobShadow` (defined here): unlit, the prototype's near-black at 45 % opacity, writing no depth, after
 * the opaque scene (render order 1). The prototype's disc was squashed to 0.8 along the 2D page's depth axis, a
 * leftover of its sprites' perspective; in 3D the disc is round.
 *
 * Invariants: one instance per `add`, in call order; a disc of radius 0 (alpha 0) is still an instance, at zero
 * size; nothing here reaches the sim.
 *
 * Carried from `my-3d2dge:src/stress-world/30-crowd.js:334-364` (`shadowAt` and its calls in `drawCrowd`) and the
 * `blob` batch of `:68-77`, in metres (80 units = 5 m, 0.2 units = 1.25 cm).
 *
 * @example
 * blobScale(0); // 1: on the floor
 * blobScale(2.5); // 0.5
 * blobScale(9); // 0.35: never smaller
 * // const shadows = createBlobShadows({ materials: library }); scene.add(shadows.root);
 * // shadows.begin(); shadows.add(hero.x, 0, hero.z, 0.35, hero.y); shadows.end();
 * @see engine/gfx/puppets/blobShadow.test.ts
 * @see tests/e2e/puppets.spec.ts
 */
import { CircleGeometry, type Group, type Material } from 'three/webgpu';
import { registry as sharedRegistry, type Registry } from '../../core/registry';
import { createInstancedBatch, type InstancedBatch } from '../instancing';
import { defineMaterial, materialKind } from '../materials/material';
import type { Warmup } from '../warmup';

/** The shadow rule's numbers: the lift above the floor, the height where it stops shrinking, its smallest scale. */
export const BLOB_SHADOW = { lift: 0.0125, fadeHeight: 5, smallest: 0.35 } as const;

/** The material blob shadows draw with. */
export const BLOB_SHADOW_MATERIAL = {
  description: "A blob shadow: the prototype's near-black at 45 % opacity, unlit, writing no depth.",
  color: '#1a1320',
  unlit: true,
  transparent: true,
  opacity: 0.45,
  depthWrite: false,
} as const;

/** Defines `material:blobShadow` on `registry` (the shared one by default) unless it has it. */
export function blobShadowMaterial(registry: Registry = sharedRegistry): void {
  materialKind(registry);
  if (!registry.has('material', 'material:blobShadow'))
    defineMaterial('material:blobShadow', BLOB_SHADOW_MATERIAL, registry);
}
blobShadowMaterial();

/** How much a body `height` metres above its floor shrinks its shadow: 1 on the floor, down to 0.35 at 5 m. */
export function blobScale(height: number): number {
  return Math.max(BLOB_SHADOW.smallest, 1 - Math.max(0, height) / BLOB_SHADOW.fadeHeight);
}

/** Blob shadows (see the file comment). */
export interface BlobShadows {
  readonly batch: InstancedBatch;
  /** The group holding the batch: add it to the scene. */
  readonly root: Group;
  begin(): void;
  /** Lays one disc under a body at (x, z) whose floor is at `floorY`, `height` above it, faded to `alpha`. */
  add(x: number, floorY: number, z: number, radius: number, height?: number, alpha?: number): void;
  end(): void;
  /** Registers the batch with `warmup` as `id` (`batch:<name>` by default). */
  register(warmup: Pick<Warmup, 'register'>, id?: string): { dispose(): void };
  dispose(): void;
}

/** Makes the blob-shadow batch, drawn with the library's `material:blobShadow` (see the file comment). */
export function createBlobShadows(options: {
  materials: { get(id: string): Material };
  name?: string;
  pageSlots?: number;
  /** What makes the batch: the instancing service's `createInstancedBatch` by default, a GPU crowd's `batch`. */
  batches?: typeof createInstancedBatch;
}): BlobShadows {
  const geometry = new CircleGeometry(1, 14).rotateX(-Math.PI / 2);
  geometry.deleteAttribute('uv');
  const material = options.materials.get('material:blobShadow');
  const name = options.name ?? 'blobShadows';
  const make = options.batches ?? createInstancedBatch;
  const batch = make({ name, geometry, material, pageSlots: options.pageSlots, renderOrder: 1 });
  const matrix = new Float64Array(16);
  return {
    batch,
    root: batch.root,
    begin: () => batch.begin(),
    add(x, floorY, z, radius, height = 0, alpha = 1) {
      const r = radius * blobScale(height) * alpha;
      matrix.set([r, 0, 0, 0, 0, 1, 0, 0, 0, 0, r, 0, x, floorY + BLOB_SHADOW.lift, z, 1]);
      batch.add(matrix);
    },
    end: () => batch.end(),
    register: (warmup, id) => batch.register(warmup, id),
    dispose() {
      batch.dispose();
      geometry.dispose();
    },
  };
}
