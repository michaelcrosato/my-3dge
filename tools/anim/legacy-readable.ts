/**
 * @file The legacy oracle (PLAN.md WP 8.2, §10.5 step 3): my-3d2dge's own readable codec, `src/mocap/readable.js`,
 * run from the checkout at `$MY3D2DGE_SRC` in a fresh Node `vm` context, as `my-3d2dge:tools/mocap-lib.mjs:7-9`
 * does, and its animation sets read the same way. Nothing is copied: the port (engine/anim/clip/readable.ts) is
 * tested against the source itself wherever it resolves.
 *
 * It also records what `x port refs --clips` writes (tools/cmd/port.ts formats and checksums it): the oracle's own
 * decodes, `MR.pose` of every frame at 30 fps of the 325 curated clips, each on its own source's rest body, as the
 * source's Float32Array holds them. Three frames per clip are committed; every frame is pinned by its clip's sha256
 * (little-endian float32 bytes) and regenerable. The decodes read the source's sets, never data/anim/sets/.
 *
 * @example
 * frameCount(2.5); // 76 frames at 30 fps
 * sampledFrames(76); // [0, 25, 50]: the frames committed
 * float32Number(Math.fround(0.1)); // 0.1, not 0.10000000149011612
 * // with the checkout: loadLegacyReadable(source).pose(set.sources[clip.src].rest, clip, t, out)
 * @see engine/anim/clip/readable.test.ts
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import type { Artifact } from '../lib/report';

/** The parts of the source's `MocapReadable` the tests and `x port` call (its own names; see the source). */
export interface LegacyReadable {
  POINTS: string[];
  P: number;
  pose(rest: object, clip: object, t: number, out?: Float32Array | Float64Array): Float32Array;
  moveAt(rest: object, clip: object, t: number): number[] | null;
  keyAt(clip: object, t: number): Record<string, number[]>;
  text(clip: object): string;
  parse(text: string | object): Record<string, unknown> & { keys: object[]; dur: number };
  mirror(clip: object): object;
  error(a: ArrayLike<number>, b: ArrayLike<number>): number;
}

/** A source set file's object (`window.MOCAP[name]`), as the tests read it. */
export interface LegacySet {
  set: string;
  fps: number;
  sources: Record<string, { rest: object }>;
  clips: Record<string, { src: string; dur: number; keys: object[] } & Record<string, unknown>>;
}

/** Runs one source file in a fresh `vm` context holding `globals`, which then also holds its top-level `var`s. */
function run<T extends object>(file: string, globals: T): T {
  vm.runInNewContext(readFileSync(file, 'utf8'), globals, { filename: file });
  return globals;
}

/** The codec's file in the source checkout. */
export const LEGACY_CODEC = 'src/mocap/readable.js';

/** The source's `MocapReadable`, loaded from the checkout at `sourcePath`. */
export function loadLegacyReadable(sourcePath: string): LegacyReadable {
  return run(join(sourcePath, LEGACY_CODEC), { MocapReadable: {} as LegacyReadable }).MocapReadable;
}

/** The source's set `name` (`quaternius`, `mesh2motion`, `cmu`, `hero`), read from `src/mocap/sets/<name>.js`. */
export function readLegacySet(sourcePath: string, name: string): LegacySet {
  const globals = { window: {} as { MOCAP?: Record<string, LegacySet> } };
  run(join(sourcePath, 'src/mocap/sets', `${name}.js`), globals);
  const sets = Object.values(globals.window.MOCAP ?? {});
  if (sets.length !== 1) throw new Error(`src/mocap/sets/${name}.js defines ${sets.length} sets, not one`);
  return sets[0];
}

/** The curated sets, 325 clips (HERO, Emberdeep's subset, is dropped: PLAN.md §10.1). */
export const CURATED_SETS = ['quaternius', 'mesh2motion', 'cmu'];
/** The rate the clips are decoded at, frames per second. */
export const CLIP_FPS = 30;
/** How many frames a clip of `dur` seconds has at 30 fps (`my-3d2dge:src/mocap/mocap.js`'s count). */
export const frameCount = (dur: number) => Math.round(dur * CLIP_FPS) + 1;
/** The frames committed for a clip of `n` frames: the first, and those a third and two thirds of the way in. */
export const sampledFrames = (n: number) => [...new Set([0, Math.floor((n - 1) / 3), Math.floor((2 * (n - 1)) / 3)])];

/** A float32 as the double of its shortest decimal that reads back to it through `Math.fround`, `-0` kept. */
export function float32Number(value: number): number {
  if (Object.is(value, -0) || !Number.isFinite(value)) return value;
  for (let digits = 1; digits < 9; digits++) {
    const short = Number(value.toPrecision(digits));
    if (Math.fround(short) === value) return short;
  }
  return Number(value.toPrecision(9));
}

/** Every frame of a clip decoded by the oracle at 30 fps on its own source's rest body: frames × 108 float32s. */
export function decodeLegacyClip(MR: LegacyReadable, set: LegacySet, name: string): Float32Array {
  const clip = set.clips[name];
  const [n, size] = [frameCount(clip.dur), MR.P * 3];
  const frames = new Float32Array(n * size);
  for (let f = 0; f < n; f++) frames.set(MR.pose(set.sources[clip.src].rest, clip, f / CLIP_FPS), f * size);
  return frames;
}

/** The sha256 of decoded frames: their float32 bytes, little-endian, frame after frame. */
export const framesSha256 = (frames: Float32Array) =>
  createHash('sha256')
    .update(new Uint8Array(frames.buffer, frames.byteOffset, frames.byteLength))
    .digest('hex');

/**
 * One set's clip vectors, `file` naming it: each clip's `sha256` of every frame and its sampled frames, as committed;
 * with `every`, each clip's every frame instead (the full set, for out/port/clips/).
 */
export function legacyClipVectors(MR: LegacyReadable, set: LegacySet, file: string, every = false): object {
  const size = MR.P * 3;
  const row = (frames: Float32Array, f: number) => [
    f,
    ...Array.from(frames.subarray(f * size, f * size + size), float32Number),
  ];
  const clips = Object.keys(set.clips).map((name) => {
    const frames = decodeLegacyClip(MR, set, name);
    const n = frames.length / size;
    const picked = every ? Array.from({ length: n }, (_, f) => f) : sampledFrames(n);
    const about = { clip: name, src: set.clips[name].src, frames: n, sha256: framesSha256(frames) };
    return { ...about, samples: picked.map((f) => row(frames, f)) };
  });
  return { set: set.set, file, fps: CLIP_FPS, points: MR.POINTS, sample: ['frame', 'points f r z…'], clips };
}

const fileSha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

/** The README written beside the clip vectors, naming the source commit and the files decoded. */
export function clipVectorsReadme(sourcePath: string, commit: string): string {
  const files = [LEGACY_CODEC, ...CURATED_SETS.map((name) => `src/mocap/sets/${name}.js`)];
  const shas = files.map((file) => `  - \`${file}\`: sha256 ${fileSha(join(sourcePath, file))}`).join('\n');
  return `# Clip decodes from my-3d2dge

Written by \`node x port refs --clips\` (tools/cmd/port.ts, tools/anim/legacy-readable.ts, PLAN.md WP 8.2), which needs
the source (\`node x src\`); never by hand. \`--check\` and \`x check\` compare them with \`../checksums.json\`, offline.

- **Source:** my-3d2dge@${commit}. The oracle is its own codec, run in a Node
  ${process.versions.node.split('.')[0]} \`vm\` context; the clips are its own sets, never data/anim/sets/:
${shas}
- **Decodes:** \`MR.pose(rest, clip, frame / ${CLIP_FPS})\` for every frame of every clip, \`frames\` = round(dur × ${CLIP_FPS}) + 1,
  on the clip's own source's rest body (\`set.sources[clip.src].rest\`), as the source's Float32Array holds them: the
  36 \`points\`, each \`[f, r, z]\` in mm (forward, right, up; to my-3dge, Appendix C: (−r, z, f) / 1000 m).
- **Committed:** three samples per clip, frames 0, ⌊(n − 1)/3⌋ and ⌊2(n − 1)/3⌋, each \`[frame, …108 numbers]\`, every
  number the shortest decimal that reads back to the same float32 (\`Math.fround\`), \`-0\` kept.
- **Checksums:** a clip's \`sha256\` covers all its frames: their float32 bytes, little-endian, frame after frame. The
  full set is regenerable: \`--clips\` also writes every frame to \`out/port/clips/<set>.json\`, in this layout.
- engine/anim/clip/readable.test.ts holds the port to these within 0.001 mm and the oracle to them bit for bit.
`;
}

/**
 * The files `x port refs --clips` writes, from the checkout at `sourcePath`: `clips/` (the README, and each set's
 * samples and checksums), returned in `files`, which tools/cmd/port.ts writes and checksums; and every frame of each set,
 * written here to `out/port/clips/<set>.json` under `root` and listed in `artifacts`. `layout` lays a value out.
 */
export function clipVectorFiles(sourcePath: string, commit: string, layout: (value: object) => string, root: string) {
  const json = (value: object) => `${layout(value)}\n`;
  const MR = loadLegacyReadable(sourcePath);
  const files: Record<string, string> = { 'clips/README.md': clipVectorsReadme(sourcePath, commit) };
  const artifacts: Artifact[] = [];
  mkdirSync(join(root, 'out/port/clips'), { recursive: true });
  for (const name of CURATED_SETS) {
    const [set, file, path] = [
      readLegacySet(sourcePath, name),
      `src/mocap/sets/${name}.js`,
      `out/port/clips/${name}.json`,
    ];
    files[`clips/${name}.json`] = json(legacyClipVectors(MR, set, file));
    writeFileSync(join(root, path), json(legacyClipVectors(MR, set, file, true)));
    artifacts.push({ path, kind: 'json', describes: `every frame of ${name}'s clips, decoded by the source` });
  }
  return { files, artifacts, messages: [] as string[] };
}
