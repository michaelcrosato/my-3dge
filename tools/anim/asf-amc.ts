/**
 * @file The Acclaim skeleton and motion formats the CMU motion capture database uses (PLAN.md §5.3, WP 8.5): `.asf`,
 * a subject's bones, and `.amc`, a take, the bones' angles frame by frame, and the forward kinematics that pose a
 * skeleton from a frame. Ported from `my-3d2dge:tools/asf-amc.mjs:1-78` with its operations kept, for its bits;
 * tools/anim/cmu-capture.ts turns picked stretches of takes into captures.
 *
 * Forward kinematics as the format defines it: each bone has a rest direction and length in world space and an axis
 * frame C (Euler angles, X then Y then Z about fixed axes); a frame's angles R turn it as M = M_parent · C · R · C⁻¹,
 * and its end sits at the parent's end + length · M · direction. Lengths are in 1/0.45 inches (`:units length 0.45`),
 * so `scale` is metres a unit. Matrices are 3 × 3, row major.
 *
 * @example
 * import { testAsf, testAmc } from './asf-amc-fixture';
 * const skeleton = readAsf(testAsf());
 * const frames = readAmc(testAmc(12));
 * [skeleton.order.length, frames.length]; // [30, 12]
 * pose(skeleton, frames[0]).end.root; // [0, 0.9426…, 0]: the root, in metres
 * @see tools/anim/asf-amc.test.ts
 */
/** A vector, or a 3 × 3 matrix (row major). */
export type V = number[];
const DG = Math.PI / 180;
/* ---- 3 × 3 matrices, row major, and vectors, as the source writes them ---- */
/** The product `a · b` of two 3 × 3 matrices. */
export const mm = (a: V, b: V): V => {
  const o = new Array<number>(9);
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  return o;
};
/** Vector `v` turned by matrix `m`. */
export const mv = (m: V, v: V): V => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
  m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
  m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
];
/** The transpose of `m` (its inverse, for a rotation). */
export const tr = (m: V): V => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
/** Rotation by x, then y, then z degrees about the fixed axes: Rz · Ry · Rx. */
function euler(x: number, y: number, z: number): V {
  const [cx, sx, cy, sy] = [Math.cos(x * DG), Math.sin(x * DG), Math.cos(y * DG), Math.sin(y * DG)];
  const [cz, sz] = [Math.cos(z * DG), Math.sin(z * DG)];
  return mm(mm([cz, -sz, 0, sz, cz, 0, 0, 0, 1], [cy, 0, sy, 0, 1, 0, -sy, 0, cy]), [1, 0, 0, 0, cx, -sx, 0, sx, cx]);
}
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V, k: number): V => [a[0] * k, a[1] * k, a[2] * k];
const norm = (a: V): V => mul(a, 1 / (Math.hypot(...a) || 1));

/** A bone: its rest direction (unit, world), length (file units), axis frame C and its inverse, and channels. */
export interface AsfBone {
  dir: V;
  len: number;
  C: V;
  Ci: V;
  dof: string[];
}
/** A skeleton: metres per file unit, its bones, their order (parents first) and each one's parent. */
export interface Skeleton {
  scale: number;
  bones: Record<string, AsfBone>;
  parent: Record<string, string>;
  order: string[];
  root: { C: V; Ci: V };
}
/** One frame of a take: each bone's channel values. */
export type AmcFrame = Record<string, number[]>;

/** Reads an `.asf` skeleton. */
export function readAsf(text: string): Skeleton {
  const [bones, parent, order] = [{} as Record<string, AsfBone>, {} as Record<string, string>, [] as string[]];
  let [scale, section, rootAxis] = [0.0254 / 0.45, '', [0, 0, 0]];
  let cur: { name?: string; dir?: V; len?: number; axis?: V; dof: string[] } | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) continue;
    if (line.startsWith(':')) {
      section = line.split(/\s+/)[0];
      continue;
    }
    const w = line.split(/\s+/);
    if (section === ':units' && w[0] === 'length') scale = 0.0254 / +w[1];
    else if (section === ':root' && w[0] === 'orientation') rootAxis = w.slice(1, 4).map(Number);
    else if (section === ':bonedata') {
      if (w[0] === 'begin') cur = { dof: [] };
      else if (w[0] === 'end' && cur) {
        const C = euler(...(cur.axis as [number, number, number]));
        bones[cur.name as string] = { dir: norm(cur.dir as V), len: cur.len as number, C, Ci: tr(C), dof: cur.dof };
        cur = null;
      } else if (cur && w[0] === 'name') cur.name = w[1];
      else if (cur && w[0] === 'direction') cur.dir = w.slice(1, 4).map(Number);
      else if (cur && w[0] === 'length') cur.len = +w[1];
      else if (cur && w[0] === 'axis') cur.axis = w.slice(1, 4).map(Number);
      else if (cur && w[0] === 'dof') cur.dof = w.slice(1).map((d) => d.toLowerCase());
    } else if (section === ':hierarchy' && w[0] !== 'begin' && w[0] !== 'end')
      for (const c of w.slice(1)) parent[c] = w[0];
  }
  const visit = (n: string) => {
    if (order.includes(n)) return;
    if (parent[n] && parent[n] !== 'root') visit(parent[n]);
    order.push(n);
  };
  Object.keys(bones).forEach(visit);
  const rC = euler(...(rootAxis as [number, number, number]));
  return { scale, bones, parent, order, root: { C: rC, Ci: tr(rC) } };
}

/** Reads an `.amc` take: one `{ bone: values }` per frame. */
export function readAmc(text: string): AmcFrame[] {
  const frames: AmcFrame[] = [];
  let cur: AmcFrame | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line[0] === '#' || line[0] === ':') continue;
    if (/^\d+$/.test(line)) frames.push((cur = {}));
    else if (cur) {
      const w = line.split(/\s+/);
      cur[w[0]] = w.slice(1).map(Number);
    }
  }
  return frames;
}

/** Every bone's world rotation and end (metres) in one frame (none: the rest pose, the root at the origin). */
export function pose(sk: Skeleton, frame: AmcFrame | null) {
  const [M, end] = [{} as Record<string, V>, {} as Record<string, V>];
  const r = frame?.root ?? [0, 0, 0, 0, 0, 0];
  M.root = mm(mm(sk.root.C, euler(r[3], r[4], r[5])), sk.root.Ci);
  end.root = mul(r.slice(0, 3), sk.scale);
  const axis: Record<string, number> = { rx: 0, ry: 1, rz: 2 };
  for (const n of sk.order) {
    const [b, v, a] = [sk.bones[n], frame?.[n] ?? [], [0, 0, 0]];
    b.dof.forEach((d, i) => {
      if (v[i] !== undefined && d in axis) a[axis[d]] = v[i];
    });
    M[n] = mm(mm(mm(M[sk.parent[n] || 'root'], b.C), euler(a[0], a[1], a[2])), b.Ci);
    end[n] = add(end[sk.parent[n] || 'root'], mul(mv(M[n], b.dir), b.len * sk.scale));
  }
  return { M, end, start: (n: string) => end[sk.parent[n] || 'root'] };
}
