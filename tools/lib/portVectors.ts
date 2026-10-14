/**
 * @file The port vectors' builders (PLAN.md WP 0.11, §9.0), for `x port refs` (tools/cmd/port.ts, which formats,
 * writes and checks them): `loadEngine` loads `my-3d2dge:engine/my-3d2dge.js` from a checkout into a Node `vm`
 * context (`console` the only shim; `Math.random` the engine's own `rng`, reseeded per record from its id), and each
 * builder records one file's worth of the old engine's outputs: `coreVectors` (`rng`, `hash2`, `noise2`, the angle
 * helpers), `colorVectors`, `humanoidVectors` per build (the state matrix of `STATES` at eight facings, sampled
 * `everyNth`), `moveVectors` (`E.move` in every phase on every build) and `blobScript` (the `BLOB_SCRIPTS`). Split from
 * tools/cmd/port.ts to keep each under 400 lines (ADR-0014 amendment 16).
 *
 * Invariants: dt is fixed (1/120 s) and every record is seeded from its id, so a re-run gives the same numbers;
 * humanoid runs record their initial breathing phase (`my-3d2dge:engine/my-3d2dge.js:1782`) for WP 3.6 to inject.
 *
 * @example
 * import { resolveSource, sourceSpecs } from './source';
 * const spec = sourceSpecs().find((candidate) => candidate.name === 'my-3d2dge')!;
 * const engine = loadEngine(resolveSource(spec).path!);
 * Object.keys(coreVectors(engine)); // the helpers WP 1.1 ports
 * @see tools/cmd/port.test.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { fnv1a } from './hash';

/** The engine file inside the source checkout. */
export const ENGINE = 'engine/my-3d2dge.js';
/** The fixed step, seconds. */
export const DT = 1 / 120;
/** The steps of each humanoid run. */
export const STEPS = 120;

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
