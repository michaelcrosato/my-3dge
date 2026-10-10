/**
 * @file The layer rules (PLAN.md §6.1; doctrines: WebGPU only, Reproducible): one `no-restricted-imports` block per
 * engine layer, naming what the layer may import, so a forbidden edge fails T0 with the rule and the way round it.
 *
 * Imports inside the engine are relative, so each pattern matches where an import climbs to: from
 * `engine/gfx/level/mesh.ts`, `../../physics/world` climbs into `physics`. The rule sees each relative source in its
 * shortest spelling from the importing file (`resolvingImports`, family.ts), so `../../../engine/physics/world` and
 * `./../../physics/world` are the same edge. Packages have single owners: only `physics/` imports Rapier, only `gfx/`
 * imports three.js, and `core/math.ts` alone takes three.js's math classes (`allowImportNames`). The sim-side
 * three.js ban itself is in simSide.ts, which also bans dynamic `import()`, a form these rules do not see. No engine
 * module imports the public barrels (`../index`, `../sim-api`, `..`): they are for game code, and re-export the
 * engine, so such an import is a cycle (WP 1.6). Tests (`*.test.ts`) may import anything.
 *
 * Invariants: every block lists its layer's whole policy (flat config keeps the last block that matches a file, so
 * the specific blocks, such as `core/math.ts` and `dev/bot.ts`, come after their layer's); the rule id is
 * `layer/no-restricted-imports`.
 *
 * @example
 * // engine/core/a.ts: import { World } from '../sim/world';
 * // → layer/no-restricted-imports: engine/core imports nothing from the other layers: …
 * @see tools/eslint/layers.test.ts
 */
import type { ESLint, Linter } from 'eslint';
import { family, resolvingImports } from './family';

/** The plugin the layer blocks use: core's `no-restricted-imports`, resolving, as `layer/no-restricted-imports`. */
export const layerPlugin: ESLint.Plugin = resolvingImports(family('layer', 'no-restricted-imports'));

/**
 * three.js's math classes, the only names `core/math.ts` takes from `three/webgpu` (§6.1); `Color` (from three.js's
 * `src/math/`) since WP 1.1, for engine/core/color.ts (ADR-0020 amendment 1).
 */
export const THREE_MATH = [
  'Vector3',
  'Quaternion',
  'Matrix4',
  'Euler',
  'Box3',
  'Sphere',
  'Ray',
  'Plane',
  'MathUtils',
  'Color',
];

/** A relative import that climbs one or more levels into one of `targets` (regular-expression fragments). */
const climb = (...targets: string[]) => `^(?:\\.\\./)+(?:${targets.join('|')})(?:/|$)`;
/** A relative import into one of `targets` beside the importing file. */
const beside = (...targets: string[]) => `^\\./(?:${targets.join('|')})(?:/|$)`;
/** `input/` other than `input/intents`: the input devices (presentation). */
const DEVICES = 'input/(?!intents(?:\\.ts)?(?:/|$))[^/]+';
/** `audio/` other than `audio/dsp`: the audio runtime. */
const AUDIO_RUNTIME = 'audio/(?!dsp(?:/|$))[^/]+';

type Pattern = { regex: string; message: string; allowTypeImports?: boolean; caseSensitive?: boolean };
type Path = { name: string; message: string; allowImportNames?: string[] };

const OUTSIDE: Pattern = {
  regex: climb('labs', 'fixtures', 'tests', 'tools'),
  message:
    'engine code never imports labs/, fixtures/, tests/ or tools/: game content and test helpers stay outside the engine; pass what the engine needs in through its API (PLAN.md §5.7, §6.1)',
};
const RAPIER: Pattern = {
  regex: '^@dimforge/',
  message:
    'only engine/physics/ imports Rapier: reach physics through the sim, or from presentation through the read-only QueryView that sim.snapshot() returns (PLAN.md §6.1)',
};
const THREE: Pattern = {
  regex: '^three(?:/|$)',
  message:
    'only engine/gfx/ imports three.js: take the math classes from core/math, and draw through gfx/ (PLAN.md §6.1)',
};
const ENHANCED: Pattern = {
  regex: '(?:^|/)enhanced(?:/|$)',
  message:
    'engine/gfx/enhanced/ is imported only by engine/gfx/features.ts: turn an optional GPU feature on through the feature registry (PLAN.md §6.1, §6.7)',
};
/** The public barrels from inside the engine: `../index`, `../sim-api`, or `..` (engine/ itself, its index). */
const BARRELS: Pattern = {
  regex: '^(?:(?:\\.\\./)+(?:index|sim-api)(?:\\.ts)?|\\.\\.(?:/\\.\\.)*)$',
  message:
    'engine code never imports the public barrels (engine/index.ts, engine/sim-api.ts): they re-export the engine, so the import makes a cycle; import the module that declares the name (PLAN.md §6.1)',
};
const SIM_TYPES = (layer: string): Pattern => ({
  regex: climb('sim'),
  allowTypeImports: true,
  message: `engine/${layer} reads the sim only through its types, snapshots and the read-only QueryView: use \`import type\`, and take the values from sim.snapshot() at run time (PLAN.md §6.1)`,
});

/** One layer's policy. */
interface Layer {
  /** The layer, as §6.1's table names it. */
  name: string;
  files: string[];
  ignores?: string[];
  /** What it may import, for the message. */
  may: string;
  /** How to get round the rule, for the message. */
  fix: string;
  /** Relative imports it may never make: climbs into these, then imports beside the file into `notBeside`. */
  never?: string[];
  notBeside?: string[];
  /** Further patterns and paths (packages, type-only edges). */
  patterns?: Pattern[];
  paths?: Path[];
}

const PUSH_DOWN = 'move what both need down into core, or have the caller pass it in';

/** §6.1's table, general blocks before the specific files that refine them. */
const LAYERS: Layer[] = [
  {
    name: 'core',
    files: ['engine/core/**'],
    may: 'core',
    fix: 'keep core self-contained; the layers above pass in what core needs',
    never: ['sim', 'physics', 'anim', 'world', 'input', 'audio', 'gfx', 'ui', 'dev', 'app'],
    patterns: [RAPIER],
  },
  {
    name: 'core/math.ts',
    files: ['engine/core/math.ts'],
    may: "core, and three.js's math classes from 'three/webgpu'",
    fix: 'keep core self-contained; the rest of three.js belongs to gfx/',
    never: ['sim', 'physics', 'anim', 'world', 'input', 'audio', 'gfx', 'ui', 'dev', 'app'],
    patterns: [RAPIER, { regex: '^three/(?!webgpu$)', message: THREE.message }],
    paths: [
      {
        name: 'three/webgpu',
        allowImportNames: THREE_MATH,
        message: `core/math re-exports three.js's math classes only (${THREE_MATH.join(', ')}); anything else belongs to gfx/ (PLAN.md §6.1)`,
      },
      { name: 'three', message: THREE.message },
    ],
  },
  ...(['anim', 'world'] as const).map((name): Layer => ({
    name,
    files: [`engine/${name}/**`],
    may: 'core',
    fix: PUSH_DOWN,
    never: ['sim', 'physics', 'anim', 'world', 'input', 'audio', 'gfx', 'ui', 'dev', 'app'].filter((n) => n !== name),
    patterns: [RAPIER],
  })),
  {
    name: 'input (devices)',
    files: ['engine/input/**'],
    may: 'core and input/intents',
    fix: 'turn device events into intents; app passes the camera in',
    never: ['sim', 'physics', 'anim', 'world', 'audio', 'gfx', 'ui', 'dev', 'app'],
    patterns: [THREE, RAPIER],
  },
  {
    name: 'input/intents',
    files: ['engine/input/intents.ts'],
    may: 'core',
    fix: 'intents are sim-side data: keep the devices out of them',
    never: ['sim', 'physics', 'anim', 'world', 'input', 'audio', 'gfx', 'ui', 'dev', 'app'],
    notBeside: ['[^/]+'],
    patterns: [RAPIER],
  },
  {
    name: 'audio/dsp',
    files: ['engine/audio/dsp/**'],
    may: 'core',
    fix: 'the DSP is sim-side and pure: the runtime calls it, never the reverse',
    never: ['sim', 'physics', 'anim', 'world', 'input', 'gfx', 'ui', 'dev', 'app', 'runtime', AUDIO_RUNTIME],
    patterns: [RAPIER],
  },
  {
    name: 'audio/runtime',
    files: ['engine/audio/runtime/**'],
    may: 'audio/dsp, core, and sim snapshot types and the QueryView',
    fix: 'play what events and snapshots describe',
    never: ['physics', 'anim', 'world', 'input', 'gfx', 'ui', 'dev', 'app'],
    patterns: [SIM_TYPES('audio/runtime'), THREE, RAPIER],
  },
  {
    name: 'physics',
    files: ['engine/physics/**'],
    may: 'core and Rapier',
    fix: PUSH_DOWN,
    never: ['sim', 'anim', 'world', 'input', 'audio', 'gfx', 'ui', 'dev', 'app'],
  },
  {
    name: 'sim',
    files: ['engine/sim/**'],
    may: 'core, anim, physics, world and input/intents',
    fix: 'presentation reads sim snapshots; the sim never reaches up',
    never: ['audio', 'gfx', 'ui', 'dev', 'app', DEVICES],
    patterns: [RAPIER],
  },
  {
    name: 'gfx',
    files: ['engine/gfx/**'],
    ignores: ['engine/gfx/enhanced/**', 'engine/gfx/features.ts'],
    may: "core, anim, world, sim types (snapshots, QueryView) and three.js ('three/webgpu', 'three/tsl', 'three/addons/*')",
    fix: 'draw from snapshots and descriptors; physics comes through the QueryView',
    never: ['physics', 'input', 'audio', 'ui', 'dev', 'app'],
    patterns: [SIM_TYPES('gfx'), ENHANCED, RAPIER],
  },
  {
    name: 'gfx/features.ts',
    files: ['engine/gfx/features.ts'],
    may: 'what gfx may, and gfx/enhanced/',
    fix: 'draw from snapshots and descriptors; physics comes through the QueryView',
    never: ['physics', 'input', 'audio', 'ui', 'dev', 'app'],
    patterns: [SIM_TYPES('gfx'), RAPIER],
  },
  {
    name: 'gfx/enhanced',
    files: ['engine/gfx/enhanced/**'],
    may: 'gfx, core and three.js',
    fix: 'an optional GPU feature works on what gfx gives it',
    never: ['sim', 'physics', 'anim', 'world', 'input', 'audio', 'ui', 'dev', 'app'],
    patterns: [RAPIER],
  },
  {
    name: 'ui',
    files: ['engine/ui/**'],
    may: 'core, input/intents and gfx',
    fix: 'show what snapshots and events say; app wires the rest',
    never: ['sim', 'physics', 'anim', 'world', 'audio', 'dev', 'app', DEVICES],
    patterns: [ENHANCED, THREE, RAPIER],
  },
  {
    name: 'dev',
    files: ['engine/dev/**'],
    may: 'everything but app',
    fix: 'app wires dev in, never the reverse',
    never: ['app'],
    patterns: [ENHANCED, THREE, RAPIER],
  },
  {
    name: 'dev/bot.ts',
    files: ['engine/dev/bot.ts'],
    may: 'the sim-side layers (core, sim, physics, anim, world, input/intents, audio/dsp)',
    fix: 'the bot is sim-side: it decides from sim state and emits intents',
    never: ['gfx', 'ui', 'app', 'dev', DEVICES, AUDIO_RUNTIME],
    notBeside: ['[^/]+'],
    patterns: [RAPIER],
  },
  {
    name: 'app',
    files: ['engine/app/**'],
    may: 'every layer',
    fix: 'wire the layers; three.js and Rapier stay with their owners',
    patterns: [ENHANCED, THREE, RAPIER],
  },
  {
    name: 'sim-api.ts',
    files: ['engine/sim-api.ts'],
    may: 'the sim-side layers (core, sim, physics, anim, world, input/intents, audio/dsp)',
    fix: 'x sim runs sim-side game code in Node: the sim barrel re-exports sim-side modules only',
    notBeside: ['gfx', 'ui', 'dev', 'app', 'index', DEVICES, AUDIO_RUNTIME],
    patterns: [THREE, RAPIER],
  },
];

/** The layer rules' blocks, in order. */
export function layerBlocks(): Linter.Config[] {
  return LAYERS.map((layer) => {
    const message = `engine/${layer.name} may import only ${layer.may}: ${layer.fix} (PLAN.md §6.1)`;
    const edges: Pattern[] = [];
    if (layer.never?.length) edges.push({ regex: climb(...layer.never), message });
    if (layer.notBeside?.length) edges.push({ regex: beside(...layer.notBeside), message });
    const patterns = [...edges, ...(layer.patterns ?? []), BARRELS, OUTSIDE].map((pattern) => ({
      caseSensitive: true,
      ...pattern,
    }));
    return {
      name: `layer: ${layer.name}`,
      files: layer.files,
      ignores: ['**/*.test.ts', ...(layer.ignores ?? [])],
      plugins: { layer: layerPlugin },
      rules: { 'layer/no-restricted-imports': ['error', { paths: layer.paths ?? [], patterns }] },
    };
  });
}
