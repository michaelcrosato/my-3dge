/**
 * @file One animation library read from a `.glb` (PLAN.md §5.3, WP 8.5): its rig (tools/anim/rigs.ts), every clip
 * sampled at a fixed rate and turned into the 36 body points the readable format measures (engine/anim/clip/encode.ts
 * `Capture`), and, for a Rigify mesh, the look of its mannequin (`body`: height, segment radii, joint-ring bands).
 * Ported from `my-3d2dge:tools/anim-import.mjs:122-231` with its operations kept, for its bits, reading through
 * tools/anim/glb.ts, which adds the guards the source lacked (signed, quantized and sparse accessors, CUBICSPLINE).
 *
 * How a frame becomes points: the tracks are sampled at `f / fps` (held past their ends), the node tree is multiplied
 * out, and each point is read off its bone (its head, its tip, or 12 cm in front) in the rig's frame: up is +y,
 * forward runs from the left heel toward the toes, right toward the right hip, and the origin is the root bone on the
 * ground. The root's travel is kept apart (`move`). A clip loops when its name ends in `_Loop` or `Idle`.
 *
 * Invariants: millimetres; the source's float32 points. A bone the rig map needs and the file lacks is an error that
 * names them. A file with no skinned mesh is measured from its bones alone (noted). `sourceFps` is the rate its keys
 * were exported at (the commonest key spacing), for format 2's clip `fps`.
 *
 * @example
 * import { riggedGlb } from './glb-fixture';
 * const library = readGlbLibrary(riggedGlb(), 'test.glb', 30);
 * [library.rig, Object.keys(library.clips)]; // ['unreal', ['Wave_Loop']]
 * @see tools/anim/glb-library.test.ts
 */
import type { Capture } from '../../engine/anim/clip/encode';
import { POINT_COUNT } from '../../engine/anim/clip/readable';
import { mat, mul, nodeTree, parseGlb, readAccessor, sampleTrack, tracksOf, xf, type Glb } from './glb';
import { bonesFor, recogniseRig, RIGS, type BoneSpot, type Segment } from './rigs';

/** The mannequin's look, measured from a Rigify mesh: height (mm), segment radii and joint-ring bands. */
export interface MannequinBody {
  height: number;
  segs: { a: string; b: string; r: number[] }[];
  bands: { a: string; b: string; t0: number; t1: number; r: number }[];
}

/** A captured clip and the rate its keys were exported at. */
export type GlbCapture = Capture & { sourceFps?: number };

/** A library read from a `.glb`: its rig, its clips as body points, its mannequin's look, and what is worth noting. */
export interface GlbLibrary {
  rig: string;
  clips: Record<string, GlbCapture>;
  body: MannequinBody | null;
  notes: string[];
}

const MM = 1000;
const IDENTITY = mat();
/** The value `p` of the way through a sorted copy of `arr` (0 for none). */
function pct(arr: number[], p: number): number {
  if (!arr.length) return 0;
  const s = arr.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}

/** What a `.glb` holds, for `x anim import --list`: its rig (or none), its clips and its bones. */
export function listGlb(
  bytes: Uint8Array,
  file: string,
): { rig: string | undefined; clips: string[]; bones: string[] } {
  const glb = parseGlb(bytes, file);
  const tree = nodeTree(glb);
  return {
    rig: recogniseRig((name) => tree.find(name) !== undefined),
    clips: (glb.json.animations ?? []).map((an, i) => an.name ?? `Clip${i}`),
    bones: (glb.json.nodes ?? []).map((node) => node.name ?? ''),
  };
}

/** The commonest spacing of a clip's keys, as frames a second (undefined with fewer than two keys). */
function exportRate(times: number[]): number | undefined {
  const counts = new Map<number, number>();
  for (let i = 1; i < times.length; i++) {
    const rate = Math.round(1 / (times[i] - times[i - 1]));
    if (Number.isFinite(rate) && rate > 0) counts.set(rate, (counts.get(rate) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0];
}

/** Reads a library from a `.glb`'s bytes (`file` names it), sampling every clip at `fps` (see the file comment). */
export function readGlbLibrary(bytes: Uint8Array, file: string, fps = 30): GlbLibrary {
  const glb = parseGlb(bytes, file);
  const { json } = glb;
  const nodes = json.nodes ?? [];
  const tree = nodeTree(glb);
  const node = (name: string) => tree.find(name) as number;
  const rig = recogniseRig((name) => tree.find(name) !== undefined);
  const known = Object.keys(RIGS).join(', ');
  if (!rig) throw new Error(`${file}: its rig is none the importer knows (${known}): add it to tools/anim/rigs.ts`);
  const BONES = bonesFor(rig);
  const missing = [...new Set(BONES.map((b) => b[1]).filter((bone) => tree.find(bone) === undefined))];
  if (missing.length) throw new Error(`${file} lacks bones the ${rig} map needs: ${missing.join(', ')}`);
  const notes: string[] = [];
  const rest = nodes.map((n) => ({
    t: n.translation ?? [0, 0, 0],
    r: n.rotation ?? [0, 0, 0, 1],
    s: n.scale ?? [1, 1, 1],
  }));
  type Trs = (typeof rest)[number];
  const world = (trs: Trs[]) => {
    const W = new Array<number[]>(nodes.length);
    for (const i of tree.order) {
      const L = mat(trs[i].t, trs[i].r, trs[i].s);
      W[i] = tree.parent[i] >= 0 ? mul(W[tree.parent[i]], L) : L;
    }
    return W;
  };
  const { boneVerts, bandVerts, top } = meshVertices(glb, notes);
  const vertsOf = (i: number) => (boneVerts.get(i) ?? []).concat(bandVerts.get(i) ?? []);
  const bindW = world(rest);
  /** The distance to the bone's first child, or (a tip bone) the extent of its vertices along y. */
  const boneLen = (name: string) => {
    const i = node(name);
    const kids = nodes[i].children ?? [];
    if (!kids.length)
      return pct(
        vertsOf(i).map((v) => v[1]),
        0.98,
      );
    const [a, b] = [xf(bindW[i], [0, 0, 0]), xf(bindW[kids[0]], [0, 0, 0])];
    return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  };
  const TIP: Record<string, number> = {};
  for (const [, bone, where] of BONES)
    if (where === 'tip')
      TIP[bone] =
        pct(
          vertsOf(node(bone)).map((v) => v[1]),
          0.98,
        ) || boneLen(bone);
  // the rig's local frame, from the rest pose: up = +y, forward from the heel toward the toes, right toward the R side
  const map = RIGS[rig].map;
  const FWD: Record<string, number[]> = {};
  const pos = (W: number[][], name: string, where?: BoneSpot) => {
    const i = node(name);
    return where === 'tip' ? xf(W[i], [0, TIP[name], 0]) : where === 'fwd' ? xf(W[i], FWD[name]) : xf(W[i], [0, 0, 0]);
  };
  const toeOf = (W: number[][]) => {
    const t = map('L').toe;
    return Array.isArray(t) ? pos(W, t[0], 'tip') : pos(W, t);
  };
  const fwd0 = (() => {
    const [a, b] = [pos(bindW, map('L').ankle as string), toeOf(bindW)];
    const v = [b[0] - a[0], 0, b[2] - a[2]];
    const l = Math.hypot(...v);
    return v.map((x) => x / l);
  })();
  // up × forward = left, then turned toward the right hip (the source's expression, signed zeros included)
  const RIGHT = [-(fwd0[1] * 0 - fwd0[2] * 1), -(fwd0[2] * 0 - fwd0[0] * 0), -(fwd0[0] * 1 - fwd0[1] * 0)];
  const [hl, hr] = [pos(bindW, map('L').hip as string), pos(bindW, map('R').hip as string)];
  if ((hr[0] - hl[0]) * RIGHT[0] + (hr[2] - hl[2]) * RIGHT[2] < 0) RIGHT.forEach((v, i) => (RIGHT[i] = -v));
  // 'fwd' points: the rest pose's forward direction written in each bone's own frame (the transpose of its rotation)
  for (const [, bone, where] of BONES) {
    if (where !== 'fwd') continue;
    const m = bindW[node(bone)];
    const n = [0, 1, 2].map((c) => Math.hypot(m[c * 4], m[c * 4 + 1], m[c * 4 + 2]));
    FWD[bone] = [0, 1, 2].map(
      (c) => ((m[c * 4] * fwd0[0] + m[c * 4 + 1] * fwd0[1] + m[c * 4 + 2] * fwd0[2]) / (n[c] * n[c])) * 0.12,
    );
  }
  const toLocal = (p: number[], o: number[]) => {
    const d = [p[0] - o[0], p[1], p[2] - o[2]];
    return [d[0] * fwd0[0] + d[2] * fwd0[2], d[0] * RIGHT[0] + d[2] * RIGHT[2], d[1]];
  };
  const segments = [...RIGS[rig].coreSegs, ...(['L', 'R'] as const).flatMap((s) => RIGS[rig].segs(s))];
  const body = segments.length && top > 0 ? measureBody(segments, top, node, vertsOf, bandVerts, boneLen) : null;

  // every clip, sampled and turned into body points
  const clips: Record<string, GlbCapture> = {};
  const rootNode = tree.find(RIGS[rig].root) ?? tree.order[0];
  const P = POINT_COUNT;
  for (const [ai, an] of (json.animations ?? []).entries()) {
    const name = an.name ?? `Clip${ai}`;
    const tracks = tracksOf(glb, an);
    const ends = an.channels.map((c) => (readAccessor(glb, an.samplers[c.sampler].input) as number[]).at(-1) ?? 0);
    const dur = ends.length ? Math.max(...ends) : 0;
    const n = Math.max(1, Math.round(dur * fps) + 1);
    const [data, move] = [new Float32Array(n * P * 3), new Float32Array(n * 2)];
    let moved = false;
    for (let f = 0; f < n; f++) {
      const time = Math.min(dur, f / fps);
      const trs = rest.map((r) => ({ t: r.t, r: r.r, s: r.s }));
      for (const k of tracks) {
        const key = k.path === 'translation' ? 't' : k.path === 'rotation' ? 'r' : 's';
        trs[k.node] = Object.assign({}, trs[k.node], { [key]: sampleTrack(k, time) });
      }
      const W = world(trs);
      const root = xf(W[rootNode], [0, 0, 0]);
      const rl = toLocal(root, [0, 0, 0]);
      [move[f * 2], move[f * 2 + 1]] = [rl[0] * MM, rl[1] * MM];
      if (Math.abs(rl[0]) + Math.abs(rl[1]) > 0.01) moved = true;
      BONES.forEach(([, bone, where], i) => {
        const p = toLocal(pos(W, bone, where), root);
        data.set([p[0] * MM, p[1] * MM, p[2] * MM], (f * P + i) * 3);
      });
    }
    const loop = /_Loop$/.test(name) || /(^|_)Idle$/.test(name);
    const longest = tracks.reduce((a, b) => (b.t.length > a.length ? b.t : a), [] as number[]);
    clips[name] = { name, n, dur, loop, fps, data, move: moved ? move : null, sourceFps: exportRate(longest) };
  }
  return { rig, clips, body, notes };
}

/** The bind pose's mesh, each vertex in the frame of the bone that moves it most, the joint-ring material's apart. */
function meshVertices(glb: Glb, notes: string[]) {
  const { json } = glb;
  const nodes = json.nodes ?? [];
  const skin = json.skins?.[0];
  const joints = skin?.joints ?? [];
  const ibm =
    skin?.inverseBindMatrices === undefined ? [] : (readAccessor(glb, skin.inverseBindMatrices) as number[][]);
  const meshNode = nodes.findIndex((n) => n.mesh !== undefined && n.skin !== undefined);
  const mesh = skin && meshNode >= 0 ? json.meshes?.[nodes[meshNode].mesh as number] : undefined;
  if (!skin || meshNode < 0) notes.push(`${glb.file}: no skinned mesh: the body is measured from the bones alone`);
  const [boneVerts, bandVerts] = [new Map<number, number[][]>(), new Map<number, number[][]>()];
  let matJoint = -1;
  (json.materials ?? []).forEach((m, i) => {
    if (/joint/i.test(String(m.name))) matJoint = i;
  });
  let top = 0;
  for (const prim of mesh?.primitives ?? []) {
    const Pp = readAccessor(glb, prim.attributes.POSITION) as number[][];
    const JN = readAccessor(glb, prim.attributes.JOINTS_0) as number[][];
    const W = readAccessor(glb, prim.attributes.WEIGHTS_0) as number[][];
    const target = prim.material === matJoint ? bandVerts : boneVerts;
    for (let v = 0; v < Pp.length; v++) {
      top = Math.max(top, Pp[v][1]);
      let best = 0;
      for (let k = 1; k < 4; k++) if (W[v][k] > W[v][best]) best = k;
      const ji = JN[v][best];
      const list = target.get(joints[ji]) ?? [];
      list.push(xf(ibm[ji] ?? IDENTITY, Pp[v])); // no inverse bind matrices: identity, as the spec says
      target.set(joints[ji], list);
    }
  }
  return { boneVerts, bandVerts, top };
}

/** The mannequin's look: each segment's radii at its thirds, and the bands of joint-ring material along it. */
function measureBody(
  segments: Segment[],
  top: number,
  node: (name: string) => number,
  vertsOf: (i: number) => number[][],
  bandVerts: Map<number, number[][]>,
  boneLen: (name: string) => number,
): MannequinBody {
  const body: MannequinBody = { height: Math.round(top * MM), segs: [], bands: [] };
  for (const [a, b, bone] of segments) {
    const i = node(bone);
    const [vs, L, bins] = [vertsOf(i), boneLen(bone) || 1, [[], [], []] as number[][]];
    for (const v of vs) bins[v[1] / L < 0.33 ? 0 : v[1] / L < 0.67 ? 1 : 2].push(Math.hypot(v[0], v[2]));
    body.segs.push({ a, b, r: bins.map((x) => Math.round(pct(x, 0.8) * MM)) });
    const bv = bandVerts.get(i);
    if (!bv || bv.length < 12) continue;
    const NB = 24;
    const [bb, min] = [Array.from({ length: NB }, () => [] as number[][]), Math.max(4, bv.length * 0.02)];
    for (const v of bv) bb[Math.max(0, Math.min(NB - 1, Math.floor(((v[1] / L + 0.2) / 1.4) * NB)))].push(v);
    for (let k = 0; k < NB;) {
      if (bb[k].length < min) {
        k++;
        continue;
      }
      let e = k;
      const run: number[][] = [];
      while (e < NB && bb[e].length >= min) run.push(...bb[e++]);
      const along = run.map((v) => v[1] / L);
      const [t0, t1] = [+pct(along, 0.03).toFixed(2), +pct(along, 0.97).toFixed(2)];
      body.bands.push({
        a,
        b,
        t0,
        t1,
        r: Math.round(
          pct(
            run.map((v) => Math.hypot(v[0], v[2])),
            0.85,
          ) * MM,
        ),
      });
      k = e;
    }
  }
  return body;
}
