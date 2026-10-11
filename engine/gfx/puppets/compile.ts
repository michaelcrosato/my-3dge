/**
 * @file Compiling a body (PLAN.md WP 3.8, I-21): `compileBody(body, build)` turns a body (engine/gfx/puppets/
 * grammar.ts) into pieces for one build's skeleton (engine/anim/skeleton.ts): each a unit shape placed rigidly in
 * one bone's frame, with its slot. Both ways of drawing read the same pieces (draw.ts): one rigid-skinned
 * `SkinnedMesh` per character, or instanced batches per shape for crowds.
 *
 * The unit shapes, in their own frame: `ball` and `eye` a sphere of radius 1; `box` a cube of side 1 about the
 * origin; `cone` radius 1 at y = 0 to its tip at y = 1; `blade` 1 wide (x) and 1 thick (z) from its grip at y = 0,
 * pointed at y = 1; `strip` 1 wide at y = 0, flaring to 1.25 at y = 1, 1 thick. A `limb` piece is its frame only (y
 * from a to b, unscaled) with its `length` and radii, drawn exact when skinned (engine/gfx/geometry/limb.ts) and as
 * a frustum with a ball at each end when instanced. A curve compiles to 4 limbs along a quadratic Bézier; a strand
 * of hair to a cone, the strands spread over the sphere by the golden angle, none over the face; a cape strip is
 * `CAPE_THICKNESS` thick.
 *
 * A part from a to b has its y along a → b; its x (width) runs across the body (+X at rest), or along its facing
 * when y itself runs across; z = x × y, so every frame is right-handed and no piece is mirrored by its matrix (r182
 * keys a pipeline on a mirrored object, and instances cannot be). Points resolve at rest, where every bone's frame
 * is the character's, so a piece's matrix in its bone's frame is its rest matrix moved by the bone's rest position.
 *
 * `reach` bounds every piece around the pelvis joint in any pose (bones keep their lengths, so a piece is never
 * further than the bone lengths down its chain plus its own extent): a puppet's bounding sphere, before root scale.
 *
 * Invariants: pure (the same body and build give the same pieces); colours are linear RGB; the pieces of `parts`
 * come first, then those of `mirror`, left then right. Problems a definition cannot see (a limb no longer than the
 * difference of its radii, a part from a point to itself) throw `GFX_BAD_BODY`, naming the part.
 *
 * @example
 * const humanoid = compileBody('body:humanoid', 'build:chibi');
 * humanoid.pieces.length; // 26: 10 parts, and 8 on each side
 * humanoid.pieces.filter((piece) => piece.glow).length; // 2: the eyes
 * @see engine/gfx/puppets/compile.test.ts
 */
import { createSkeleton, JOINT_COUNT, JOINTS, PARENTS, SOCKETS, type Skeleton } from '../../anim/skeleton';
import type { Build } from '../../anim/builds';
import { toLinear, type Rgb } from '../../core/color';
import { codeError, defineCodes } from '../../core/log';
import type { Registry } from '../../core/registry';
import {
  getBody,
  mirrorPart,
  PART_TYPES,
  type Body,
  type BodyLength,
  type BodyPart,
  type BodyPoint,
  type PartOptions,
} from './grammar';

/** The codes compiling a body raises, with their fixes. */
export const COMPILE_CODES = defineCodes('gfx', {
  GFX_BAD_BODY: {
    template: 'cannot compile {body} for {build}: {part} {problem}',
    fix: '{fix}',
    doc: 'Raised by `compileBody` (engine/gfx/puppets/compile.ts) for what a body definition cannot check without a build: a limb or curve no longer than the difference of its radii, or a part whose two points are the same.',
  },
});

/** A unit shape a piece draws (see the file comment). */
export type PieceShape = 'limb' | 'ball' | 'eye' | 'box' | 'cone' | 'blade' | 'strip';

/** How thick a cape strip is, in metres at size 1. */
export const CAPE_THICKNESS = 0.02;

/** One piece: a unit shape on one bone (see the file comment). */
export interface BodyPiece {
  readonly shape: PieceShape;
  /** The bone it rides: −1 for the root, else the joint's index in `JOINTS`. */
  readonly bone: number;
  /** The unit shape's placement in the bone's frame, column-major (a limb's frame, unscaled). */
  readonly matrix: Float64Array;
  /** A limb's length and radii at a and b (0 for the other shapes). */
  readonly length: number;
  readonly radiusStart: number;
  readonly radiusEnd: number;
  readonly slot: string;
  /** Drawn unlit, with the body's glow material (eyes). */
  readonly glow: boolean;
  /** The part it came from: `parts[3]`, `mirror[1]` or `mirror[1] (right)`. */
  readonly part: string;
}

/** A body compiled for one build (see the file comment). */
export interface CompiledBody {
  readonly body: Body;
  readonly skeleton: Skeleton;
  readonly pieces: readonly BodyPiece[];
  /** Each slot's colour, linear RGB. */
  readonly colors: Readonly<Record<string, Rgb>>;
  /** Each joint's rest position, 3 per joint. */
  readonly rest: Float64Array;
  /** How far any piece reaches from the pelvis joint, in any pose, before the root's scale. */
  readonly reach: number;
}

type Vec = [number, number, number];
const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec, k: number): Vec => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: Vec) => Math.hypot(a[0], a[1], a[2]);
const cross = (a: Vec, b: Vec): Vec => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** The golden angle, which spreads hair strands evenly round the head. */
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

/** Each joint's rest position on `skeleton`, 3 per joint (rest rotations are the identity). */
export function restPositions(skeleton: Skeleton): Float64Array {
  const rest = new Float64Array(JOINT_COUNT * 3);
  for (let j = 0; j < JOINT_COUNT; j++) {
    for (let k = 0; k < 3; k++)
      rest[j * 3 + k] = (PARENTS[j] < 0 ? 0 : rest[PARENTS[j] * 3 + k]) + skeleton.offsets[j * 3 + k];
  }
  return rest;
}

/** A column-major matrix from axes x, y, z (already scaled) and origin t. */
function matrixOf(x: Vec, y: Vec, z: Vec, t: Vec): Float64Array {
  return Float64Array.of(...x, 0, ...y, 0, ...z, 0, ...t, 1);
}

/** The frame of a part from a to b: y along it, x across the body, z = x × y, and its length. */
function frame(a: Vec, b: Vec): { x: Vec; y: Vec; z: Vec; length: number } {
  const length = norm(sub(b, a));
  const y = scale(sub(b, a), 1 / length);
  const across: Vec = Math.abs(y[0]) > 0.9 ? [0, 0, 1] : [1, 0, 0];
  const x0 = sub(across, scale(y, dot(across, y)));
  const x = scale(x0, 1 / norm(x0));
  return { x, y, z: cross(x, y), length };
}

/** Compiles `body` (or its id) for `build` (a skeleton, a build or a build id; `build:chibi` by default). */
export function compileBody(
  body: Body | string,
  build: Skeleton | Build | string = 'build:chibi',
  options: { registry?: Registry } = {},
): CompiledBody {
  const b = typeof body === 'string' ? getBody(body, options.registry) : body;
  const skeleton = typeof build === 'object' && 'offsets' in build ? build : createSkeleton(build);
  const s = skeleton.build.size;
  const sizes = { limbRadius: b.limbRadius, torsoRadius: b.torsoRadius, ...b.builds[skeleton.build.id] };
  const rest = restPositions(skeleton);
  const pieces: BodyPiece[] = [];
  const fail = (part: string, problem: string, fix: string): never => {
    throw codeError('GFX_BAD_BODY', { body: b.id, build: skeleton.build.id, part, problem, fix });
  };

  /** A length in metres for this build. */
  const len = (length: BodyLength): number => {
    if (typeof length === 'number') return length * s;
    const [k, ref] = length;
    return k * (ref === 'head' ? skeleton.headRadius : ref === 'limb' ? sizes.limbRadius * s : sizes.torsoRadius * s);
  };
  /** A point's rest position and the bone it names (null for `[f, r, u]`). */
  const point = (p: BodyPoint): { at: Vec; bone: number | null } => {
    if (typeof p === 'string') {
      const socket = (SOCKETS as readonly string[]).indexOf(p);
      const j = socket >= 0 ? skeleton.socketJoints[socket] : (JOINTS as readonly string[]).indexOf(p);
      const at: Vec = [rest[j * 3], rest[j * 3 + 1], rest[j * 3 + 2]];
      const offset = skeleton.socketOffsets;
      return {
        at: socket < 0 ? at : add(at, [offset[socket * 3], offset[socket * 3 + 1], offset[socket * 3 + 2]]),
        bone: j,
      };
    }
    if (p[0] === 'lerp') {
      const [a, c] = [point(p[1]), point(p[2])];
      return { at: add(a.at, scale(sub(c.at, a.at), p[3])), bone: a.bone ?? c.bone };
    }
    if (p[0] === 'off') {
      const from = point(p[1]);
      return { at: add(from.at, [-len(p[3]), len(p[4]), len(p[2])]), bone: from.bone };
    }
    const [f, r, u] = p as readonly [BodyLength, BodyLength, BodyLength];
    return { at: [-len(r), len(u), len(f)], bone: null };
  };

  /** Compiles one part into pieces. */
  const compilePart = (part: BodyPart, where: string) => {
    const kinds = PART_TYPES[part[0]];
    const options = part.length > kinds.length + 1 ? (part[kinds.length + 1] as PartOptions) : {};
    const resolved = part.map((arg, i) => (kinds[i - 1] === 'p' ? point(arg as BodyPoint) : null));
    const named = resolved.find((r) => r && r.bone !== null)?.bone ?? -1;
    const bone = options.on === 'root' ? -1 : options.on ? (JOINTS as readonly string[]).indexOf(options.on) : named;
    const origin: Vec = bone < 0 ? [0, 0, 0] : [rest[bone * 3], rest[bone * 3 + 1], rest[bone * 3 + 2]];
    const slot = part[kinds.length] as string;
    const push = (shape: PieceShape, m: Float64Array, limb = [0, 0, 0]) => {
      for (let k = 0; k < 3; k++) m[12 + k] -= origin[k];
      const [length, radiusStart, radiusEnd] = limb;
      pieces.push({ shape, bone, matrix: m, length, radiusStart, radiusEnd, slot, glow: shape === 'eye', part: where });
    };
    const span = (a: Vec, b: Vec) => {
      const f = frame(a, b);
      if (!(f.length > 1e-6)) fail(where, 'runs from a point to itself', 'give the part two different points');
      return f;
    };
    const limb = (a: Vec, b: Vec, ra: number, rb: number) => {
      const f = span(a, b);
      if (f.length <= Math.abs(ra - rb)) {
        fail(
          where,
          `is ${f.length.toFixed(4)} m long, no more than its radii differ`,
          'make it longer or its radii closer',
        );
      }
      push('limb', matrixOf(f.x, f.y, f.z, a), [f.length, ra, rb]);
    };
    const along = (shape: PieceShape, a: Vec, b: Vec, w: number, t: number, centred = false) => {
      const f = span(a, b);
      push(shape, matrixOf(scale(f.x, w), scale(f.y, f.length), scale(f.z, t), centred ? scale(add(a, b), 0.5) : a));
    };
    const ball = (shape: PieceShape, c: Vec, r: Vec) =>
      push(shape, matrixOf([r[0], 0, 0], [0, r[1], 0], [0, 0, r[2]], c));
    const [a, b2] = [resolved[1]?.at, resolved[2]?.at] as [Vec, Vec];
    const arg = (i: number) => part[i] as BodyLength;
    switch (part[0]) {
      case 'limb':
        return limb(a, b2, len(arg(3)), len(arg(4)));
      case 'curve': {
        const f = span(a, b2);
        const mid = scale(add(a, b2), 0.5);
        let out: Vec = sub([mid[0], 0, mid[2]], scale(f.y, dot([mid[0], 0, mid[2]], f.y)));
        if (norm(out) < 1e-6) out = sub([0, 0, 1], scale(f.y, f.y[2]));
        const control = add(mid, scale(out, (part[3] * f.length) / norm(out)));
        const at = (t: number) => add(add(scale(a, (1 - t) ** 2), scale(control, 2 * (1 - t) * t)), scale(b2, t * t));
        const [ra, rb] = [len(arg(4)), len(arg(5))];
        for (let k = 0; k < 4; k++)
          limb(at(k / 4), at((k + 1) / 4), ra + ((rb - ra) * k) / 4, ra + ((rb - ra) * (k + 1)) / 4);
        return;
      }
      case 'ball':
      case 'eye': {
        const r = part[2] as BodyLength | readonly BodyLength[];
        const three = Array.isArray(r) && r.length === 3;
        const radii: Vec = three
          ? [len(r[0]), len(r[1]), len(r[2])]
          : ([0, 0, 0].map(() => len(r as BodyLength)) as Vec);
        return ball(part[0], a, radii);
      }
      case 'box':
        return along('box', a, b2, len(arg(3)), len(arg(4)), true);
      case 'cone':
        return along('cone', a, b2, len(arg(3)), len(arg(3)));
      case 'blade':
        return along('blade', a, b2, len(arg(3)), len(arg(4)));
      case 'cape':
        return along('strip', a, b2, len(arg(3)), CAPE_THICKNESS * s);
      case 'hair': {
        const [radius, count, length, width] = [len(arg(2)), part[3], len(arg(4)), len(arg(5))];
        for (let i = 0; i < count; i++) {
          const polar = ((i + 0.5) / count) * 0.62 * Math.PI;
          const d: Vec = [
            Math.sin(polar) * Math.cos(i * GOLDEN),
            Math.cos(polar),
            Math.sin(polar) * Math.sin(i * GOLDEN),
          ];
          if (d[2] > 0.25) d[2] = -d[2];
          const root = add(a, scale(d, radius * 0.9));
          const droop = add(d, [0, -0.6, -0.4]);
          along('cone', root, add(root, scale(droop, length / norm(droop))), width, width);
        }
        return;
      }
    }
  };

  b.parts.forEach((part, i) => compilePart(part, `parts[${i}]`));
  b.mirror.forEach((part, i) => {
    compilePart(part, `mirror[${i}]`);
    compilePart(mirrorPart(part), `mirror[${i}] (right)`);
  });
  const colors = Object.fromEntries(Object.entries(b.slots).map(([slot, color]) => [slot, toLinear(color)]));
  return { body: b, skeleton, pieces, colors, rest, reach: reachOf(skeleton, pieces) };
}

/** The radius of each unit shape about its own origin. */
const UNIT_RADIUS: Record<PieceShape, number> = {
  limb: 0,
  ball: 1,
  eye: 1,
  box: Math.sqrt(3) / 2,
  cone: 1,
  blade: 1,
  strip: Math.hypot(0.625, 1, 0.5),
};

/** How far any piece reaches from the pelvis joint (see the file comment). */
function reachOf(skeleton: Skeleton, pieces: readonly BodyPiece[]): number {
  const chain = new Float64Array(JOINT_COUNT);
  for (let j = 0; j < JOINT_COUNT; j++) chain[j] = PARENTS[j] < 0 ? 0 : chain[PARENTS[j]] + skeleton.lengths[j];
  let reach = 0;
  for (const piece of pieces) {
    const m = piece.matrix;
    const columns = [0, 4, 8].map((c) => Math.hypot(m[c], m[c + 1], m[c + 2]));
    const extent =
      piece.shape === 'limb'
        ? piece.length + Math.max(piece.radiusStart, piece.radiusEnd)
        : UNIT_RADIUS[piece.shape] * Math.max(...columns);
    const from = piece.bone < 0 ? skeleton.lengths[0] : chain[piece.bone];
    reach = Math.max(reach, from + Math.hypot(m[12], m[13], m[14]) + extent);
  }
  return reach;
}

/** `compiled` with its slots' colours replaced by `palette`'s (hex), the pieces shared. */
export function recolor(compiled: CompiledBody, palette: Readonly<Record<string, string>>): CompiledBody {
  const colors = { ...compiled.colors };
  for (const [slot, color] of Object.entries(palette)) colors[slot] = toLinear(color);
  return { ...compiled, colors };
}
