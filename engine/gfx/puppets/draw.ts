/**
 * @file Drawing puppets (PLAN.md WP 3.8, I-21): a compiled body (compile.ts) drawn two ways from the same pieces.
 * - `createPuppet(compiled, { materials })`: one rigid-skinned three.js `SkinnedMesh` per character. Its `Skeleton`
 *   has a bone for the root and one per joint, placed as engine/anim/fk.ts composes them (root T·R·S, then each
 *   joint's rest offset and local rotation), bound at the rest pose; every vertex follows the one bone its piece
 *   rides, with weight 1 (smooth skinning is for later). `setPose(pose)` writes a WP 3.4 `Pose` into the bones, so
 *   the drawn sockets are FK's. Its geometry holds every lit piece in one group and every glow piece (eyes) in
 *   another, coloured per vertex from the slots: two draw calls, and two more per shadow map. `hide(joints)` gives
 *   the vertices of the pieces on those joints no skin weight (first person's near-body culling), so skinning folds
 *   them to a point that covers no pixel: an attribute upload, never a pipeline; the bones move as before.
 * - `createPuppetBatches({ materials })`: instanced parts per shape for crowds (engine/gfx/instancing.ts):
 *   `draw(compiled, pose)` runs FK and writes each piece's world matrix and slot colour into its shape's batch; a
 *   limb draws as a frustum whose taper is rounded to eighths (one batch per eighth) with a ball at each end, so a
 *   crowd costs a draw call per shape, whatever its size.
 *
 * Materials come from the body (`material`, `glowMaterial`) through the page's material library; this module
 * defines the two it names by default (`material:puppet`, lit, and `material:puppetGlow`, unlit, both white and
 * multiplied by the vertex or instance colour) on the shared registry, and on any other with `puppetMaterials`.
 *
 * Invariants: unit shapes have positions and normals only (no UVs), so every lit shape shares one shader; the
 * bones' names are `root` and the joints'; a puppet's bounding sphere is `reach` around the pelvis, so culling
 * never drops a posed body; nothing here reaches the sim.
 *
 * @example
 * // const puppet = createPuppet(compileBody('body:humanoid'), { materials: library });
 * // scene.add(puppet.mesh); puppet.setPose(pose); puppet.socketPosition('weaponR'); // as FK has it
 * @see engine/gfx/puppets/draw.test.ts
 * @see tests/e2e/puppets.spec.ts
 */
import {
  Bone,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Matrix4,
  Skeleton,
  SkinnedMesh,
  Sphere,
  SphereGeometry,
  Vector3,
  type Material,
} from 'three/webgpu';
import { createWorldPose, forwardKinematics } from '../../anim/fk';
import { Pose } from '../../anim/pose';
import { JOINTS, PARENTS, SOCKETS, type JointName, type SocketName } from '../../anim/skeleton';
import { registry as sharedRegistry, type Registry } from '../../core/registry';
import { limbGeometry } from '../geometry/limb';
import { createInstancedBatch, type InstancedBatch } from '../instancing';
import { defineMaterial, materialKind, type MaterialSpec } from '../materials/material';
import type { Warmup } from '../warmup';
import type { BodyPiece, CompiledBody, PieceShape } from './compile';

/** The materials puppets draw with by default. */
export const PUPPET_MATERIALS: Readonly<Record<string, MaterialSpec>> = {
  'material:puppet': {
    description: 'A puppet, lit: white, multiplied by each part’s slot colour (vertex or instance colours).',
    vertexColors: true,
    roughness: 0.8,
  },
  'material:puppetGlow': {
    description: 'A puppet’s eyes and glows, unlit: white, multiplied by the slot colour.',
    vertexColors: true,
    unlit: true,
  },
};

/** Defines `PUPPET_MATERIALS` on `registry` (the shared one by default), those it lacks. */
export function puppetMaterials(registry: Registry = sharedRegistry): void {
  materialKind(registry);
  for (const [id, spec] of Object.entries(PUPPET_MATERIALS))
    if (!registry.has('material', id)) defineMaterial(id, spec, registry);
}
puppetMaterials();

/** Where materials come from: the page's material library. */
export interface PuppetMaterials {
  get(id: string): Material;
}

/** `geometry` with only positions and normals, flat-shaded when `flat`. */
function plain(geometry: BufferGeometry, flat = false): BufferGeometry {
  const out = flat ? geometry.toNonIndexed() : geometry;
  for (const name of Object.keys(out.attributes))
    if (name !== 'position' && name !== 'normal') out.deleteAttribute(name);
  if (flat) out.computeVertexNormals();
  return out;
}

/** A blade: a diamond section 1 wide and 1 thick from y = 0, pointed from y = 0.8 to its tip at y = 1. */
function bladeGeometry(): BufferGeometry {
  const body = new CylinderGeometry(0.5, 0.5, 0.8, 4, 1).translate(0, 0.4, 0);
  const tip = new ConeGeometry(0.5, 0.2, 4, 1, true).translate(0, 0.9, 0);
  const parts = [plain(body, true), plain(tip, true)];
  const merged = new BufferGeometry();
  for (const name of ['position', 'normal']) {
    const arrays = parts.map((part) => part.getAttribute(name).array as Float32Array);
    merged.setAttribute(name, new BufferAttribute(Float32Array.from(arrays.flatMap((a) => Array.from(a))), 3));
  }
  return merged;
}

/** A cape strip: a slab 1 thick, 1 wide at y = 0, flaring to 1.25 at y = 1. */
function stripGeometry(): BufferGeometry {
  const strip = plain(new BoxGeometry(1, 1, 1, 1, 4, 1).translate(0, 0.5, 0), true);
  const position = strip.getAttribute('position');
  for (let i = 0; i < position.count; i++) position.setX(i, position.getX(i) * (1 + 0.25 * position.getY(i)));
  strip.computeVertexNormals();
  return strip;
}

/** The unit shapes (compile.ts's file comment), made once. */
const UNIT = new Map<string, BufferGeometry>();

/** The unit geometry of `shape`; `limb@k` is an open frustum of radius 1 at y = 0 and k at y = 1. */
export function unitGeometry(shape: Exclude<PieceShape, 'limb'> | `limb@${number}`): BufferGeometry {
  let geometry = UNIT.get(shape);
  if (geometry) return geometry;
  if (shape.startsWith('limb@')) {
    const k = Number(shape.slice(5));
    geometry = plain(new CylinderGeometry(k, 1, 1, 10, 1, true).translate(0, 0.5, 0));
  } else if (shape === 'ball') geometry = plain(new SphereGeometry(1, 12, 8));
  else if (shape === 'eye') geometry = plain(new SphereGeometry(1, 8, 6));
  else if (shape === 'box') geometry = plain(new BoxGeometry(1, 1, 1), true);
  else if (shape === 'cone') geometry = plain(new ConeGeometry(1, 1, 8).translate(0, 0.5, 0));
  else if (shape === 'blade') geometry = bladeGeometry();
  else geometry = stripGeometry();
  UNIT.set(shape, geometry);
  return geometry;
}

/** A piece's geometry at rest in the character's frame: its unit shape (or exact limb) moved by its rest matrix. */
function pieceGeometry(compiled: CompiledBody, piece: BodyPiece): BufferGeometry {
  const { length, radiusStart, radiusEnd } = piece;
  const source =
    piece.shape === 'limb'
      ? limbGeometry({ length, radiusStart, radiusEnd, radialSegments: 10, capSegments: 3 })
      : unitGeometry(piece.shape);
  const at = piece.bone < 0 ? [0, 0, 0] : Array.from(compiled.rest.subarray(piece.bone * 3, piece.bone * 3 + 3));
  const matrix = new Matrix4().fromArray(piece.matrix).premultiply(new Matrix4().makeTranslation(at[0], at[1], at[2]));
  return plain(source.clone()).applyMatrix4(matrix);
}

/** Where one piece's vertices lie in a puppet's geometry (`geometry.userData.pieces`, in drawing order). */
export interface PieceRange {
  readonly part: string;
  readonly shape: PieceShape;
  readonly slot: string;
  readonly start: number;
  readonly count: number;
}

/**
 * The rigid-skinned geometry of `compiled`: lit pieces (group 0), then glow pieces (group 1), see the file comment;
 * `userData.pieces` lists each piece's vertices (`PieceRange`).
 */
export function puppetGeometry(compiled: CompiledBody): BufferGeometry {
  const ordered = [...compiled.pieces.filter((p) => !p.glow), ...compiled.pieces.filter((p) => p.glow)];
  const parts = ordered.map((piece) => ({ piece, geometry: pieceGeometry(compiled, piece) }));
  const vertices = parts.reduce((sum, part) => sum + part.geometry.getAttribute('position').count, 0);
  const [position, normal, color] = [0, 0, 0].map(() => new Float32Array(vertices * 3));
  const skinIndex = new Uint16Array(vertices * 4);
  const skinWeight = new Float32Array(vertices * 4);
  const index: number[] = [];
  const ranges: PieceRange[] = [];
  let offset = 0;
  let litIndices = 0;
  for (const { piece, geometry } of parts) {
    const count = geometry.getAttribute('position').count;
    ranges.push({ part: piece.part, shape: piece.shape, slot: piece.slot, start: offset, count });
    position.set(geometry.getAttribute('position').array as Float32Array, offset * 3);
    normal.set(geometry.getAttribute('normal').array as Float32Array, offset * 3);
    const rgb = compiled.colors[piece.slot];
    for (let v = offset; v < offset + count; v++) {
      color.set(rgb, v * 3);
      skinIndex[v * 4] = piece.bone + 1;
      skinWeight[v * 4] = 1;
    }
    const own = geometry.getIndex();
    for (let i = 0; i < (own ? own.count : count); i++) index.push(offset + (own ? own.getX(i) : i));
    if (!piece.glow) litIndices = index.length;
    offset += count;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(position, 3));
  geometry.setAttribute('normal', new BufferAttribute(normal, 3));
  geometry.setAttribute('color', new BufferAttribute(color, 3));
  geometry.setAttribute('skinIndex', new BufferAttribute(skinIndex, 4));
  geometry.setAttribute('skinWeight', new BufferAttribute(skinWeight, 4));
  geometry.setIndex(index);
  if (litIndices > 0) geometry.addGroup(0, litIndices, 0);
  if (index.length > litIndices) geometry.addGroup(litIndices, index.length - litIndices, 1);
  geometry.userData.pieces = ranges;
  return geometry;
}

/** One character drawn as a rigid-skinned mesh (see the file comment). */
export interface Puppet {
  readonly mesh: SkinnedMesh;
  readonly compiled: CompiledBody;
  /** Writes `pose` into the bones and the bounding sphere. */
  setPose(pose: Pose): this;
  /** Where `socket` is drawn, from the bones' world matrices. */
  socketPosition(socket: SocketName, out?: Vector3): Vector3;
  /** Hides the pieces riding `joints` and shows the rest (see the file comment); `[]` shows every piece. */
  hide(joints: readonly JointName[]): this;
  /** Draw calls a frame costs: one per group (lit, glow), again per shadow map. */
  drawCalls(shadowMaps?: number): number;
  /** Registers the mesh with `warmup` as `id` (the mesh's name, `puppet:<body>`, by default). */
  register(warmup: Pick<Warmup, 'register'>, id?: string): { dispose(): void };
  /** Frees the geometry and removes the mesh from its parent. */
  dispose(): void;
}

/** Draws `compiled` as one rigid-skinned mesh (see the file comment), at rest until `setPose`. */
export function createPuppet(compiled: CompiledBody, options: { materials: PuppetMaterials; name?: string }): Puppet {
  const { body, skeleton, rest } = compiled;
  const bones = [new Bone(), ...JOINTS.map(() => new Bone())];
  bones[0].name = 'root';
  JOINTS.forEach((name, j) => {
    const bone = bones[j + 1];
    bone.name = name;
    bone.position.fromArray(skeleton.offsets, j * 3);
    bones[PARENTS[j] + 1].add(bone);
  });
  const inverses = bones.map((_, b) =>
    b ? new Matrix4().makeTranslation(-rest[b * 3 - 3], -rest[b * 3 - 2], -rest[b * 3 - 1]) : new Matrix4(),
  );
  const geometry = puppetGeometry(compiled);
  const materials = [options.materials.get(body.material), options.materials.get(body.glowMaterial)];
  const mesh = new SkinnedMesh(geometry, materials);
  mesh.name = options.name ?? `puppet:${body.id}`;
  mesh.add(bones[0]);
  mesh.bind(new Skeleton(bones, inverses), new Matrix4());
  Object.assign(mesh, { castShadow: true, receiveShadow: true, boundingSphere: new Sphere() });
  Object.assign(mesh.userData, { body: body.id, build: skeleton.build.id });
  const [pelvis, shown] = [new Vector3(), { hidden: new Set<number>() }];
  const puppet: Puppet = {
    mesh,
    compiled,
    setPose(pose) {
      bones[0].position.copy(pose.rootPos);
      bones[0].quaternion.copy(pose.rootRot);
      bones[0].scale.copy(pose.rootScale);
      for (let j = 0; j < JOINTS.length; j++) bones[j + 1].quaternion.fromArray(pose.local, j * 4);
      pelvis.fromArray(skeleton.offsets, 0).multiply(pose.rootScale).applyQuaternion(pose.rootRot).add(pose.rootPos);
      const scale = Math.max(Math.abs(pose.rootScale.x), Math.abs(pose.rootScale.y), Math.abs(pose.rootScale.z));
      mesh.boundingSphere!.set(pelvis, compiled.reach * scale);
      return puppet;
    },
    socketPosition(socket, out = new Vector3()) {
      const s = SOCKETS.indexOf(socket);
      const bone = bones[skeleton.socketJoints[s] + 1];
      bone.updateWorldMatrix(true, false);
      return out.fromArray(skeleton.socketOffsets, s * 3).applyMatrix4(bone.matrixWorld);
    },
    hide(joints) {
      const next = new Set(joints.map((joint) => JOINTS.indexOf(joint) + 1)); // the bones, as skinIndex holds them
      if (next.size === shown.hidden.size && [...next].every((bone) => shown.hidden.has(bone))) return puppet;
      const [skinIndex, skinWeight] = [geometry.getAttribute('skinIndex'), geometry.getAttribute('skinWeight')];
      for (let v = 0; v < skinIndex.count; v++) skinWeight.setX(v, next.has(skinIndex.getX(v)) ? 0 : 1);
      [shown.hidden, skinWeight.needsUpdate] = [next, true];
      return puppet;
    },
    drawCalls(shadowMaps = 0) {
      return geometry.groups.length * (1 + (mesh.castShadow ? shadowMaps : 0));
    },
    register(warmup, id = mesh.name) {
      return warmup.register(id, { objects: () => [mesh] });
    },
    dispose() {
      geometry.dispose();
      mesh.removeFromParent();
    },
  };
  return puppet.setPose(new Pose());
}

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
