/**
 * @file Instanced puppet parts for crowds (PLAN.md WP 3.8, I-21): `createPuppetBatches({ materials })` draws compiled
 * bodies (compile.ts) as instanced parts per shape over the instancing service (engine/gfx/instancing.ts), from the
 * same pieces a puppet (draw.ts) is made of. `draw(compiled, pose)` runs FK and writes each piece's world matrix and
 * slot colour into its shape's batch; a limb draws as a frustum whose taper is rounded to eighths (one batch per
 * eighth) with a ball at each end, so a crowd costs a draw call per shape, whatever its size. Split from draw.ts at
 * its size cap (WP 11.4).
 *
 * Invariants: every lit shape draws with the body's `material`, every glow piece with its `glowMaterial`, a body's
 * own material in a batch of its own (`<shape>~<material>`); lit batches cast and receive shadows, glow ones neither;
 * a piece's batches are worked out once; nothing here reaches the sim.
 *
 * @example
 * // const batches = createPuppetBatches({ materials: library }); scene.add(batches.root);
 * // batches.begin(); batches.draw(compiled, pose); batches.end(); batches.drawCalls(1);
 * @see engine/gfx/puppets/draw.test.ts
 * @see tests/e2e/puppets.spec.ts
 */
import { Group, Matrix4 } from 'three/webgpu';
import { createWorldPose, forwardKinematics } from '../../anim/fk';
import type { Pose } from '../../anim/pose';
import { createInstancedBatch, type InstancedBatch } from '../instancing';
import type { Warmup } from '../warmup';
import type { BodyPiece, CompiledBody } from './compile';
import { unitGeometry, type PuppetMaterials } from './draw';

/** Instanced parts for crowds (see the file comment). */
export interface PuppetBatches {
  readonly root: Group;
  /** The batches by shape (`ball`, `limb@0.875`…, with `~<material>` for a body's own material). */
  readonly batches: ReadonlyMap<string, InstancedBatch>;
  /** Makes the batches `compiled` needs (do it before a warm-up, so their first page is built then). */
  prepare(compiled: CompiledBody): void;
  begin(): void;
  /** Writes one character's pieces in `pose`; returns the instances written. */
  draw(compiled: CompiledBody, pose: Pose): number;
  end(): void;
  /** Draw calls a frame costs: one per shown page, again per shadow map for casting batches. */
  drawCalls(shadowMaps?: number): number;
  /** Registers every batch's pages, present and future, with `warmup` as `id` (`<name>` by default). */
  register(warmup: Pick<Warmup, 'register'>, id?: string): { dispose(): void };
  dispose(): void;
}

/**
 * A limb piece's instanced parts, each with its matrix in the bone's frame: the frustum (radius r0 at the wide end,
 * k × r0 at the narrow one, k rounded to eighths: the batch `limb@k`) and the balls at its ends.
 */
function limbParts(piece: BodyPiece): [string, Matrix4][] {
  const { length: L, radiusStart: ra, radiusEnd: rb } = piece;
  const flip = rb > ra;
  const r0 = Math.max(ra, rb);
  const k = Math.max(1, Math.round((Math.min(ra, rb) / r0) * 8)) / 8;
  const [wide, narrow] = flip ? [L, 0] : [0, L];
  const frame = new Matrix4().fromArray(piece.matrix);
  const ball = (r: number, y: number) => frame.clone().multiply(new Matrix4().makeScale(r, r, r).setPosition(0, y, 0));
  const frustum = new Matrix4().makeScale(flip ? -r0 : r0, flip ? -L : L, r0).setPosition(0, wide, 0);
  return [
    [`limb@${k}`, frame.clone().multiply(frustum)],
    ['ball', ball(r0, wide)],
    ['ball', ball(k * r0, narrow)],
  ];
}

/** Makes instanced puppet batches (see the file comment). */
export function createPuppetBatches(options: {
  materials: PuppetMaterials;
  name?: string;
  pageSlots?: number;
}): PuppetBatches {
  const name = options.name ?? 'puppets';
  const root = new Group();
  root.name = name;
  const batches = new Map<string, InstancedBatch>();
  const parts = new WeakMap<BodyPiece, readonly (readonly [InstancedBatch, Matrix4])[]>();
  const world = createWorldPose();
  const [bone, out] = [new Matrix4(), new Matrix4()];

  /** The batch of `shape` drawn with material `id`, made on first use. */
  const batchOf = (shape: string, id: string, glow: boolean, defaultId: string) => {
    const key = id === defaultId ? shape : `${shape}~${id}`;
    let batch = batches.get(key);
    if (!batch) {
      const geometry = unitGeometry(shape as Parameters<typeof unitGeometry>[0]);
      const material = options.materials.get(id);
      const [castShadow, receiveShadow, { pageSlots }] = [!glow, !glow, options];
      batch = createInstancedBatch({
        name: `${name}/${key}`,
        geometry,
        material,
        pageSlots,
        castShadow,
        receiveShadow,
      });
      batches.set(key, batch);
      root.add(batch.root);
    }
    return batch;
  };
  /** The batches a piece draws into, each with its matrix in the bone's frame; worked out once per piece. */
  const partsOf = (compiled: CompiledBody, piece: BodyPiece) => {
    let list = parts.get(piece);
    if (list) return list;
    const { material, glowMaterial } = compiled.body;
    const matrix = new Matrix4().fromArray(piece.matrix);
    if (piece.glow) list = [[batchOf(piece.shape, glowMaterial, true, 'material:puppetGlow'), matrix]];
    else {
      const shapes: [string, Matrix4][] = piece.shape === 'limb' ? limbParts(piece) : [[piece.shape, matrix]];
      list = shapes.map(([shape, m]) => [batchOf(shape, material, false, 'material:puppet'), m] as const);
    }
    parts.set(piece, list);
    return list;
  };
  const all = () => [...batches.values()];
  return {
    root,
    batches,
    prepare(compiled) {
      for (const piece of compiled.pieces) partsOf(compiled, piece);
    },
    begin: () => all().forEach((batch) => batch.begin()),
    draw(compiled, pose) {
      forwardKinematics(compiled.skeleton, pose, world);
      let written = 0;
      for (const piece of compiled.pieces) {
        if (piece.bone < 0) bone.compose(pose.rootPos, pose.rootRot, pose.rootScale);
        else bone.fromArray(world.matrices, piece.bone * 16);
        for (const [batch, matrix] of partsOf(compiled, piece)) {
          batch.add(out.multiplyMatrices(bone, matrix).elements, compiled.colors[piece.slot]);
          written++;
        }
      }
      return written;
    },
    end: () => all().forEach((batch) => batch.end()),
    drawCalls: (shadowMaps = 0) => all().reduce((sum, batch) => sum + batch.drawCalls(shadowMaps), 0),
    register(warmup, id = name) {
      return warmup.register(id, { objects: () => all().flatMap((batch) => batch.pages) });
    },
    dispose() {
      for (const batch of all()) batch.dispose();
      root.removeFromParent();
    },
  };
}
