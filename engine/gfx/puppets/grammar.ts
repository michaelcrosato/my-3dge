/**
 * @file The body grammar, v2 (PLAN.md WP 3.8, §5.1; I-21): a puppet's body as data, the registry kind `body`. A body
 * lists its parts, one line each, hung on the humanoid skeleton's bones (engine/anim/skeleton.ts), its material slots
 * (the default palette) and the drawing sizes its lengths may name. `compileBody` (compile.ts) turns it into pieces
 * for one build; `createPuppet` and `createPuppetBatches` (draw.ts) draw them.
 *
 * Parts (sizes in metres, scaled with the build's `size`; a size may also be `[k, 'head' | 'limb' | 'torso']`, k
 * times the skeleton's head radius or the body's `limbRadius` or `torsoRadius`):
 * - `['limb', a, b, radiusA, radiusB, slot]`: a tapered limb from a to b, round at both ends;
 * - `['curve', a, b, bow, radiusA, radiusB, slot]`: a limb bowed away from the body by `bow` × its length;
 * - `['ball', at, radius | [rx, ry, rz], slot]`: a sphere, or an ellipsoid along its bone's axes;
 * - `['eye', at, radius, slot]`: a small unlit sphere;
 * - `['box', a, b, width, depth, slot]`: a box from a to b, `width` across the body and `depth` along its facing;
 * - `['cone', base, tip, radius, slot]`: horns, spikes, hats;
 * - `['blade', grip, tip, width, thickness, slot]`: a flat blade pointed at its tip;
 * - `['cape', top, bottom, width, slot]`: a cape strip hanging from top to bottom, flaring by a quarter;
 * - `['hair', centre, radius, count, length, width, slot]`: `count` strands rooted over the back and top of a sphere.
 * Each may end with options, `{ on: bone }`: the bone it rides.
 *
 * Points: a joint (`'shinL'`), a socket (`'eyeL'`, `'weaponR'`, `'back'`), `[f, r, u]` (forward, right and up from
 * the root), `['lerp', a, b, t]` or `['off', p, f, r, u]` (p moved forward, right and up). Every point is a rest
 * position: at rest every bone's frame is the character's (+Z forward, +Y up, right is −X). A part rides one bone,
 * rigidly: its `on`, else the bone of its first point that names a joint or socket, else the root.
 *
 * `mirror` lists parts written for the left side; each is drawn on the right too, its L and R names swapped and its
 * right offsets negated. `slots` maps slot names to hex colours; a palette overrides them per character. Eyes draw
 * with `glowMaterial` (unlit), the rest with `material`. `builds` gives a build's own `limbRadius` and `torsoRadius`
 * by its id: the builds' drawing fields (my-3d2dge's `limbW` / 2 and `torsoW`, in metres).
 *
 * Invariants: a body is checked when defined (`CORE_BAD_SPEC` names each problem, `bodyProblems`); a missing id
 * stands in as `body:humanoid`. Nothing here draws or reaches the sim.
 *
 * Carried from the lab3d grammar, `my-3d2dge:src/lab3d/40-characters.js:8-48`, in metres on bones.
 *
 * @example
 * mirrorPart(['limb', 'thighL', ['off', 'shinL', 0, 0.02, 0], 0.07, 0.06, 'pants']);
 * // ['limb', 'thighR', ['off', 'shinR', 0, -0.02, 0], 0.07, 0.06, 'pants']
 * getBody('body:humanoid').slots.skin; // '#f1c7a0'
 * @see engine/gfx/puppets/grammar.test.ts
 */
import { JOINTS, SOCKETS } from '../../anim/skeleton';
import { hex } from '../../core/color';
import { didYouMean } from '../../core/log';
import { registry as sharedRegistry, type Entry, type Registry } from '../../core/registry';
import type { Schema } from '../../core/schema';
import { HUMANOID_BODY } from './bodies/humanoid';

/** A size or an offset: metres, or `[k, ref]`, k times the head radius, the limb radius or the torso radius. */
export type BodyLength = number | readonly [number, 'head' | 'limb' | 'torso'];

/** Where a part's end lies (see the file comment). */
export type BodyPoint =
  | string
  | readonly [BodyLength, BodyLength, BodyLength]
  | readonly ['lerp', BodyPoint, BodyPoint, number]
  | readonly ['off', BodyPoint, BodyLength, BodyLength, BodyLength];

/** A part's options: the bone it rides (a joint, or `'root'`). */
export interface PartOptions {
  on?: string;
}

/** One part, one line (see the file comment). */
export type BodyPart =
  | readonly ['limb', BodyPoint, BodyPoint, BodyLength, BodyLength, string, PartOptions?]
  | readonly ['curve', BodyPoint, BodyPoint, number, BodyLength, BodyLength, string, PartOptions?]
  | readonly ['ball', BodyPoint, BodyLength | readonly [BodyLength, BodyLength, BodyLength], string, PartOptions?]
  | readonly ['eye', BodyPoint, BodyLength, string, PartOptions?]
  | readonly ['box', BodyPoint, BodyPoint, BodyLength, BodyLength, string, PartOptions?]
  | readonly ['cone', BodyPoint, BodyPoint, BodyLength, string, PartOptions?]
  | readonly ['blade', BodyPoint, BodyPoint, BodyLength, BodyLength, string, PartOptions?]
  | readonly ['cape', BodyPoint, BodyPoint, BodyLength, string, PartOptions?]
  | readonly ['hair', BodyPoint, BodyLength, number, BodyLength, BodyLength, string, PartOptions?];

/**
 * Each part type's arguments after its name: `p` a point, `s` a size, `r` a size or three, `n` a number, `c` a count
 * (1–64), `k` the slot.
 */
export const PART_TYPES = {
  limb: 'ppssk',
  curve: 'ppnssk',
  ball: 'prk',
  eye: 'psk',
  box: 'ppssk',
  cone: 'ppsk',
  blade: 'ppssk',
  cape: 'ppsk',
  hair: 'pscssk',
} as const;

/** A part type's name. */
export type PartType = keyof typeof PART_TYPES;

/** A length field of the body schema, in metres. */
const metres = (value: number, description: string) =>
  ({ type: 'number', default: value, minimum: 0, unit: 'm', description }) as const;

/** The fields of a `body` entry. */
export const BODY_FIELDS = {
  description: { type: 'string', default: '', description: 'What the body is, in plain sentences.' },
  slots: { type: 'object', default: {}, description: 'Material slots: each name with its hex colour (the palette).' },
  parts: { type: 'array', default: [], description: 'The parts, one line each (engine/gfx/puppets/grammar.ts).' },
  mirror: { type: 'array', default: [], description: 'Parts written for the left side, drawn on both sides.' },
  limbRadius: metres(0.0625, "A limb's radius, for sizes written [k, 'limb'] (my-3d2dge's limbW / 2)."),
  torsoRadius: metres(0.1875, "The torso's radius, for sizes written [k, 'torso'] (my-3d2dge's torsoW)."),
  builds: { type: 'object', default: {}, description: 'By build id: the limbRadius and torsoRadius it changes.' },
  material: { type: 'string', default: 'material:puppet', description: 'The material of every part but eyes.' },
  glowMaterial: { type: 'string', default: 'material:puppetGlow', description: 'The unlit material of eyes.' },
} as const satisfies Schema;

/** A `body` entry: the parsed spec, its parts typed. */
export type Body = Omit<Entry<typeof BODY_FIELDS>, 'slots' | 'parts' | 'mirror' | 'builds'> & {
  readonly slots: Readonly<Record<string, string>>;
  readonly parts: readonly BodyPart[];
  readonly mirror: readonly BodyPart[];
  readonly builds: Readonly<Record<string, { limbRadius?: number; torsoRadius?: number }>>;
};

/** What `defineBody` takes: any field; absent ones keep their defaults. */
export interface BodySpec {
  description?: string;
  slots?: Readonly<Record<string, string>>;
  parts?: readonly BodyPart[];
  mirror?: readonly BodyPart[];
  limbRadius?: number;
  torsoRadius?: number;
  builds?: Readonly<Record<string, { limbRadius?: number; torsoRadius?: number }>>;
  material?: string;
  glowMaterial?: string;
}

/** The names a point may give: the joints and the sockets. */
const NAMES: readonly string[] = [...JOINTS, ...SOCKETS];

/** `name` with its side swapped (`thighL` → `thighR`), when the swapped name exists; else `name`. */
export function mirrorName(name: string): string {
  const side = name.at(-1);
  const swapped = name.slice(0, -1) + (side === 'L' ? 'R' : 'L');
  return (side === 'L' || side === 'R') && NAMES.includes(swapped) ? swapped : name;
}

/** `length` negated (a right offset turned left). */
const negate = (length: BodyLength): BodyLength => (typeof length === 'number' ? -length : [-length[0], length[1]]);

/** `point` mirrored left to right. */
export function mirrorPoint(point: BodyPoint): BodyPoint {
  if (typeof point === 'string') return mirrorName(point);
  if (point[0] === 'lerp') return ['lerp', mirrorPoint(point[1]), mirrorPoint(point[2]), point[3]];
  if (point[0] === 'off') return ['off', mirrorPoint(point[1]), point[2], negate(point[3]), point[4]];
  const [f, r, u] = point as readonly [BodyLength, BodyLength, BodyLength];
  return [f, negate(r), u];
}

/** `part` mirrored left to right: its points and its `on` bone (see the file comment). */
export function mirrorPart(part: BodyPart): BodyPart {
  const kinds = PART_TYPES[part[0]];
  const mirrored = part.map((arg, i) => {
    if (i === 0) return arg;
    if (kinds[i - 1] === 'p') return mirrorPoint(arg as BodyPoint);
    const on = (arg as PartOptions | undefined)?.on;
    return i > kinds.length && on ? { ...(arg as PartOptions), on: mirrorName(on) } : arg;
  });
  return mirrored as unknown as BodyPart;
}

/** Why `value` is no length (signed when `offset`), or null. */
function lengthProblem(value: unknown, offset: boolean): string | null {
  const ok = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && (offset || n > 0);
  if (ok(value)) return null;
  if (Array.isArray(value) && value.length === 2 && ok(value[0]) && ['head', 'limb', 'torso'].includes(value[1])) {
    return null;
  }
  const what = offset ? 'metres, or [k, ref]' : 'metres above 0, or [k, ref] with k above 0';
  return `${JSON.stringify(value)} is no ${offset ? 'offset' : 'size'} (write ${what}; ref head, limb or torso)`;
}

/** Why `point` is no point, or null. */
export function pointProblem(point: unknown): string | null {
  if (typeof point === 'string') {
    return NAMES.includes(point) ? null : `${JSON.stringify(point)} is no joint or socket${didYouMean(point, NAMES)}`;
  }
  if (!Array.isArray(point)) return `${JSON.stringify(point)} is no point`;
  if (point[0] === 'lerp') {
    if (point.length !== 4 || typeof point[3] !== 'number') return "write ['lerp', a, b, t]";
    return pointProblem(point[1]) ?? pointProblem(point[2]);
  }
  if (point[0] === 'off') {
    if (point.length !== 5) return "write ['off', point, forward, right, up]";
    return (
      pointProblem(point[1]) ??
      point
        .slice(2)
        .map((v) => lengthProblem(v, true))
        .find(Boolean) ??
      null
    );
  }
  if (point.length !== 3) return `${JSON.stringify(point)} is no point: write a name, [f, r, u], lerp or off`;
  return point.map((v) => lengthProblem(v, true)).find(Boolean) ?? null;
}

/** The problems of one part, each starting with where it is (`parts[3] (limb)`). */
function partProblems(part: unknown, where: string, slots: Readonly<Record<string, string>>): string[] {
  if (!Array.isArray(part) || !Object.hasOwn(PART_TYPES, part[0])) {
    const type = Array.isArray(part) ? String(part[0]) : JSON.stringify(part);
    return [`${where}: ${type} is no part type${didYouMean(type, Object.keys(PART_TYPES))}`];
  }
  const kinds: string = PART_TYPES[part[0] as PartType];
  const at = `${where} (${part[0]})`;
  const options = part.length === kinds.length + 2 ? part.at(-1) : undefined;
  if (part.length !== kinds.length + 1 && !(options && typeof options === 'object' && !Array.isArray(options))) {
    return [`${at}: has ${part.length - 1} arguments, needs ${kinds.length} (and an optional { on })`];
  }
  const problems: string[] = [];
  [...kinds].forEach((kind, i) => {
    const arg = part[i + 1];
    let problem: string | null = null;
    if (kind === 'p') problem = pointProblem(arg);
    else if (kind === 's') problem = lengthProblem(arg, false);
    else if (kind === 'r') {
      const three = Array.isArray(arg) && arg.length === 3;
      problem = three
        ? (arg.map((v: unknown) => lengthProblem(v, false)).find(Boolean) ?? null)
        : lengthProblem(arg, false);
    } else if (kind === 'n') problem = Number.isFinite(arg) ? null : `${JSON.stringify(arg)} is no number`;
    else if (kind === 'c') problem = Number.isInteger(arg) && arg >= 1 && arg <= 64 ? null : `count ${arg} is not 1–64`;
    else if (!Object.hasOwn(slots, arg)) {
      problem = `slot ${JSON.stringify(arg)} is not in slots${didYouMean(String(arg), Object.keys(slots))}`;
    }
    if (problem) problems.push(`${at}, argument ${i + 1}: ${problem}`);
  });
  const on = (options as PartOptions | undefined)?.on;
  if (
    options &&
    (Object.keys(options).some((key) => key !== 'on') || (on !== 'root' && !JOINTS.includes(on as never)))
  ) {
    problems.push(`${at}: its options ${JSON.stringify(options)} are not { on: a joint or 'root' }`);
  }
  return problems;
}

/**
 * The problems of a body beyond its fields' types: colours that are not hex, builds giving other fields, and in every
 * part an unknown type, the wrong number of arguments, a point that is no joint or socket, a slot the body lacks, a
 * size that is not positive, a count outside 1–64, or options other than `{ on }`.
 */
export function bodyProblems(body: Body): string[] {
  const problems: string[] = [];
  for (const [slot, color] of Object.entries(body.slots)) {
    try {
      hex(color);
    } catch {
      problems.push(`slot ${slot} is ${JSON.stringify(color)}; write colours as hex strings ('#rrggbb')`);
    }
  }
  for (const [build, sizes] of Object.entries(body.builds)) {
    const bad = Object.entries(sizes ?? {}).filter(
      ([key, value]) => !['limbRadius', 'torsoRadius'].includes(key) || !(typeof value === 'number' && value > 0),
    );
    if (bad.length) problems.push(`builds.${build}: give only limbRadius and torsoRadius, in metres above 0`);
  }
  body.parts.forEach((part, i) => problems.push(...partProblems(part, `parts[${i}]`, body.slots)));
  body.mirror.forEach((part, i) => problems.push(...partProblems(part, `mirror[${i}]`, body.slots)));
  return problems;
}

/** Declares the kind `body` on `registry`, with the engine's bodies (`body:humanoid`), unless it has it. */
export function bodyKind(registry: Registry): void {
  if (registry.kinds().includes('body')) return;
  registry.defineKind('body', {
    description: 'Puppet bodies: parts on the humanoid skeleton, one line each, with material slots (the palette).',
    fields: BODY_FIELDS,
    fallback: 'body:humanoid',
    defineWith:
      "defineBody('<id>', { slots: { skin: '#…' }, parts: [['limb', 'thighL', 'shinL', 0.07, 0.06, 'skin']] })",
    check: (entry) => bodyProblems(entry as unknown as Body),
  });
  registry.def('body', 'body:humanoid', HUMANOID_BODY as Record<string, unknown>);
}
bodyKind(sharedRegistry);

/** Defines a body on `registry` (the shared one by default). Throws `CORE_BAD_SPEC`, `CORE_DUPLICATE_ID`. */
export function defineBody(id: string, spec: BodySpec, registry: Registry = sharedRegistry): Body {
  bodyKind(registry);
  return registry.def('body', id, spec as Record<string, unknown>) as unknown as Body;
}

/** The body `id` of `registry`; a missing id warns once (`CORE_UNKNOWN_ID`) and gives `body:humanoid`. */
export function getBody(id: string, registry: Registry = sharedRegistry): Body {
  bodyKind(registry);
  return registry.get('body', id) as unknown as Body;
}
