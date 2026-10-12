/**
 * @file The glTF binary reader the importer uses (PLAN.md §5.3, WP 8.5): a `.glb`'s JSON and binary chunks, its
 * accessors, its node tree and its animation tracks, sampled at any time. Ported from `my-3d2dge:tools/
 * anim-import.mjs:124-156, 212-223` (the matrices and the sampling keep its operations, for its bits), with the guards
 * it lacked, each refused or read by the glTF 2.0 spec instead of read wrong:
 * - **signed and quantized accessors** (`KHR_mesh_quantization`): BYTE and SHORT components, and normalized integers
 *   read as `max(c / 127, -1)` and `max(c / 32767, -1)` when signed (`c / 255`, `c / 65535` unsigned);
 * - **sparse accessors**: the listed elements replace the base (zeros when it has no buffer view);
 * - **CUBICSPLINE tracks**: an in-tangent, a value and an out-tangent per key, in-betweened as the spec's Hermite
 *   spline (a rotation renormalized), where the source read every third element as a key;
 * - an accessor or a chunk that reads past the file's end, an unknown component or element type, a missing chunk.
 *
 * Invariants: matrices are column-major 4 × 4 arrays, quaternions `[x, y, z, w]`, distances the file's (metres). A
 * bone name matches whatever its case, and without a namespace (Mixamo's `mixamorig:Hips` answers to `hips`), as
 * shardfall's reader does (`crates/pav_tools/src/mocap/glb.rs`). Errors name the file and the fix.
 *
 * @example
 * const doc = { asset: { version: '2.0' }, nodes: [{ name: 'Root', children: [1] }, { name: 'mixamorig:Hips' }] };
 * const glb = parseGlb(glbBytes(doc, new Uint8Array(0)), 'test.glb');
 * nodeTree(glb).find('HIPS'); // 1
 * @see tools/anim/glb.test.ts
 */

/** The parts of a glTF document the importer reads (anything else is ignored). */
export interface GltfJson {
  accessors?: GltfAccessor[];
  bufferViews?: { buffer?: number; byteOffset?: number; byteLength: number; byteStride?: number }[];
  nodes?: GltfNode[];
  skins?: { joints: number[]; inverseBindMatrices?: number }[];
  meshes?: { primitives: { attributes: Record<string, number>; material?: number }[] }[];
  materials?: { name?: string }[];
  animations?: GltfAnimation[];
  [key: string]: unknown;
}
/** An accessor: how to read typed elements out of a buffer view. */
export interface GltfAccessor {
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  normalized?: boolean;
  count: number;
  type: string;
  sparse?: {
    count: number;
    indices: { bufferView: number; byteOffset?: number; componentType: number };
    values: { bufferView: number; byteOffset?: number };
  };
}
/** A node: its name, children, and rest transform. */
export interface GltfNode {
  name?: string;
  children?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
  mesh?: number;
  skin?: number;
}
/** An animation: channels targeting node paths, through samplers. */
export interface GltfAnimation {
  name?: string;
  channels: { sampler: number; target: { node?: number; path: string } }[];
  samplers: { input: number; output: number; interpolation?: string }[];
}
/** A parsed `.glb`: its JSON, the whole file and where the binary chunk's data starts. */
export interface Glb {
  json: GltfJson;
  bytes: Uint8Array;
  bin: number;
  file: string;
}

const MAGIC = 0x46546c67; // 'glTF'
const SIZE: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
/** Each component type's bytes, and the divisor that normalizes it (signed ones clamp at −1). */
const COMPONENT: Record<number, { bytes: number; norm: number; signed: boolean }> = {
  5120: { bytes: 1, norm: 127, signed: true },
  5121: { bytes: 1, norm: 255, signed: false },
  5122: { bytes: 2, norm: 32767, signed: true },
  5123: { bytes: 2, norm: 65535, signed: false },
  5125: { bytes: 4, norm: 1, signed: false },
  5126: { bytes: 4, norm: 1, signed: false },
};

/** Splits a `.glb` into its JSON and the binary chunk's start; `file` names it in errors. */
export function parseGlb(bytes: Uint8Array, file: string): Glb {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 20 || view.getUint32(0, true) !== MAGIC) {
    throw new Error(`${file} is not a binary glTF (.glb) file: convert it first (tools/anim/to-glb.py)`);
  }
  const jsonLength = view.getUint32(12, true);
  if (20 + jsonLength > bytes.length) throw new Error(`${file}: its JSON chunk runs past the file's end: re-export it`);
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength))) as GltfJson;
  return { json, bytes, bin: 20 + jsonLength + 8, file };
}

/** Reads one number of a component type at byte `offset`. */
function component(view: DataView, type: number, offset: number): number {
  switch (type) {
    case 5120:
      return view.getInt8(offset);
    case 5121:
      return view.getUint8(offset);
    case 5122:
      return view.getInt16(offset, true);
    case 5123:
      return view.getUint16(offset, true);
    case 5125:
      return view.getUint32(offset, true);
    default:
      return view.getFloat32(offset, true);
  }
}

/** An accessor's elements: numbers for SCALAR, else arrays of its components, normalized when it says so. */
export function readAccessor(glb: Glb, index: number): (number | number[])[] {
  const a = glb.json.accessors?.[index];
  const where = `${glb.file}: accessor ${index}`;
  if (!a) throw new Error(`${where} does not exist: the file is damaged; re-export it`);
  const n = SIZE[a.type];
  const kind = COMPONENT[a.componentType];
  if (!n || !kind) {
    throw new Error(`${where} has ${a.type} of component type ${a.componentType}, which glTF 2.0 does not define`);
  }
  const view = new DataView(glb.bytes.buffer, glb.bytes.byteOffset, glb.bytes.byteLength);
  const scale = (c: number) =>
    !a.normalized || kind.norm === 1 ? c : kind.signed ? Math.max(c / kind.norm, -1) : c / kind.norm;
  const rows: number[][] = Array.from({ length: a.count }, () => new Array<number>(n).fill(0));
  const fill = (viewIndex: number, extraOffset: number, count: number, at: (k: number) => number) => {
    const bv = glb.json.bufferViews?.[viewIndex];
    if (!bv) throw new Error(`${where} names buffer view ${viewIndex}, which does not exist: re-export it`);
    const base = glb.bin + (bv.byteOffset ?? 0) + extraOffset;
    const stride = bv.byteStride || n * kind.bytes;
    if (count > 0 && base + (count - 1) * stride + n * kind.bytes > glb.bytes.length) {
      throw new Error(`${where} reads past the end of the file: the file is truncated; re-export it`);
    }
    for (let k = 0; k < count; k++)
      for (let c = 0; c < n; c++)
        rows[at(k)][c] = scale(component(view, a.componentType, base + k * stride + c * kind.bytes));
  };
  if (a.bufferView !== undefined) fill(a.bufferView, a.byteOffset ?? 0, a.count, (k) => k);
  if (a.sparse) {
    const { indices, values, count } = a.sparse;
    const ib = glb.json.bufferViews?.[indices.bufferView];
    if (!ib) throw new Error(`${where}: its sparse indices name a missing buffer view: re-export it`);
    const bytes = COMPONENT[indices.componentType]?.bytes ?? 4;
    const at = (k: number) =>
      component(view, indices.componentType, glb.bin + (ib.byteOffset ?? 0) + (indices.byteOffset ?? 0) + k * bytes);
    fill(values.bufferView, values.byteOffset ?? 0, count, at);
  }
  return n === 1 ? rows.map((row) => row[0]) : rows;
}

/** A node tree: each node's parent (−1 for a root), the order that visits parents first, and names by any case. */
export interface NodeTree {
  parent: number[];
  order: number[];
  /** The node named `name`: exactly, else whatever its case, else without a namespace (`mixamorig:`). */
  find(name: string): number | undefined;
}

/** The document's node tree. */
export function nodeTree(glb: Glb): NodeTree {
  const nodes = glb.json.nodes ?? [];
  const parent = new Array<number>(nodes.length).fill(-1);
  const [exact, lower, bare] = [new Map<string, number>(), new Map<string, number>(), new Map<string, number>()];
  nodes.forEach((node, i) => {
    for (const c of node.children ?? []) parent[c] = i;
    const name = node.name ?? '';
    if (!exact.has(name)) exact.set(name, i);
    if (!lower.has(name.toLowerCase())) lower.set(name.toLowerCase(), i);
    const tail = name.includes(':') ? name.slice(name.lastIndexOf(':') + 1).toLowerCase() : '';
    if (tail && !bare.has(tail)) bare.set(tail, i);
  });
  const [order, seen] = [[] as number[], new Set<number>()];
  const visit = (i: number) => {
    if (seen.has(i)) return;
    if (parent[i] >= 0) visit(parent[i]);
    seen.add(i);
    order.push(i);
  };
  nodes.forEach((_, i) => visit(i));
  const find = (name: string) => exact.get(name) ?? lower.get(name.toLowerCase()) ?? bare.get(name.toLowerCase());
  return { parent, order, find };
}

/* ---- column-major 4 × 4 matrices and quaternions [x, y, z, w], as the source writes them ---- */
/** A transform matrix from a translation, a rotation and a scale. */
export function mat(t = [0, 0, 0], q = [0, 0, 0, 1], s = [1, 1, 1]): number[] {
  const [x, y, z, w] = q;
  const [xx, yy, zz, xy, xz, yz, wx, wy, wz] = [x * x, y * y, z * z, x * y, x * z, y * z, w * x, w * y, w * z];
  return [
    ...[(1 - 2 * (yy + zz)) * s[0], 2 * (xy + wz) * s[0], 2 * (xz - wy) * s[0], 0],
    ...[2 * (xy - wz) * s[1], (1 - 2 * (xx + zz)) * s[1], 2 * (yz + wx) * s[1], 0],
    ...[2 * (xz + wy) * s[2], 2 * (yz - wx) * s[2], (1 - 2 * (xx + yy)) * s[2], 0],
    ...[t[0], t[1], t[2], 1],
  ];
}
/** The product `a · b`. */
export function mul(a: number[], b: number[]): number[] {
  const o = new Array<number>(16);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return o;
}
/** Point `p` transformed by `m`. */
export const xf = (m: number[], p: number[]): number[] => [
  m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
  m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
];
/** The shortest rotation from `a` toward `b`, a share `t` of the way (normalized-linear when they nearly agree). */
export function slerp(a: number[], b: number[], t: number): number[] {
  let [d, s] = [a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3], 1];
  if (d < 0) [d, s] = [-d, -1];
  if (d > 0.9995) {
    const o = a.map((v, i) => v + (b[i] * s - v) * t);
    const l = Math.hypot(...o);
    return o.map((v) => v / l);
  }
  const th = Math.acos(d);
  const [k0, k1] = [Math.sin((1 - t) * th) / Math.sin(th), (Math.sin(t * th) / Math.sin(th)) * s];
  return a.map((v, i) => v * k0 + b[i] * k1);
}

/** One animation channel: the node and path it moves, its key times and values, and how it in-betweens. */
export interface Track {
  node: number;
  path: 'translation' | 'rotation' | 'scale';
  t: number[];
  v: number[][];
  interpolation: 'LINEAR' | 'STEP' | 'CUBICSPLINE';
}

/** An animation's tracks (channels with no node, or moving weights, are left out). */
export function tracksOf(glb: Glb, animation: GltfAnimation): Track[] {
  const tracks: Track[] = [];
  for (const channel of animation.channels) {
    const { node, path } = channel.target;
    if (node === undefined || !['translation', 'rotation', 'scale'].includes(path)) continue;
    const sampler = animation.samplers[channel.sampler];
    const interpolation = (sampler.interpolation ?? 'LINEAR') as Track['interpolation'];
    if (!['LINEAR', 'STEP', 'CUBICSPLINE'].includes(interpolation)) {
      throw new Error(`${glb.file}: ${animation.name ?? 'an animation'} in-betweens by ${interpolation}: re-export it`);
    }
    const t = readAccessor(glb, sampler.input) as number[];
    const v = readAccessor(glb, sampler.output) as number[][];
    if (v.length !== t.length * (interpolation === 'CUBICSPLINE' ? 3 : 1)) {
      throw new Error(
        `${glb.file}: ${animation.name ?? 'an animation'} has ${t.length} key times and ${v.length} values`,
      );
    }
    tracks.push({ node, path: path as Track['path'], t, v, interpolation });
  }
  return tracks;
}

/** A track's value at `time`: held before its first key and after its last, in-betweened as it says between. */
export function sampleTrack(k: Track, time: number): number[] {
  const T = k.t;
  let j = 0;
  while (j < T.length - 2 && T[j + 1] <= time) j++;
  const u =
    T.length < 2 || k.interpolation === 'STEP' ? 0 : Math.max(0, Math.min(1, (time - T[j]) / (T[j + 1] - T[j] || 1)));
  if (k.interpolation === 'CUBICSPLINE') {
    const j1 = Math.min(j + 1, T.length - 1);
    const [v0, v1, out0, in1] = [k.v[j * 3 + 1], k.v[j1 * 3 + 1], k.v[j * 3 + 2], k.v[j1 * 3]];
    const td = (T[j1] ?? T[j]) - T[j];
    const [s2, s3] = [u * u, u * u * u];
    const [h00, h10, h01, h11] = [2 * s3 - 3 * s2 + 1, s3 - 2 * s2 + u, -2 * s3 + 3 * s2, s3 - s2];
    const p = v0.map((x, i) => h00 * x + h10 * td * out0[i] + h01 * v1[i] + h11 * td * in1[i]);
    if (k.path !== 'rotation') return p;
    const l = Math.hypot(...p) || 1;
    return p.map((x) => x / l);
  }
  const [a, b] = [k.v[j], k.v[Math.min(j + 1, k.v.length - 1)]];
  return k.path === 'rotation' ? slerp(a, b, u) : a.map((x, i) => x + (b[i] - x) * u);
}

/** A `.glb` file's bytes from a document and its binary data (for tests and tools that write one). */
export function glbBytes(json: object, bin: Uint8Array): Uint8Array {
  const pad = (n: number) => (4 - (n % 4)) % 4;
  const text = new TextEncoder().encode(JSON.stringify(json));
  const jsonChunk = new Uint8Array(text.length + pad(text.length)).fill(0x20);
  jsonChunk.set(text);
  const binChunk = new Uint8Array(bin.length + pad(bin.length));
  binChunk.set(bin);
  const out = new Uint8Array(12 + 8 + jsonChunk.length + 8 + binChunk.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, MAGIC, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, out.length, true);
  view.setUint32(12, jsonChunk.length, true);
  view.setUint32(16, 0x4e4f534a, true); // 'JSON'
  out.set(jsonChunk, 20);
  view.setUint32(20 + jsonChunk.length, binChunk.length, true);
  view.setUint32(24 + jsonChunk.length, 0x004e4942, true); // 'BIN'
  out.set(binChunk, 28 + jsonChunk.length);
  return out;
}
