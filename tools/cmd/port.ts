/**
 * @file Records the reference vectors the ports from my-3d2dge are tested against (PLAN.md WP 0.11, §9.0): the old
 * engine's own outputs as text JSON in `tests/baselines/port/`, with a generated README that says what each file
 * holds, the source commit, the sampling and the conversion to my-3dge's frame (Appendix C). Consumers: WP 1.1
 * (`rng`, `hash2`, `noise2`, angle and colour helpers), 3.6 (the Humanoid state matrix), 5.3 (Blob updates) and 6.1
 * (`E.move`); WP 8.2 adds the library's clips.
 *
 * `refs` loads `my-3d2dge:engine/my-3d2dge.js` from `$MY3D2DGE_SRC` (resolved as tools/lib/source.ts does) into a
 * Node `vm` context, as `my-3d2dge:tools/mocap-lib.mjs:7` loads its codec; `console` is the only shim, and any
 * message fails the run. `Math.random` is the engine's own `rng`, reseeded per record from its id; dt is fixed.
 * Humanoid runs record their initial breathing phase (`my-3d2dge:engine/my-3d2dge.js:1782`) for WP 3.6 to inject.
 *
 * Invariants: a re-run is byte-identical: numbers are exact (the shortest decimal that parses back to the double,
 * `-0` kept), keys keep a fixed order. `checksums.json` holds each file's sha256; `--check` (offline, no source) and
 * the `port` plugin of `x check` compare them. A changed vector is a changed baseline: give the reason (AGENTS.md).
 *
 * Usage: node x port refs [--check]. Exit 0; 1 when the source is unresolved, the engine warns or a check fails.
 * @see tools/cmd/port.test.ts
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { fnv1a } from '../lib/hash';
import type { Finding } from '../lib/report';
import { resolveSource, sourceSpecs } from '../lib/source';
import { UsageError, type Command, type CommandResult } from '../x';
import type { CheckPlugin } from './check';

/** Where the vectors live, relative to the repository root. */
export const PORT_DIR = 'tests/baselines/port';
/** The file in `PORT_DIR` that records every other file's sha256. */
export const CHECKSUMS = 'checksums.json';
/** The engine file inside the source checkout. */
const ENGINE = 'engine/my-3d2dge.js';
/** The fixed step (seconds), and the steps of each humanoid run. */
const [DT, STEPS] = [1 / 120, 120];

/** A point or direction as the source writes it: `[x, y, z]`, world or rig-local, in units (16 per metre). */
type V3 = number[];
/** The parts of `E.Humanoid` the vectors read: clock, root, rig-local joints, transform and sockets. */
type SourceRig = { t: number; x: number; y: number; z: number; J: Record<string, V3>; _w(local: V3): V3 } & Sockets;
type Sockets = Updates & { hand(which?: string): V3; tip(): V3 };
type Updates = { update(dt: number, state: object): void };
/** The parts of `E.Blob` the vectors read. */
type SourceBlob = { sq: number; sqV: number; look: V3; flap: number; flapP: number; kick(v: number): void } & Updates;
/** Helpers of `E`, by what they return. */
type Helpers<K extends string, R> = Record<K, (...args: unknown[]) => R>;
/** The parts of the old engine's `E` (`My3D2dge`) the vectors call. */
export type SourceEngine = Helpers<'hash2' | 'noise2' | 'angDiff' | 'lerpAng' | 'approachAng' | 'approach', number> &
  Helpers<'smoothDamp' | 'hex' | 'toHsl', V3> &
  Helpers<'toHex' | 'hsl' | 'shade' | 'mix', string> & {
    rng(seed: number): () => number;
    ease: Record<string, (u: number) => number>;
    tones(color: string, strength: number): Record<string, string>;
    ramp(color: string, n: number, strength: number): string[];
    Humanoid: new (options?: object) => SourceRig;
    Blob: new (options?: object) => SourceBlob;
    MOVES: Record<string, object>;
    move(name: string, u: number, phase: string): { spec: object };
  };
/** The old engine in its own `vm` context: `E`, what it printed (must stay empty), and `seed(id)` for each record. */
export type LoadedEngine = { E: SourceEngine; messages: string[]; seed(id: string): void };

/** Loads `my-3d2dge:engine/my-3d2dge.js` from the checkout at `sourcePath` into a fresh `vm` context. */
export function loadEngine(sourcePath: string): LoadedEngine {
  const file = join(sourcePath, ENGINE);
  const messages: string[] = [];
  const say = (...args: unknown[]) => void messages.push(args.map(String).join(' '));
  const context = vm.createContext({ console: { log: say, info: say, warn: say, error: say, debug: say } });
  const math = vm.runInContext('Math', context) as Math;
  math.random = () => {
    throw new Error('Math.random was called before a record seeded it (loadEngine().seed)');
  };
  vm.runInContext(readFileSync(file, 'utf8'), context, { filename: file });
  const E = (context as { My3D2dge: SourceEngine }).My3D2dge;
  return { E, messages, seed: (id) => void (math.random = E.rng(fnv1a(id))) };
}

/** A scalar as written: numbers exact (the shortest decimal that parses back), `-0` kept; NaN and infinities throw. */
function scalar(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return Object.is(value, -0) ? '-0' : String(value);
  if (typeof value === 'string' || typeof value === 'boolean' || value === null) return JSON.stringify(value);
  throw new Error(`a vector holds ${String(value)}: write finite numbers, strings, booleans, arrays and objects`);
}
/** One line of JSON, without spaces. */
function compact(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(compact).join(',')}]`;
  if (!value || typeof value !== 'object') return scalar(value);
  return `{${Object.entries(value)
    .map(([key, item]) => `${JSON.stringify(key)}:${compact(item)}`)
    .join(',')}}`;
}
/**
 * Writes JSON in a stable layout: a container that fits in 120 columns stays on one line, and so does any array of
 * scalars (one sample per line); the others open one item per line, indented by two spaces.
 */
export function layout(value: unknown, indent = ''): string {
  const flat = compact(value);
  if (!value || typeof value !== 'object' || indent.length + flat.length <= 120) return flat;
  if (Array.isArray(value) && value.every((item) => item === null || typeof item !== 'object')) return flat;
  const inner = `${indent}  `;
  if (Array.isArray(value)) return `[\n${value.map((item) => inner + layout(item, inner)).join(',\n')}\n${indent}]`;
  const items = Object.entries(value).map(([key, item]) => `${inner}${JSON.stringify(key)}: ${layout(item, inner)}`);
  return `{\n${items.join(',\n')}\n${indent}}`;
}

const range = (n: number, from = 0) => Array.from({ length: n }, (_, i) => from + i);
const grid = <A, B>(as: A[], bs: B[]): [A, B][] => as.flatMap((a) => bs.map((b): [A, B] => [a, b]));
/** Splits a flat list into tuples of `n`: `chunks([1, 2, 3, 4], 2)` is `[[1, 2], [3, 4]]`. */
const chunks = (flat: number[], n: number) => range(flat.length / n).map((i) => flat.slice(i * n, i * n + n));

/** `core.json`: `rng`, `hash2`, `noise2`, and the math helpers WP 1.1 ports. */
export function coreVectors({ E }: LoadedEngine): object {
  const seeds = [0, 1, 2, 42, 1234567, -1, 2147483647, -2147483648, 2654435769, 3.7, 2 ** 40 + 5];
  const odd = chunks([1e9, -1e9, 2 ** 31, 1, -(2 ** 31) - 1, 7, 3.9, -2.1, -3.9, 2.1, 123456789, 987654321], 2);
  const points = grid(range(12), range(12)).map(([i, j]) => [-3.3 + i * 0.55, -2.2 + j * 0.45]);
  points.push(...chunks([0, 0, 1, 1, 0.5, 0.5, 1000.25, -2000.75, -0.0001, 0.9999], 2));
  const angles = [-7, -3.5, -Math.PI, -1, -0.25, 0, 0.5, Math.PI / 2, Math.PI, 3, 6.5, 10];
  const pairs = grid(angles, angles);
  const damp = grid(grid([0, 5, -3], [10, -2]), grid(grid([0, 4], [0.1, 0.5]), [1 / 120, 1 / 60]));
  const curve = (name: string) => [name, range(21).map((i) => [i / 20, E.ease[name](i / 20)])];
  return {
    rng: seeds.map((seed) => ({ seed, values: range(64).map(E.rng(seed)) })),
    hash2: [...grid(range(7, -3), range(7, -3)), ...odd].map(([x, y]) => [x, y, E.hash2(x, y)]),
    noise2: points.map(([x, y]) => [x, y, E.noise2(x, y)]),
    angDiff: pairs.map(([a, b]) => [a, b, E.angDiff(a, b)]),
    lerpAng: pairs.map(([a, b]) => [a, b, 0.3, E.lerpAng(a, b, 0.3)]),
    approachAng: pairs.map(([a, b]) => [a, b, 0.4, E.approachAng(a, b, 0.4)]),
    approach: pairs.map(([a, b]) => [a, b, 0.4, E.approach(a, b, 0.4)]),
    smoothDamp: damp.map(([[x, to], [[v, st], dt]]) => [x, to, v, st, dt, ...E.smoothDamp(x, to, v, st, dt)]),
    ease: Object.fromEntries(Object.keys(E.ease).map(curve)),
  };
}

/** `color.json`: the colour helpers over a fixed list of colours, 24 of them drawn from `E.rng(0x5eed)`. */
export function colorVectors({ E }: LoadedEngine): object {
  const next = E.rng(0x5eed);
  const random = () => `#${(2 ** 24 + Math.floor(next() * 2 ** 24)).toString(16).slice(1)}`;
  const colors = [
    ...'#f1c7a0 #3b2a2f #2f8f86 #3b3552 #6a4128 #e0a84a #c8452f #7a2622 #dce8f1 #7f93ab #e8b04e #1a1320'.split(' '),
    ...'#000000 #ffffff #808080 #ff0000 #00ff00 #0000ff #ffff00 #00ffff #ff00ff #7f8080 #8a8f8c #abc #F0A'.split(' '),
    ...range(24).map(random),
  ];
  const bytes = chunks([0, 0, 0, 255, 255, 255, 12.5, 300, -4, 127.5, 127.49, 0.5, -0.5, 254.5, 255.4], 3);
  const hues = [-30, 0, 45, 59.9, 60, 120, 180, 240, 300, 359, 400];
  const hsl = grid(grid(hues, [0, 0.3, 1, 1.2]), [-0.1, 0, 0.25, 0.5, 0.8, 1]);
  const neighbours = colors.map((c, i) => [c, colors[(i + 1) % colors.length]]);
  return {
    colors,
    hex: colors.map((c) => [c, [...E.hex(c)]]),
    toHex: bytes.map((c) => [c, E.toHex(c)]),
    toHsl: colors.map((c) => [c, [...E.toHsl(c)]]),
    hsl: hsl.map(([[h, s], l]) => [h, s, l, E.hsl(h, s, l)]),
    shade: grid(colors, [-0.6, -0.3, -0.15, -0.05, 0.1, 0.25, 0.5]).map(([c, a]) => [c, a, E.shade(c, a)]),
    mix: grid(neighbours, [0, 0.3, 0.5, 1]).map(([[a, b], t]) => [a, b, t, E.mix(a, b, t)]),
    tones: grid(colors, [1, 0.5, 2]).map(([c, k]) => [c, k, { ...E.tones(c, k) }]),
    ramp: grid(colors, chunks([5, 1, 3, 0.5, 7, 2, 1, 1], 2)).map(([c, [n, k]]) => [c, n, k, [...E.ramp(c, n, k)]]),
  };
}

/** The builds of the humanoid matrix and of the moves. */
export const BUILDS = ['chibi', 'heroic', 'bulky'];
/** The humanoid's recorded points: `rig.J`'s joints, then `tip` (`rig.tip()`). */
const POINTS = 'hipL hipR kneeL kneeR footL footR hipC shC shL shR head elbowL elbowR handL handR tip'.split(' ');
const POSES = ['cheer', 'cast', 'guard', 'kneel', 'crouch', 'wave', 'hips', 'block', 'die', 'down'];
/** A state: speed along the facing and climb speed (units/s), start height, and the fields `update` gets. */
type StateDef = { speed?: number; vz?: number; z?: number; fields?: Record<string, string | boolean> };
/** The humanoid state matrix (WP 0.11): locomotion, every pose, and both stances (while walking). */
export const STATES: Record<string, StateDef> = {
  idle: {},
  walk: { speed: 40 },
  run: { speed: 80 },
  dash: { speed: 260, fields: { dash: true } },
  air: { speed: 80, z: 12, fields: { air: true } },
  climb: { vz: 32, fields: { climb: true } },
  ...Object.fromEntries(POSES.map((pose) => [`pose-${pose}`, { fields: { pose } }])),
  ...Object.fromEntries(['guard', 'ready'].map((stance) => [`stance-${stance}`, { speed: 40, fields: { stance } }])),
};
/** The steps sampled: every 4th at facing 0, every 40th (among those) at the other seven, which differ only by the turn. */
export const everyNth = (facing: number) => (facing === 0 ? 4 : 40);

/** World position of a rig point: the root plus `rig._w` of the joint (the source's own transform), or the tip. */
function world(rig: SourceRig, point: string): V3 {
  if (point === 'tip') return [...rig.tip()];
  const offset = rig._w(rig.J[point]);
  return [rig.x + offset[0], rig.y + offset[1], rig.z + offset[2]];
}

/** One run of the humanoid matrix: a fresh rig of `build` in `state`, facing `facing`·π/4, for 120 steps. */
export function humanoidRun(engine: LoadedEngine, build: string, state: string, facing: number): object {
  const { speed = 0, vz = 0, z = 0, fields } = STATES[state];
  engine.seed(`humanoid/${build}/${state}`); // the same t0 at every facing: they differ only by the turn
  const rig = new engine.E.Humanoid({ build });
  const phi = (facing * Math.PI) / 4;
  const velocity = [speed * Math.cos(phi), speed * Math.sin(phi), vz];
  const input = { vx: velocity[0], vy: velocity[1], vz, facing: phi, ...fields };
  const [t0, root0, root] = [rig.t, [0, 0, z], [0, 0, z]];
  const samples: number[][] = [];
  for (let step = 1; step <= STEPS; step++) {
    for (let i = 0; i < 3; i++) root[i] += velocity[i] * DT;
    rig.update(DT, { x: root[0], y: root[1], z: root[2], ...input });
    if (step % everyNth(facing) === 0) samples.push([step, ...root, ...POINTS.flatMap((p) => world(rig, p))]);
  }
  return { state, facing, t0, root0, velocity, input, samples };
}

/** `humanoid-<build>.json`: every state at every facing. */
export function humanoidVectors(engine: LoadedEngine, build: string): object {
  const runs = grid(Object.keys(STATES), range(8)).map(([state, k]) => humanoidRun(engine, build, state, k));
  return { build, dt: DT, steps: STEPS, points: POINTS, sample: ['step', 'x', 'y', 'z', 'points xyz…'], runs };
}

/** The phases of `E.move`, and the points recorded per sample. */
const PHASES = ['wind', 'active', 'recover'];
const MOVE_POINTS = ['handR', 'handL', 'tip', 'footR'];

/** `E.move(name, u, phase)` for u = i/20 on `build`, each sample on a fresh rig at rest at t = 0 (see the README). */
export function moveRecord(engine: LoadedEngine, build: string, name: string, phase: string): object {
  const samples = range(21).map((i) => {
    engine.seed(`move/${build}/${name}/${phase}/${i}`);
    const rig = new engine.E.Humanoid({ build });
    rig.t = -1;
    rig.update(1, { x: 0, y: 0 });
    rig.t = -1;
    rig.update(1, { x: 0, y: 0, attack: engine.E.move(name, i / 20, phase) });
    return [i / 20, ...rig.hand('R'), ...rig.hand('L'), ...rig.tip(), ...world(rig, 'footR')];
  });
  return { build, move: name, phase, samples };
}

/** `moves.json`: every move of `E.MOVES`, its spec as `E.move` builds it, in every phase on every build. */
export function moveVectors(engine: LoadedEngine): object {
  const names = Object.keys(engine.E.MOVES);
  const specs = Object.fromEntries(names.map((name) => [name, { ...engine.E.move(name, 0, 'active').spec }]));
  const records = grid(grid(BUILDS, names), PHASES).map(([[b, n], p]) => moveRecord(engine, b, n, p));
  return { points: MOVE_POINTS, sample: ['u', 'points xyz…'], specs, records };
}

/** A Blob script segment: an `update` input held for `steps` steps, after an optional `kick`. */
type Segment = { steps: number; kick?: number; input: object };
const hold = (steps: number, input: object, kick?: number): Segment => ({ steps, ...(kick && { kick }), input });
/** The Blob scripts: the stress world's slime hop, kicks to the squash spring, and look turns. */
export const BLOB_SCRIPTS: Record<string, Segment[]> = {
  hop: [
    hold(20, { squash: 0, look: [1, 0] }),
    hold(20, { squash: -0.32, look: [1, 0.5], squint: true }),
    hold(15, { squash: -0.42, look: [1, 0.5], squint: true }),
    hold(30, { squash: 0.28, look: [0.5, 1], flap: 1 }),
    hold(35, { squash: 0, look: [-1, 0.2], flap: 0 }),
  ],
  kick: [hold(60, {}, -3), hold(60, { squash: 0.2, walk: 1 }, 5)],
  look: chunks([1, 0, 0, 1, -1, 0, 0.004, 0.005, 0, -1, 3, 4, -2, -2, 1, 0], 2).map((look) => hold(15, { look })),
};

/** One Blob script from a fresh `new E.Blob()`, sampled after every step. */
export function blobScript(engine: LoadedEngine, name: string): object {
  engine.seed(`blob/${name}`);
  const blob = new engine.E.Blob();
  const samples: number[][] = [];
  for (const { steps, kick, input } of BLOB_SCRIPTS[name]) {
    if (kick) blob.kick(kick);
    for (let i = 0; i < steps; i++) {
      blob.update(DT, input);
      samples.push([samples.length + 1, blob.sq, blob.sqV, blob.look[0], blob.look[1], blob.flap, blob.flapP]);
    }
  }
  return { script: name, segments: BLOB_SCRIPTS[name], samples };
}

/** The README written beside the vectors. */
function readme(commit: string, engineSha: string): string {
  return `# Reference vectors from my-3d2dge

Written by \`node x port refs\` (tools/cmd/port.ts, PLAN.md WP 0.11), which needs the source (\`node x src\`); never by
hand. \`--check\` and \`x check\` compare every file with \`${CHECKSUMS}\` (sha256), offline. A re-run is byte-identical,
so a diff means the source, the generator or the runtime changed: a baseline changes only with a written reason.

- **Source:** my-3d2dge@${commit}, \`${ENGINE}\` (sha256 ${engineSha}), on Node ${process.versions.node.split('.')[0]}, in
  a \`vm\` context whose only shim is \`console\` (a message fails the run). \`Math.random\` is \`E.rng\` seeded with the
  FNV-1a hash of each record's id (\`humanoid/<build>/<state>\`, \`move/<build>/<name>/<phase>/<i>\`,
  \`blob/<script>\`). Nothing is drawn, so no view hack runs (\`_cheat\` 0, \`_pitch\` and \`_camSide\` unset: a swing is
  vertical only with \`plane: 'side'\`, the left hand waves). No rig has a cape or long hair.
- **Numbers** are exact: the shortest decimal that parses back to the same double, \`-0\` kept. Times are in seconds.
- **Frames:** positions are the source's (x east, y south, z up, 16 units per metre, left-handed). To my-3dge (Appendix
  C): (x, y, z) → (x, z, y) / 16 m; facing φ (forward (cos φ, sin φ)) → yaw ψ = π/2 − φ; rig-local (f, r, z) → (−r, z,
  f) / 16; move fields by Appendix C's table.
- \`core.json\`, \`color.json\` (WP 1.1, bit for bit; angle helpers within 1e-12): each helper's inputs, then outputs;
  \`rng\` gives 64 outputs per seed, \`ease\` each curve at u = i/20.
- \`humanoid-<build>.json\` (WP 3.6): a run is a fresh \`new E.Humanoid({ build })\`; \`t0\`, its clock after construction,
  is the initial breathing phase (breathing is sin(2.3 t)) the port injects. Then ${STEPS} calls \`update(1/120, { x, y,
  z, ...input })\`, the root moving from \`root0\` by \`velocity\` × dt before each. Stances walk; moving states go along
  the facing φ = kπ/4, k = \`facing\`. A sample (after the step it names) is the root, then the world positions of
  \`points\` (root + \`rig._w(rig.J[…])\`, and \`rig.tip()\`): every ${everyNth(0)}th step at facing 0, every ${everyNth(1)}th at
  the others, which differ only by the root's turn (to rounding) and so check the facing conversion.
- \`moves.json\` (WP 6.1): \`E.move(name, u, phase)\` for every move in \`specs\`, each phase, u = i/20, each build. Each
  sample is a fresh rig: \`rig.t = -1; update(1, { x: 0, y: 0 })\` (the rest pose at t = 0, no breathing or sway), then
  \`rig.t = -1; update(1, { x: 0, y: 0, attack })\`: dt = 1 saturates every smoothing, so the pose is the move's own at
  (phase, u), the wind blending from the rest pose. A sample is u, then \`hand('R')\`, \`hand('L')\`, \`tip()\` and the
  right foot, the rig at the origin facing φ = 0 (world = rig-local (f, r, z), but for \`spin\`'s turn).
- \`blob.json\` (WP 5.3): scripts on a fresh \`new E.Blob()\`: each segment holds \`input\` for \`steps\` updates of
  1/120 s, after \`kick(v)\` when named; every step is sampled. Body radius R(1 − 0.55 sq), height and centre R(1 + sq).
`;
}

const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');

/** Every file of `PORT_DIR` but the checksums, by name, generated from the checkout at `sourcePath`. */
export function buildFiles(sourcePath: string, commit: string): { files: Record<string, string>; messages: string[] } {
  const engine = loadEngine(sourcePath);
  const json = (value: object) => `${layout(value)}\n`;
  const blob = { R: 6.5, sample: ['step', 'sq', 'sqV', 'lookX', 'lookY', 'flap', 'flapP'] };
  const files: Record<string, string> = {
    'README.md': readme(commit, sha256(readFileSync(join(sourcePath, ENGINE)))),
    'core.json': json(coreVectors(engine)),
    'color.json': json(colorVectors(engine)),
    ...Object.fromEntries(BUILDS.map((b) => [`humanoid-${b}.json`, json(humanoidVectors(engine, b))])),
    'moves.json': json(moveVectors(engine)),
    'blob.json': json({ ...blob, scripts: Object.keys(BLOB_SCRIPTS).map((name) => blobScript(engine, name)) }),
  };
  return { files, messages: engine.messages };
}

/** The checksums recorded in `dir`, by file name; undefined when there are none. */
function readChecksums(dir: string): Record<string, string> | undefined {
  const file = join(dir, CHECKSUMS);
  if (!existsSync(file)) return undefined;
  return (JSON.parse(readFileSync(file, 'utf8')) as { files: Record<string, string> }).files;
}

/** Writes `files` and their checksums into `dir`, and removes the files an earlier run wrote that are gone now. */
export function writeVectors(dir: string, files: Record<string, string>): void {
  mkdirSync(dir, { recursive: true });
  for (const old of Object.keys(readChecksums(dir) ?? {})) if (!(old in files)) rmSync(join(dir, old), { force: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  const names = Object.keys(files).sort();
  const sums = Object.fromEntries(names.map((name) => [name, sha256(files[name])]));
  writeFileSync(join(dir, CHECKSUMS), `${layout({ about: 'sha256 of each file, by x port refs', files: sums })}\n`);
}

/** Compares the vectors under `root` with their checksums, offline: a changed, missing or unlisted file fails. */
export function checkVectors(root: string): { failures: Finding[]; files: number } {
  const dir = join(root, PORT_DIR);
  const sums = readChecksums(dir) ?? {};
  const problem = (name: string) => {
    const file = join(dir, name);
    if (!existsSync(file)) return 'MISSING';
    if (name === CHECKSUMS) return '';
    if (!(name in sums)) return 'UNLISTED';
    return sha256(readFileSync(file)) === sums[name] ? '' : 'CHANGED';
  };
  const fix = 'only node x port refs writes here: regenerate, and give the reason (a baseline changed)';
  const names = new Set([CHECKSUMS, ...Object.keys(sums), ...(existsSync(dir) ? readdirSync(dir) : [])]);
  const failures = [...names].sort().flatMap((name) => {
    const [id, file] = [problem(name), `${PORT_DIR}/${name}`];
    return id ? [{ id: `PORT_${id}`, message: `${file} is ${id.toLowerCase()}: ${fix}`, file }] : [];
  });
  return { failures, files: Object.keys(sums).length };
}

/** Regenerates the vectors from the source; fails without writing when the source is unresolved or the engine speaks. */
function refs(root: string): CommandResult {
  const spec = sourceSpecs(root).find((candidate) => candidate.name === 'my-3d2dge');
  const source = spec && resolveSource(spec, { root });
  if (!spec || !source?.ok || !source.path) {
    const message = source?.problem ?? 'scripts/setup.sh names no my-3d2dge source';
    return { ok: false, summary: 'the source is unresolved', failures: [{ id: 'SRC_UNRESOLVED', message }] };
  }
  const { files, messages } = buildFiles(source.path, spec.commit);
  const failures = messages.map((said) => ({ id: 'PORT_ENGINE_SPOKE', message: `the engine printed "${said}"` }));
  if (failures.length) return { ok: false, summary: 'nothing written: the engine printed messages', failures };
  writeVectors(join(root, PORT_DIR), files);
  const sizes = Object.entries(files).map(([name, text]) => [name, Buffer.byteLength(text)] as const);
  const bytes = sizes.reduce((sum, [, size]) => sum + size, 0);
  return {
    ok: true,
    summary: `${sizes.length} files, ${(bytes / 1e6).toFixed(2)} MB, from my-3d2dge@${spec.commit.slice(0, 7)} in ${PORT_DIR}`,
    lines: sizes.map(([name, size]) => `${name}: ${size} bytes`),
    metrics: { files: sizes.length, bytes },
  };
}

export default {
  usage: 'port refs [--check]',
  options: { check: { type: 'boolean' } },
  maxPositionals: 1,
  async run({ values, positionals: [subject], root }): Promise<CommandResult> {
    if (subject !== 'refs') throw new UsageError(`${subject ? `no "${subject}" to port` : 'name what'}: refs`);
    if (!values.check) return { ...refs(root), target: 'refs' };
    const { failures, files } = checkVectors(root);
    const summary = `${files} files ${failures.length ? 'differ from' : 'match'} ${PORT_DIR}/${CHECKSUMS}`;
    return { ok: !failures.length, summary, failures, target: 'refs', metrics: { files } };
  },
} satisfies Command;

/** The `port` plugin of `x check`: the committed vectors still match their checksums. */
export const check: CheckPlugin = {
  name: 'port',
  run: ({ root }) => ({ failures: checkVectors(root).failures }),
};
