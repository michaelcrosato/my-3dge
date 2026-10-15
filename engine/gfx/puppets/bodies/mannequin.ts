/**
 * @file The mannequin (PLAN.md WP 8.4, §5.3): the look-alike of the figure the Quaternius clips were measured on, in
 * the body grammar (engine/gfx/puppets/grammar.ts). The set's `body` (`data/anim/sets/quaternius/_set.json`: the
 * model's height, 22 segments with three radii each, near a, mid-way and near b, and 24 bands of its second
 * material) becomes amber limbs on the skeleton's bones with purple joint rings, in the source model's two colours.
 * Its build, `build:mannequin`, is the set's rest body (retarget.ts `restBuild`), so the clip layer retargets onto
 * the proportions the clips were captured on; what retargeting still moves is in tests/baselines/anim-clips.json.
 *
 * A segment between two body points (`hipL` to `kneeL`) becomes two tapered limbs, a to its middle and the middle to
 * b, or one limb from a to b when a half is shorter than its change of radius (the grammar draws a limb only longer
 * than that). Each rides the bone that carries the segment: the parent joint of its far end, or the joint a socket
 * or offset point hangs on. A band is a limb from `t0` to `t1` along its segment, 1 mm proud of the radius measured.
 *
 * Invariants: radii are the source's millimetres, as metres (the build is the rest body's own size); the body is
 * data for one build, made by `mannequinBody`; `defineMannequin` registers the build and the body once per registry.
 * Carried from my-3d2dge's `Mocap.Mannequin` (`my-3d2dge:src/mocap/mocap.js:57-129`, its colours) and the importer's
 * body measurement (`my-3d2dge:tools/anim-import.mjs:193-205`), drawn in 3D instead of as 2D capsules.
 *
 * @example
 * import { readSet } from '../../../../tools/anim/repack';
 * import { createRegistry } from '../../../core/registry';
 * import { compileBody } from '../compile';
 * const registry = createRegistry();
 * const { build, body } = defineMannequin(readSet('quaternius'), { registry }); // build:mannequin, body:mannequin
 * compileBody(body, build, { registry }).pieces.length; // 67: the 22 segments in 43 limbs, and 24 rings
 * build.legUpper; // 0.40031: the rest body's thigh, in metres
 * @see engine/gfx/puppets/bodies/mannequin.test.ts
 */
import { buildKind, defineBuild, getBuild, type Build } from '../../../anim/builds';
import { restBuild } from '../../../anim/clip/rest';
import type { RestBody } from '../../../anim/clip/validate';
import { createSkeleton, jointIndex, PARENTS, JOINTS, type JointName } from '../../../anim/skeleton';
import { codeError, defineCodes } from '../../../core/log';
import { registry as sharedRegistry, type Registry } from '../../../core/registry';
import { restPositions } from '../compile';
import { bodyKind, defineBody, getBody, type Body, type BodyPart, type BodyPoint, type BodySpec } from '../grammar';

/** The codes this module raises, with their fixes. */
export const MANNEQUIN_CODES = defineCodes('gfx', {
  GFX_NO_MANNEQUIN: {
    template: 'set {set} has no {missing} to make the mannequin from',
    fix: 'pass the joined quaternius set (data/anim/sets/quaternius/), the only one with a body',
    doc: 'Raised by `defineMannequin` (engine/gfx/puppets/bodies/mannequin.ts) for a set without a `body` or without the rest body it names.',
  },
});

/** The source model's two materials: the body, and its joint rings. */
export const MANNEQUIN_SLOTS = { main: '#e8aa3a', joint: '#aa66db' } as const;

/** A set's `body`, as the importer measured it (mm). */
export interface MannequinData {
  height: number;
  segs: readonly { a: string; b: string; r: readonly [number, number, number] }[];
  bands: readonly { a: string; b: string; t0: number; t1: number; r: number }[];
}

/** A body point's joint, and its offset from it `[forward, right, up]` in metres (null: the joint itself). */
type Mark = [JointName, [number, number, number] | null];

/** The decode's points on the skeleton of `build` (whose rest body `R` gives the knuckles). */
function marks(R: RestBody, build: Build): Record<string, Mark> {
  const skeleton = createSkeleton(build);
  const toe = skeleton.tips.subarray(jointIndex('toeL') * 3, jointIndex('toeL') * 3 + 3);
  const m: Record<string, Mark> = {
    ...{ pelvis: ['pelvis', null], spine1: ['spine1', null], spine2: ['spine2', null], chest: ['chest', null] },
    ...{ neck: ['neck', null], head: ['head', null], headTop: ['head', [0, 0, 2 * skeleton.headRadius]] },
  };
  for (const [s, sign] of [['L', -1] as const, ['R', 1] as const]) {
    Object.assign(m, {
      ...{ [`clav${s}`]: [`clavicle${s}`, null], [`sh${s}`]: [`upperArm${s}`, null] },
      ...{ [`elbow${s}`]: [`forearm${s}`, null], [`wrist${s}`]: [`hand${s}`, null] },
      ...{ [`knuck${s}`]: [`hand${s}`, [0, (sign * R.knuck) / 1000, 0]], [`hip${s}`]: [`thigh${s}`, null] },
      ...{ [`knee${s}`]: [`shin${s}`, null], [`ankle${s}`]: [`foot${s}`, null], [`ball${s}`]: [`toe${s}`, null] },
      [`toe${s}`]: [`toe${s}`, [toe[2], 0, toe[1]]],
    });
  }
  return m;
}

/** `body` (a set's measured figure) as a body for `build`, the rest body `R`'s own (see the file comment). */
export function mannequinBody(body: MannequinData, R: RestBody, build: Build): BodySpec {
  const m = marks(R, build);
  const rest = restPositions(createSkeleton(build));
  const point = (name: string): BodyPoint => {
    const [joint, off] = m[name];
    return off ? ['off', joint, ...off] : joint;
  };
  const at = (name: string) => {
    const [joint, off] = m[name];
    const j = jointIndex(joint) * 3;
    const [f, r, u] = off ?? [0, 0, 0];
    return [rest[j] - r, rest[j + 1] + u, rest[j + 2] + f];
  };
  // the bone that carries a segment: its far end's parent joint, or the joint an offset point hangs on
  const carrier = (a: string, b: string): JointName =>
    m[b][1] ? m[b][0] : (JOINTS[PARENTS[jointIndex(m[b][0])]] ?? m[a][0]);
  const parts: BodyPart[] = [];
  for (const { a, b, r } of body.segs) {
    const [ra, rm, rb] = r.map((x) => x / 1000);
    const [pa, pb] = [at(a), at(b)];
    const length = Math.hypot(pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]);
    const on = { on: carrier(a, b) };
    const mid: BodyPoint = ['lerp', point(a), point(b), 0.5];
    if (length / 2 > Math.abs(ra - rm) + 1e-4 && length / 2 > Math.abs(rm - rb) + 1e-4) {
      parts.push(['limb', point(a), mid, ra, rm, 'main', on], ['limb', mid, point(b), rm, rb, 'main', on]);
    } else {
      const [r0, r1] = length > Math.abs(ra - rb) + 1e-4 ? [ra, rb] : [Math.max(ra, rb), Math.max(ra, rb)];
      parts.push(['limb', point(a), point(b), r0, r1, 'main', on]);
    }
  }
  for (const { a, b, t0, t1, r } of body.bands) {
    const ring = (r + 1) / 1000;
    const span = (t: number): BodyPoint => ['lerp', point(a), point(b), t];
    parts.push(['limb', span(t0), span(t1), ring, ring, 'joint', { on: carrier(a, b) }]);
  }
  return {
    description: `The mannequin the library was measured on, ${(body.height / 1000).toFixed(2)} m: amber limbs, purple joint rings.`, // prettier-ignore
    slots: { ...MANNEQUIN_SLOTS },
    parts,
  };
}

/**
 * Registers `build:mannequin` (rest body `source` of `set`, its first by default) and `body:mannequin` (its `body`)
 * on `registry` (the shared one), once; returns both.
 */
export function defineMannequin(
  set: { set?: string; sources?: Record<string, { rest: RestBody }>; body?: object | null },
  options: { source?: string; registry?: Registry } = {},
): { build: Build; body: Body } {
  const registry = options.registry ?? sharedRegistry;
  const rest = set.sources?.[options.source ?? Object.keys(set.sources ?? {})[0]]?.rest;
  if (!rest || !set.body) {
    throw codeError('GFX_NO_MANNEQUIN', { set: String(set.set), missing: set.body ? 'rest body' : 'body' });
  }
  buildKind(registry);
  bodyKind(registry);
  const build = registry.has('build', 'build:mannequin')
    ? getBuild('build:mannequin', registry)
    : defineBuild('build:mannequin', restBuild(rest), registry);
  const body = registry.has('body', 'body:mannequin')
    ? getBody('body:mannequin', registry)
    : defineBody('body:mannequin', mannequinBody(set.body as MannequinData, rest, build), registry);
  return { build, body };
}
