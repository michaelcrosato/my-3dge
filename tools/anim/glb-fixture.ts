/**
 * @file Small `.glb` files built in memory for the importer's tests (WP 8.5; no binary fixture is committed): a
 * `GlbBuilder` that packs typed arrays into accessors, and `riggedGlb`, a T-posed humanoid with the Unreal
 * mannequin's bone names (tools/anim/rigs.ts) and the clips asked for, each a track list on named bones.
 *
 * The figure faces +Z with its left at +X, 1.8 m tall; every bone's rest rotation is the identity, so a bone's local
 * axes are the world's. A clip's tracks may use any component type, normalized or not, and any interpolation, so the
 * reader's guards meet them through the whole importer.
 *
 * @example
 * const library = readGlbLibrary(riggedGlb(), 'test.glb', 30); // tools/anim/glb-library.ts
 * library.clips.Wave_Loop.n; // 31
 * @see tools/anim/glb-library.test.ts
 */
import { glbBytes } from './glb';

/** Packs elements into one binary buffer, one buffer view and accessor each. */
export class GlbBuilder {
  readonly accessors: object[] = [];
  readonly bufferViews: object[] = [];
  private chunks: Uint8Array[] = [];
  private length = 0;

  /** Adds `values` as an accessor of `type` (`VEC4`…) in `componentType`; returns its index. */
  add(values: readonly number[], type: string, componentType = 5126, normalized = false): number {
    const Typed = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array }[
      componentType
    ];
    const typed = Typed ? new Typed(values) : new Float32Array(values);
    const bytes = new Uint8Array(typed.buffer.slice(0));
    const pad = (4 - (this.length % 4)) % 4;
    this.chunks.push(new Uint8Array(pad), bytes);
    this.bufferViews.push({ buffer: 0, byteOffset: this.length + pad, byteLength: bytes.length });
    this.length += pad + bytes.length;
    const n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[type] ?? 1;
    const accessor = { bufferView: this.bufferViews.length - 1, componentType, count: values.length / n, type };
    this.accessors.push(normalized ? { ...accessor, normalized } : accessor);
    return this.accessors.length - 1;
  }

  /** The `.glb` of document `json` with this builder's accessors, buffer views and buffer. */
  build(json: object): Uint8Array {
    const bin = new Uint8Array(this.length);
    let at = 0;
    for (const chunk of this.chunks) {
      bin.set(chunk, at);
      at += chunk.length;
    }
    const doc = { asset: { version: '2.0' }, ...json, buffers: [{ byteLength: bin.length }] };
    return glbBytes({ ...doc, accessors: this.accessors, bufferViews: this.bufferViews }, bin);
  }
}

/** The Unreal mannequin's bones: `[name, parent, head position in metres (x left, y up, z forward)]`. */
const SKELETON: [string, string | null, number[]][] = [
  ['root', null, [0, 0, 0]],
  ['pelvis', 'root', [0, 0.95, 0]],
  ['spine_01', 'pelvis', [0, 1.05, 0]],
  ['spine_02', 'spine_01', [0, 1.15, 0]],
  ['spine_03', 'spine_02', [0, 1.3, 0]],
  ['neck_01', 'spine_03', [0, 1.5, -0.01]],
  ['Head', 'neck_01', [0, 1.6, 0]],
  ['head_leaf', 'Head', [0, 1.8, 0]],
  ...(['l', 'r'] as const).flatMap((s): [string, string, number[]][] => {
    const x = s === 'l' ? 1 : -1;
    return [
      [`clavicle_${s}`, 'spine_03', [0.03 * x, 1.45, 0.02]],
      [`upperarm_${s}`, `clavicle_${s}`, [0.18 * x, 1.45, 0]],
      [`lowerarm_${s}`, `upperarm_${s}`, [0.46 * x, 1.45, 0]],
      [`hand_${s}`, `lowerarm_${s}`, [0.72 * x, 1.45, 0]],
      [`index_01_${s}`, `hand_${s}`, [0.8 * x, 1.45, 0.03]],
      [`middle_01_${s}`, `hand_${s}`, [0.81 * x, 1.45, 0]],
      [`pinky_01_${s}`, `hand_${s}`, [0.79 * x, 1.45, -0.03]],
      [`middle_02_${s}`, `middle_01_${s}`, [0.85 * x, 1.45, 0]],
      [`thigh_${s}`, 'pelvis', [0.1 * x, 0.92, 0]],
      [`calf_${s}`, `thigh_${s}`, [0.1 * x, 0.5, 0.01]],
      [`foot_${s}`, `calf_${s}`, [0.1 * x, 0.08, 0]],
      [`ball_${s}`, `foot_${s}`, [0.1 * x, 0.02, 0.13]],
      [`ball_leaf_${s}`, `ball_${s}`, [0.1 * x, 0.02, 0.2]],
    ];
  }),
];

/** One animation track: a bone, a path, key times and flat values, optionally quantized or splined. */
export interface FixtureTrack {
  bone: string;
  path: 'translation' | 'rotation' | 'scale';
  times: number[];
  values: number[];
  interpolation?: 'LINEAR' | 'STEP' | 'CUBICSPLINE';
  componentType?: number;
  normalized?: boolean;
}

/** A rotation of `deg` degrees about `axis` as `[x, y, z, w]`. */
export function turn(axis: [number, number, number], deg: number): number[] {
  const h = (deg * Math.PI) / 360;
  return [...axis.map((v) => v * Math.sin(h)), Math.cos(h)];
}

/** The default clip: the left arm swings down and back up over a second, a loop. */
const WAVE: Record<string, FixtureTrack[]> = {
  Wave_Loop: [
    {
      bone: 'upperarm_l',
      path: 'rotation',
      times: [0, 0.5, 1],
      values: [...turn([0, 0, 1], 0), ...turn([0, 0, 1], -70), ...turn([0, 0, 1], 0)],
    },
  ],
};

/** A T-posed Unreal-named humanoid with `clips` (by name, each a list of tracks) as a `.glb`. */
export function riggedGlb(clips: Record<string, FixtureTrack[]> = WAVE): Uint8Array {
  const index = new Map(SKELETON.map(([name], i) => [name, i]));
  const nodes = SKELETON.map(([name, parent, head]) => {
    const base = parent === null ? [0, 0, 0] : (SKELETON[index.get(parent) as number][2] as number[]);
    const children = SKELETON.flatMap(([, of], i) => (of === name ? [i] : []));
    return { name, translation: head.map((v, i) => v - base[i]), ...(children.length ? { children } : {}) };
  });
  const builder = new GlbBuilder();
  const animations = Object.entries(clips).map(([name, tracks]) => {
    const samplers = tracks.map((track) => {
      const type = track.path === 'rotation' ? 'VEC4' : 'VEC3';
      const input = builder.add(track.times, 'SCALAR');
      const output = builder.add(track.values, type, track.componentType, track.normalized);
      return { input, output, interpolation: track.interpolation ?? 'LINEAR' };
    });
    const channels = tracks.map((track, i) => ({
      sampler: i,
      target: { node: index.get(track.bone), path: track.path },
    }));
    return { name, channels, samplers };
  });
  return builder.build({ scene: 0, scenes: [{ nodes: [0] }], nodes, animations });
}
