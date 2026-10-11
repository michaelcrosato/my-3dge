/**
 * @file The rig maps (PLAN.md §5.3, WP 8.5): which bone of a known humanoid rig gives each of the 36 body points the
 * readable format measures (engine/anim/clip/readable.ts `POSE_POINTS`). Ported from `my-3d2dge:tools/anim-import.mjs:
 * 74-102`: the Rigify `DEF-` deform bones (Quaternius' Universal Animation Library) and the Unreal mannequin's names
 * (`pelvis`, `spine_01`, `upperarm_l`…: Universal Animation Library 2, Mesh2Motion's humans). A rig is recognised by
 * its `test` bone, in any case. Another rig is one more entry here.
 *
 * Invariants: each entry of `bonesFor` is `[point, bone, where]`, where `where` is `tip` (the bone's far end: its
 * vertices' 98th percentile along the bone, else its length), `fwd` (12 cm in front of the bone, the rest pose's
 * forward written in the bone's frame) or absent (the bone's head). `segs` and `coreSegs` name the segments whose
 * thickness the mesh gives the mannequin's look-alike (`[from point, to point, bone that owns the vertices]`).
 *
 * @example
 * recogniseRig((name) => name.toLowerCase() === 'spine_01'); // 'unreal'
 * bonesFor('unreal').find(([point]) => point === 'kneeL'); // ['kneeL', 'calf_l']
 * @see tools/anim/glb-library.test.ts
 */
import { POSE_POINTS } from '../../engine/anim/clip/readable';

/** Where on a bone a point sits: its head (absent), its far end, or 12 cm in front of it. */
export type BoneSpot = 'tip' | 'fwd';
/** One body point's bone: `[point, bone, where]`. */
export type PointBone = [point: string, bone: string, where?: BoneSpot];
/** A segment whose thickness the mesh gives: `[from point, to point, bone that owns its vertices]`. */
export type Segment = [from: string, to: string, bone: string];

/** A rig: the bone that identifies it, its root, its limb and core bones, and its measured segments. */
export interface Rig {
  test: string;
  root: string;
  map(side: 'L' | 'R'): Record<string, string | [string, BoneSpot]>;
  core: Record<'pelvis' | 'spine1' | 'spine2' | 'chest' | 'neck' | 'head', string>;
  segs(side: 'L' | 'R'): Segment[];
  coreSegs: Segment[];
}

/** The rigs the importer knows, by name. */
export const RIGS: Record<string, Rig> = {
  rigify: {
    test: 'DEF-hips',
    root: 'root',
    map: (s) => ({
      ...{ clav: `DEF-shoulder.${s}`, sh: `DEF-upper_arm.${s}`, elbow: `DEF-forearm.${s}`, wrist: `DEF-hand.${s}` },
      ...{ index: `DEF-f_index.01.${s}`, knuck: `DEF-f_middle.01.${s}`, pinky: `DEF-f_pinky.01.${s}` },
      ...{ fist: `DEF-f_middle.02.${s}`, hip: `DEF-thigh.${s}`, knee: `DEF-shin.${s}`, ankle: `DEF-foot.${s}` },
      ...{ ball: `DEF-toe.${s}`, toe: [`DEF-toe.${s}`, 'tip'] },
    }),
    core: {
      ...{ pelvis: 'DEF-hips', spine1: 'DEF-spine.001', spine2: 'DEF-spine.002', chest: 'DEF-spine.003' },
      ...{ neck: 'DEF-neck', head: 'DEF-head' },
    },
    segs: (s) => [
      [`clav${s}`, `sh${s}`, `DEF-shoulder.${s}`],
      [`sh${s}`, `elbow${s}`, `DEF-upper_arm.${s}`],
      [`elbow${s}`, `wrist${s}`, `DEF-forearm.${s}`],
      [`wrist${s}`, `knuck${s}`, `DEF-hand.${s}`],
      [`hip${s}`, `knee${s}`, `DEF-thigh.${s}`],
      [`knee${s}`, `ankle${s}`, `DEF-shin.${s}`],
      [`ankle${s}`, `ball${s}`, `DEF-foot.${s}`],
      [`ball${s}`, `toe${s}`, `DEF-toe.${s}`],
    ],
    coreSegs: [
      ['pelvis', 'spine1', 'DEF-hips'],
      ['spine1', 'spine2', 'DEF-spine.001'],
      ['spine2', 'chest', 'DEF-spine.002'],
      ['chest', 'neck', 'DEF-spine.003'],
      ['neck', 'head', 'DEF-neck'],
      ['head', 'headTop', 'DEF-head'],
    ],
  },
  unreal: {
    test: 'spine_01',
    root: 'root',
    map: (side) => {
      const x = side.toLowerCase();
      return {
        ...{ clav: `clavicle_${x}`, sh: `upperarm_${x}`, elbow: `lowerarm_${x}`, wrist: `hand_${x}` },
        ...{ index: `index_01_${x}`, knuck: `middle_01_${x}`, pinky: `pinky_01_${x}`, fist: `middle_02_${x}` },
        ...{ hip: `thigh_${x}`, knee: `calf_${x}`, ankle: `foot_${x}`, ball: `ball_${x}`, toe: `ball_leaf_${x}` },
      };
    },
    core: {
      pelvis: 'pelvis',
      spine1: 'spine_01',
      spine2: 'spine_02',
      chest: 'spine_03',
      neck: 'neck_01',
      head: 'Head',
    },
    segs: () => [],
    coreSegs: [],
  },
};

/** The rig whose `test` bone the file has (`has` matches names whatever their case), or undefined. */
export const recogniseRig = (has: (name: string) => boolean) => Object.keys(RIGS).find((rig) => has(RIGS[rig].test));

/** Each of the 36 body points with the bone (and the spot on it) that gives it, in `POSE_POINTS` order. */
export function bonesFor(rig: string): PointBone[] {
  const { core, map } = RIGS[rig];
  return POSE_POINTS.map((p): PointBone => {
    if (p in core) return [p, core[p as keyof Rig['core']]];
    if (p === 'headTop') return [p, core.head, 'tip'];
    if (p === 'faceF') return [p, core.head, 'fwd'];
    if (p === 'chestF') return [p, core.chest, 'fwd'];
    if (p === 'pelvisF') return [p, core.pelvis, 'fwd'];
    const bone = map(p.slice(-1) as 'L' | 'R')[p.slice(0, -1)];
    return Array.isArray(bone) ? [p, ...bone] : [p, bone];
  });
}
