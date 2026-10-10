/**
 * @file The humanoid skeleton (PLAN.md WP 3.4, §5.2, Appendix C; I-01, I-08): a root plus 23 joints, their sockets,
 * the rest pose a build gives them (`createSkeleton`), and bone masks (`boneMask`) for blending.
 *
 * Invariants:
 * - Axes are the engine's: +Y up, the character faces +Z, so its left is +X and its right −X (right = forward × up).
 * - `JOINTS` lists parents before children; `PARENTS[j]` is −1 for the pelvis, whose parent is the root.
 * - The rest pose is a T-pose with every local rotation the identity: each joint's frame is the character's, and the
 *   offsets alone shape it (arms out along ±X, legs straight down, soles on the floor at y = 0). A joint sits at its
 *   parent's frame times its offset, as a three.js `Bone` sits at its `position`.
 * - Lengths are metres, the build's times its `size`. `legUpper + legLower` reaches from the hip joint to the sole,
 *   so the pelvis rests at that height. The proportions the old rig lacked (spine split, clavicles, feet, eyes, grip)
 *   are shares of build lengths in `PROPORTIONS`.
 * - Names follow Appendix C: `JOINT_INFO` gives each joint's old `rig.J` key and the mocap points it stands for.
 *
 * Carried from `my-3d2dge:engine/my-3d2dge.js:1753` (`JOINT_KEYS`) and the implicit hierarchy of `_pose()`
 * (`engine:1917-1994`), rewritten as data with local rotations.
 *
 * @example
 * const skeleton = createSkeleton('build:heroic');
 * skeleton.height; // 2.00125: legs 0.925 + torso 0.6 + neck 0.09375 + head 2 × 0.190625
 * PARENTS[jointIndex('forearmL')] === jointIndex('upperArmL'); // true
 * boneMask('upper').weights[jointIndex('head')]; // 1
 * boneMask(['handL', 'root']).root; // 1
 * @see engine/anim/skeleton.test.ts
 */
import { codeError, defineCodes, didYouMean } from '../core/log';
import { getBuild, type Build } from './builds';

/** The codes this module raises, with their fixes. */
export const SKELETON_CODES = defineCodes('anim', {
  ANIM_UNKNOWN_JOINT: {
    template: '{name} is not a {what} of the humanoid skeleton{suggestion}',
    fix: 'use one of: {names}',
    doc: 'Raised by `jointIndex`, `socketIndex`, `boneMask` and the pose functions that take a joint (engine/anim/) for a name the skeleton lacks, or a joint index outside 0–22. The message names the closest names; `JOINTS`, `SOCKETS` and `MASKS` list them all.',
  },
  ANIM_BAD_MASK: {
    template: 'the bone mask weight of {name} is {value}',
    fix: 'give each weight a number from 0 to 1',
    doc: 'Raised by `boneMask` (engine/anim/skeleton.ts) for a weight that is not a number from 0 to 1.',
  },
});

/** The 23 joints, parents before children. */
export const JOINTS = [
  'pelvis',
  'spine0',
  'spine1',
  'spine2',
  'chest',
  'neck',
  'head',
  'clavicleL',
  'upperArmL',
  'forearmL',
  'handL',
  'clavicleR',
  'upperArmR',
  'forearmR',
  'handR',
  'thighL',
  'shinL',
  'footL',
  'toeL',
  'thighR',
  'shinR',
  'footR',
  'toeR',
] as const;

/** A joint's name. */
export type JointName = (typeof JOINTS)[number];

/** How many joints a pose holds: 23. */
export const JOINT_COUNT = JOINTS.length;

/** What Appendix C says of a joint: its parent, the old rig's `rig.J` key, and the mocap points it stands for. */
export interface JointInfo {
  readonly parent: JointName | 'root';
  readonly rig?: string;
  readonly mocap: readonly string[];
}

/** Appendix C's table. The old `shC` is the chest's top, the neck joint's position; old feet stood on the sole. */
export const JOINT_INFO: Readonly<Record<JointName, JointInfo>> = {
  pelvis: { parent: 'root', rig: 'hipC', mocap: ['pelvis', 'pelvisF'] },
  spine0: { parent: 'pelvis', mocap: [] },
  spine1: { parent: 'spine0', mocap: ['spine1'] },
  spine2: { parent: 'spine1', mocap: ['spine2'] },
  chest: { parent: 'spine2', rig: 'shC', mocap: ['chest', 'chestF'] },
  neck: { parent: 'chest', mocap: ['neck'] },
  head: { parent: 'neck', rig: 'head', mocap: ['head', 'headTop', 'faceF'] },
  clavicleL: { parent: 'chest', mocap: ['clavL'] },
  upperArmL: { parent: 'clavicleL', rig: 'shL', mocap: ['shL'] },
  forearmL: { parent: 'upperArmL', rig: 'elbowL', mocap: ['elbowL'] },
  handL: { parent: 'forearmL', rig: 'handL', mocap: ['wristL', 'indexL', 'knuckL', 'pinkyL', 'fistL'] },
  clavicleR: { parent: 'chest', mocap: ['clavR'] },
  upperArmR: { parent: 'clavicleR', rig: 'shR', mocap: ['shR'] },
  forearmR: { parent: 'upperArmR', rig: 'elbowR', mocap: ['elbowR'] },
  handR: { parent: 'forearmR', rig: 'handR', mocap: ['wristR', 'indexR', 'knuckR', 'pinkyR', 'fistR'] },
  thighL: { parent: 'pelvis', rig: 'hipL', mocap: ['hipL'] },
  shinL: { parent: 'thighL', rig: 'kneeL', mocap: ['kneeL'] },
  footL: { parent: 'shinL', rig: 'footL', mocap: ['ankleL'] },
  toeL: { parent: 'footL', mocap: ['ballL', 'toeL'] },
  thighR: { parent: 'pelvis', rig: 'hipR', mocap: ['hipR'] },
  shinR: { parent: 'thighR', rig: 'kneeR', mocap: ['kneeR'] },
  footR: { parent: 'shinR', rig: 'footR', mocap: ['ankleR'] },
  toeR: { parent: 'footR', mocap: ['ballR', 'toeR'] },
};

/** Each joint's parent index, −1 for the root. */
export const PARENTS: readonly number[] = JOINTS.map((name) => {
  const { parent } = JOINT_INFO[name];
  return parent === 'root' ? -1 : JOINTS.indexOf(parent);
});

/** The sockets: attachment points that turn with their joint (`SOCKET_JOINTS`). */
export const SOCKETS = ['weaponR', 'weaponL', 'headTop', 'eyeL', 'eyeR', 'contactL', 'contactR', 'back'] as const;

/** A socket's name. */
export type SocketName = (typeof SOCKETS)[number];

/** The joint each socket rides on. A weapon's blade runs along its socket's +Z (the thumb side of a fist). */
export const SOCKET_JOINTS: Readonly<Record<SocketName, JointName>> = {
  weaponR: 'handR',
  weaponL: 'handL',
  headTop: 'head',
  eyeL: 'head',
  eyeR: 'head',
  contactL: 'footL',
  contactR: 'footR',
  back: 'chest',
};

/** The shares that place what the old rig lacked (chosen here; the build's lengths carry the source's proportions). */
export const PROPORTIONS = {
  /** spine1 above the pelvis, share of `torso`. */
  spine1: 0.25,
  /** spine2 above the pelvis, share of `torso`. */
  spine2: 0.5,
  /** chest above the pelvis, share of `torso` (its top, the neck joint, is at 1: the old shoulder centre). */
  chest: 0.72,
  /** Clavicle joints above the pelvis, share of `torso`. */
  clavicleHeight: 0.94,
  /** Clavicle joints out from the centre line, share of `shoulderHalf`. */
  clavicleAcross: 0.18,
  /** The ankle ahead of the heel, share of `footLength`. */
  heel: 0.25,
  /** The ball of the foot (the toe joint) ahead of the heel, share of `footLength`. */
  ball: 0.7,
  /** The ball above the sole, share of `ankleHeight`. */
  ballHeight: 0.3,
  /** The contact sockets on the sole, ahead of the heel, share of `footLength`: midway to the ball. */
  contact: 0.35,
  /** Each eye from the base of the skull: across, up and forward, shares of `headRadius` (on the head's sphere). */
  eye: [0.35, 1.1, 0.93],
  /** The weapon grip from the wrist along the hand, share of `handLength`. */
  grip: 0.4,
  /** The back socket above the chest joint, share of `torso`; it sits half the `chestDepth` behind. */
  back: 0.2,
} as const;

/** A humanoid skeleton made from a build: rest offsets, bone lengths, leaf tips and sockets, in metres. */
export interface Skeleton {
  /** The build it was made from. */
  readonly build: Build;
  /** Each joint's rest position in its parent's frame (the pelvis's in the root's), 3 per joint. */
  readonly offsets: Float64Array;
  /** Each joint's distance from its parent joint (the pelvis's from the root). */
  readonly lengths: Float64Array;
  /** The far end of each leaf bone (head, hands, toes) in its own frame, 3 per joint; zero for the others. */
  readonly tips: Float64Array;
  /** Each socket's joint index, in `SOCKETS` order. */
  readonly socketJoints: readonly number[];
  /** Each socket's position in its joint's frame, 3 per socket. */
  readonly socketOffsets: Float64Array;
  /** Rest height: the soles to the top of the head. */
  readonly height: number;
  /** The head's radius; its centre is one radius above the head joint. */
  readonly headRadius: number;
}

/** "a, b, c" for messages. */
const names = (list: readonly string[]) => list.join(', ');

/** The index of joint `joint` (a name, or an index checked to be 0–22). Throws `ANIM_UNKNOWN_JOINT`. */
export function jointIndex(joint: JointName | number): number {
  if (typeof joint === 'number') {
    if (Number.isInteger(joint) && joint >= 0 && joint < JOINT_COUNT) return joint;
  } else {
    const index = (JOINTS as readonly string[]).indexOf(joint);
    if (index >= 0) return index;
  }
  const name = JSON.stringify(joint);
  const suggestion = typeof joint === 'string' ? didYouMean(joint, JOINTS) : ' (joint indexes run 0–22)';
  throw codeError('ANIM_UNKNOWN_JOINT', { name, what: 'joint', suggestion, names: names(JOINTS) });
}

/** The index of socket `socket` in `SOCKETS`. Throws `ANIM_UNKNOWN_JOINT`. */
export function socketIndex(socket: SocketName): number {
  const index = (SOCKETS as readonly string[]).indexOf(socket);
  if (index >= 0) return index;
  const values = { name: JSON.stringify(socket), what: 'socket', names: names(SOCKETS) };
  throw codeError('ANIM_UNKNOWN_JOINT', { ...values, suggestion: didYouMean(String(socket), SOCKETS) });
}

/** The skeleton of `build` (a build or its id; `build:chibi` by default), in its T-shaped rest pose. */
export function createSkeleton(build: Build | string = 'build:chibi'): Skeleton {
  const b = typeof build === 'string' ? getBuild(build) : build;
  const P = PROPORTIONS;
  const s = b.size;
  const [torso, r, ankle, foot, hand] = [
    b.torso * s,
    b.headRadius * s,
    b.ankleHeight * s,
    b.footLength * s,
    b.handLength * s,
  ];
  const offsets = new Float64Array(JOINT_COUNT * 3);
  const tips = new Float64Array(JOINT_COUNT * 3);
  const socketOffsets = new Float64Array(SOCKETS.length * 3);
  const put = (array: Float64Array, index: number, x: number, y: number, z: number) => array.set([x, y, z], index * 3);
  const joint = (name: JointName, x: number, y: number, z: number) => put(offsets, jointIndex(name), x, y, z);
  const socket = (name: SocketName, x: number, y: number, z: number) => put(socketOffsets, socketIndex(name), x, y, z);
  joint('pelvis', 0, (b.legUpper + b.legLower) * s, 0);
  joint('spine1', 0, P.spine1 * torso, 0);
  joint('spine2', 0, (P.spine2 - P.spine1) * torso, 0);
  joint('chest', 0, (P.chest - P.spine2) * torso, 0);
  joint('neck', 0, (1 - P.chest) * torso, 0);
  joint('head', 0, b.neck * s, 0);
  put(tips, jointIndex('head'), 0, 2 * r, 0);
  socket('headTop', 0, 2 * r, 0);
  socket('back', 0, P.back * torso, -0.5 * b.chestDepth * s);
  for (const [side, x] of [['L', 1] as const, ['R', -1] as const]) {
    joint(`clavicle${side}`, x * P.clavicleAcross * b.shoulderHalf * s, (P.clavicleHeight - P.chest) * torso, 0);
    joint(`upperArm${side}`, x * (1 - P.clavicleAcross) * b.shoulderHalf * s, (1 - P.clavicleHeight) * torso, 0);
    joint(`forearm${side}`, x * b.armUpper * s, 0, 0);
    joint(`hand${side}`, x * b.armLower * s, 0, 0);
    joint(`thigh${side}`, x * b.hipHalf * s, 0, 0);
    joint(`shin${side}`, 0, -b.legUpper * s, 0);
    joint(`foot${side}`, 0, -(b.legLower * s - ankle), 0);
    joint(`toe${side}`, 0, -(1 - P.ballHeight) * ankle, (P.ball - P.heel) * foot);
    put(tips, jointIndex(`hand${side}`), x * hand, 0, 0);
    put(tips, jointIndex(`toe${side}`), 0, -P.ballHeight * ankle, (1 - P.ball) * foot);
    socket(`weapon${side}`, x * P.grip * hand, 0, 0);
    socket(`eye${side}`, x * P.eye[0] * r, P.eye[1] * r, P.eye[2] * r);
    socket(`contact${side}`, 0, -ankle, (P.contact - P.heel) * foot);
  }
  const lengths = new Float64Array(JOINT_COUNT);
  for (let j = 0; j < JOINT_COUNT; j++) lengths[j] = Math.hypot(offsets[j * 3], offsets[j * 3 + 1], offsets[j * 3 + 2]);
  const height = (b.legUpper + b.legLower + b.torso + b.neck + 2 * b.headRadius) * s;
  const socketJoints = SOCKETS.map((name) => jointIndex(SOCKET_JOINTS[name]));
  return Object.freeze({ build: b, offsets, lengths, tips, socketJoints, socketOffsets, height, headRadius: r });
}

/** The preset bone masks. */
export const MASKS = ['full', 'upper', 'lower', 'arms', 'legs', 'armL', 'armR', 'legL', 'legR', 'head'] as const;

/** A preset bone mask's name. */
export type MaskName = (typeof MASKS)[number];

/** How much of a blend or layer reaches each joint (0–1, in `JOINTS` order) and the root's channels. */
export interface BoneMask {
  readonly weights: Float32Array;
  readonly root: number;
}

/** The joints of each preset: the branches (a joint and all below it) it holds, and whether it holds the root. */
const PRESETS: Readonly<Record<MaskName, { branches: readonly JointName[]; root: boolean }>> = {
  full: { branches: ['pelvis'], root: true },
  upper: { branches: ['spine0'], root: false },
  lower: { branches: ['pelvis'], root: true },
  arms: { branches: ['clavicleL', 'clavicleR'], root: false },
  legs: { branches: ['thighL', 'thighR'], root: false },
  armL: { branches: ['clavicleL'], root: false },
  armR: { branches: ['clavicleR'], root: false },
  legL: { branches: ['thighL'], root: false },
  legR: { branches: ['thighR'], root: false },
  head: { branches: ['neck'], root: false },
};

/** Whether joint `j` is `ancestor` or below it. */
function inBranch(j: number, ancestor: number): boolean {
  for (let at = j; at >= 0; at = PARENTS[at]) if (at === ancestor) return true;
  return false;
}

/** Fills `weights` with 1 for the joints of preset `name` (`lower` stops at the spine); returns whether it has the root. */
function addPreset(name: MaskName, weights: Float32Array): boolean {
  const preset = PRESETS[name];
  const spine = jointIndex('spine0');
  for (let j = 0; j < JOINT_COUNT; j++) {
    const held = preset.branches.some((branch) => inBranch(j, jointIndex(branch)));
    if (held && !(name === 'lower' && inBranch(j, spine))) weights[j] = 1;
  }
  return preset.root;
}

/** Throws `ANIM_UNKNOWN_JOINT` for a name that is neither a joint, a preset mask nor 'root'. */
function unknownMaskName(name: string): never {
  const all = [...JOINTS, ...MASKS, 'root'];
  const values = { name: JSON.stringify(name), what: 'joint or bone mask', names: names(all) };
  throw codeError('ANIM_UNKNOWN_JOINT', { ...values, suggestion: didYouMean(name, all) });
}

/**
 * A bone mask: a preset (`'upper'`: spine0 and everything above it; `'lower'`: the pelvis, the legs and the root;
 * `'arms'`, `'legs'`, one limb, `'head'`, `'full'`), a list of joints and presets (each listed joint alone; `'root'`
 * for the root's channels), or weights by joint (`{ chest: 0.5, root: 1 }`). Throws `ANIM_UNKNOWN_JOINT`,
 * `ANIM_BAD_MASK`.
 */
export function boneMask(
  spec: MaskName | readonly (JointName | MaskName | 'root')[] | Readonly<Partial<Record<JointName | 'root', number>>>,
): BoneMask {
  const weights = new Float32Array(JOINT_COUNT);
  let root = 0;
  const add = (name: string) => {
    if (name === 'root') root = 1;
    else if ((MASKS as readonly string[]).includes(name)) root = addPreset(name as MaskName, weights) ? 1 : root;
    else if ((JOINTS as readonly string[]).includes(name)) weights[jointIndex(name as JointName)] = 1;
    else unknownMaskName(name);
  };
  if (typeof spec === 'string') add(spec);
  else if (Array.isArray(spec)) for (const name of spec as readonly string[]) add(name);
  else {
    for (const [name, value] of Object.entries(spec)) {
      if (typeof value !== 'number' || !(value >= 0 && value <= 1)) {
        throw codeError('ANIM_BAD_MASK', { name, value: JSON.stringify(value) });
      }
      if (name === 'root') root = value;
      else if ((JOINTS as readonly string[]).includes(name)) weights[jointIndex(name as JointName)] = value;
      else unknownMaskName(name);
    }
  }
  return { weights, root };
}
