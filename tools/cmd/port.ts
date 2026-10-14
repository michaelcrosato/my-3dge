/**
 * @file Records the reference vectors the ports from my-3d2dge are tested against (PLAN.md WP 0.11, §9.0): the old
 * engine's own outputs as text JSON in `tests/baselines/port/`, with a generated README that says what each file
 * holds, the source commit, the sampling and the conversion to my-3dge's frame (Appendix C). Consumers: WP 1.1
 * (`rng`, `hash2`, `noise2`, angle and colour helpers), 3.6 (the Humanoid state matrix), 5.3 (Blob updates) and 6.1
 * (`E.move`); WP 8.2 adds the library's clips: `--clips` (tools/anim/legacy-readable.ts) writes only `clips/`.
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
 * The builders and the old engine's loader are tools/lib/portVectors.ts's.
 *
 * Usage: node x port refs [--clips] [--check]. Exit 1 if the source is unresolved, the engine speaks or a check fails.
 * @see tools/cmd/port.test.ts
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { clipVectorFiles } from '../anim/legacy-readable';
import type { Finding } from '../lib/report';
import {
  blobScript,
  BLOB_SCRIPTS,
  BUILDS,
  colorVectors,
  coreVectors,
  ENGINE,
  everyNth,
  humanoidVectors,
  loadEngine,
  moveVectors,
  STEPS,
} from '../lib/portVectors';
import { resolveSource, sourceSpecs } from '../lib/source';
import { UsageError, type Command, type CommandResult } from '../x';
import type { CheckPlugin } from './check';

/** Where the vectors live, relative to the repository root. */
export const PORT_DIR = 'tests/baselines/port';
/** The file in `PORT_DIR` that records every other file's sha256. */
export const CHECKSUMS = 'checksums.json';

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
- \`clips/\` (WP 8.2): the library's clip decodes, written by \`x port refs --clips\`; its README says what they hold.
`;
}

const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');

/** Every file of `PORT_DIR` but the checksums and `clips/`, by name, generated from the checkout at `sourcePath`. */
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

/** Writes `files` (names may hold `/`) and their checksums into `dir`, and removes the files an earlier run wrote that
 * are gone now; of the files this run does not `own`, it keeps the recorded checksums. */
export function writeVectors(dir: string, files: Record<string, string>, owns = (_name: string) => true): void {
  const recorded = Object.entries(readChecksums(dir) ?? {});
  for (const [old] of recorded) if (owns(old) && !(old in files)) rmSync(join(dir, old), { force: true });
  const dirs = new Set([dir, ...Object.keys(files).map((name) => dirname(join(dir, name)))]);
  dirs.forEach((sub) => mkdirSync(sub, { recursive: true }));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  const all = [...recorded.filter(([name]) => !owns(name)), ...Object.entries(files).map(([n, t]) => [n, sha256(t)])];
  const sums = Object.fromEntries(all.sort(([a], [b]) => (a < b ? -1 : 1)));
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
  const listed = existsSync(dir) ? readdirSync(dir, { recursive: true, encoding: 'utf8' }) : [];
  const names = new Set([CHECKSUMS, ...Object.keys(sums), ...listed.filter((n) => statSync(join(dir, n)).isFile())]);
  const failures = [...names].sort().flatMap((name) => {
    const [id, file] = [problem(name), `${PORT_DIR}/${name}`];
    return id ? [{ id: `PORT_${id}`, message: `${file} is ${id.toLowerCase()}: ${fix}`, file }] : [];
  });
  return { failures, files: Object.keys(sums).length };
}

/** Regenerates the vectors (`clips`: only clips/); fails without writing if the source is unresolved or speaks. */
function refs(root: string, clips: boolean): CommandResult {
  const spec = sourceSpecs(root).find((candidate) => candidate.name === 'my-3d2dge');
  const source = spec && resolveSource(spec, { root });
  if (!spec || !source?.ok || !source.path) {
    const message = source?.problem ?? 'scripts/setup.sh names no my-3d2dge source';
    return { ok: false, summary: 'the source is unresolved', failures: [{ id: 'SRC_UNRESOLVED', message }] };
  }
  const built = clips ? clipVectorFiles(source.path, spec.commit, layout, root) : buildFiles(source.path, spec.commit);
  const { files, messages, artifacts } = { artifacts: [], ...built };
  const failures = messages.map((said) => ({ id: 'PORT_ENGINE_SPOKE', message: `the engine printed "${said}"` }));
  if (failures.length) return { ok: false, summary: 'nothing written: the engine printed messages', failures };
  writeVectors(join(root, PORT_DIR), files, (name) => name.startsWith('clips/') === clips);
  const sizes = Object.entries(files).map(([name, text]) => [name, Buffer.byteLength(text)] as const);
  const bytes = sizes.reduce((sum, [, size]) => sum + size, 0);
  return {
    ok: true,
    summary: `${sizes.length} files, ${(bytes / 1e6).toFixed(2)} MB, from my-3d2dge@${spec.commit.slice(0, 7)} in ${PORT_DIR}`,
    lines: sizes.map(([name, size]) => `${name}: ${size} bytes`),
    metrics: { files: sizes.length, bytes },
    artifacts,
  };
}

export default {
  usage: 'port refs [--clips] [--check]',
  options: { check: { type: 'boolean' }, clips: { type: 'boolean' } },
  maxPositionals: 1,
  async run({ values, positionals: [subject], root }): Promise<CommandResult> {
    if (subject !== 'refs') throw new UsageError(`${subject ? `no "${subject}" to port` : 'name what'}: refs`);
    if (!values.check) return { ...refs(root, Boolean(values.clips)), target: values.clips ? 'clips' : 'refs' };
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
