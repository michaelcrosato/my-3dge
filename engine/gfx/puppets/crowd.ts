/**
 * @file Crowd drawing (PLAN.md WP 5.4, I-21): thousands of bodies in a few dozen draw calls, over the instancing
 * service (engine/gfx/instancing.ts). `createCrowd({ materials })` holds the batches and a level of detail
 * (engine/gfx/puppets/lod.ts); each frame, for each body, `see` first, and pose and draw only what it returns a band
 * for:
 * - `humanoid(compiled, pose, { band })`: a compiled body (compile.ts) in a pose from its animator, posed at the
 *   band's level (`animator.pose({ lod: band.pose })`), drawn as instanced parts (draw.ts `createPuppetBatches`),
 *   its capes left out in bands without capes;
 * - `blob(blob, { band })` and `floater(floater, { band })`: a blob or floater rig (engine/anim/blob.ts, floater.ts)
 *   posed from its state alone and drawn in its body (bodies/blob.ts, bodies/floater.ts; `BLOB_BODY` and
 *   `FLOATER_BODY` by default), alike in every band (a rig's pose is a few matrices); `rig(body, joints)` draws any
 *   rig body on any joints;
 * - with `floor` (the floor's height under it, which the caller knows), a blob shadow (blobShadow.ts).
 *
 * A rig body (`RigBody`) is data: its slots, and its parts, each a unit shape on one joint of the rig's pose
 * (`RigPart` says how it is placed and sized).
 *
 * The cost: a draw call per shown page of each batch (a shape and a material: the puppets' `crowd/puppets/<shape>`,
 * the rigs' `crowd/rigs/<shape>`, and `crowd/shadows`), again per shadow map for lit ones. Pages hold
 * `CROWD_PAGE_SLOTS` (8,192) instances, so 5,000 bodies fit in a few pages a batch; pages added as the crowd grows
 * share their batch's shader and build no pipeline (tests/e2e/crowd-render.spec.ts).
 *
 * Invariants: presentation only: nothing here reaches the sim, and a band changes only what is drawn; `prepare`
 * bodies before the warm-up so every batch's first page is compiled then. A rig body's problems throw
 * `GFX_RIG_BODY`, naming the part.
 *
 * Carried from `my-3d2dge:src/stress-world/30-crowd.js:342-373` (`drawCrowd`: culled bodies are neither posed nor
 * drawn, a blob shadow under every body but a wisp, shared batches per shape).
 *
 * @example
 * // const crowd = createCrowd({ materials: library }); crowd.prepare(compiled, BLOB_BODY); scene.add(crowd.root);
 * // crowd.begin(camera);
 * // const band = crowd.see(slime.position.x, slime.position.y + 0.4, slime.position.z, 1);
 * // if (band) crowd.blob(slime, { band, floor: 0 });
 * // crowd.end(); crowd.drawCalls(1); // what the frame costs with one shadow map
 * @see engine/gfx/puppets/crowd.test.ts
 * @see tests/e2e/crowd-render.spec.ts
 */
import { Group, Matrix4, Quaternion, Vector3, type Camera } from 'three/webgpu';
import type { Blob } from '../../anim/blob';
import type { Floater } from '../../anim/floater';
import type { Pose } from '../../anim/pose';
import { toLinear, type Rgb } from '../../core/color';
import { codeError, defineCodes } from '../../core/log';
import { createInstancedBatch, type InstancedBatch } from '../instancing';
import type { Warmup } from '../warmup';
import { BLOB_BODY, BLOB_BODY_RADIUS } from './bodies/blob';
import { FLOATER_BODY } from './bodies/floater';
import { createBlobShadows, type BlobShadows } from './blobShadow';
import type { CompiledBody, PieceShape } from './compile';
import { createPuppetBatches, unitGeometry, type PuppetBatches, type PuppetMaterials } from './draw';
import { createCrowdLod, type CrowdBand, type CrowdLod, type CrowdLodCounts, type CrowdLodOptions } from './lod';

/** The codes crowd drawing raises, with their fixes. */
export const CROWD_CODES = defineCodes('gfx', {
  GFX_RIG_BODY: {
    template: 'rig body {body}, part {part}: {problem}',
    fix: '{fix}',
    doc: 'Raised by `createCrowd` (engine/gfx/puppets/crowd.ts) for a rig body whose part has an unknown shape, a slot the body lacks, a size that is not positive, or a joint the rig’s pose lacks.',
  },
});

/** Instances per page of the crowd's batches. */
export const CROWD_PAGE_SLOTS = 8192;

/** A humanoid's blob shadow, metres at size 1 (the source's 5 units). */
export const HUMANOID_SHADOW = 5 / 16;

/** A unit shape a rig part draws: any but the limb. */
export type RigShape = Exclude<PieceShape, 'limb'>;

type Vec3 = readonly [number, number, number];

/**
 * One part of a rig body: a unit shape (compile.ts's file comment) on one joint of the rig's pose, a matrix, a point
 * or a list of points (one part on each). It sits at `at` in the joint's frame, through the joint's whole matrix,
 * points `toward` a direction and has a `size` in metres: it turns with the joint but keeps its size, scaled only by
 * the rig's `scale` (a blob's radius over its body's), unless it `stretch`es through the joint's scale too (a
 * squashing body), when its size is in the joint's units. `eye` parts are unlit (the body's glow material); a part
 * with a `material` of its own draws in a batch of its own; `when` and `unless` name the rig's flags (`squint`).
 */
export interface RigPart {
  /** Its unit shape; `eye` is drawn unlit. */
  readonly shape: RigShape;
  /** The joint it rides: a key of the rig's pose. */
  readonly on: string;
  /** Its origin in the joint's frame, through the joint's whole matrix (the joint's origin by default). */
  readonly at?: Vec3;
  /** Its size along x, y and z (one number for all three): metres, or with `stretch` the joint's units. */
  readonly size: number | Vec3;
  /** Where its +Y points, in the joint's frame (+Y by default). */
  readonly toward?: Vec3;
  /** Sized by the joint's scale too. */
  readonly stretch?: boolean;
  readonly slot: string;
  /** A material id of its own: drawn in a batch of its own, casting no shadow. */
  readonly material?: string;
  /** Drawn only while this flag of the rig is on. */
  readonly when?: string;
  /** Drawn only while this flag of the rig is off. */
  readonly unless?: string;
}

/** A rig body (see the file comment). */
export interface RigBody {
  /** Its name, for messages. */
  readonly name: string;
  readonly description: string;
  /** Material slots: each name with its hex colour. */
  readonly slots: Readonly<Record<string, string>>;
  readonly parts: readonly RigPart[];
  /** The lit parts' material (`material:puppet`) and the eyes' (`material:puppetGlow`). */
  readonly material?: string;
  readonly glowMaterial?: string;
  /** A blob shadow under joint `on`, `radius` metres before the rig's scale, when a floor is given. */
  readonly shadow?: Readonly<{ on: string; radius: number }>;
}

/** A rig's pose: each joint a world matrix, a point, or a list of points. */
export type RigJoints = Readonly<Record<string, Matrix4 | Vector3 | readonly Vector3[]>>;

/** How a body is drawn: its band (full detail when absent) and the floor under it, for a blob shadow. */
export interface CrowdDraw {
  band?: CrowdBand;
  floor?: number;
}

/** How a rig is drawn: also its flags (`when`, `unless`) and its scale against its body. */
export interface CrowdRigDraw extends CrowdDraw {
  /** The rig's flags by name, read as true or false (a blob's state). */
  flags?: object;
  scale?: number;
}

/** A frame's counts: the bands and culling (lod.ts), bodies drawn, and each batch's instances and shown pages. */
export interface CrowdStats {
  lod: CrowdLodCounts;
  bodies: number;
  instances: Record<string, number>;
  pages: Record<string, number>;
}

/** A crowd's batches and level of detail (see the file comment). */
export interface Crowd {
  readonly root: Group;
  readonly lod: CrowdLod;
  readonly puppets: PuppetBatches;
  /** The rigs' batches, by shape (with `~<material>` for a part's own material). */
  readonly rigs: ReadonlyMap<string, InstancedBatch>;
  readonly shadows: BlobShadows | null;
  /** Makes the batches these bodies need: before the warm-up. */
  prepare(...bodies: (CompiledBody | RigBody)[]): this;
  /** Starts a frame seen by `camera`. */
  begin(camera: Camera): void;
  /** The band a body with this bounding sphere is drawn in, or null when it is not drawn (lod.ts). */
  see(x: number, y: number, z: number, radius: number): CrowdBand | null;
  /** Draws a humanoid's compiled body in `pose`; returns the instances written. */
  humanoid(compiled: CompiledBody, pose: Pose, options?: CrowdDraw): number;
  /** Poses a blob rig and draws it in `body` (`BLOB_BODY`), flagged by its state, scaled by its radius. */
  blob(blob: Blob, options?: CrowdDraw & { body?: RigBody }): number;
  /** Poses a floater rig and draws it in `body` (`FLOATER_BODY`). */
  floater(floater: Floater, options?: CrowdDraw & { body?: RigBody }): number;
  /** Draws `body` on `joints`. Throws `GFX_RIG_BODY`. */
  rig(body: RigBody, joints: RigJoints, options?: CrowdRigDraw): number;
  end(): void;
  /** Draw calls the frame costs: a call per shown page, again per shadow map for casting batches. */
  drawCalls(shadowMaps?: number): number;
  stats(): CrowdStats;
  /** Registers every batch's pages, present and future, with `warmup` as `id` (`<name>` by default). */
  register(warmup: Pick<Warmup, 'register'>, id?: string): { dispose(): void };
  dispose(): void;
}

/** A rig part made ready to draw. */
interface RigPiece {
  readonly part: RigPart;
  readonly batch: InstancedBatch;
  readonly color: Rgb;
  readonly at: Vector3;
  /** Its turn and size (stretching parts: its whole matrix in the joint's frame). */
  readonly local: Matrix4;
}

const SHAPES: readonly string[] = ['ball', 'eye', 'box', 'cone', 'blade', 'strip'];
const Y = new Vector3(0, 1, 0);
/** Scratch objects. */
const [out, unit, point, sizes] = [new Matrix4(), new Matrix4(), new Vector3(), new Vector3()];
const turn = new Quaternion();
const floaterJoints: { core: Matrix4; motes: readonly Vector3[] } = { core: new Matrix4(), motes: [] };
const blobDraw: CrowdRigDraw = {};

/** Makes a crowd's batches and level of detail (see the file comment). */
export function createCrowd(options: {
  materials: PuppetMaterials;
  name?: string;
  pageSlots?: number;
  lod?: CrowdLodOptions;
  /** Whether bodies given a floor get blob shadows (true). */
  shadows?: boolean;
}): Crowd {
  const name = options.name ?? 'crowd';
  const pageSlots = options.pageSlots ?? CROWD_PAGE_SLOTS;
  const root = new Group();
  root.name = name;
  const lod = createCrowdLod(options.lod);
  const puppets = createPuppetBatches({ materials: options.materials, name: `${name}/puppets`, pageSlots });
  const shadows =
    options.shadows === false
      ? null
      : createBlobShadows({ materials: options.materials, name: `${name}/shadows`, pageSlots });
  root.add(puppets.root, ...(shadows ? [shadows.root] : []));
  const rigs = new Map<string, InstancedBatch>();
  const compiledRigs = new WeakMap<RigBody, readonly RigPiece[]>();
  const capeless = new WeakMap<CompiledBody, CompiledBody>();
  let bodies = 0;

  /** The rigs' batch of `shape` drawn with material `id`, made on first use. */
  const batchOf = (shape: RigShape, id: string, lit: boolean, own: boolean) => {
    const key = own ? `${shape}~${id}` : shape;
    let batch = rigs.get(key);
    if (!batch) {
      const material = options.materials.get(id);
      const geometry = unitGeometry(shape);
      batch = createInstancedBatch({
        name: `${name}/rigs/${key}`,
        geometry,
        material,
        pageSlots,
        castShadow: lit,
        receiveShadow: lit,
      });
      rigs.set(key, batch);
      root.add(batch.root);
    }
    return batch;
  };

  /** `body`'s parts made ready to draw, once per body. Throws `GFX_RIG_BODY`. */
  const compileRig = (body: RigBody): readonly RigPiece[] => {
    let pieces = compiledRigs.get(body);
    if (pieces) return pieces;
    pieces = body.parts.map((part, i) => {
      const fail = (problem: string, fix: string) =>
        codeError('GFX_RIG_BODY', { body: body.name, part: i, problem, fix });
      if (!SHAPES.includes(part.shape)) throw fail(`${part.shape} is no shape`, `use one of ${SHAPES.join(', ')}`);
      if (!Object.hasOwn(body.slots, part.slot)) throw fail(`slot ${part.slot} is not in slots`, 'add it to slots');
      const size = typeof part.size === 'number' ? [part.size, part.size, part.size] : part.size;
      if (!size.every((s) => s > 0)) throw fail(`size ${JSON.stringify(part.size)}`, 'give sizes above 0');
      const glow = part.shape === 'eye';
      const id = part.material ?? (glow ? body.glowMaterial : body.material);
      const fallback = glow ? 'material:puppetGlow' : 'material:puppet';
      const batch = batchOf(part.shape, id ?? fallback, !glow && !part.material, part.material !== undefined);
      const at = new Vector3(...(part.at ?? [0, 0, 0]));
      turn.setFromUnitVectors(Y, new Vector3(...(part.toward ?? [0, 1, 0])).normalize());
      const local = new Matrix4().compose(part.stretch ? at : new Vector3(), turn, new Vector3(...size));
      return { part, batch, color: toLinear(body.slots[part.slot]), at, local };
    });
    compiledRigs.set(body, pieces);
    return pieces;
  };

  /** `compiled` without its capes (its strips), the pieces shared. */
  const withoutCapes = (compiled: CompiledBody) => {
    let drawn = capeless.get(compiled);
    if (!drawn) {
      const pieces = compiled.pieces.filter((piece) => piece.shape !== 'strip');
      drawn = pieces.length === compiled.pieces.length ? compiled : { ...compiled, pieces };
      capeless.set(compiled, drawn);
    }
    return drawn;
  };

  /** Writes one rig piece on joint matrix `joint`. */
  const place = (piece: RigPiece, joint: Matrix4, scale: number) => {
    if (piece.part.stretch) out.multiplyMatrices(joint, piece.local);
    else {
      point.copy(piece.at).applyMatrix4(joint);
      out.extractRotation(joint).multiply(piece.local);
      if (scale !== 1) out.scale(sizes.setScalar(scale));
      out.setPosition(point);
    }
    piece.batch.add(out.elements, piece.color);
  };

  const all = () => [...puppets.batches.values(), ...rigs.values(), ...(shadows ? [shadows.batch] : [])];
  const crowd: Crowd = {
    root,
    lod,
    puppets,
    rigs,
    shadows,
    prepare(...list) {
      for (const body of list) {
        if ('skeleton' in body) puppets.prepare(body);
        else compileRig(body);
      }
      return crowd;
    },
    begin(camera) {
      lod.begin(camera);
      bodies = 0;
      puppets.begin();
      for (const batch of rigs.values()) batch.begin();
      shadows?.begin();
    },
    see: (x, y, z, radius) => lod.see(x, y, z, radius),
    humanoid(compiled, pose, draw = {}) {
      const capes = draw.band?.capes ?? true;
      const written = puppets.draw(capes ? compiled : withoutCapes(compiled), pose);
      if (draw.floor !== undefined && shadows) {
        const { x, y, z } = pose.rootPos;
        const s = pose.rootScale;
        const radius = HUMANOID_SHADOW * compiled.skeleton.build.size * Math.max(s.x, s.y, s.z);
        shadows.add(x, draw.floor, z, radius, y - draw.floor);
      }
      bodies++;
      return written;
    },
    blob(blob, draw = {}) {
      Object.assign(blobDraw, { band: draw.band, floor: draw.floor, flags: blob.state });
      blobDraw.scale = blob.radius / BLOB_BODY_RADIUS;
      return crowd.rig(draw.body ?? BLOB_BODY, blob.pose(), blobDraw);
    },
    floater(floater, draw = {}) {
      const { core, motes } = floater.pose();
      [floaterJoints.core, floaterJoints.motes] = [core, motes];
      return crowd.rig(draw.body ?? FLOATER_BODY, floaterJoints, draw);
    },
    rig(body, joints, draw = {}) {
      const scale = draw.scale ?? 1;
      const flags = (draw.flags ?? {}) as Readonly<Record<string, unknown>>;
      let written = 0;
      for (const piece of compileRig(body)) {
        const { when, unless, on } = piece.part;
        if ((when && !flags[when]) || (unless && flags[unless])) continue;
        const joint = joints[on];
        if (!joint) {
          const index = body.parts.indexOf(piece.part);
          const fix = `ride one of its joints: ${Object.keys(joints).join(', ')}`;
          throw codeError('GFX_RIG_BODY', {
            body: body.name,
            part: index,
            problem: `the pose has no joint ${on}`,
            fix,
          });
        }
        const points = Array.isArray(joint) ? joint : 'isVector3' in joint ? [joint] : null;
        if (!points) place(piece, joint as Matrix4, scale);
        for (const p of points ?? []) place(piece, unit.makeTranslation(p.x, p.y, p.z), scale);
        written += points ? points.length : 1;
      }
      const shadow = body.shadow;
      if (draw.floor !== undefined && shadows && shadow) {
        const joint = joints[shadow.on];
        if (joint && !Array.isArray(joint)) {
          const at = 'isVector3' in joint ? point.copy(joint) : point.setFromMatrixPosition(joint as Matrix4);
          shadows.add(at.x, draw.floor, at.z, shadow.radius * scale, at.y - draw.floor);
        }
      }
      bodies++;
      return written;
    },
    end() {
      puppets.end();
      for (const batch of rigs.values()) batch.end();
      shadows?.end();
    },
    drawCalls: (shadowMaps = 0) => all().reduce((sum, batch) => sum + batch.drawCalls(shadowMaps), 0),
    stats() {
      const instances: Record<string, number> = {};
      const pages: Record<string, number> = {};
      for (const batch of all()) {
        instances[batch.name] = batch.count;
        pages[batch.name] = batch.pages.filter((page) => page.count > 0).length;
      }
      return { lod: lod.counts(), bodies, instances, pages };
    },
    register(warmup, id = name) {
      return warmup.register(id, { objects: () => all().flatMap((batch) => batch.pages) });
    },
    dispose() {
      puppets.dispose();
      for (const batch of rigs.values()) batch.dispose();
      shadows?.dispose();
      root.removeFromParent();
    },
  };
  return crowd;
}
